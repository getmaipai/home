// PERUSE-2026-10-25: adult content of another household adult through the picture and video tools. The job is held until the
// pictured adult consents on the ask; only then does the Stack see it, with a proof minted from the approved ask and no nudity
// negative; every other end (decline, timeout, a changed prompt, the switch off) sends nothing. Self and ordinary requests need no ask.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { likenessAsks, people as peopleTable, pictureJobs } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { prepareStylesUse, prepareStyleUse } from "@/lib/likeness/apply";
import { ADULT_CONTENT_OTHER_SUBJECT_LINE } from "@/lib/likeness/decide";
import { ASK_TEMPORARY_LINE, ASK_WAIT_MS, askFor, decideAsk, expireAsks } from "@/lib/likeness/ask";
import { __setStackTrustForTests } from "@/lib/likeness/proof";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { runGenerateImage } from "@/lib/pictures/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { cardView } from "@/routes/pictures";
import { runGenerateVideo } from "@/lib/videos/tool";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { installFakeImageStack, until, testPng, type FakeImageStack } from "./pictureFixture";
import { storeTemporaryChatImage } from "@/lib/attachments";
import { __setPhotoInspectorForTests } from "@/lib/likeness/inspector";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let iris: PersonRow;
let sage: PersonRow;
let imageStack: FakeImageStack;
let videoStack: FakeVideoStack;
const PIC_STYLE = "lora-cccccccccccccccc";
const VID_STYLE = "lora-dddddddddddddddd";
const PROMPT = "she undresses slowly";

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}
const perUse = (on: boolean) => expect(setValue(bench.owner, "household", "likeness.per_use", on).ok).toBe(true);
const audience = (actor: PersonRow) => ({ actor, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false }) as never;
function stateFor(actor: PersonRow, temporary = false) {
  return { actor, surface: "chat", speakerEvidence: undefined, planBasis: { surfaceClass: "written" }, plan: undefined, conversationId: null, turnId: null, temporary, ephemeral: false, images: undefined, utterance: "" } as never;
}
const text = (outcome: ToolExecutionOutcome) => (outcome.result?.reply as { text?: string } | undefined)?.text ?? "";
// The ask id never rides in the outcome data (rule 6a); it is read from the held job, as the card does.
const data = (outcome: ToolExecutionOutcome) => {
  const raw = (outcome.result?.data ?? {}) as { pictureJobId?: string; videoJobId?: string; refused?: string };
  const job = raw.pictureJobId ? getPictureJob(sage, raw.pictureJobId) : raw.videoJobId ? getVideoJobFor(sage, raw.videoJobId) : null;
  const likenessAskId = job?.request.likeness?.ask;
  expect((raw as Record<string, unknown>).likenessAskId).toBeUndefined();
  return { ...raw, ...(likenessAskId ? { likenessAskId } : {}) };
};
const ask = (id: string) => db.select().from(likenessAsks).where(eq(likenessAsks.id, id)).get()!;
const imageCall = (over: Record<string, unknown> = {}) => ({ state: stateFor(sage), args: { prompt: PROMPT, style: "Iris portrait", depicts_real_person: true, ...over }, callId: "c-img", spoken: false });

beforeEach(() => {
  resetDb();
  bench = createBenchPeople();
  sage = addPerson("Sage", "adult");
  iris = addPerson("Iris", "adult");
  imageStack = installFakeImageStack();
  videoStack = installFakeVideoStack();
  imageStack.loras.push({ id: PIC_STYLE, name: "Iris portrait", sha256: "c".repeat(64), bytes: 100, base_model: "flux2-klein-4b", licence: "Apache-2.0", source_url: null, classification: "all-ages", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z", likeness_subject: iris.id });
  videoStack.loras.push({ id: VID_STYLE, name: "Iris motion", sha256: "d".repeat(64), bytes: 100, base_model: "wan2.2-ti2v-5b", licence: "Apache-2.0", source_url: null, classification: "all-ages", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z", likeness_subject: iris.id });
  __setStackTrustForTests({ ok: true });
  perUse(true);
});
afterEach(() => { __setPhotoInspectorForTests(undefined); imageStack.restore(); videoStack.restore(); __setStackTrustForTests(null); });

describe("a held picture", () => {
  test("is not sent to the Stack until the pictured adult consents, then goes with a proof and no nudity negative", async () => {
    const outcome = await runGenerateImage(imageCall());
    const { pictureJobId, likenessAskId } = data(outcome);
    expect(pictureJobId && likenessAskId).toBeTruthy();
    expect(text(outcome)).toContain("Iris needs to say yes first");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(imageStack.submitted).toHaveLength(0);
    const held = getPictureJob(sage, pictureJobId!)!;
    expect(held.state).toBe("queued");
    expect(cardView(sage, held, false)).toMatchObject({ likeness_ask_id: likenessAskId, label: expect.stringContaining("to say yes") });
    expect(askFor(likenessAskId!, iris)).toMatchObject({ state: "waiting", prompt: PROMPT, as: "subject", count: 1, style_name: "Iris portrait" });
    // Nobody else can start it, and a still-waiting ask never releases.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(imageStack.submitted).toHaveLength(0);

    expect(decideAsk(likenessAskId!, iris, "consent")).toEqual({ ok: true, state: "approved" });
    await until(() => imageStack.submitted.length === 1);
    const sent = imageStack.submitted[0] as { prompt: string; negative_prompt?: string; loras: Array<{ id: string; likeness_proof?: string }> };
    expect(sent.prompt).toBe(PROMPT);
    expect(sent.negative_prompt ?? "").not.toContain("nude");
    expect(sent.loras[0]).toMatchObject({ id: PIC_STYLE, likeness_proof: expect.stringMatching(/^[\w-]+\.[\w-]+$/) });
    expect(ask(likenessAskId!)).toMatchObject({ state: "consumed", prompt: null, jobId: pictureJobId });
  });

  test("Decline ends the job with the plain line, sends nothing and leaves no prompt text on the job", async () => {
    const outcome = await runGenerateImage(imageCall());
    const { pictureJobId, likenessAskId } = data(outcome);
    decideAsk(likenessAskId!, iris, "decline");
    await until(() => getPictureJob(sage, pictureJobId!)?.state === "failed");
    const job = getPictureJob(sage, pictureJobId!)!;
    expect(job.error).toBe("Iris said no. Nothing was made.");
    expect(job.prompt).toBe("");
    expect(JSON.stringify(job.request)).not.toContain(PROMPT);
    expect(imageStack.submitted).toHaveLength(0);
    const row = db.select().from(pictureJobs).where(eq(pictureJobs.id, pictureJobId!)).get();
    expect(JSON.stringify(row)).not.toContain("undresses");
  });

  test("ten minutes without an answer ends it with the timeout line and sends nothing", async () => {
    const outcome = await runGenerateImage(imageCall());
    const { pictureJobId, likenessAskId } = data(outcome);
    expect(expireAsks(Date.now() + ASK_WAIT_MS + 1000)).toBe(1);
    await until(() => getPictureJob(sage, pictureJobId!)?.state === "failed");
    expect(getPictureJob(sage, pictureJobId!)?.error).toContain("did not answer in 10 minutes");
    expect(ask(likenessAskId!).state).toBe("expired");
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("a prompt changed after approval sends nothing", async () => {
    const outcome = await runGenerateImage(imageCall());
    const { pictureJobId, likenessAskId } = data(outcome);
    // Tamper with the stored body while the job waits, then approve.
    const job = getPictureJob(sage, pictureJobId!)!;
    (job.request as unknown as { stackBody: { prompt: string } }).stackBody.prompt = `${PROMPT}, and something the person never read`;
    const { saveJob } = await import("@/lib/pictures/jobStore");
    saveJob(job);
    decideAsk(likenessAskId!, iris, "consent");
    await until(() => getPictureJob(sage, pictureJobId!)?.state === "failed");
    expect(getPictureJob(sage, pictureJobId!)?.error).toContain("The request changed after it was approved");
    expect(ask(likenessAskId!).state).toBe("cancelled");
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("turning the switch off while it waits stops it for good", async () => {
    const outcome = await runGenerateImage(imageCall());
    const { pictureJobId, likenessAskId } = data(outcome);
    perUse(false);
    expect(expireAsks()).toBe(1);
    await until(() => getPictureJob(sage, pictureJobId!)?.state === "failed");
    expect(getPictureJob(sage, pictureJobId!)?.error).toContain("switched off");
    expect(ask(likenessAskId!)).toMatchObject({ state: "cancelled", prompt: null });
    expect(decideAsk(likenessAskId!, iris, "consent")).toMatchObject({ ok: false });
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("stopping a held picture ends its ask and clears the prompt text", async () => {
    const outcome = await runGenerateImage(imageCall());
    const { pictureJobId, likenessAskId } = data(outcome);
    const { cancelPictureJob } = await import("@/lib/pictures/jobs");
    await cancelPictureJob(sage, pictureJobId!);
    expect(ask(likenessAskId!)).toMatchObject({ state: "cancelled", prompt: null });
    expect(getPictureJob(sage, pictureJobId!)).toMatchObject({ state: "cancelled", prompt: "" });
    expect(decideAsk(likenessAskId!, iris, "consent")).toMatchObject({ ok: false });
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("a temporary chat is refused with the plain line and opens no ask", async () => {
    const outcome = await runGenerateImage({ ...imageCall(), state: stateFor(sage, true) });
    expect(text(outcome)).toContain(ASK_TEMPORARY_LINE);
    expect(db.select().from(likenessAsks).all()).toHaveLength(0);
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("with the switch off the request is refused as before and opens no ask", async () => {
    perUse(false);
    const outcome = await runGenerateImage(imageCall());
    expect(text(outcome)).toContain(ADULT_CONTENT_OTHER_SUBJECT_LINE);
    expect(db.select().from(likenessAsks).all()).toHaveLength(0);
    expect(imageStack.submitted).toHaveLength(0);
  });

  test("a person making adult content of themselves needs no ask, and nor does an ordinary request", async () => {
    const own = await runGenerateImage({ ...imageCall(), state: stateFor(iris) });
    expect(data(own).likenessAskId).toBeUndefined();
    expect(data(own).pictureJobId).toBeTruthy();
    const ordinary = await runGenerateImage({ ...imageCall({ prompt: "a red fox in the snow" }), state: stateFor(sage), callId: "c-2" });
    // A saved style of a household adult is adult-only, so even a plain prompt through it asks; no style at all never does.
    const plain = await runGenerateImage({ state: stateFor(sage), args: { prompt: "a red fox in the snow" }, callId: "c-3", spoken: false });
    expect(data(plain).likenessAskId).toBeUndefined();
    expect(data(plain).pictureJobId).toBeTruthy();
    expect(typeof text(ordinary)).toBe("string");
  });

  test("Make another asks again: every held request opens its own ask", async () => {
    const style = { id: PIC_STYLE, name: "Iris portrait", likeness_subject: iris.id, classification: "adult-only" as const };
    const a = await prepareStylesUse({ medium: "picture", audience: audience(sage), styles: [style], text: PROMPT, source: "chat", held: { prompt: PROMPT, count: 1, temporary: false } });
    const b = await prepareStylesUse({ medium: "picture", audience: audience(sage), styles: [style], text: PROMPT, source: "chat", held: { prompt: `${PROMPT} again`, count: 1, temporary: false } });
    expect(a).toMatchObject({ kind: "likeness", adultContent: true, askId: expect.any(String), negativePrompt: null });
    expect(b).toMatchObject({ kind: "likeness", askId: expect.any(String) });
    if (a.kind === "likeness" && b.kind === "likeness") { expect(a.askId).not.toBe(b.askId); expect(a.proofs.size).toBe(0); }
    // Without a way to hold the job (a path that did not opt in) the same request is refused.
    expect(await prepareStylesUse({ medium: "picture", audience: audience(sage), styles: [style], text: PROMPT, source: "chat" })).toMatchObject({ kind: "refused", line: ADULT_CONTENT_OTHER_SUBJECT_LINE });
    expect(await prepareStyleUse({ medium: "picture", audience: audience(sage), style, text: PROMPT, depictsRealPerson: true, source: "chat" })).toMatchObject({ kind: "refused", line: ADULT_CONTENT_OTHER_SUBJECT_LINE });
  });
});

describe("a held video", () => {
  test("a starting picture never rides along with adult content of another person", async () => {
    const png = await testPng();
    storeTemporaryChatImage({ id: "photo-1", turnId: "turn-1", conversationId: "conv-1", ownerPersonId: sage.id, name: "photo.png", mediaType: "image/png", width: 64, height: 64, bytes: png });
    __setPhotoInspectorForTests(async () => ({ people: 1, faces: 1, under18: "no" }));
    videoStack.loras.find((l) => l.id === VID_STYLE)!.classification = "adult-only";
    const state = { ...(stateFor(sage, true) as object), conversationId: "conv-1", turnId: "turn-1", images: [{ id: "photo-1", name: "photo.png", width: 64, height: 64, media_type: "image/png" }], utterance: "animate this photo, it is Iris" } as never;
    const out = await runGenerateVideo({ state, args: { prompt: "gentle motion", style: "Iris motion", from_picture: "attached", photo_subject: "Iris" }, callId: "c-ph", spoken: false });
    expect(videoStack.submitted).toHaveLength(0);
    expect(db.select().from(likenessAsks).all().filter((r) => r.state === "waiting")).toHaveLength(0);
    expect(typeof text(out)).toBe("string");
  });

  const videoCall = () => ({ state: stateFor(sage), args: { prompt: PROMPT, style: "Iris motion", depicts_real_person: true }, callId: "c-vid", spoken: false });

  test("waits for the consent and then goes to the Stack with a proof", async () => {
    const outcome = await runGenerateVideo(videoCall());
    const { videoJobId, likenessAskId } = data(outcome);
    expect(videoJobId && likenessAskId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(videoStack.submitted).toHaveLength(0);
    expect(getVideoJobFor(sage, videoJobId!)?.state).toBe("queued");
    decideAsk(likenessAskId!, iris, "consent");
    await until(() => videoStack.submitted.length === 1);
    const sent = videoStack.submitted[0] as { prompt: string; negative_prompt?: string; loras: Array<{ id: string; likeness_proof?: string }> };
    expect(sent.negative_prompt ?? "").not.toContain("nude");
    expect(sent.loras[0]).toMatchObject({ id: VID_STYLE, likeness_proof: expect.any(String) });
    expect(ask(likenessAskId!).state).toBe("consumed");
  });

  test("a decline sends nothing", async () => {
    const outcome = await runGenerateVideo(videoCall());
    const { videoJobId, likenessAskId } = data(outcome);
    decideAsk(likenessAskId!, iris, "decline");
    await until(() => getVideoJobFor(sage, videoJobId!)?.state === "failed");
    expect(getVideoJobFor(sage, videoJobId!)?.error).toBe("Iris said no. Nothing was made.");
    expect(videoStack.submitted).toHaveLength(0);
  });
});
