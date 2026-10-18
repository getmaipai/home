import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, musicJobs, people, pictureJobs } from "@/db/schema";
import { attachmentFilePath, createAttachment, deleteAttachmentsForPerson, readAttachment } from "@/lib/attachments";
import { deleteConversationById, resolveOrCreateConversation, runRetention } from "@/lib/conversationHistory";
import { listFilesVisibleToActor } from "@/lib/shares";
import { createHost } from "@/lib/packageHost";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { loadSource, saveVersion } from "@/lib/imageEdit";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { installFakeImageStack, until } from "./pictureFixture";
import { installFakeVideoStack } from "./videoFixture";
import { startPictureJob, getPictureJob } from "@/lib/pictures/jobs";
import { startVideoJob, getVideoJobFor } from "@/lib/videos/jobs";
import { __resetAgeCheckForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";

afterEach(() => { __resetAgeCheckForTests(); __setKeyframesForTests(null); });

function context(stale = false) {
  const now = new Date().toISOString();
  const actor = db.insert(people).values({ id: newPersonId(), displayName: "Sage", role: "owner", avatarSeed: "sage", source: "hub", createdAt: now, updatedAt: now, hlc: nextHlc() }).returning().get()!;
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const conversationId = conversation.value.id;
  const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "a picture", replyText: "saved", source: "model", safetyAction: "allow", createdAt: stale ? new Date(Date.now() - 100 * 86400000).toISOString() : now, hlc: nextHlc() }).run();
  return { actor, conversationId, turnId };
}

for (const mode of ["delete", "retention"] as const) {
  test(`kept files and output jobs survive ${mode}, conversation files do not`, () => {
    const c = context(mode === "retention");
    const make = (retention: "kept" | "conversation") => {
      const result = createAttachment(c.actor, { ...c, mediaType: "text/plain", bytes: new TextEncoder().encode(`${c.turnId}-${retention}`), retention });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    const kept = make("kept"), disposable = make("conversation");
    const now = new Date().toISOString();
    const jobId = `job-${c.turnId}`;
    db.insert(musicJobs).values({ id: jobId, personId: c.actor.id, conversationId: c.conversationId, turnId: c.turnId, task: "generate", request: "{}", state: "done", fileId: kept.id, createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
    db.insert(pictureJobs).values({ id: jobId, personId: c.actor.id, conversationId: c.conversationId, turnId: c.turnId, kind: "generate", state: "done", prompt: "a boat", request: "{}", files: JSON.stringify([{ id: kept.id }]), createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
    const discardedJobId = `${jobId}-discarded`;
    const music = db.select().from(musicJobs).where(eq(musicJobs.id, jobId)).get()!;
    const picture = db.select().from(pictureJobs).where(eq(pictureJobs.id, jobId)).get()!;
    db.insert(musicJobs).values({ ...music, id: discardedJobId, fileId: disposable.id }).run();
    db.insert(pictureJobs).values({ ...picture, id: discardedJobId, files: JSON.stringify([{ id: disposable.id }]) }).run();
    if (mode === "delete") expect(deleteConversationById(c.actor, c.conversationId).ok).toBe(true);
    else expect(runRetention().deleted).toBeGreaterThanOrEqual(1);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, c.turnId)).get()).toBeUndefined();
    expect(readAttachment(c.actor, kept.id).ok).toBe(true);
    expect(listFilesVisibleToActor(c.actor).map((item) => item.file.id)).toContain(kept.id);
    expect(db.select().from(attachments).where(eq(attachments.id, kept.id)).get()?.turnId).toBeNull();
    expect(existsSync(attachmentFilePath(disposable.storage_path))).toBe(false);
    expect(db.select().from(attachments).where(eq(attachments.id, disposable.id)).get()).toBeUndefined();
    expect(db.select().from(musicJobs).where(eq(musicJobs.id, jobId)).get()?.fileId).toBe(kept.id);
    expect(db.select().from(pictureJobs).where(eq(pictureJobs.id, jobId)).get()).toBeDefined();
    expect(db.select().from(musicJobs).where(eq(musicJobs.id, discardedJobId)).get()).toBeUndefined();
    expect(db.select().from(pictureJobs).where(eq(pictureJobs.id, discardedJobId)).get()).toBeUndefined();
    const manifest = PackageManifest.parse({ id: "test-library", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Library test", description: "Library test package.", author: "test", license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0, permissions: [] });
    createHost(c.actor, manifest).data.forget(c.actor.id);
    expect(deleteAttachmentsForPerson(c.actor.id)).toBe(0);
    expect(existsSync(attachmentFilePath(kept.storage_path))).toBe(false);
    expect(listFilesVisibleToActor(c.actor)).toHaveLength(0);
    expect(db.select().from(musicJobs).where(eq(musicJobs.id, jobId)).get()).toBeUndefined();
    expect(db.select().from(pictureJobs).where(eq(pictureJobs.id, jobId)).get()).toBeUndefined();
  });
}

test("generated picture, video and poster records default to kept", async () => {
  const c = context();
  __resetAgeCheckForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
  __setKeyframesForTests(async () => null);
  const picture = installFakeImageStack();
  const video = installFakeVideoStack({ pollsToFinish: 1 });
  try {
    const pic = await startPictureJob({ ...c, temporary: false, kind: "generate", prompt: "a boat", body: { prompt: "a boat", audience: "all-ages" } });
    await until(() => getPictureJob(c.actor, pic.id)?.state === "done");
    const pictureId = getPictureJob(c.actor, pic.id)!.files[0]!.id;
    const source = loadSource(c.actor, c.conversationId, pictureId, true);
    const edited = await saveVersion(c.actor, source, source.bytes, { op: "comment", label: "Soft light" });
    expect(db.select().from(attachments).where(eq(attachments.id, edited.id)).get()?.retention).toBe("kept");
    const clip = await startVideoJob({ ...c, temporary: false, kind: "generate", prompt: "a boat", body: { prompt: "a boat", audience: "all-ages" } });
    await until(() => getVideoJobFor(c.actor, clip.id)?.state === "done");
    const rows = db.select().from(attachments).where(eq(attachments.turnId, c.turnId)).all();
    expect(rows.map((row) => row.mediaType).sort()).toEqual(["image/jpeg", "image/png", "image/png", "video/mp4"]);
    expect(rows.every((row) => row.retention === "kept")).toBe(true);
    expect(deleteConversationById(c.actor, c.conversationId).ok).toBe(true);
    for (const row of rows) expect(readAttachment(c.actor, row.id).ok).toBe(true);
    expect(getVideoJobFor(c.actor, clip.id)?.files).toHaveLength(1);
  } finally {
    picture.restore(); video.restore(); __resetAgeCheckForTests(); __setKeyframesForTests(null);
  }
});
