// VIDEO-CHAT-01 (C3, C4, docs/design/video-chat-2026-11-02.md): edit_video trim, join and mix on the Stack's media.edit job, through a fake Stack.
// The clips are real finished jobs made through the fake video Stack; the edit runs through lib/videos/stackEdit.ts against the fake edit Stack.
import { __unlockRestOfTest } from "@/lib/adultLock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, people, videoJobs } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { saveClonedVoice } from "@/lib/clonedVoices";
import { dataDir } from "@/lib/paths";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor, readVideoFile, type VideoJob } from "@/lib/videos/jobs";
import { libraryProvenance } from "@/lib/libraryProvenance";
import { canReadFileAudience } from "@/lib/access";
import { sweepStaleEditFolders } from "@/lib/videos/stackEdit";
import { mkdirSync, statSync, utimesSync } from "node:fs";
import { NO_CLIPS_LINE, NO_TRACK_LINE, NO_VOICE_LINE, START_PAST_END_LINE, JOIN_CLIPS_LINE, SPEECH_FAILED_LINE, runEditVideo } from "@/lib/videos/editTool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { MINOR_MAKE_LINE } from "@/lib/videos/make";
import { MIX_LEVELS, mixOps, trimRange } from "@/lib/videos/editPlan";
import { EDIT_FAILED_LINE, EDIT_UNAVAILABLE_LINE } from "@/lib/videos/stackEdit";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb();
  __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack();
  video.detailed = "installed";
  __setVideoStatusForTests(readyVideoStatusForTests({ detailed: "installed" }));
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
  // A temporary chat is a saved conversation row here with the turn's `temporary` flag set, as in the other video tests.
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
const BOAT = "A paper boat floats down a rainy street, soft evening light";

async function makeClip(actor: PersonRow, conversationId?: string, temporary = false, prompt = BOAT): Promise<{ job: VideoJob; state: TurnState }> {
  const state = chatState(actor, conversationId, temporary);
  const outcome = await runGenerateVideo({ state, args: { prompt }, callId: "make", spoken: false });
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!id) throw new Error(`no job: ${outcome.result?.reply?.text ?? outcome.detail}`);
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId!, temporary) };
}
const edit = (state: TurnState, args: Record<string, unknown>) => runEditVideo({ state, args, callId: "edit", spoken: false });
const jobOf = (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => getVideoJobFor(actor, (outcome.result?.data as { videoJobId: string }).videoJobId)!;
const finished = async (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => { const id = (outcome.result?.data as { videoJobId: string }).videoJobId; await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id)?.state ?? "")); return getVideoJobFor(actor, id)!; };
const editRoot = () => join(dataDir, "video-edit");
const leftovers = () => (existsSync(editRoot()) ? readdirSync(editRoot()) : []);
const library = (owner: PersonRow, mediaType = "audio/mpeg") => { const made = storeFile(owner, { conversationId: null, turnId: null, mediaType, bytes: new Uint8Array(3000).fill(5), provenance: "composer:upload", retention: "kept" }); if (!made.ok) throw new Error(made.error); return made.value.id; };

describe("the plan", () => {
  test("a cut is checked against the clip's length and the levels run quiet to loud", () => {
    expect(trimRange({ from_s: 2 }, 5)).toEqual({ ok: true, from: 2, to: 5 });
    expect(trimRange({ to_s: 3 }, 5)).toEqual({ ok: true, from: 0, to: 3 });
    expect(trimRange({ from_s: 1, to_s: 99 }, 5)).toEqual({ ok: true, from: 1, to: 5 });
    expect(trimRange({ from_s: 4, to_s: 2 }, 5).ok).toBe(false);
    expect(trimRange({ from_s: 7 }, 5).ok).toBe(false);
    expect(trimRange({ to_s: 9 }, 5).ok).toBe(false);
    expect(trimRange({ from_s: 1 }, null).ok).toBe(false);
    const gains = MIX_LEVELS.map((step) => step.gain_db);
    expect([...gains].sort((a, b) => a - b)).toEqual(gains);
    expect(mixOps("balanced", 1.5, true)).toEqual([{ op: "audio_overlay", input: 1, gain_db: 0, clip_gain_db: -3, start_s: 1.5, duck: true }]);
  });
});

describe("trim", () => {
  test("a cut makes a new finished video of the Stack's result, linked to the first, with the old one kept and nothing left on disk", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const outcome = await edit(state, { clip: "latest", change: "trim", from_s: 1, to_s: 4 });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.result?.data).toHaveProperty("videoJobId");
    expect(outcome.result?.reply?.text).toContain("the first one is kept");
    const next = await finished(owner, outcome);
    expect(next.state).toBe("done");
    expect(next.kind).toBe("edit");
    expect(next.id).not.toBe(job.id);
    expect(next.conversationId).toBe(job.conversationId);
    expect(next.request.edit).toEqual({ from: job.id, change: "trim" });
    expect(getVideoJobFor(owner, job.id)?.state).toBe("done");
    expect(stack.jobs).toHaveLength(1);
    const sent = stack.jobs[0]!.input;
    expect(sent.ops).toEqual([{ op: "trim", in_s: 1, out_s: 4 }]);
    expect(sent.inputs).toHaveLength(1);
    expect(stack.jobs[0]!.staged[0]!.bytes).toBeGreaterThan(1000);
    expect(sent.output.name).toBe("edited.mp4");
    expect(stack.rootsSet.at(-1)?.read).toContain(editRoot());
    expect(stack.rootsSet.at(-1)?.write).toContain(editRoot());
    // The new clip is in the Library with the video-edit note, a poster and its own bytes.
    const file = next.files[0]!;
    const row = db.select().from(attachments).where(eq(attachments.id, file.id)).get()!;
    expect(libraryProvenance(row.provenance)).toMatchObject({ writer: "video-edit", from: job.id, change: "trim", job: next.id });
    expect(readVideoFile(owner, next, file.id)?.bytes.byteLength).toBe(4096);
    expect(readVideoFile(owner, next, file.poster_id)?.mediaType).toBe("image/jpeg");
    expect(next.request.seconds).toBe(6);
    expect(leftovers()).toEqual([]);
  });

  test("a cut that makes no sense is refused in words and the Stack is never asked", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    const bad = await edit(state, { clip: "latest", change: "trim", from_s: 4, to_s: 2 });
    expect(bad.result?.data).toEqual({ refused: "bad_cut" });
    const past = await edit(state, { clip: "latest", change: "trim", from_s: 30 });
    expect(past.result?.reply?.text).toContain("seconds long");
    expect(stack.jobs).toHaveLength(0);
  });
});

describe("join", () => {
  test("clips join in the order named, each of the person's own, into one new video linked to the first", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    const b = await makeClip(owner, a.state.conversationId!);
    const c = await makeClip(owner, a.state.conversationId!);
    const outcome = await edit(chatState(owner, a.state.conversationId!), { clip: "latest", change: "join", clips: [c.job.id, a.job.id, b.job.id] });
    const next = await finished(owner, outcome);
    expect(next.state).toBe("done");
    expect(next.request.edit).toEqual({ from: c.job.id, change: "join", with: [a.job.id, b.job.id] });
    const sent = stack.jobs[0]!;
    expect(sent.input.inputs.map((path) => path.split("/").pop())).toEqual(["in-1.mp4", "in-2.mp4", "in-3.mp4"]);
    expect(sent.input.ops).toEqual([{ op: "concat" }]);
    expect(sent.staged.every((file) => file.bytes > 1000)).toBe(true);
    expect(leftovers()).toEqual([]);
    for (const old of [a.job, b.job, c.job]) expect(getVideoJobFor(owner, old.id)?.state).toBe("done");
  });

  test("another person's clip, an unknown clip, one clip and a list that is too long are refused and nothing reaches the Stack", async () => {
    const owner = person("owner");
    const other = person("adult", "marlow");
    const mine = await makeClip(owner);
    const theirs = await makeClip(other);
    const state = chatState(owner, mine.state.conversationId!);
    expect((await edit(state, { clip: "latest", change: "join", clips: [mine.job.id, theirs.job.id] })).result?.data).toEqual({ refused: "no_clip" });
    expect((await edit(state, { clip: "latest", change: "join", clips: [mine.job.id, "vjob-nothing"] })).result?.reply?.text).toContain(NO_CLIPS_LINE);
    expect((await edit(state, { clip: "latest", change: "join" })).result?.reply?.text).toContain(JOIN_CLIPS_LINE);
    expect((await edit(state, { clip: "latest", change: "join", clips: [mine.job.id] })).status).toBe("failed");
    expect((await edit(state, { clip: "latest", change: "join", clips: Array(7).fill(mine.job.id) })).status).toBe("failed");
    expect(stack.jobs).toHaveLength(0);
  });
});

describe("mix", () => {
  test("a voice line is screened, spoken in the person's own voice, and laid over a ducked clip at the default balance", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const outcome = await edit(state, { clip: "latest", change: "mix", sound: "voice", line: "Look at the little boat go." });
    const next = await finished(owner, outcome);
    expect(next.state).toBe("done");
    expect(next.request.edit).toEqual({ from: job.id, change: "mix" });
    expect(stack.speech).toHaveLength(1);
    expect(stack.speech[0]).toMatchObject({ text: "Look at the little boat go." });
    const sent = stack.jobs[0]!;
    expect(sent.input.inputs.map((path) => path.split("/").pop())).toEqual(["in-1.mp4", "in-2.wav"]);
    expect(sent.staged[1]!.bytes).toBe(2048);
    expect(sent.input.ops).toEqual([{ op: "audio_overlay", input: 1, gain_db: 0, clip_gain_db: -3, start_s: 0, duck: true }]);
    expect(leftovers()).toEqual([]);
  });

  test("a named home voice speaks the line, a level and a start time reach the overlay, and an unknown voice is refused before any speech", async () => {
    const owner = person("owner");
    const made = saveClonedVoice(owner, "Porch Voice", new Uint8Array(2000).fill(3), "audio/wav");
    if (!made.ok) throw new Error(made.error);
    const { state } = await makeClip(owner);
    const outcome = await edit(state, { clip: "latest", change: "mix", sound: "voice", line: "Here we go.", voice: "porch voice", level: "loud", start_s: 1.5 });
    await finished(owner, outcome);
    expect(stack.speech[0]!.voice_url).toContain(`/cloned/${made.value.id}/file`);
    expect(stack.jobs[0]!.input.ops).toEqual([{ op: "audio_overlay", input: 1, gain_db: 4, clip_gain_db: -6, start_s: 1.5, duck: true }]);
    const unknown = await edit(state, { clip: "latest", change: "mix", sound: "voice", line: "Hello there.", voice: "nobody" });
    expect(unknown.result?.reply?.text).toContain(NO_VOICE_LINE);
    expect(stack.speech).toHaveLength(1);
    const late = await edit(state, { clip: "latest", change: "mix", sound: "voice", line: "Hello there.", start_s: 40 });
    expect(late.result?.reply?.text).toContain(START_PAST_END_LINE);
    expect(stack.speech).toHaveLength(1);
  });

  test("a typed line goes through the prompt screening first: a line the screen refuses makes no speech and no job", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    const outcome = await edit(state, { clip: "latest", change: "mix", sound: "voice", line: "a naked child playing in a park" });
    expect(outcome.result?.reply?.text).toContain("No video was made");
    expect(outcome.result?.data).not.toHaveProperty("videoJobId");
    expect(stack.speech).toHaveLength(0);
    expect(stack.jobs).toHaveLength(0);
  });

  test("a song of the person's own Library goes under the clip, softly and not ducked; another person's file and a missing one are refused", async () => {
    const owner = person("owner");
    const other = person("adult", "marlow");
    const { state } = await makeClip(owner);
    const mine = library(owner);
    const next = await finished(owner, await edit(state, { clip: "latest", change: "mix", sound: "music", track: mine }));
    expect(next.state).toBe("done");
    const sent = stack.jobs[0]!;
    expect(sent.input.inputs.map((path) => path.split("/").pop())).toEqual(["in-1.mp4", "in-2.mp3"]);
    expect(sent.input.ops).toEqual([{ op: "audio_overlay", input: 1, gain_db: -8, clip_gain_db: 0, start_s: 0, duck: false }]);
    const theirs = library(other);
    expect((await edit(state, { clip: "latest", change: "mix", sound: "music", track: theirs })).result?.reply?.text).toContain(NO_TRACK_LINE);
    expect((await edit(state, { clip: "latest", change: "mix", sound: "music", track: "file-missing" })).result?.data).toEqual({ refused: "no_track" });
    expect((await edit(state, { clip: "latest", change: "mix", sound: "music" })).result?.data).toEqual({ refused: "nothing_to_mix" });
    expect(stack.jobs).toHaveLength(1);
  });

  test("a Library picture is not a song and is refused as a track", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    const picture = library(owner, "image/png");
    expect((await edit(state, { clip: "latest", change: "mix", sound: "music", track: picture })).result?.data).toEqual({ refused: "no_track" });
  });
});

describe("who may edit, and where", () => {
  test("a teen, a child and a guest are refused and nothing is spoken or sent to the Stack", async () => {
    const owner = person("owner");
    const made = await makeClip(owner);
    const teen = person("teen");
    db.update(videoJobs).set({ personId: teen.id }).where(eq(videoJobs.id, made.job.id)).run();
    const teenOut = await edit(chatState(teen), { clip: made.job.id, change: "trim", to_s: 2 });
    expect(teenOut.result?.reply?.text).toContain(MINOR_MAKE_LINE);
    expect((await edit(chatState(teen), { clip: made.job.id, change: "mix", sound: "voice", line: "hi there" })).result?.data).toEqual({ refused: "minor" });
    const child = person("child");
    db.update(videoJobs).set({ personId: child.id }).where(eq(videoJobs.id, made.job.id)).run();
    expect((await edit(chatState(child), { clip: made.job.id, change: "trim", to_s: 2 })).result?.data).toEqual({ refused: "minor" });
    expect((await edit(chatState(child), { clip: made.job.id, change: "join", clips: [made.job.id, made.job.id] })).result?.data).toEqual({ refused: "minor" });
    const guest = person("guest");
    expect((await edit(chatState(guest), { clip: made.job.id, change: "mix", sound: "voice", line: "hi there" })).result?.data).toEqual({ refused: "guest" });
    expect(stack.jobs).toHaveLength(0);
    expect(stack.speech).toHaveLength(0);
  });

  test("a temporary chat edits only its own temporary clips and a saved chat never a temporary one, in trim, join and mix", async () => {
    const owner = person("owner");
    const saved = await makeClip(owner);
    const temp = await makeClip(owner, undefined, true);
    expect(temp.job.temporary).toBe(true);
    const tempState = chatState(owner, temp.state.conversationId!, true);
    expect((await edit(tempState, { clip: saved.job.id, change: "trim", to_s: 2 })).result?.data).toEqual({ refused: "no_clip" });
    expect((await edit(tempState, { clip: "latest", change: "join", clips: [temp.job.id, saved.job.id] })).result?.data).toEqual({ refused: "no_clip" });
    const savedState = chatState(owner, saved.state.conversationId!);
    expect((await edit(savedState, { clip: temp.job.id, change: "trim", to_s: 2 })).result?.data).toEqual({ refused: "no_clip" });
    // A temporary chat never lays a saved Library song over its clip.
    expect((await edit(tempState, { clip: "latest", change: "mix", sound: "music", track: library(owner) })).result?.data).toEqual({ refused: "no_track" });
    expect(stack.jobs).toHaveLength(0);
    // Its own temporary clip edits, stays in memory (no Library row) and the old one stays.
    const next = await finished(owner, await edit(tempState, { clip: "latest", change: "trim", to_s: 3 }));
    expect(next.state).toBe("done");
    expect(next.temporary).toBe(true);
    expect(db.select().from(videoJobs).where(eq(videoJobs.id, next.id)).get()).toBeUndefined();
    expect(getVideoJobFor(owner, temp.job.id)?.state).toBe("done");
  });
});

describe("a Stack that fails never fails the answer", () => {
  test("the Stack ending the job failed becomes one plain line on the card, with no path in it, and the folder is removed", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    stack.failWith = "The edit could not be made at step 1 (trim). Open Details for what the tool said.";
    const outcome = await edit(state, { clip: "latest", change: "trim", to_s: 2 });
    expect(outcome.status).toBe("succeeded");
    const next = await finished(owner, outcome);
    expect(next.state).toBe("failed");
    expect(next.error).toContain("I couldn't change that video.");
    expect(next.error).toContain("step 1");
    expect(next.files).toEqual([]);
    expect(leftovers()).toEqual([]);
    stack.failWith = "/Users/someone/secret/file.mp4 could not be read";
    const again = await finished(owner, await edit(state, { clip: "latest", change: "trim", to_s: 2 }));
    expect(again.error).toBe(EDIT_FAILED_LINE);
  });

  test("an unreachable Stack becomes the not-ready line without the error text, and a speech failure becomes its own line", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    stack.refuseSubmit = true;
    const down = await finished(owner, await edit(state, { clip: "latest", change: "trim", to_s: 2 }));
    expect(down.error).toBe(EDIT_UNAVAILABLE_LINE);
    expect(down.error).not.toContain("secret");
    stack.refuseSubmit = false;
    stack.speechFails = true;
    const mute = await finished(owner, await edit(state, { clip: "latest", change: "mix", sound: "voice", line: "Hello there." }));
    expect(mute.state).toBe("failed");
    expect(mute.error).toBe(SPEECH_FAILED_LINE);
    expect(stack.jobs).toHaveLength(0);
    expect(leftovers()).toEqual([]);
  });

  test("one video at a time: an edit while another is being made is refused in words, and Stop ends an edit", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    stack.pollsToFinish = 400;
    const first = await edit(state, { clip: "latest", change: "trim", to_s: 2 });
    const id = (first.result?.data as { videoJobId: string }).videoJobId;
    expect(getVideoJobFor(owner, id)?.state).toBe("running");
    const second = await edit(state, { clip: "latest", change: "trim", to_s: 3 });
    expect(second.result?.data).toEqual({ refused: "already_making" });
    const { cancelVideoJob } = await import("@/lib/videos/jobs");
    await cancelVideoJob(owner, id);
    expect(getVideoJobFor(owner, id)?.state).toBe("cancelled");
    await until(() => stack.jobs[0]!.cancelled);
    await until(() => leftovers().length === 0);
  });
});

const SPICY = "A sexy dance in a dim nightclub, slow camera";
const audienceOf = (job: VideoJob) => libraryProvenance(db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!.provenance).audience;
const nova = () => (db.select().from(people).where(eq(people.id, "person-novaxyz")).get() as PersonRow | undefined) ?? person("teen", "nova");
const teenReads = (job: VideoJob) => canReadFileAudience(nova(), { ownerPersonId: job.personId, provenance: db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!.provenance });

describe("an edit is never lower than its sources", () => {
  test("a clean source stays all-ages and a teen can read it; an adult-only source stays adult-only in trim and a teen cannot read it", async () => {
    const owner = person("owner");
    __unlockRestOfTest(owner.id); // ADULT-LOCK-02: a locked source is read on an unlocked page only
    const clean = await makeClip(owner);
    const cleanEdit = await finished(owner, await edit(clean.state, { clip: clean.job.id, change: "trim", to_s: 3 }));
    expect(audienceOf(cleanEdit)).toBe("all-ages");
    expect(teenReads(cleanEdit)).toBe(true);
    const spicy = await makeClip(owner, undefined, false, SPICY);
    expect(audienceOf(spicy.job)).toBe("adult-only");
    const next = await finished(owner, await edit(spicy.state, { clip: spicy.job.id, change: "trim", to_s: 3 }));
    expect(next.state).toBe("done");
    expect(audienceOf(next)).toBe("adult-only");
    expect(teenReads(next)).toBe(false);
  });

  test("a join of one adult-only and one all-ages clip is adult-only, in either order", async () => {
    const owner = person("owner");
    __unlockRestOfTest(owner.id);
    const clean = await makeClip(owner);
    const spicy = await makeClip(owner, clean.state.conversationId!, false, SPICY);
    const state = chatState(owner, clean.state.conversationId!);
    for (const clips of [[clean.job.id, spicy.job.id], [spicy.job.id, clean.job.id]]) {
      const next = await finished(owner, await edit(state, { clip: "latest", change: "join", clips }));
      expect(audienceOf(next)).toBe("adult-only");
      expect(teenReads(next)).toBe(false);
    }
  });

  test("a voice line that is adult-only over a clean clip makes an adult-only video", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    const next = await finished(owner, await edit(state, { clip: job.id, change: "mix", sound: "voice", line: "Come here, you sexy thing." }));
    expect(next.state).toBe("done");
    expect(audienceOf(next)).toBe("adult-only");
    const plain = await finished(owner, await edit(state, { clip: job.id, change: "mix", sound: "voice", line: "Look at the boat." }));
    expect(audienceOf(plain)).toBe("all-ages");
  });
});

describe("a source that is in Trash or gone, and the staging folder", () => {
  test("trim, join and mix refuse a clip whose Library file is in Trash or deleted", async () => {
    const owner = person("owner");
    const a = await makeClip(owner);
    const b = await makeClip(owner, a.state.conversationId!);
    const state = chatState(owner, a.state.conversationId!);
    db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, a.job.files[0]!.id)).run();
    expect((await edit(state, { clip: a.job.id, change: "trim", to_s: 2 })).result?.data).toEqual({ refused: "no_clip" });
    expect((await edit(state, { clip: "latest", change: "join", clips: [b.job.id, a.job.id] })).result?.data).toEqual({ refused: "no_clip" });
    expect((await edit(state, { clip: a.job.id, change: "mix", sound: "voice", line: "Hello there." })).result?.data).toEqual({ refused: "no_clip" });
    db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, b.job.files[0]!.id)).run();
    expect((await edit(state, { clip: b.job.id, change: "trim", to_s: 2 })).result?.data).toEqual({ refused: "no_clip" });
    expect(stack.jobs).toHaveLength(0);
    expect(stack.speech).toHaveLength(0);
  });

  test("the staging folder is private (0700) and the startup sweep removes only folders older than an hour", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    await finished(owner, await edit(state, { clip: "latest", change: "trim", to_s: 2 }));
    expect(stack.jobs[0]!.dirMode).toBe(0o700);
    mkdirSync(join(editRoot(), "old-one"), { recursive: true });
    mkdirSync(join(editRoot(), "new-one"), { recursive: true });
    const old = new Date(Date.now() - 2 * 3600_000);
    utimesSync(join(editRoot(), "old-one"), old, old);
    expect(sweepStaleEditFolders()).toBe(1);
    expect(leftovers()).toEqual(["new-one"]);
  });
});
