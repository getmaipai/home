// CREATOR-02 review fixes (CREATOR-PORT-2026-11-13): the lock follows every file of a clip, a failing record writer never breaks a job, the back-fill runs only after
// the lock gate and keeps the id already in the file note, and deleting a subject takes its cast rows.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, conversationTurns, creationCast, creations } from "@/db/schema";
import { __resetAdultLockForTests, withMark } from "@/lib/adultLock";
import { storeFile } from "@/lib/attachments";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { creationOfFile, readCreationByFile, recordCreation, rebuildCreationCast } from "@/lib/creations/store";
import { backfillCreationForFile } from "@/lib/creations/backfill";
import { __setWriterFaultForTests } from "@/lib/creations/writers";
import { createMediaSubject, deleteMediaSubject } from "@/lib/mediaSubjects";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeImageStack, testPng, until } from "./pictureFixture";
import { household, makeClip, unlock, unlockHeader, PASSCODE, PLAIN_PROMPT } from "./fixtures/adultLock";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { resetFitAsksForTests, resetTierStateForTests, resetChatActivityForTests, resetFitMemoryForTests, resetDownshiftForTests, resetActivePlanForTests, setBudgetReader } from "@/lib/jobs/householdQueue";
import { wireQueuePolicy } from "@/lib/jobs/queuePolicy";
import type { PersonRow } from "@/types";

setDefaultTimeout(30_000);
const PLAIN = { people_count: 0, apparent_min_age_estimate: null, label: "none", is_nude_or_sexual: false, confidence: 0.99 } as never;
let fakeImages: ReturnType<typeof installFakeImageStack> | null = null;
let fakeVideo: FakeVideoStack | null = null;
beforeEach(() => {
  resetDb(); __resetAdultLockForTests(); __resetVideoAdapterCacheForTests();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: PLAIN })));
  setBudgetReader(async () => ({ freeMemoryBytes: 10_000_000_000, loaded: [], readingDegraded: false }));
  wireQueuePolicy();
  resetFitAsksForTests(); resetTierStateForTests(); resetChatActivityForTests(); resetFitMemoryForTests(); resetDownshiftForTests(); resetActivePlanForTests();
});
afterEach(() => { __setWriterFaultForTests(null); fakeImages?.restore(); fakeVideo?.restore(); fakeImages = null; fakeVideo = null; setBudgetReader(null); __resetAdultLockForTests(); });

async function makeJob(actor: PersonRow, onDone?: (id: string) => Promise<void>) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const conversationId = conversation.value.id; const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "p", replyText: "m", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  const job = await startPictureJob({ actor, conversationId, turnId, temporary: false, kind: "generate", prompt: "a quiet landscape", body: { prompt: "a quiet landscape", size: "1024x1024", audience: "all-ages", n: 1 } as never, ...(onDone ? { onDone } : {}) } as never);
  await until(() => getPictureJob(actor, job.id)?.state === "done");
  return getPictureJob(actor, job.id)!;
}
const lockOf = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance;

describe("CREATOR-02 review", () => {
  test("clearing the lock of a clip also clears its 5.1 sibling, and the record follows both", async () => {
    fakeVideo = installFakeVideoStack();
    const h = await household(); const actor = h.row("Marlow");
    const clip = await makeClip(h.adult.client, actor, PLAIN_PROMPT);
    const sibling = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: await testPng(), deduplicate: false, retention: "kept", provenance: `video-gen:${JSON.stringify({ v: 1, audience: "all-ages", made_audience: "all-ages", lock: "off", creation: creationOfFile(actor.id, clip.fileId)!.id, job: clip.jobId, role: "surround_5_1" })}` });
    if (!sibling.ok) throw new Error(sibling.error);
    recordCreation(actor, { kind: "video", fileIds: [clip.fileId, sibling.value.id], recipe: { tool: "video", route: "text" } });
    for (const row of db.select().from(attachments).all()) { if (!row.provenance.includes(`"job":"${clip.jobId}"`)) continue; const next = withMark(row.provenance, { lock: "on", raiseToAdult: true }); if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, row.id)).run(); }
    const { syncCreationMarkForFile } = await import("@/lib/creations/store");
    syncCreationMarkForFile(clip.fileId);
    expect(db.select().from(creations).all()[0]).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    const ticket = (await (await h.adult.client.post("/api/adult-lock/confirm", { secret: PASSCODE, action: "unmark", item: clip.jobId })).json() as { ticket: string }).ticket;
    expect((await h.adult.client.post(`/api/videos/jobs/${clip.jobId}/adult-mark`, { action: "clear", ticket })).status).toBe(200);
    for (const id of [clip.fileId, sibling.value.id, clip.posterId]) expect(lockOf(id)).toContain('"lock":"off"');
    expect(lockOf(sibling.value.id)).toContain('"audience":"adult-only"');
    expect(db.select().from(creations).all()[0]).toMatchObject({ madeAudience: "adult-only", lock: "off" });
    expect((await h.adult.client.get(`/api/creations/by-file/${clip.fileId}`)).status).toBe(200);
  });

  test("a record writer that throws leaves a picture job done, runs its callbacks, and leaves a clip job done", async () => {
    fakeImages = installFakeImageStack({ pollsToFinish: 1 });
    fakeVideo = installFakeVideoStack();
    const h = await household(); const actor = h.row("Marlow");
    __setWriterFaultForTests(() => { throw new Error("boom"); });
    let called = "";
    const done = await makeJob(actor, async (id) => { called = id; });
    expect(done.state).toBe("done");
    await until(() => called !== "");
    expect(called).toBe(done.files[0]!.id);
    const clip = await makeClip(h.adult.client, actor, PLAIN_PROMPT);
    expect(getVideoJobFor(actor, clip.jobId)!.state).toBe("done");
    expect(db.select().from(creations).all()).toHaveLength(0);
  });

  test("the back-fill does not run for a locked item without the unlock, runs with it, and keeps the id from the file note", async () => {
    fakeImages = installFakeImageStack({ pollsToFinish: 1 });
    const h = await household(); const actor = h.row("Marlow");
    const job = await makeJob(actor);
    const fileId = job.files[0]!.id;
    const id = creationOfFile(actor.id, fileId)!.id;
    const note = db.select().from(attachments).where(eq(attachments.id, fileId)).get()!.provenance;
    db.update(attachments).set({ provenance: withMark(note, { lock: "on", raiseToAdult: true })! }).where(eq(attachments.id, fileId)).run();
    db.delete(creations).run();
    const locked = await h.adult.client.get(`/api/creations/by-file/${fileId}`);
    expect(locked.status).toBe(404);
    expect(db.select().from(creations).all()).toHaveLength(0);
    const proof = unlockHeader(await unlock(h.adult.client));
    const open = await h.adult.client.get(`/api/creations/by-file/${fileId}`, proof);
    expect(open.status).toBe(200);
    expect(((await open.json()) as { id: string }).id).toBe(id);
  });

  test("the back-fill never runs for a minor reaching an adult-only item", async () => {
    const h = await household(); const actor = h.row("Nova");
    const png = await testPng();
    const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: png, deduplicate: false, retention: "kept", provenance: `picture-gen:${JSON.stringify({ v: 1, audience: "adult-only", made_audience: "adult-only", lock: "on", job: "pjob-none", index: 0 })}` });
    if (!stored.ok) throw new Error(stored.error);
    let tried = 0;
    expect(readCreationByFile(actor, stored.value.id, undefined, () => { tried += 1; return false; }).state).toBe("none");
    expect(tried).toBe(0);
    expect(backfillCreationForFile(actor, stored.value.id)).toBe(false);
  });

  test("deleting a subject removes its cast rows, and a rebuild does not bring them back", async () => {
    const h = await household(); const actor = h.row("Marlow");
    const subject = createMediaSubject(actor, { name: "Mop", kind: "character", look: "a small grey mop", referenceIds: [], real: false } as never);
    const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await testPng(), deduplicate: false, retention: "kept", provenance: `picture-gen:${JSON.stringify({ v: 1, audience: "all-ages", made_audience: "all-ages", lock: "off", job: "pjob-x", index: 0 })}` });
    if (!stored.ok) throw new Error(stored.error);
    recordCreation(actor, { kind: "picture", fileIds: [stored.value.id], recipe: { tool: "p", route: "text" }, cast: [{ subject_id: subject.id, role: "lead" }] });
    expect(db.select().from(creationCast).all()).toHaveLength(1);
    expect(deleteMediaSubject(actor, subject.id)).toBe(true);
    expect(db.select().from(creationCast).all()).toHaveLength(0);
    rebuildCreationCast();
    expect(db.select().from(creationCast).all()).toHaveLength(0);
  });
});
