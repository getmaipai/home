import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { __resetAdultLockForTests, lockItemOfProvenance } from "@/lib/adultLock";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { saveVersion, type SourcePicture } from "@/lib/imageEdit";
import { __markRowsForTests } from "@/lib/adultMarks";
import { installFakeImageStack, testPng, until } from "./pictureFixture";
import { makePicture } from "./fixtures/adultLockPicture";
import { household, unlock, unlockHeader, PASSCODE } from "./fixtures/adultLock";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { conversationTurns } from "@/db/schema";
import { resetFitAsksForTests, resetTierStateForTests, resetChatActivityForTests, resetFitMemoryForTests, resetDownshiftForTests, resetActivePlanForTests, setBudgetReader } from "@/lib/jobs/householdQueue";
import { wireQueuePolicy } from "@/lib/jobs/queuePolicy";
import type { PersonRow } from "@/types";

setDefaultTimeout(30_000);

const ADULT_STYLE = "lora-bbbbbbbbbbbbbbbb";
const PLAIN = { people_count: 0, apparent_min_age_estimate: null, label: "none", is_nude_or_sexual: false, confidence: 0.99 } as never;
let fake: ReturnType<typeof installFakeImageStack>;

beforeEach(() => {
  resetDb(); __resetAdultLockForTests();
  fake = installFakeImageStack({ pollsToFinish: 2 });
  setBudgetReader(async () => ({ freeMemoryBytes: 10_000_000_000, loaded: [], readingDegraded: false }));
  wireQueuePolicy();
  resetFitAsksForTests(); resetTierStateForTests(); resetChatActivityForTests(); resetFitMemoryForTests(); resetDownshiftForTests(); resetActivePlanForTests();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: PLAIN })));
});
afterEach(() => { fake.restore(); setBudgetReader(null); __resetAdultLockForTests(); });

const item = (id: string) => lockItemOfProvenance("owner", db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance);
const markRoute = (client: import("./client").TestClient, id: string, action: "mark" | "clear", ticket?: string) => client.post(`/api/pictures/jobs/${id}/adult-mark`, { action, ...(ticket ? { ticket } : {}) });
const ticketFor = (client: import("./client").TestClient, id: string) => client.post("/api/adult-lock/confirm", { secret: PASSCODE, action: "unmark", item: id });

async function makeJob(actor: PersonRow, options: { adultStyle?: boolean } = {}) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const conversationId = conversation.value.id; const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "make a landscape", replyText: "making", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  const job = await startPictureJob({ actor, conversationId, turnId, temporary: false, kind: "generate", prompt: "a quiet landscape", body: { prompt: "a quiet landscape", size: "1024x1024", audience: "adult", n: 1, ...(options.adultStyle ? { loras: [{ id: ADULT_STYLE, scale: 0.9 }] } : {}) } as never });
  await until(() => { const j = getPictureJob(actor, job.id); if (j && ["failed", "cancelled"].includes(j.state)) throw new Error(`picture job ${j.state}: ${j.error}`); return j?.state === "done"; });
  return getPictureJob(actor, job.id)!;
}

describe("ADULT-LOCK-07 follow-ups", () => {
  test("variation checks a saved adult style proof, allows all-ages styles, and hides another person's job from minors", async () => {
    const h = await household(); const actor = h.row("Marlow");
    const adultStyle = await makeJob(actor, { adultStyle: true });
    const noProof = await h.adult.client.post(`/api/pictures/jobs/${adultStyle.id}/variation`, {});
    expect(noProof.status).toBe(423);
    expect(((await noProof.json()) as { error: string }).error).toBe("That is locked. Unlock it with your passcode first, then try again.");
    expect(fake.submitted).toHaveLength(1);
    const proof = unlockHeader(await unlock(h.adult.client));
    const allowed = await h.adult.client.post(`/api/pictures/jobs/${adultStyle.id}/variation`, {}, proof);
    expect(allowed.status).toBe(200);
    expect(fake.submitted).toHaveLength(2);

    const allAges = await makeJob(actor);
    expect((await h.adult.client.post(`/api/pictures/jobs/${allAges.id}/variation`, {})).status).toBe(200);
    const other = await makeJob(h.row("Quill"));
    for (const minor of [h.teen, h.child]) expect((await minor.client.post(`/api/pictures/jobs/${other.id}/variation`, {})).status).toBe(404);
  });

  test("saveVersion copies the source lock and clearing or re-marking the source updates its edit descendants", async () => {
    const h = await household(); const actor = h.row("Marlow"); const sourceJob = await makeJob(actor, { adultStyle: true });
    const sourceId = sourceJob.files[0]!.id;
    const stored = db.select().from(attachments).where(eq(attachments.id, sourceId)).get()!;
    const source: SourcePicture = { id: sourceId, conversationId: sourceJob.conversationId!, temporary: false, turnId: sourceJob.turnId!, mediaType: stored.mediaType, name: "source", bytes: await testPng(), sha256: stored.sha256, rootId: sourceId, audience: "adult-only", adultMark: { madeAudience: "adult-only", lock: "on" }, ownerPersonId: actor.id };
    const version = await saveVersion(actor, source, await testPng(), { op: "resize", label: "Resized" });
    expect(item(version.id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    const ticket = (await (await ticketFor(h.adult.client, sourceJob.id)).json() as { ticket: string }).ticket;
    expect((await markRoute(h.adult.client, sourceJob.id, "clear", ticket)).status).toBe(200);
    expect(item(sourceId)).toMatchObject({ lock: "off" });
    expect(item(version.id)).toMatchObject({ lock: "off" });
    expect((await markRoute(h.adult.client, sourceJob.id, "mark")).status).toBe(200);
    expect(item(sourceId)).toMatchObject({ lock: "on" });
    expect(item(version.id)).toMatchObject({ lock: "on" });
  });

  test("an admin can mark another person's picture without a passcode, cannot clear it, and other viewers get the missing answer", async () => {
    const h = await household(); const actor = h.row("Marlow"); const job = await makeJob(actor);
    const id = job.files[0]!.id;
    const marked = await markRoute(h.owner, job.id, "mark");
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ made_audience: "adult-only", lock: "on" });
    expect(__markRowsForTests(id).at(-1)).toMatchObject({ action: "mark", via: "admin" });
    expect((await markRoute(h.owner, job.id, "clear", "anything")).status).toBe(404);
    expect((await markRoute(h.other.client, job.id, "mark")).status).toBe(404);
    for (const minor of [h.teen, h.child]) expect((await markRoute(minor.client, job.id, "mark")).status).toBe(404);
    expect(item(id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
  });
});
