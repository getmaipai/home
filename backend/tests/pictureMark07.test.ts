// ADULT-LOCK-07 slice 3: picture marks at job start and finish, edits, and the picture mark route.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { saveVersion, type SourcePicture } from "@/lib/imageEdit";
import { __markRowsForTests } from "@/lib/adultMarks";
import { __resetAdultLockForTests, lockItemOfProvenance } from "@/lib/adultLock";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { installFakeImageStack, testPng, until } from "./pictureFixture";
import { makePicture } from "./fixtures/adultLockPicture";
import { household, unlock, unlockHeader, PASSCODE } from "./fixtures/adultLock";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { conversationTurns } from "@/db/schema";
import type { PersonRow } from "@/types";
import { resetFitAsksForTests, resetTierStateForTests, resetChatActivityForTests, resetFitMemoryForTests, resetDownshiftForTests, resetActivePlanForTests, setBudgetReader } from "@/lib/jobs/householdQueue";
import { wireQueuePolicy } from "@/lib/jobs/queuePolicy";

setDefaultTimeout(30_000);
const ADULT_STYLE = "lora-bbbbbbbbbbbbbbbb";
const PLAIN = { people_count: 0, apparent_min_age_estimate: null, label: "none", is_nude_or_sexual: false, confidence: 0.99 } as never;
let fake: ReturnType<typeof installFakeImageStack>;

beforeEach(() => {
  resetDb(); __resetAdultLockForTests();
  fake = installFakeImageStack({ pollsToFinish: 20 });
  setBudgetReader(async () => ({ freeMemoryBytes: 10_000_000_000, loaded: [], readingDegraded: false }));
  wireQueuePolicy();
  resetFitAsksForTests(); resetTierStateForTests(); resetChatActivityForTests(); resetFitMemoryForTests(); resetDownshiftForTests(); resetActivePlanForTests();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: PLAIN })));
});
afterEach(() => { fake.restore(); setBudgetReader(null); });

const note = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance;
const item = (id: string) => lockItemOfProvenance("owner", note(id));
const markRoute = (client: TestClient, id: string, body: Record<string, unknown>) => client.post(`/api/pictures/jobs/${id}/adult-mark`, body);
const ticketFor = (client: TestClient, id: string) => client.post("/api/adult-lock/confirm", { secret: PASSCODE, action: "unmark", item: id });

async function start(actor: PersonRow, options: { lora?: string; sourceFileId?: string; kind?: "generate" | "variation" } = {}) {
  const conversation = options.sourceFileId ? null : resolveOrCreateConversation(actor, "chat");
  if (conversation && !conversation.ok) throw new Error(conversation.error);
  const conversationId = options.sourceFileId ? db.select().from(attachments).where(eq(attachments.id, options.sourceFileId)).get()!.conversationId : conversation!.value.id;
  const turnId = newConversationTurnId(); const now = new Date().toISOString();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "make a landscape", replyText: "making", source: "model", safetyAction: "allow", createdAt: now, hlc: nextHlc() }).run();
  return startPictureJob({ actor, conversationId, turnId, temporary: false, kind: options.kind ?? "generate", prompt: "a landscape", sourceFileId: options.sourceFileId,
    body: { prompt: "a landscape", size: "1024x1024", n: 1, audience: "adult", ...(options.lora ? { loras: [{ id: options.lora, scale: 0.9 }] } : {}) } as never });
}
async function finish(actor: PersonRow, jobId: string) {
  await until(() => { const job = getPictureJob(actor, jobId); if (job && ["failed", "cancelled"].includes(job.state)) throw new Error(`picture job ${job.state}: ${job.error}`); return job?.state === "done"; });
  return getPictureJob(actor, jobId)!;
}

describe("picture job marks", () => {
  test("all-ages stays open; an ordinary adult-lane job remains a normal card while running", async () => {
    const h = await household(); const actor = h.row("Marlow");
    const ordinary = await start(actor);
    expect(ordinary.request).not.toHaveProperty("adultLock");
    const runningCard = await h.adult.client.get(`/api/pictures/jobs/${ordinary.id}`);
    expect(runningCard.status).toBe(200);
    expect(await runningCard.text()).not.toContain('"locked":true');
    fake.pollsToFinish = 1;
    const plain = await finish(actor, ordinary.id);
    expect(item(plain.files[0]!.id)).toMatchObject({ madeAudience: "all-ages", lock: "off" });
  });

  test("adult-only style marks the running job and its finished picture", async () => {
    const h = await household(); const actor = h.row("Marlow"); fake.pollsToFinish = 100;
    const job = await start(actor, { lora: ADULT_STYLE });
    expect(job.request).toMatchObject({ adultLock: "on" });
    expect(await (await h.adult.client.get(`/api/pictures/jobs/${job.id}`)).json()).toEqual({ locked: true, making: true });
    fake.pollsToFinish = 2;
    const done = await finish(actor, job.id);
    expect(item(done.files[0]!.id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    expect(__markRowsForTests(done.files[0]!.id)).toEqual([{ action: "mark", via: "auto", actorId: actor.id }]);
  });

  test("an adult-only source variation is locked at start and keeps its source mark", async () => {
    const h = await household(); const actor = h.row("Marlow"); const source = await makePicture(actor, "adult-only", "source"); fake.pollsToFinish = 100;
    const job = await start(actor, { sourceFileId: source.id, kind: "variation" });
    expect(job.request).toMatchObject({ adultLock: "on" });
    fake.pollsToFinish = 1;
    const done = await finish(actor, job.id);
    expect(item(done.files[0]!.id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
  });

  test("an all-ages source plus an adult-only style becomes adult-only and locked", async () => {
    const h = await household(); const actor = h.row("Marlow"); const source = await makePicture(actor, "all-ages", "source"); fake.pollsToFinish = 100;
    const job = await start(actor, { sourceFileId: source.id, kind: "variation", lora: ADULT_STYLE });
    expect(job.request).toMatchObject({ adultLock: "on" });
    fake.pollsToFinish = 1;
    const done = await finish(actor, job.id);
    expect(item(done.files[0]!.id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
  });

  test("saveVersion of an adult-only picture carries its audience and lock", async () => {
    const h = await household(); const actor = h.row("Marlow"); const source = await makePicture(actor, "adult-only", "source");
    const stored = db.select().from(attachments).where(eq(attachments.id, source.id)).get()!;
    const loaded: SourcePicture = { id: source.id, conversationId: source.conversationId, temporary: false, turnId: source.turnId, mediaType: stored.mediaType, name: "source", bytes: await testPng(), sha256: stored.sha256, rootId: source.id, audience: "adult-only", adultMark: { madeAudience: "adult-only", lock: "on" }, ownerPersonId: actor.id };
    const version = await saveVersion(actor, loaded, await testPng(), { op: "resize", label: "Resized" });
    expect(item(version.id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    expect(__markRowsForTests(version.id)).toEqual([{ action: "mark", via: "auto", actorId: actor.id }]);
  });

  test("saveVersion of an all-ages picture with an adult-only result raises the mark and locks it", async () => {
    const h = await household(); const actor = h.row("Marlow"); const source = await makePicture(actor, "all-ages", "source");
    const stored = db.select().from(attachments).where(eq(attachments.id, source.id)).get()!;
    const loaded: SourcePicture = { id: source.id, conversationId: source.conversationId, temporary: false, turnId: source.turnId, mediaType: stored.mediaType, name: "source", bytes: await testPng(), sha256: stored.sha256, rootId: source.id, audience: "all-ages" };
    const version = await saveVersion(actor, loaded, await testPng(), { op: "comment", label: "Changed", audience: "adult-only" });
    expect(item(version.id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
  });

  test("a variation of an unlocked adult picture follows the cleared lock", async () => {
    const h = await household(); const actor = h.row("Marlow"); const source = await makePicture(actor, "adult-only", "source");
    const first = await start(actor, { sourceFileId: source.id, kind: "variation" }); fake.pollsToFinish = 1;
    const original = await finish(actor, first.id); const originalId = original.files[0]!.id;
    const ticket = (await (await ticketFor(h.adult.client, first.id)).json() as { ticket: string }).ticket;
    expect((await markRoute(h.adult.client, first.id, { action: "clear", ticket })).status).toBe(200);
    const variation = await start(actor, { sourceFileId: originalId, kind: "variation" });
    expect(variation.request).toMatchObject({ adultLock: "off" });
    fake.pollsToFinish = 1;
    const next = await finish(actor, variation.id);
    expect(item(next.files[0]!.id)).toMatchObject({ madeAudience: "adult-only", lock: "off" });
  });
});

describe("picture lock clear route", () => {
  test("fresh proof clears the mark, audits it, and the owner can then read without proof", async () => {
    const h = await household(); const actor = h.row("Marlow"); const source = await makePicture(actor, "adult-only", "source");
    const job = await start(actor, { sourceFileId: source.id, kind: "variation" }); fake.pollsToFinish = 1;
    const done = await finish(actor, job.id); const id = done.files[0]!.id;
    const ticket = (await (await ticketFor(h.adult.client, job.id)).json() as { ticket: string }).ticket;
    expect((await markRoute(h.adult.client, job.id, { action: "clear", ticket })).status).toBe(200);
    expect(item(id)).toMatchObject({ madeAudience: "adult-only", lock: "off" });
    expect(__markRowsForTests(id).map((r) => [r.action, r.via])).toEqual([["mark", "auto"], ["clear", "creator_passcode"]]);
    expect((await h.adult.client.get(`/api/files/${id}/content`)).status).toBe(200);
  });

  test("minor and child cannot clear or see a locked picture", async () => {
    const h = await household(); const actor = h.row("Marlow"); const source = await makePicture(actor, "adult-only", "source");
    const job = await start(actor, { sourceFileId: source.id, kind: "variation" }); fake.pollsToFinish = 1;
    const done = await finish(actor, job.id); const id = done.files[0]!.id;
    for (const minor of [h.teen, h.child]) {
      expect((await markRoute(minor.client, job.id, { action: "clear", ticket: "x" })).status).toBe(404);
      expect((await minor.client.get(`/api/files/${id}/content`)).status).toBe(404);
    }
  });
});
