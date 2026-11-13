// CREATOR-02 (CREATOR-PORT-2026-11-13, docs/design/creatoros-port-2026-11-13.md section 7): the creation store. A record is written once, only when a finished job
// has stored its file; only the maker reads it; a locked or adult-only item's record follows the item's lock; a purge takes it away; and the migration lands on
// a database that already holds rows.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { attachments, conversationTurns, creationCast, creations } from "@/db/schema";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { purgeFileRecord } from "@/lib/attachments";
import { __resetAdultLockForTests, __unlockedForTests, withMark } from "@/lib/adultLock";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { saveVersion, type SourcePicture } from "@/lib/imageEdit";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { creationIdOfFile, creationOfFile, rebuildCreationCast, readCreationByFile, recordCreation } from "@/lib/creations/store";
import { backfillCreationForFile } from "@/lib/creations/backfill";
import { recordClipCreation, recordFilmCreation } from "@/lib/creations/writers";
import { getVideoJobFor, type ReferenceRecipe } from "@/lib/videos/jobs";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeImageStack, testPng, until } from "./pictureFixture";
import { makePicture } from "./fixtures/adultLockPicture";
import { household, makeClip, markAdultOnly, unlock, unlockHeader, PLAIN_PROMPT } from "./fixtures/adultLock";
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
afterEach(() => { fakeImages?.restore(); fakeVideo?.restore(); fakeImages = null; fakeVideo = null; setBudgetReader(null); __resetAdultLockForTests(); });

async function makeJob(actor: PersonRow, prompt = "a quiet landscape") {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const conversationId = conversation.value.id; const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: prompt, replyText: "making", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  const job = await startPictureJob({ actor, conversationId, turnId, temporary: false, kind: "generate", prompt, body: { prompt, size: "1024x1024", audience: "all-ages", n: 1 } as never });
  return { job, conversationId, turnId };
}
const finished = async (actor: PersonRow, id: string) => { await until(() => getPictureJob(actor, id)?.state === "done"); return getPictureJob(actor, id)!; };
const records = () => db.select().from(creations).all();
const noteOf = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance;

describe("CREATOR-02 writing", () => {
  test("a picture job writes its record when it finishes, never before, and the file note points to it", async () => {
    fakeImages = installFakeImageStack({ pollsToFinish: 3 });
    const h = await household(); const actor = h.row("Marlow");
    const { job } = await makeJob(actor);
    expect(records()).toHaveLength(0);
    const done = await finished(actor, job.id);
    expect(records()).toHaveLength(1);
    const fileId = done.files[0]!.id;
    const record = creationOfFile(actor.id, fileId)!;
    expect(noteOf(fileId)).toContain(`"creation":"${record.id}"`);
    expect(record).toMatchObject({ kind: "picture", file_ids: [fileId], job_ids: [job.id], recipe: { tool: "pictures", route: "text" }, words: { written: "a quiet landscape" }, cast: [], parent_id: null, review: "pending", made_audience: "all-ages", lock: "off" });
    expect(record.generation).toMatchObject({ kind: "picture", job_id: expect.any(String), commercial_use: "unknown" });
  });

  test("a job that fails or is stopped writes nothing", async () => {
    fakeImages = installFakeImageStack({ pollsToFinish: 50 });
    const h = await household(); const actor = h.row("Marlow");
    const { job } = await makeJob(actor);
    const { cancelPictureJob } = await import("@/lib/pictures/jobs");
    await cancelPictureJob(actor, job.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(records()).toHaveLength(0);
  });

  test("recordCreation never throws and writes nothing for a bad file id, and a second call for the same file updates the one record", async () => {
    fakeImages = installFakeImageStack({ pollsToFinish: 1 });
    const h = await household(); const actor = h.row("Marlow");
    expect(recordCreation(actor, { kind: "picture", fileIds: ["not-a-file"], recipe: { tool: "x", route: "other" } })).toBeNull();
    const picture = await makePicture(actor, "all-ages", "boat");
    const first = recordCreation(actor, { kind: "video", fileIds: [picture.id], recipe: { tool: "video", route: "text" }, words: { written: "boat" } })!;
    const second = recordCreation(actor, { kind: "film", fileIds: [picture.id], recipe: { tool: "make_film", route: "film" } })!;
    expect(second.id).toBe(first.id);
    expect(second.kind).toBe("film");
    expect(second.words).toEqual({ written: "boat" });
    expect(records()).toHaveLength(1);
  });

  test("the cast index is written with the record, and rebuilds from the records", async () => {
    const h = await household(); const actor = h.row("Marlow");
    const picture = await makePicture(actor, "all-ages", "boat");
    const subject = createMediaSubject(actor, { name: "Mop", kind: "character", look: "a small grey mop", referenceIds: [], real: false } as never);
    const record = recordCreation(actor, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" }, cast: [{ subject_id: subject.id, synth_id: "nova", role: "lead" }, { subject_id: "not-a-subject", role: "x" }] })!;
    expect(record.cast).toHaveLength(1);
    expect(db.select().from(creationCast).all()).toEqual([{ creationId: record.id, subjectId: subject.id, synthId: "nova" }]);
    db.delete(creationCast).run();
    expect(rebuildCreationCast()).toBe(1);
    expect(db.select().from(creationCast).all()).toHaveLength(1);
  });

  test("a Picture Studio save writes a record that names its source's record as the parent", async () => {
    fakeImages = installFakeImageStack({ pollsToFinish: 1 });
    const h = await household(); const actor = h.row("Marlow");
    const { job } = await makeJob(actor);
    const done = await finished(actor, job.id);
    const sourceId = done.files[0]!.id;
    const stored = db.select().from(attachments).where(eq(attachments.id, sourceId)).get()!;
    const source: SourcePicture = { id: sourceId, conversationId: done.conversationId!, temporary: false, turnId: done.turnId!, mediaType: stored.mediaType, name: "source", bytes: await testPng(), sha256: stored.sha256, rootId: sourceId } as SourcePicture;
    const version = await saveVersion(actor, source, await testPng(), { op: "resize", label: "Resized" });
    const sourceRecord = creationOfFile(actor.id, sourceId)!;
    const record = creationOfFile(actor.id, version.id)!;
    expect(record).toMatchObject({ kind: "picture", recipe: { tool: "picture-studio", route: "edit" }, parent_id: sourceRecord.id, sources: [{ file_id: sourceId, role: "edit_source" }] });
  });

  test("a clip made on the Create page writes one record for the clip and its poster; Another take names the first as its parent", async () => {
    fakeVideo = installFakeVideoStack();
    const h = await household(); const actor = h.row("Marlow");
    const clip = await makeClip(h.adult.client, actor, PLAIN_PROMPT);
    const first = creationOfFile(actor.id, clip.fileId)!;
    expect(first).toMatchObject({ kind: "video", file_ids: expect.arrayContaining([clip.fileId, clip.posterId]), job_ids: [clip.jobId], parent_id: null });
    expect(creationIdOfFile(actor.id, clip.posterId)).toBe(first.id);
    const again = await h.adult.client.post(`/api/videos/jobs/${clip.jobId}/another`, {});
    expect(again.status).toBe(200);
    const next = (await again.json()) as { id: string };
    await until(() => getVideoJobFor(actor, next.id)?.state === "done");
    const second = creationOfFile(actor.id, getVideoJobFor(actor, next.id)!.files[0]!.id)!;
    expect(second.parent_id).toBe(first.id);
    const read = await h.adult.client.get(`/api/creations/by-file/${getVideoJobFor(actor, next.id)!.files[0]!.id}`);
    expect(((await read.json()) as { parent_id: string }).parent_id).toBe(first.id);
  });

  test("the reference recipe's sheets, words, route and face check move into the record, and the job still holds its recipe for the old readers", async () => {
    fakeVideo = installFakeVideoStack();
    const h = await household(); const actor = h.row("Marlow");
    const clip = await makeClip(h.adult.client, actor, PLAIN_PROMPT);
    const sheet = await makePicture(actor, "all-ages", "sheet");
    const job = getVideoJobFor(actor, clip.jobId)!;
    const recipe: ReferenceRecipe = { v: 1, sheetFileIds: [sheet.id], description: "Reference sheet: one", request: "the person's words", prompt: "Reference sheet: one\n\nGenerated video: the person's words", seed: 7, seconds: 5, panels: [], pictureFileIds: [], providedAsIs: [false], route: "first_frame",
      faceMatch: { frames: 6, people: [], threshold: 0.363, low: false } };
    const viaRecipe = { ...job, request: { ...job.request, reference: recipe } };
    const record = recordClipCreation(actor, viaRecipe, job.files, "video-edit")!;
    expect(record).toMatchObject({ recipe: { route: "first_frame" }, words: { written: "the person's words", composed: recipe.prompt }, sources: expect.arrayContaining([{ file_id: sheet.id, role: "sheet" }]), checks: { face_match: { low: false } } });
    expect(getVideoJobFor(actor, clip.jobId)!.request.reference).toBeUndefined();
  });

  test("a finished film's record is the cut's record made a film: plan inline, cast and clips as sources", async () => {
    const h = await household(); const actor = h.row("Marlow");
    const cut = await makePicture(actor, "all-ages", "cut"); const shotClip = await makePicture(actor, "all-ages", "clip");
    const clipRecord = recordCreation(actor, { kind: "video", fileIds: [cut.id], recipe: { tool: "video-film", route: "edit" } })!;
    const film = recordFilmCreation(actor, { cutFileId: cut.id, productionId: "mprd-aaaaaaaaaa", runId: "run-1", plan: { shots: [{ id: "a" }, { id: "b" }] }, castSubjects: [{ subject_id: "msub-aaaaaaaaaa", role: "Mop" }], clipFileIds: [shotClip.id], faceless: false })!;
    expect(film.id).toBe(clipRecord.id);
    expect(film).toMatchObject({ kind: "film", production_id: "mprd-aaaaaaaaaa", plan: { shots: [{ id: "a" }, { id: "b" }] }, cast: [{ subject_id: "msub-aaaaaaaaaa", role: "Mop" }], sources: [{ file_id: shotClip.id, role: "clip" }] });
    expect(records()).toHaveLength(1);
  });

  test("an item made before the store existed gets its record from its job row when its maker opens it", async () => {
    fakeImages = installFakeImageStack({ pollsToFinish: 1 });
    const h = await household(); const actor = h.row("Marlow");
    const { job } = await makeJob(actor);
    const done = await finished(actor, job.id);
    db.delete(creations).run();
    const res = await h.adult.client.get(`/api/creations/by-file/${done.files[0]!.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "picture", job_ids: [job.id], words: { written: "a quiet landscape" } });
    expect(records()).toHaveLength(1);
    expect(backfillCreationForFile(h.row("Quill"), done.files[0]!.id)).toBe(false);
  });
});

describe("CREATOR-02 reading and locks", () => {
  test("only the maker reads a record: another adult, the owner account and a signed-out caller get the not-found answer", async () => {
    const h = await household(); const actor = h.row("Marlow");
    const picture = await makePicture(actor, "all-ages", "boat");
    recordCreation(actor, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" }, words: { written: "private words" } });
    const maker = await h.adult.client.get(`/api/creations/by-file/${picture.id}`);
    expect(maker.status).toBe(200);
    expect(((await maker.json()) as { words: { written: string } }).words.written).toBe("private words");
    for (const other of [h.other.client, h.owner, h.teen.client, h.child.client]) {
      const res = await other.get(`/api/creations/by-file/${picture.id}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("private words");
    }
    expect((await new TestClient().get(`/api/creations/by-file/${picture.id}`)).status).toBe(401);
  });

  test("a teen's or a child's own adult-only item answers not-found, never the record; an all-ages one reads", async () => {
    const h = await household();
    for (const [client, name] of [[h.teen.client, "Nova"], [h.child.client, "Sprout"]] as const) {
      const actor = h.row(name);
      const adultItem = await makePicture(actor, "adult-only", "x"); const plain = await makePicture(actor, "all-ages", "y");
      recordCreation(actor, { kind: "picture", fileIds: [adultItem.id], recipe: { tool: "p", route: "text" }, words: { written: "hidden" } });
      recordCreation(actor, { kind: "picture", fileIds: [plain.id], recipe: { tool: "p", route: "text" } });
      expect(readCreationByFile(actor, adultItem.id).state).toBe("none");
      const res = await client.get(`/api/creations/by-file/${adultItem.id}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("hidden");
      expect((await client.get(`/api/creations/by-file/${plain.id}`)).status).toBe(200);
    }
  });

  test("a locked adult item's record answers with the lock tile only until the unlock, and follows a lock change", async () => {
    fakeVideo = installFakeVideoStack();
    const h = await household(); const actor = h.row("Marlow");
    const clip = await makeClip(h.adult.client, actor, PLAIN_PROMPT);
    markAdultOnly(clip.jobId);
    const { syncCreationMarkForFile } = await import("@/lib/creations/store");
    syncCreationMarkForFile(clip.fileId);
    expect(db.select().from(creations).all()[0]).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    const locked = await h.adult.client.get(`/api/creations/by-file/${clip.fileId}`);
    expect(locked.status).toBe(423);
    expect(await locked.json()).toEqual({ locked: true, making: false, code: "locked" });
    const proof = unlockHeader(await unlock(h.adult.client));
    expect((await h.adult.client.get(`/api/creations/by-file/${clip.fileId}`, proof)).status).toBe(200);
    // The creator clears the lock on the file: the record follows it.
    for (const row of db.select().from(attachments).all()) { const next = withMark(row.provenance, { lock: "off" }); if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, row.id)).run(); }
    syncCreationMarkForFile(clip.fileId);
    expect(db.select().from(creations).all()[0]).toMatchObject({ madeAudience: "adult-only", lock: "off" });
    expect((await h.adult.client.get(`/api/creations/by-file/${clip.fileId}`)).status).toBe(200);
  });

  test("a new item made from a locked source takes the source's lock, and a locked parent is never named", async () => {
    const h = await household(); const actor = h.row("Marlow");
    const source = await makePicture(actor, "adult-only", "src"); const child = await makePicture(actor, "all-ages", "kid");
    const parent = recordCreation(actor, { kind: "picture", fileIds: [source.id], recipe: { tool: "p", route: "text" } })!;
    expect(parent).toMatchObject({ made_audience: "adult-only", lock: "on" });
    const derived = recordCreation(actor, { kind: "picture", fileIds: [child.id], recipe: { tool: "p", route: "edit" }, sources: [{ file_id: source.id, role: "edit_source" }], parentId: parent.id })!;
    expect(derived).toMatchObject({ made_audience: "adult-only", lock: "on", parent_id: parent.id });
    __unlockedForTests(actor.id, () => expect(readCreationByFile(actor, child.id).state).toBe("ok"));
    expect(readCreationByFile(actor, child.id).state).toBe("locked");
  });

  test("purging the file takes its record and cast with it; a purged poster only leaves the list", async () => {
    fakeVideo = installFakeVideoStack();
    const h = await household(); const actor = h.row("Marlow");
    const clip = await makeClip(h.adult.client, actor, PLAIN_PROMPT);
    const record = creationOfFile(actor.id, clip.fileId)!;
    purgeFileRecord(db.select().from(attachments).where(eq(attachments.id, clip.posterId)).get()!);
    expect(creationOfFile(actor.id, clip.fileId)!.file_ids).toEqual([clip.fileId]);
    purgeFileRecord(db.select().from(attachments).where(eq(attachments.id, clip.fileId)).get()!);
    expect(db.select().from(creations).where(eq(creations.id, record.id)).all()).toHaveLength(0);
  });
});

describe("CREATOR-02 migration", () => {
  const MIGRATIONS = join(import.meta.dir, "../src/db/migrations");
  test("0194 lands on a database that already holds rows and keeps them", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-creations-"));
    try {
      const old = join(dir, "old-migrations");
      cpSync(MIGRATIONS, old, { recursive: true });
      const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
      const cut = journal.entries.findIndex((entry) => entry.tag === "0193_video_package_id");
      writeFileSync(join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }));
      const sqlite = new Database(join(dir, "household.db"));
      sqlite.exec("PRAGMA journal_mode = WAL"); sqlite.exec("PRAGMA foreign_keys = ON");
      migrate(drizzle(sqlite), { migrationsFolder: old });
      expect(sqlite.query("SELECT name FROM sqlite_master WHERE name = 'creations'").all()).toEqual([]);
      sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, created_at, updated_at, hlc) VALUES ('person-owner01','Sage','owner','seed','setup','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','1:0:test00')").run();
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
      expect(sqlite.query("SELECT display_name FROM people WHERE id = 'person-owner01'").get()).toEqual({ display_name: "Sage" });
      sqlite.query("INSERT INTO creations (id, person_id, kind, body, created_at, updated_at, hlc, provenance) VALUES ('crt-aaaaaaaaaa','person-owner01','picture','{}','2026-11-02T00:00:00Z','2026-11-02T00:00:00Z','1:0:test00','person:person-owner01')").run();
      sqlite.query("INSERT INTO creation_cast (creation_id, subject_id) VALUES ('crt-aaaaaaaaaa','msub-aaaaaaaaaa')").run();
      expect(sqlite.query("SELECT review, made_audience, lock, file_ids FROM creations").get()).toEqual({ review: "pending", made_audience: "all-ages", lock: "off", file_ids: "[]" });
      sqlite.query("DELETE FROM creations WHERE id = 'crt-aaaaaaaaaa'").run();
      expect(sqlite.query("SELECT count(*) AS n FROM creation_cast").get()).toEqual({ n: 0 });
      expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
      sqlite.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
