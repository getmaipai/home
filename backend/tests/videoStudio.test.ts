// VIDEO-STUDIO-07 (docs/design/video-studio-2026-11-02.md): the Studio page's plan, its export through the shared edit gate and the add action.
// Part one is the plan to Stack steps table (pure). Part two runs real finished clips through the fake video Stack and the fake media.edit Stack.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { __resetAdultLockForTests, __unlockedForTests, __unlockRestOfTest, withMark } from "@/lib/adultLock";
import { appRouteAllowed } from "@/lib/apps";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { libraryProvenance } from "@/lib/libraryProvenance";
import { getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { compileStudioPlan, studioPlanSchema, STUDIO_FILM_S, type StudioPlan, type StudioSources } from "@/lib/videos/studioPlan";
import { startStudioExport, STUDIO_VOICE_GONE_LINE } from "@/lib/videos/studioExport";
import { studioAdd, studioHeaderRows, studioRows, STUDIO_LOCKED_LINE, STUDIO_NO_CLIP_LINE } from "@/lib/videos/studio";
import { __resetStudioVoicesForTests, getStudioVoice, wavSeconds } from "@/lib/videos/studioVoices";
import { feedRowById, feedRows } from "@/lib/videos/feed";
import { CROSSFADE_IN_STACK, gainOps, fadeOps } from "@/lib/videos/editPlan";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

// ---------------------------------------------------------------- the plan to steps table

type PlanPatch = Partial<{ video: Partial<StudioPlan["video"]>; voice: Partial<StudioPlan["voice"]>; music: Partial<StudioPlan["music"]> }>;
const vp = (ref: string, over: Partial<StudioPlan["video"]["pieces"][number]> = {}) => ({ ref, in_s: 0, out_s: 6, level_db: 0, fade_in_s: 0, fade_out_s: 0, ...over });
const lp = (ref: string, over: Partial<StudioPlan["voice"]["pieces"][number]> = {}) => ({ ref, in_s: 0, out_s: 2, start_s: 0, level_db: 0, fade_in_s: 0, fade_out_s: 0, duck: false, ...over });
function planOf(pieces: StudioPlan["video"]["pieces"], patch: PlanPatch = {}, transitions: StudioPlan["video"]["transitions"] = []): StudioPlan {
  return {
    version: 1, film_s: 0,
    video: { level_db: 0, muted: false, pieces, transitions, ...patch.video },
    voice: { level_db: 0, muted: false, pieces: [], ...patch.voice },
    music: { level_db: 0, muted: false, pieces: [], ...patch.music },
  };
}
const SRC6: StudioSources = { video: [6, 6, 6, 6, 6, 6], voice: [3, 3], music: [30, 30] };
const compiled = (plan: StudioPlan, sources: StudioSources = SRC6) => {
  const result = compileStudioPlan(studioPlanSchema.parse(plan), sources);
  if (!result.ok) throw new Error(`${result.code}: ${result.line}`);
  return result.value;
};
const refusedWith = (plan: StudioPlan, sources: StudioSources = SRC6) => {
  const result = compileStudioPlan(studioPlanSchema.parse(plan), sources);
  return result.ok ? null : result.code;
};

describe("the plan as Stack steps", () => {
  test("the Stack has the crossfade step now", () => expect(CROSSFADE_IN_STACK).toBe(true));

  test("a trim: one trim step, the film is the piece's length; a whole untouched clip is nothing to export", () => {
    const cut = compiled(planOf([vp("a", { in_s: 1, out_s: 4 })]));
    expect(cut.pieces).toEqual([{ index: 0, ops: [{ op: "trim", in_s: 1, out_s: 4 }], seconds: 3 }]);
    expect(cut.filmSeconds).toBe(3);
    expect(cut.joins).toEqual([]);
    expect(cut.changed).toBe(true);
    expect(compiled(planOf([vp("a")])).changed).toBe(false);
    // The end of a piece past the clip's real end is the clip's end (whole clip, no trim).
    expect(compiled(planOf([vp("a", { out_s: 9 })])).pieces[0]!.ops).toEqual([]);
  });

  test("level, mute and fades: the lane's level and the piece's level add; mute drops the clip's sound; fades come last and fit inside the piece", () => {
    expect(compiled(planOf([vp("a", { level_db: -3 })], { video: { level_db: -3 } })).pieces[0]!.ops).toEqual([{ op: "gain", db: -6 }]);
    expect(compiled(planOf([vp("a", { level_db: 0 })], { video: { level_db: 0 } })).pieces[0]!.ops).toEqual([]);
    expect(compiled(planOf([vp("a", { level_db: -3, in_s: 1 })], { video: { muted: true } })).pieces[0]!.ops).toEqual([{ op: "trim", in_s: 1, out_s: 6 }, { op: "mute" }]);
    expect(compiled(planOf([vp("a", { in_s: 2, out_s: 4, fade_in_s: 0.5, fade_out_s: 1 })])).pieces[0]!.ops).toEqual([{ op: "trim", in_s: 2, out_s: 4 }, { op: "fade", in_s: 0.5, out_s: 1 }]);
    // Fades longer than the piece are scaled down to fit, never refused.
    const fitted = compiled(planOf([vp("a", { in_s: 0, out_s: 1, fade_in_s: 3, fade_out_s: 1 })], {}, [])).pieces[0]!.ops;
    expect(fitted.at(-1)).toMatchObject({ op: "fade" });
    const fade = fitted.at(-1) as { in_s: number; out_s: number };
    expect(fade.in_s + fade.out_s).toBeLessThanOrEqual(1.0001);
    expect(gainOps(0.004)).toEqual([]);
    expect(gainOps(100)).toEqual([{ op: "gain", db: 24 }]);
    expect(fadeOps(0, 0)).toEqual([]);
  });

  test("joins: cuts are one concat, equal crossfades are one crossfade, a mix of both is two steps in order; the film is the sum minus each blend", () => {
    const three = [vp("a"), vp("b"), vp("c")];
    const cuts = compiled(planOf(three, {}, [{ kind: "cut", seconds: 0 }, { kind: "cut", seconds: 0 }]));
    expect(cuts.joins).toEqual([{ transition: "cut", seconds: 0, count: 2, ops: [{ op: "concat" }] }]);
    expect(cuts.filmSeconds).toBe(18);
    const fades = compiled(planOf(three, {}, [{ kind: "crossfade", seconds: 0.5 }, { kind: "crossfade", seconds: 0.5 }]));
    expect(fades.joins).toEqual([{ transition: "crossfade", seconds: 0.5, count: 2, ops: [{ op: "crossfade", duration_s: 0.5 }] }]);
    expect(fades.filmSeconds).toBe(17);
    const mixed = compiled(planOf(three, {}, [{ kind: "cut", seconds: 0 }, { kind: "crossfade", seconds: 1 }]));
    expect(mixed.joins.map((j) => [j.transition, j.seconds, j.count])).toEqual([["cut", 0, 1], ["crossfade", 1, 1]]);
    expect(mixed.filmSeconds).toBe(17);
    const different = compiled(planOf(three, {}, [{ kind: "crossfade", seconds: 0.4 }, { kind: "crossfade", seconds: 0.8 }]));
    expect(different.joins.map((j) => j.seconds)).toEqual([0.4, 0.8]);
    // A missing transition is a cut.
    expect(compiled(planOf([vp("a"), vp("b")])).joins[0]!.transition).toBe("cut");
  });

  test("a crossfade between pieces that are too short, or outside 0.3 to 1 second, is refused with a line", () => {
    expect(refusedWith(planOf([vp("a", { out_s: 1 }), vp("b")], {}, [{ kind: "crossfade", seconds: 0.6 }]))).toBe("crossfade_too_short");
    expect(refusedWith(planOf([vp("a"), vp("b")], {}, [{ kind: "crossfade", seconds: 0.1 }]))).toBe("bad_crossfade");
  });

  test("a voice and a song: songs go first so a line can lower them; level, fades, start and end reach the overlay; a piece inside its file is cut out first", () => {
    const plan = planOf([vp("a"), vp("b")], {
      music: { level_db: -10, muted: false, pieces: [lp("song", { in_s: 4, out_s: 20, start_s: 0, level_db: -2, fade_in_s: 1, fade_out_s: 2, duck: true })] },
      voice: { level_db: 0, muted: false, pieces: [lp("line", { out_s: 2, start_s: 3 })] },
    });
    const out = compiled(plan);
    expect(out.overlays.map((o) => [o.lane, o.op])).toEqual([
      ["music", { op: "audio_overlay", input: 1, gain_db: -12, clip_gain_db: 0, start_s: 0, duck: false, fade_in_s: 1, fade_out_s: 2, end_s: 11.9 }],
      ["voice", { op: "audio_overlay", input: 2, gain_db: 0, clip_gain_db: 0, start_s: 3, duck: true, end_s: 5 }],
    ]);
    expect(out.overlays[0]!.trim).toEqual([{ op: "trim", in_s: 4, out_s: 20 }]);
    expect(out.overlays[1]!.trim).toEqual([]);
    expect(out.filmSeconds).toBe(12);
  });

  test("a muted lane is left out; a voice or song that starts after the film ends is refused; a film over a minute is refused", () => {
    const muted = planOf([vp("a")], { voice: { muted: true, level_db: 0, pieces: [lp("line")] } });
    expect(compiled(muted).overlays).toEqual([]);
    expect(refusedWith(planOf([vp("a")], { voice: { muted: false, level_db: 0, pieces: [lp("line", { start_s: 6 })] } }))).toBe("start_past_end");
    const long = Array.from({ length: 6 }, (_, i) => vp(`c${i}`, { out_s: 11 }));
    expect(refusedWith(planOf(long), { ...SRC6, video: [11, 11, 11, 11, 11, 11] })).toBe("too_long");
    expect(STUDIO_FILM_S).toBe(60);
  });

  test("the schema refuses what the page cannot have sent: seven pieces, three voice lines, a NaN, a wrong version", () => {
    const seven = planOf(Array.from({ length: 7 }, (_, i) => vp(`c${i}`)));
    expect(studioPlanSchema.safeParse(seven).success).toBe(false);
    expect(studioPlanSchema.safeParse(planOf([vp("a")], { voice: { muted: false, level_db: 0, pieces: [lp("a"), lp("b"), lp("c")] } })).success).toBe(false);
    expect(studioPlanSchema.safeParse(planOf([vp("a", { in_s: Number.NaN })])).success).toBe(false);
    expect(studioPlanSchema.safeParse({ ...planOf([vp("a")]), version: 2 }).success).toBe(false);
    expect(studioPlanSchema.safeParse(planOf([])).success).toBe(false);
    expect(studioPlanSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  test("a WAV header gives its length", () => {
    const bytes = new Uint8Array(44 + 32000);
    const view = new DataView(bytes.buffer);
    const put = (at: number, text: string) => [...text].forEach((ch, i) => { bytes[at + i] = ch.charCodeAt(0); });
    put(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); put(8, "WAVE"); put(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, "data"); view.setUint32(40, 32000, true);
    expect(wavSeconds(bytes)).toBe(1);
    expect(wavSeconds(new Uint8Array(100).fill(7))).toBeNull();
  });
});

// ---------------------------------------------------------------- export, with real finished clips

let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb();
  __resetAdultLockForTests();
  __resetStudioVoicesForTests();
  __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack();
  video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
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
function chatState(actor: PersonRow, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
const BOAT = "A paper boat floats down a rainy street, soft evening light";
const SPICY = "A sexy dance in a dim nightclub, slow camera";
async function makeClip(actor: PersonRow, prompt = BOAT): Promise<VideoJob> {
  const outcome = await runGenerateVideo({ state: chatState(actor), args: { prompt }, callId: "make", spoken: false });
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!id) throw new Error(`no job: ${outcome.result?.reply?.text ?? outcome.detail}`);
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return getVideoJobFor(actor, id)!;
}
/** A silent mono 8 kHz 8-bit WAV of `secondsLong` seconds: a song the header can measure. */
function wav(secondsLong: number): Uint8Array {
  const data = secondsLong * 8000;
  const bytes = new Uint8Array(44 + data).fill(128);
  const view = new DataView(bytes.buffer);
  const put = (at: number, text: string) => [...text].forEach((ch, i) => { bytes[at + i] = ch.charCodeAt(0); });
  put(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); put(8, "WAVE"); put(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); put(36, "data"); view.setUint32(40, data, true);
  return bytes;
}
const song = (owner: PersonRow, mediaType = "audio/wav") => { const made = storeFile(owner, { conversationId: null, turnId: null, mediaType, bytes: wav(30), provenance: "composer:upload", retention: "kept" }); if (!made.ok) throw new Error(made.error); return made.value.id; };
const finished = async (actor: PersonRow, id: string) => { await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id)?.state ?? "")); return getVideoJobFor(actor, id)!; };
/** The way the pipeline stores a clip behind the Adult lock: its Library files carry adult-only with the lock on. */
function lockClip(job: VideoJob): void {
  for (const row of db.select().from(attachments).where(like(attachments.provenance, `%"job":"${job.id}"%`)).all()) {
    const next = withMark(row.provenance, { lock: "on", raiseToAdult: true });
    if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, row.id)).run();
  }
}
const refOf = (job: VideoJob) => job.files[0]!.id;
const seconds = (job: VideoJob) => job.files[0]!.seconds ?? 6;
const audienceOf = (job: VideoJob) => libraryProvenance(db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!.provenance).audience;

describe("export", () => {
  test("three clips with a crossfade, a typed voice line and a song: one NEW clip, the old clips kept, each step the Stack is asked for in order", async () => {
    const owner = person("owner");
    const [a, b, c] = [await makeClip(owner), await makeClip(owner, "A red kite over a green field, clear morning"), await makeClip(owner, "A cat asleep on a sunny windowsill")];
    const added = await studioAdd(owner, { clip: refOf(a), kind: "voice", ref: "say:Look at the little boat go." });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(stack.speech).toHaveLength(1);
    expect(added.piece.ref).toMatch(/^voice:/);
    expect(added.piece.src).toMatch(/^\/api\/videos\/studio\/voices\//);
    const songId = song(owner);
    const len = seconds(a);
    const plan = planOf(
      [vp(refOf(a), { out_s: len }), vp(refOf(b), { out_s: len, in_s: 0.5 }), vp(refOf(c), { out_s: len, level_db: -4, fade_out_s: 1 })],
      {
        voice: { level_db: 0, muted: false, pieces: [lp(String(added.piece.ref), { out_s: Number(added.piece.duration_s), start_s: 1, duck: true })] },
        music: { level_db: -14, muted: false, pieces: [lp(songId, { out_s: 20, start_s: 0, fade_in_s: 1, fade_out_s: 2 })] },
      },
      [{ kind: "crossfade", seconds: 0.5 }, { kind: "crossfade", seconds: 0.5 }],
    );
    const before = stack.jobs.length;
    const started = await startStudioExport(owner, { clip: refOf(a), plan });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const next = await finished(owner, started.job.id);
    expect(next.state).toBe("done");
    expect(next.kind).toBe("edit");
    expect([a.id, b.id, c.id]).not.toContain(next.id);
    expect(next.conversationId).toBeNull();
    expect(next.request.edit).toMatchObject({ from: a.id, change: "mix", with: [b.id, c.id] });
    for (const old of [a, b, c]) expect(getVideoJobFor(owner, old.id)?.state).toBe("done");
    const ops = stack.jobs.slice(before).map((job) => job.input.ops);
    // piece b is cut at its start, piece c is turned down and fades out, a is whole; then one crossfade of the three; then both sounds in one step.
    expect(ops).toContainEqual([{ op: "trim", in_s: 0.5, out_s: len }]);
    expect(ops).toContainEqual([{ op: "gain", db: -4 }, { op: "fade", in_s: 0, out_s: 1 }]);
    expect(ops).toContainEqual([{ op: "crossfade", duration_s: 0.5 }]);
    const overlay = ops.at(-1)!;
    expect(overlay.map((op) => op.op)).toEqual(["audio_overlay", "audio_overlay"]);
    expect(overlay[0]).toMatchObject({ input: 1, gain_db: -14, start_s: 0, fade_in_s: 1, fade_out_s: 2, duck: false });
    expect(overlay[1]).toMatchObject({ input: 2, start_s: 1, duck: true });
    // It is a Library clip of its own and a feed entry that says it was edited.
    const row = db.select().from(attachments).where(eq(attachments.id, next.files[0]!.id)).get()!;
    expect(libraryProvenance(row.provenance)).toMatchObject({ writer: "video-edit", from: a.id });
    const entry = feedRowById(owner, next.id)[0]!;
    expect(entry.status).toBe("ready");
    expect(entry.tags).toContain("Edited");
    expect(feedRows(owner, {}).some((r) => r.id === next.id)).toBe(true);
  });

  test("a single trim is one step; nothing changed is refused in a line and nothing is sent", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    const same = await startStudioExport(owner, { clip: refOf(a), plan: planOf([vp(refOf(a), { out_s: seconds(a) })]) });
    expect(same).toMatchObject({ ok: false, code: "nothing_to_export" });
    expect(stack.jobs).toHaveLength(0);
    const cut = await startStudioExport(owner, { clip: refOf(a), plan: planOf([vp(refOf(a), { in_s: 1, out_s: 4 })]) });
    expect(cut.ok).toBe(true);
    if (cut.ok) await finished(owner, cut.job.id);
    expect(stack.jobs.map((job) => job.input.ops)).toEqual([[{ op: "trim", in_s: 1, out_s: 4 }]]);
  });

  test("a child, a teen and a guest are refused before any file is read; the page's actions are closed to them", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    for (const role of ["child", "teen"]) {
      const minor = person(role, `${role}x`);
      const plan = planOf([vp(refOf(a), { in_s: 1, out_s: 4 })]);
      expect(await startStudioExport(minor, { clip: refOf(a), plan })).toMatchObject({ ok: false, status: 403 });
      expect((await studioAdd(minor, { kind: "voice", ref: "say:hello there" })).ok).toBe(false);
      expect(studioRows(minor, refOf(a))).toEqual([]);
      for (const kind of ["actions"] as const) for (const id of ["export", "add"]) expect(appRouteAllowed(minor, "videos", kind, id)).toBe(false);
      // CLIPS-FEED-01: the Clips page binds `recipes` and is open to every role, so the route is open; the host answers only the `short` scope below adult (tests/videoClipsFeed.test.ts).
      expect(appRouteAllowed(minor, "videos", "data", "recipes")).toBe(true);
    }
    expect(stack.jobs).toHaveLength(0);
    expect(stack.speech).toHaveLength(0);
  });

  test("a missing clip, another person's clip, a clip in Trash, an over-limit plan and a bad body are each one plain refusal and nothing reaches the Stack", async () => {
    const owner = person("owner");
    const other = person("adult", "marlow");
    const mine = await makeClip(owner);
    const theirs = await makeClip(other);
    const cut = (ref: string) => planOf([vp(ref, { in_s: 1, out_s: 4 })]);
    expect(await startStudioExport(owner, { plan: cut("file-missing") })).toMatchObject({ ok: false, status: 404, code: "no_clip", line: STUDIO_NO_CLIP_LINE });
    expect(await startStudioExport(owner, { plan: cut(refOf(theirs)) })).toMatchObject({ ok: false, status: 404, code: "no_clip" });
    expect(await startStudioExport(owner, { plan: planOf([vp(refOf(mine), { in_s: 1, out_s: 4 }), vp(refOf(theirs))]) })).toMatchObject({ ok: false, code: "no_clip" });
    const seven = planOf(Array.from({ length: 7 }, () => vp(refOf(mine))));
    expect(await startStudioExport(owner, { plan: seven })).toMatchObject({ ok: false, status: 422, code: "bad_plan" });
    expect(await startStudioExport(owner, { plan: "nonsense" })).toMatchObject({ ok: false, code: "bad_plan" });
    expect(await startStudioExport(owner, {})).toMatchObject({ ok: false, code: "bad_plan" });
    db.update(attachments).set({ deletedAt: new Date().toISOString() } as never).where(eq(attachments.id, refOf(mine))).run();
    expect(await startStudioExport(owner, { plan: cut(refOf(mine)) })).toMatchObject({ ok: false, code: "no_clip" });
    expect(stack.jobs).toHaveLength(0);
  });

  test("a voice line from another person, a stale one and a song that is a picture are refused", async () => {
    const owner = person("owner");
    const other = person("adult", "marlow");
    const a = await makeClip(owner);
    const added = await studioAdd(other, { kind: "voice", ref: "say:Hello from over here." });
    if (!added.ok) throw new Error("add failed");
    const withVoice = (ref: string) => planOf([vp(refOf(a), { out_s: seconds(a) })], { voice: { level_db: 0, muted: false, pieces: [lp(ref)] } });
    expect(await startStudioExport(owner, { plan: withVoice(String(added.piece.ref)) })).toMatchObject({ ok: false, status: 404, code: "no_voice", line: STUDIO_VOICE_GONE_LINE });
    expect(await startStudioExport(owner, { plan: withVoice("voice:voice-nope") })).toMatchObject({ ok: false, code: "no_voice" });
    const picture = song(owner, "image/png");
    const asSong = planOf([vp(refOf(a), { out_s: seconds(a) })], { music: { level_db: 0, muted: false, pieces: [lp(picture)] } });
    expect(await startStudioExport(owner, { plan: asSong })).toMatchObject({ ok: false, code: "no_track" });
    expect(stack.jobs).toHaveLength(0);
  });

  test("one video at a time: an export while another is being made is refused in words", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    const plan = planOf([vp(refOf(a), { in_s: 1, out_s: 4 })]);
    stack.pollsToFinish = 40;
    const first = await startStudioExport(owner, { plan });
    expect(first.ok).toBe(true);
    const second = await startStudioExport(owner, { plan });
    expect(second).toMatchObject({ ok: false, status: 409, code: "already_making" });
    if (first.ok) await finished(owner, first.job.id);
  });

  test("a failed Stack step ends the export in one plain line and keeps the old clip", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    stack.failWith = "The picture could not be read.";
    const started = await startStudioExport(owner, { plan: planOf([vp(refOf(a), { in_s: 1, out_s: 4 })]) });
    if (!started.ok) throw new Error("did not start");
    const next = await finished(owner, started.job.id);
    expect(next.state).toBe("failed");
    expect(next.error).toContain("I couldn't change that video.");
    expect(getVideoJobFor(owner, a.id)?.state).toBe("done");
  });
});

describe("the audience floor and the Adult lock", () => {
  test("an all-ages export stays all-ages; an adult-only clip, an adult-only line, or an adult-only song makes an adult-only clip", async () => {
    const owner = person("owner");
    __unlockRestOfTest(owner.id);
    const clean = await makeClip(owner);
    const spicy = await makeClip(owner, SPICY);
    expect(audienceOf(spicy)).toBe("adult-only");
    const exportOf = async (plan: StudioPlan) => { const started = await startStudioExport(owner, { plan }); if (!started.ok) throw new Error(started.line); return finished(owner, started.job.id); };
    expect(audienceOf(await exportOf(planOf([vp(refOf(clean), { in_s: 1, out_s: 4 })])))).toBe("all-ages");
    expect(audienceOf(await exportOf(planOf([vp(refOf(spicy), { in_s: 1, out_s: 4 })])))).toBe("adult-only");
    expect(audienceOf(await exportOf(planOf([vp(refOf(clean), { out_s: seconds(clean) }), vp(refOf(spicy), { out_s: seconds(spicy) })])))).toBe("adult-only");
    const line = await studioAdd(owner, { kind: "voice", ref: "say:Come here, you sexy thing." });
    if (!line.ok) throw new Error("line");
    expect(audienceOf(await exportOf(planOf([vp(refOf(clean), { out_s: seconds(clean) })], { voice: { level_db: 0, muted: false, pieces: [lp(String(line.piece.ref))] } })))).toBe("adult-only");
    const plain = await studioAdd(owner, { kind: "voice", ref: "say:Look at the boat." });
    if (!plain.ok) throw new Error("line");
    expect(audienceOf(await exportOf(planOf([vp(refOf(clean), { out_s: seconds(clean) })], { voice: { level_db: 0, muted: false, pieces: [lp(String(plain.piece.ref))] } })))).toBe("all-ages");
  });

  test("a locked clip opens as the lock row with nothing of it, cannot be added or exported without the unlock, and opens after it", async () => {
    const owner = person("owner");
    const clean = await makeClip(owner);
    const spicy = await makeClip(owner, SPICY);
    lockClip(spicy);
    // Locked: one row that names nothing; the header says nothing of the clip either.
    const rows = studioRows(owner, refOf(spicy));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ locked: true });
    expect(JSON.stringify(rows)).not.toContain(refOf(spicy));
    expect(JSON.stringify(rows)).not.toContain("nightclub");
    expect(studioHeaderRows(owner, refOf(spicy))).toEqual([{ title: "Make it yours", locked: true }]);
    expect(await studioAdd(owner, { kind: "clip", ref: refOf(spicy) })).toMatchObject({ ok: false, status: 403, line: STUDIO_LOCKED_LINE });
    const plan = planOf([vp(refOf(clean), { out_s: seconds(clean) }), vp(refOf(spicy), { out_s: seconds(spicy) })]);
    expect(await startStudioExport(owner, { plan })).toMatchObject({ ok: false, status: 403, code: "locked" });
    expect(stack.jobs).toHaveLength(0);
    // Unlocked: the clip is a row with its lanes, marked adult-only so the page fetches it with the proof.
    const open = __unlockedForTests(owner.id, () => studioRows(owner, refOf(spicy))[0]!);
    expect(open).toMatchObject({ id: refOf(spicy), locked: false, adult_only: true });
    const lanes = open.lanes as Array<{ id: string; pieces: Array<Record<string, unknown>> }>;
    expect(lanes.map((lane) => lane.id)).toEqual(["video", "voice", "music"]);
    expect(lanes[0]!.pieces[0]).toMatchObject({ ref: refOf(spicy), in_s: 0, adult_only: true });
    expect(String(lanes[0]!.pieces[0]!.src)).toContain(`/api/videos/jobs/${spicy.id}/files/`);
    // A clean clip carries no mark.
    expect(studioRows(owner, refOf(clean))[0]).not.toHaveProperty("adult_only");
    // A locked source makes a locked clip.
    const out = await __unlockedForTests(owner.id, async () => { const started = await startStudioExport(owner, { plan }); if (!started.ok) throw new Error(started.line); return finished(owner, started.job.id); });
    const note = libraryProvenance(db.select().from(attachments).where(eq(attachments.id, out.files[0]!.id)).get()!.provenance);
    expect(note).toMatchObject({ audience: "adult-only", lock: "on" });
  });
});

describe("the add action", () => {
  test("a typed line is screened before any speech: a refused line makes no speech and nothing is kept", async () => {
    const owner = person("owner");
    const refused = await studioAdd(owner, { kind: "voice", ref: "say:a naked child playing in a park" });
    expect(refused).toMatchObject({ ok: false, status: 403, code: "refused" });
    expect(stack.speech).toHaveLength(0);
    const ok = await studioAdd(owner, { kind: "voice", ref: "say:The boat sails on." });
    expect(ok.ok).toBe(true);
    expect(stack.speech).toHaveLength(1);
    expect(stack.speech[0]).toMatchObject({ text: "The boat sails on." });
    if (ok.ok) expect(getStudioVoice(owner.id, String(ok.piece.ref).replace("voice:", ""))?.line).toBe("The boat sails on.");
  });

  test("speech that fails is one plain line; a pick for the wrong tool is one plain line; a clip and a song come back as pieces", async () => {
    const owner = person("owner");
    stack.speechFails = true;
    expect(await studioAdd(owner, { kind: "voice", ref: "say:Hello there." })).toMatchObject({ ok: false, status: 503, code: "speech_failed" });
    stack.speechFails = false;
    expect(await studioAdd(owner, { kind: "voice", ref: "file-123" })).toMatchObject({ ok: false, code: "wrong_kind" });
    expect(await studioAdd(owner, { kind: "music", ref: "say:Hello" })).toMatchObject({ ok: false, code: "wrong_kind" });
    expect(await studioAdd(owner, { kind: "nonsense", ref: "x" })).toMatchObject({ ok: false, status: 422 });
    const clip = await makeClip(owner);
    const added = await studioAdd(owner, { kind: "clip", ref: clip.id });
    expect(added).toMatchObject({ ok: true, piece: { ref: refOf(clip), duration_s: seconds(clip) } });
    const track = song(owner);
    const music = await studioAdd(owner, { kind: "music", ref: track });
    expect(music).toMatchObject({ ok: true, piece: { ref: track, src: `/api/files/${track}/content`, duration_s: 30 } });
    expect(await studioAdd(owner, { kind: "music", ref: "file-nope" })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("a temporary chat's clip", () => {
  test("is never opened, added or exported: it is meant to leave nothing in the Library", async () => {
    const owner = person("owner");
    const state = { ...chatState(owner), temporary: true } as TurnState;
    const outcome = await runGenerateVideo({ state, args: { prompt: BOAT }, callId: "make", spoken: false });
    const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(owner, id)?.state === "done");
    const temp = getVideoJobFor(owner, id)!;
    expect(temp.temporary).toBe(true);
    expect(studioRows(owner, temp.id)).toEqual([]);
    expect(studioRows(owner, refOf(temp))).toEqual([]);
    expect(await studioAdd(owner, { kind: "clip", ref: temp.id })).toMatchObject({ ok: false, code: "no_clip" });
    expect(await startStudioExport(owner, { plan: planOf([vp(refOf(temp), { in_s: 1, out_s: 4 })]) })).toMatchObject({ ok: false, code: "no_clip" });
    expect(stack.jobs).toHaveLength(0);
  });
});

describe("the page's rows", () => {
  test("no clip, a missing clip or another person's clip is no row; the header reads the plain title then", async () => {
    const owner = person("owner");
    const other = person("adult", "marlow");
    const theirs = await makeClip(other);
    expect(studioRows(owner, undefined)).toEqual([]);
    expect(studioRows(owner, "$state.clip")).toEqual([]);
    expect(studioRows(owner, refOf(theirs))).toEqual([]);
    expect(studioHeaderRows(owner, refOf(theirs))).toEqual([{ title: "Make it yours", locked: false }]);
  });

  test("an open clip is one video piece the clip's own length with its poster and address; the header carries its words", async () => {
    const owner = person("owner");
    const clip = await makeClip(owner);
    const row = studioRows(owner, clip.id)[0]!;
    expect(row).toMatchObject({ id: refOf(clip), locked: false });
    expect(String(row.title)).toContain("paper boat");
    const piece = (row.lanes as Array<{ pieces: Array<Record<string, unknown>> }>)[0]!.pieces[0]!;
    expect(piece).toMatchObject({ ref: refOf(clip), in_s: 0, out_s: seconds(clip), source_s: seconds(clip) });
    expect(studioHeaderRows(owner, clip.id)[0]).toMatchObject({ locked: false });
    expect(String(studioHeaderRows(owner, clip.id)[0]!.title).toLowerCase()).toContain("paper boat");
  });
});
