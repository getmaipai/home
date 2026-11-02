// VIDEO-INPUTS-01 (Home side): (A) a start picture goes to LTX-2.5 Standard, Boost and Max when the Stack reports `image_to_video`; (B) `edit_video`
// `continue` starts a new clip from the last frame of a finished one (the Stack's `frame` op, then the picture start); (C) `join` takes a
// `transition` and says plainly that a crossfade is not available until the Stack has the step. Fake Stacks only; no network.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { attachments, people, videoJobs } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { LTX25_MAX_MODEL, LTX25_MODEL, chooseVideoQuality, ltx25EndPictureReady, ltx25MaxPictureReady, ltx25PictureReady } from "@/lib/videos/quality";
import { WAN_QUICK_VIDEO_MODEL } from "@/lib/pictures/lane";
import { videoBodyForSlot } from "@/lib/videos/slotBody";
import { CONTINUE_NOT_READY_LINE, CONTINUE_TRASH_LINE, CROSSFADE_NOT_SUPPORTED_LINE, EDIT_VIDEO_TOOL_ID, runEditVideo } from "@/lib/videos/editTool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { CROSSFADE_IN_STACK, crossfadeOps, crossfadeProblem, joinOps, lastFrameAt, frameOps } from "@/lib/videos/editPlan";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_DIR } from "@/lib/paths";

let video: FakeVideoStack;
let stack: FakeEditStack;
const READY = (extra: Parameters<typeof readyVideoStatusForTests>[0] = {}) => readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", detailed: "installed", ...extra });
const PICTURES = () => READY({ ltx25Picture: true, ltx25maxPicture: true });
beforeEach(() => {
  resetDb();
  __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack();
  video.ltx25 = "ready"; video.ltx25max = "ready"; video.detailed = "installed";
  __setVideoStatusForTests(PICTURES());
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); });

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}xyz`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function chatState(actor: PersonRow, conversationId?: string, temporary = false): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
const BOAT = "A paper boat floats down a rainy street, soft evening light";
async function makeClip(actor: PersonRow, conversationId?: string, temporary = false, args: Record<string, unknown> = {}): Promise<{ job: VideoJob; state: TurnState }> {
  const state = chatState(actor, conversationId, temporary);
  const outcome = await runGenerateVideo({ state, args: { prompt: BOAT, ...args }, callId: "make", spoken: false });
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!id) throw new Error(`no job: ${outcome.result?.reply?.text ?? outcome.detail}`);
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId!, temporary) };
}
const edit = (state: TurnState, args: Record<string, unknown>) => runEditVideo({ state, args, callId: "edit", spoken: false });
const jobOf = (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => getVideoJobFor(actor, (outcome.result?.data as { videoJobId: string }).videoJobId)!;
const refusedWith = (outcome: Awaited<ReturnType<typeof edit>>) => (outcome.result?.data as { refused?: string } | undefined)?.refused;
const finished = async (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => { const id = (outcome.result?.data as { videoJobId: string }).videoJobId; await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id)?.state ?? "")); return getVideoJobFor(actor, id)!; };

describe("A: the Stack's picture flags decide, Home hard-codes nothing", () => {
  test("the flags are read exactly as true; an older Stack, a missing level or Quick and Detailed give none", () => {
    expect(ltx25PictureReady(PICTURES())).toBe(true);
    expect(ltx25MaxPictureReady(PICTURES())).toBe(true);
    expect(ltx25EndPictureReady(PICTURES())).toBe(true);
    expect(ltx25EndPictureReady(PICTURES(), true)).toBe(true);
    expect(ltx25PictureReady(READY())).toBe(false);
    expect(ltx25MaxPictureReady(READY({ ltx25Picture: true }))).toBe(false);
    expect(ltx25EndPictureReady(READY())).toBe(false);
    expect(ltx25PictureReady(READY({ ltx25Picture: true, ltx25: "missing" }))).toBe(false);
    expect(ltx25PictureReady(null)).toBe(false);
  });

  test("a picture rides LTX-2.5 at every level for an adult when the flag is true, and the old makers when it is not", () => {
    const engine = PICTURES();
    expect(chooseVideoQuality({ requested: "quick", seconds: 10, engine, adultLane: true, hasPicture: true })).toMatchObject({ quality: "quick", maker: "ltx25", seconds: 10, note: null });
    expect(chooseVideoQuality({ requested: "detailed", seconds: 5, engine, adultLane: true, hasPicture: true })).toMatchObject({ quality: "detailed", maker: "ltx25", note: null });
    expect(chooseVideoQuality({ requested: "detailed", seconds: 10, engine, adultLane: true, hasPicture: true, max: true })).toMatchObject({ maker: "ltx25max", seconds: 10 });
    const old = READY();
    expect(chooseVideoQuality({ requested: "quick", engine: old, adultLane: true, hasPicture: true })).toMatchObject({ maker: "wan", note: "picture_needs_quick" });
    expect(chooseVideoQuality({ requested: "detailed", engine: old, adultLane: true, hasPicture: true, max: true }).maker).not.toBe("ltx25max");
    // Standard and Boost flag true, Max flag false: Max falls back to the level below, never a Max picture clip.
    expect(chooseVideoQuality({ requested: "detailed", engine: READY({ ltx25Picture: true }), adultLane: true, hasPicture: true, max: true }).maker).toBe("ltx25");
  });

  test("a style still keeps a clip off LTX-2.5, and a teen or a child never gets it (rule 8)", () => {
    const engine = PICTURES();
    expect(chooseVideoQuality({ engine, adultLane: true, hasPicture: true, style: { base_model: "wan2.2-ti2v-5b" } }).maker).toBe("wan");
    expect(chooseVideoQuality({ engine, adultLane: true, hasPicture: true, max: true, style: { base_model: "ltx-2.3" } }).maker).toBe("ltx23");
    expect(chooseVideoQuality({ requested: "detailed", engine, quickOnly: true, adultLane: false, hasPicture: true, max: true })).toMatchObject({ quality: "quick", maker: "wan" });
    const sent = videoBodyForSlot({ prompt: BOAT, audience: "all-ages", model: LTX25_MODEL, size: "512x256", seconds: 5, image: "abc", end_image: "def" }, "standard", "teen", "teen", engine);
    expect(sent.body.model).toBe(WAN_QUICK_VIDEO_MODEL);
    expect(sent.body.end_image).toBeUndefined();
  });

  async function pictureClip(who: "owner" | "adult", tier: string) {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
    const png = new Uint8Array(await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
    const made = storeFile(row, { conversationId: null, turnId: null, mediaType: "image/png", bytes: png, provenance: "composer:upload", retention: "kept", deduplicate: false });
    if (!made.ok) throw new Error("file");
    void who;
    const res = await owner.post("/api/videos/make", { prompt: BOAT, tier, start_frame: made.value.id, seconds: 5 });
    return { res, png };
  }

  for (const [tier, model, size] of [["standard", LTX25_MODEL, "512x256"], ["boost", LTX25_MODEL, "768x448"], ["max", LTX25_MAX_MODEL, "1024x576"]] as const) {
    test(`Create sends a Library picture to LTX-2.5 at ${tier} when the Stack says it can start from one`, async () => {
      const { res, png } = await pictureClip("owner", tier);
      expect(res.status).toBe(200);
      await until(() => video.submitted.length > 0);
      const sent = video.submitted[0]!;
      expect(sent).toMatchObject({ model, size, image_source: "uploaded" });
      expect(Buffer.from(sent.image as string, "base64").equals(Buffer.from(png))).toBe(true);
      expect(sent.end_image).toBeUndefined();
    });
  }

  test("on a Stack without the flags the same request goes the old way: no LTX-2.5 model on the wire", async () => {
    __setVideoStatusForTests(READY());
    const { res } = await pictureClip("owner", "max");
    expect(res.status).toBe(200);
    await until(() => video.submitted.length > 0);
    expect(video.submitted[0]!.model).not.toBe(LTX25_MAX_MODEL);
    expect(video.submitted[0]!.model).not.toBe(LTX25_MODEL);
  });
});

describe("B: edit_video continue", () => {
  test("the last frame goes through the Stack's frame op, then the picture starts a new clip at the same level; the old clip is kept", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner, undefined, false, { look: "anime", camera: "dolly-in", seconds: 6 });
    expect(job.request.create).toMatchObject({ look: "anime", recipe: "dolly-in" });
    const outcome = await edit(state, { clip: "latest", change: "continue" });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.result?.reply?.text).toContain("starts where the first one ended");
    expect(outcome.result?.reply?.text).toContain("the first one is kept");
    expect(stack.jobs).toHaveLength(1);
    const framed = stack.jobs[0]!;
    expect(framed.input.output.name).toBe("frame.png");
    expect(framed.input.ops).toEqual(frameOps(lastFrameAt(job.files[0]!.seconds ?? job.request.seconds)));
    expect(framed.input.ops).toHaveLength(1);
    await until(() => video.submitted.length >= 2);
    const sent = video.submitted[1]!;
    expect(sent).toMatchObject({ model: LTX25_MODEL, image_source: "generated" });
    // The frame goes as a JPEG of the Stack's picture, not the clip.
    const bytes = Buffer.from(sent.image as string, "base64");
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(String(sent.prompt)).toContain(BOAT);
    expect(sent.seed).not.toBe(job.request.seed);
    const next = jobOf(owner, outcome);
    expect(next.id).not.toBe(job.id);
    expect(next.kind).toBe("animate");
    expect(next.conversationId).toBe(job.conversationId);
    expect(next.prompt).toBe(BOAT);
    expect(next.request.source_file_id).toBeTruthy();
    expect(next.request.create).toMatchObject({ look: "anime", recipe: "dolly-in" });
    expect(next.request.seconds).toBe(job.request.seconds);
    expect(getVideoJobFor(owner, job.id)?.state).toBe("done");
    expect(next.request.adultOnly).toBeUndefined();
  });

  test("new words replace the old ones and the level and length can change; a Max source continues at Max", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner, undefined, false, { tier: "max", seconds: 10 });
    expect(job.request.tier).toBe("max");
    const outcome = await edit(state, { clip: "latest", change: "continue", prompt: "The boat reaches a wide river at sunset", seconds: 4 });
    expect(outcome.status).toBe("succeeded");
    const next = jobOf(owner, outcome);
    expect(next.prompt).toBe("The boat reaches a wide river at sunset");
    await until(() => video.submitted.length >= 2);
    expect(video.submitted[1]).toMatchObject({ model: LTX25_MAX_MODEL, seconds: 4, tier: "max" });
    expect(next.request.tier).toBe("max");
  });

  test("an adult-only source makes an adult-only continuation; Make another on it keeps the picture", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const row = db.select().from(videoJobs).where(eq(videoJobs.id, job.id)).get()!;
    db.update(videoJobs).set({ request: JSON.stringify({ ...JSON.parse(row.request), adultOnly: true }) }).where(eq(videoJobs.id, job.id)).run();
    const outcome = await edit(state, { clip: job.id, change: "continue" });
    const next = jobOf(owner, outcome);
    expect(next.request.adultOnly).toBe(true);
    await finished(owner, outcome);
    const again = await edit(chatState(owner, job.conversationId!), { clip: next.id, change: "another_take" });
    expect(again.status).toBe("succeeded");
    await until(() => video.submitted.length >= 3);
    expect(video.submitted[2]!.image).toBe(video.submitted[1]!.image);
  });

  test("a clip in Trash is refused with its own line and nothing is read or started", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, job.files[0]!.id)).run();
    const outcome = await edit(state, { clip: "latest", change: "continue" });
    expect(refusedWith(outcome)).toBe("in_trash");
    expect(outcome.result?.reply?.text).toContain(CONTINUE_TRASH_LINE);
    expect(stack.jobs).toHaveLength(0);
    expect(video.submitted).toHaveLength(1);
  });

  test("when LTX-2.5 cannot start from a picture the line says so in plain words and no frame is taken", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    __setVideoStatusForTests(READY());
    const outcome = await edit(state, { clip: "latest", change: "continue" });
    expect(refusedWith(outcome)).toBe("picture_start_not_ready");
    expect(outcome.result?.reply?.text).toContain(CONTINUE_NOT_READY_LINE);
    expect(CONTINUE_NOT_READY_LINE).not.toMatch(/ltx|wan/i);
    expect(stack.jobs).toHaveLength(0);
    expect(video.submitted).toHaveLength(1);
  });

  test("one clip at a time: a second continue while the first is being made is refused and takes no frame", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    video.pollsToFinish = 50;
    const first = await edit(state, { clip: "latest", change: "continue" });
    expect(first.status).toBe("succeeded");
    const second = await edit(chatState(owner, state.conversationId!), { clip: "latest", change: "continue" });
    expect(refusedWith(second)).toBe("already_making");
    expect(stack.jobs).toHaveLength(1);
  });

  test("a failed frame job is one plain line and nothing is sent to the video engine", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    stack.failWith = "The picture could not be taken.";
    const outcome = await edit(state, { clip: "latest", change: "continue" });
    expect(outcome.result?.reply?.text).toContain("I couldn't change that video.");
    expect(video.submitted).toHaveLength(1);
  });

  test("a temporary chat continues its own clip, in memory", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner, undefined, true);
    expect(job.temporary).toBe(true);
    const outcome = await edit(state, { clip: "latest", change: "continue" });
    expect(outcome.status).toBe("succeeded");
    const next = jobOf(owner, outcome);
    expect(next.temporary).toBe(true);
    expect(next.request.source_file_id).toBeTruthy();
    expect(db.select().from(videoJobs).all().find((row) => row.id === next.id)).toBeUndefined();
  });

  test("a teen is refused and nothing is taken or sent (rule 8)", async () => {
    const owner = person("owner");
    const { job } = await makeClip(owner);
    const teen = person("teen");
    db.update(people).set({ birthdate: "2011-03-01" } as never).where(eq(people.id, teen.id)).run();
    const outcome = await edit(chatState(db.select().from(people).where(eq(people.id, teen.id)).get() as PersonRow), { clip: job.id, change: "continue" });
    expect(outcome.result?.data).toHaveProperty("refused");
    expect(stack.jobs).toHaveLength(0);
    expect(video.submitted).toHaveLength(1);
  });

  test("the package declares continue and the join transition", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, EDIT_VIDEO_TOOL_ID, "manifest.json"), "utf8")) as { version: string; args: { properties: Record<string, { enum?: string[]; minimum?: number; maximum?: number }> } };
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.args.properties.change!.enum).toContain("continue");
    expect(manifest.args.properties.transition!.enum).toEqual(["cut", "crossfade"]);
    expect(manifest.args.properties.transition_s).toMatchObject({ minimum: 0.3, maximum: 1 });
  });
});

describe("C: join transition", () => {
  test("a cut is the default and a straight concat; a crossfade op is built clamped to 0.3 to 1 second", () => {
    expect(joinOps()).toEqual([{ op: "concat" }]);
    expect(joinOps("cut", 0.9)).toEqual([{ op: "concat" }]);
    expect(joinOps("crossfade")).toEqual([{ op: "crossfade", duration_s: 0.5 }]);
    expect(crossfadeOps(5)).toEqual([{ op: "crossfade", duration_s: 1 }]);
    expect(crossfadeOps(0.1)).toEqual([{ op: "crossfade", duration_s: 0.3 }]);
    expect(crossfadeProblem([5, 5], 0.5)).toBeNull();
    expect(crossfadeProblem([5, null, 0.9], 0.5)).toContain("too short");
  });

  test("a crossfade is refused with the plain not-available line until the Stack has the step; nothing is read or started", async () => {
    expect(CROSSFADE_IN_STACK).toBe(false);
    const owner = person("owner");
    const a = await makeClip(owner);
    const b = await makeClip(owner, a.state.conversationId!);
    const outcome = await edit(chatState(owner, a.state.conversationId!), { clip: "latest", change: "join", clips: [a.job.id, b.job.id], transition: "crossfade", transition_s: 0.6 });
    expect(refusedWith(outcome)).toBe("not_supported");
    expect(outcome.result?.reply?.text).toContain(CROSSFADE_NOT_SUPPORTED_LINE);
    expect(stack.jobs).toHaveLength(0);
  });

  test("a join with transition cut, or none, is the same straight join as before", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    const b = await makeClip(owner, a.state.conversationId!);
    for (const extra of [{}, { transition: "cut" }, { transition: "cut", transition_s: 0.8 }]) {
      const outcome = await edit(chatState(owner, a.state.conversationId!), { clip: "latest", change: "join", clips: [a.job.id, b.job.id], ...extra });
      expect(outcome.status).toBe("succeeded");
      await finished(owner, outcome);
      expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "concat" }]);
    }
  });

  test("a transition length outside 0.3 to 1 second is a bad argument", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    const b = await makeClip(owner, a.state.conversationId!);
    const outcome = await edit(chatState(owner, a.state.conversationId!), { clip: "latest", change: "join", clips: [a.job.id, b.job.id], transition: "crossfade", transition_s: 2 });
    expect(outcome.status).toBe("failed");
  });
});
