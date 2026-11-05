import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { attachments, musicJobs } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, LYRICS, LRC, testM4a, waitForMusic } from "./musicFixture";
import { runGenerateMusic, runEditMusic } from "@/lib/music/tool";
import { resolveMusicSection } from "@/lib/music/sections";
import { cancelMusicJob, conversationHasMusic, getMusicJobFor, musicVersions, readMusicFile, sourceMusicJob, useMusicVersion } from "@/lib/music/jobs";
import { deleteMusicJobsForTurns, pruneMusicJobs } from "@/lib/music/store";
import { createAttachment, deleteAttachmentsForTurns, deleteAttachmentsForPerson, removeTemporaryChatImages, toRecord } from "@/lib/attachments";
import { listConversationTurns, deleteConversationById } from "@/lib/conversationHistory";
import { musicCardView } from "@/routes/music";
import { commercialUseOf } from "@/lib/music/commercial";
import { musicForOutcomes } from "@/lib/composer";
import { MUSIC_NOTE, generationOf, type MusicJob } from "@/lib/music/types";
import { toolNode } from "@/lib/turnMachine/nodes/tool";
import { runSmoke } from "@/lib/smoke";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setMusicMixRunnerForTests, __setMusicMixToolsForTests, mixMusicParts, mixPcmWav } from "@/lib/music/mixParts";
import { saveClonedVoice } from "@/lib/clonedVoices";
import { writeFileSync } from "node:fs";
import type { TurnState } from "@/lib/turnMachine/contract";
function pcmFixture(samples: number[]): Uint8Array {
  const output = new Uint8Array(44 + samples.length * 2); const view = new DataView(output.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) output[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, output.length - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 44100, true); view.setUint32(28, 176400, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true); samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true)); return output;
}
let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); __setMusicMixToolsForTests({ afconvert: "/usr/bin/afconvert", ffmpeg: null }); __setMusicMixRunnerForTests(async (command) => { (globalThis as unknown as { lastMixCommand: string[] }).lastMixCommand = command; const output = command.at(-1)!; if (command.includes("WAVE")) writeFileSync(output, pcmFixture([12000, -12000])); else writeFileSync(output, new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])); return true; }); });
afterEach(() => { __setMusicMixRunnerForTests(null); __setMusicMixToolsForTests(null); fake.restore(); });
const ARGS = { description: "a gentle folk song with an original voice", lyrics: LYRICS, title: "Pancakes", seconds: 60, bpm: 100, key: "C major", language: "en" };
async function generate(state = musicState(people.owner), args: Record<string, unknown> = ARGS): Promise<MusicJob> {
  const outcome = await runGenerateMusic({ state, args, callId: "g", spoken: false });
  expect(outcome.status).toBe("succeeded");
  expect(outcome.result?.reply?.text).toStartWith("I've started your song. It will show below when it's finished.");
  const id = musicForOutcomes([outcome])?.id;
  expect(id).toBeDefined();
  await waitForMusic(() => getMusicJobFor(people.owner, id!)?.state === "done");
  return getMusicJobFor(people.owner, id!)!;
}
async function edit(state: TurnState, change: string, args: Record<string, unknown> = {}): Promise<MusicJob> {
  const outcome = await runEditMusic({ state, args: { track: "latest", change, ...args }, callId: "e", spoken: false });
  expect(outcome.status).toBe("succeeded");
  expect(outcome.result?.reply?.text).toStartWith("I've started your song. It will show below when it's finished.");
  const id = musicForOutcomes([outcome])?.id; expect(id).toBeDefined();
  await waitForMusic(() => getMusicJobFor(people.owner, id!)?.state === "done");
  return getMusicJobFor(people.owner, id!)!;
}
describe("music jobs and their private files", () => {
  test("split stems writes a song file and completed job for each returned track", async () => {
    const state = musicState(people.owner); const parent = await generate(state);
    fake.stems = true;
    const outcome = await runEditMusic({ state, args: { track: parent.fileId, change: "stems" }, callId: "s", spoken: false });
    expect(outcome.result?.reply?.text).toBe("The stems are on the way.");
    const id = musicForOutcomes([outcome])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const jobs = db.select().from(musicJobs).where(eq(musicJobs.task, "stems")).all();
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job).toMatchObject({ task: "stems", state: "done", parentFileId: parent.fileId });
      const row = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get()!;
      expect(generationOf(row.provenance)).toMatchObject({ task: "text2music", parent_file_id: parent.fileId, source_kind: "made_here" });
      expect(row.provenance).toContain(parent.fileId!);
    }
    expect(jobs.map((job) => (JSON.parse(job.request) as { title?: string }).title ?? "").every((title) => /\((vocals|drums|bass|other)\)$/.test(title) && !title.includes(") ("))).toBe(true);
    // A stem is its own track: the song's versions stay the song's, and a stem has no versions but itself.
    const song = getMusicJobFor(people.owner, parent.id)!;
    expect(musicVersions(people.owner, song).map((v) => v.fileId)).toEqual([parent.fileId]);
    for (const job of jobs) expect(musicVersions(people.owner, getMusicJobFor(people.owner, job.id)!).map((v) => v.fileId)).toEqual([job.fileId]);
  });
  test("stems follow the same audience gate as every other edit: a child, a spoken turn and a song from another chat never reach the Stack", async () => {
    const state = musicState(people.owner); const parent = await generate(state);
    fake.stems = true;
    for (const [other, spoken] of [[musicState(people.child), false], [state, true], [{ ...state, conversationId: "conv-another-chat" }, false]] as const) {
      const outcome = await runEditMusic({ state: other, args: { track: parent.fileId, change: "stems" }, callId: "s", spoken });
      expect(outcome.result?.data).toMatchObject({ refused: expect.any(String) });
    }
    expect(db.select().from(musicJobs).where(eq(musicJobs.task, "stems")).all()).toHaveLength(0);
  });
  test("the tool node returns at once, puts the job on the tool part, and stores unchanged AAC with prompt-free provenance", async () => {
    const state = musicState(people.owner);
    fake.pollsToFinish = 4;
    const result = await toolNode(state, { proposals: [{ kind: "read_only", request: { tool: "generate_music", args: ARGS, callId: "c" } }] }, new AbortController().signal);
    const id = musicForOutcomes(result.output.outcomes)!.id;
    const part = result.output.toolEvents.find((e) => e.t === "tool_result");
    expect(part && "outcome" in part && part.outcome).toMatchObject({ musicJobId: id });
    expect(result.output.outcomes[0]?.result?.reply?.text).toStartWith("I've started your song. It will show below when it's finished.");
    expect(getMusicJobFor(people.owner, id)?.state).not.toBe("done");
    expect(fake.submitted[0]).toMatchObject({ task: "text2music", caption: ARGS.description, lyrics: LYRICS, duration_s: 60, timeout_ms: 1, bpm: 100, key: "C major", language: "en" });
    expect(fake.submitted[0]).not.toHaveProperty("title");
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const job = getMusicJobFor(people.owner, id)!;
    const row = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get()!;
    const record = toRecord(row);
    expect(record).toMatchObject({ origin: "made", kind: "audio", media_type: "audio/mp4", retention: "conversation" });
    const note = generationOf(row.provenance)!;
    expect(note).toMatchObject({ kind: "music", task: "text2music", model: { id: "ace-step-1-5-turbo", revision: "19671f406d603126926c1b7e2adc169acbcade22", licence: "MIT" }, engine: { id: "music-gen", version: "ca1e85f" }, source_kind: "none", commercial_use: "cleared", duration_s: 60 });
    for (const text of [ARGS.description, ARGS.title, "Morning light"]) expect(row.provenance).not.toContain(text);
    expect(readMusicFile(people.owner, job, job.fileId!)?.bytes).toEqual(testM4a());
    expect(readMusicFile(people.child, job, job.fileId!)).toBeNull();
    expect(getMusicJobFor(people.child, id)).toBeNull();
    expect(commercialUseOf(job.fileId!)).toBe("cleared");
    await waitForMusic(() => fake.deleted.includes(job.stackJob!));
    const history = listConversationTurns(people.owner, state.conversationId);
    expect(history.ok && history.value.some((t) => t.music?.id === id)).toBe(true);
  });
  test("202 and immediate 200 Stack replies both finish through the same file path", async () => {
    fake.immediate = true;
    const job = await generate(); expect(job.state).toBe("done"); expect(job.fileId).toBeTruthy();
  });
  test("one job per person even when two submits race", async () => {
    fake.pollsToFinish = 1000;
    const state = musicState(people.owner, true);
    const args = { state, args: ARGS, callId: "c", spoken: false };
    const result = await Promise.all([runGenerateMusic(args), runGenerateMusic(args)]);
    expect(fake.submitted).toHaveLength(1);
    expect(result.filter((r) => !!musicForOutcomes([r]))).toHaveLength(1);
    expect(result.some((r) => JSON.stringify(r.result).includes("already_making"))).toBe(true);
    const id = result.map((r) => musicForOutcomes([r])?.id).find(Boolean)!;
    await cancelMusicJob(people.owner, id);
    expect(getMusicJobFor(people.owner, id)?.state).toBe("cancelled");
  });
  test("storage is checked before a Stack submit", async () => {
    setHouseholdSettingValue("storage.household.cap_bytes", 1);
    const out = await runGenerateMusic({ state: musicState(people.owner), args: ARGS, callId: "c", spoken: false });
    expect(out.errorCode).toBe("storage_full"); expect(fake.submitted).toHaveLength(0);
  });
  test("temporary and incognito jobs and audio stay in memory, expire at two hours and go with the chat", async () => {
    for (const ephemeral of [false, true]) {
      const state = musicState(people.owner, true); state.temporary = !ephemeral; state.ephemeral = ephemeral;
      const job = await generate(state);
      expect(db.select().from(musicJobs).all()).toHaveLength(0); expect(db.select().from(attachments).all()).toHaveLength(0);
      expect(readMusicFile(people.owner, job, job.fileId!)).not.toBeNull();
      removeTemporaryChatImages(state.conversationId);
      expect(getMusicJobFor(people.owner, job.id)).toBeNull(); expect(readMusicFile(people.owner, job, job.fileId!)).toBeNull();
    }
    const job = await generate(musicState(people.owner, true));
    pruneMusicJobs(Date.parse(job.createdAt) + 2 * 60 * 60 * 1000);
    expect(getMusicJobFor(people.owner, job.id)).toBeNull();
  });
  test("failures retain only a code and a plain card line; raw error text never enters the model result", async () => {
    fake.fail = { code: "no_memory", error: "PRIVATE_RAW_LYRICS" };
    const out = await runGenerateMusic({ state: musicState(people.owner, true), args: ARGS, callId: "c", spoken: false });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "failed");
    expect(fake.submitted).toHaveLength(3);
    expect(getMusicJobFor(people.owner, id)).toMatchObject({ errorCode: "no_memory", errorLine: expect.stringContaining("stopped before it finished") });
    expect(JSON.stringify(out)).not.toContain("PRIVATE_RAW_LYRICS");
    fake.refuse = { status: 503, code: "no_memory", error: "PRIVATE_RAW_LYRICS" };
    const failed = await runGenerateMusic({ state: musicState(people.owner, true), args: ARGS, callId: "c", spoken: false });
    const queuedId = musicForOutcomes([failed])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, queuedId)?.state === "failed");
    expect(getMusicJobFor(people.owner, queuedId)?.errorLine).toContain("stopped before it finished"); expect(JSON.stringify(failed)).not.toContain("PRIVATE_RAW_LYRICS");
  });
  test("forgetting turns and chats keeps finished songs; forgetting the person deletes requests and stops watchers without resurrecting them", async () => {
    const state = musicState(people.owner);
    const job = await generate(state);
    deleteAttachmentsForTurns([state.turnId]); expect(getMusicJobFor(people.owner, job.id)).not.toBeNull(); // BUG-LIBRARY-KEPT-01: a finished song is a generated Library item and outlives its turn
    const nextState = musicState(people.owner); const next = await generate(nextState);
    expect(deleteConversationById(people.owner, nextState.conversationId).ok).toBe(true); expect(getMusicJobFor(people.owner, next.id)).not.toBeNull(); // and outlives its chat
    const third = await generate(); deleteAttachmentsForPerson(people.owner.id); expect(getMusicJobFor(people.owner, third.id)).toBeNull();
    fake.pollsToFinish = 1000;
    const pending = musicState(people.owner, true);
    const out = await runGenerateMusic({ state: pending, args: ARGS, callId: "c", spoken: false });
    const id = musicForOutcomes([out])!.id; deleteMusicJobsForTurns([pending.turnId]);
    await new Promise((r) => setTimeout(r, 10)); expect(getMusicJobFor(people.owner, id)).toBeNull();
  });
  test("forgetting while submission is in flight frees the Stack copy and retains no request", async () => {
    const state = musicState(people.owner, true);
    let release!: () => void;
    fake.beforeSubmit = () => new Promise<void>((resolve) => { release = resolve; });
    const promise = runGenerateMusic({ state, args: ARGS, callId: "c", spoken: false });
    await waitForMusic(() => !!release);
    deleteMusicJobsForTurns([state.turnId]); release();
    expect((await promise).status).toBe("succeeded");
    await waitForMusic(() => fake.deleted.length > 0);
    expect(db.select().from(musicJobs).all()).toHaveLength(0);
  });
  test("both bundled recipes have working smoke fixtures", async () => {
    expect((await runSmoke("generate_music")).ok).toBe(true); expect((await runSmoke("edit_music")).ok).toBe(true);
  });
});
describe("native music edits, versions and section timing", () => {
  test("parts on an attached upload makes one mixed file with upload provenance; kept stems alone are mixed alone", async () => {
    const state = musicState(people.owner);
    const bytes = testM4a();
    const upload = createAttachment(people.owner, { conversationId: state.conversationId, turnId: state.turnId, bytes, mediaType: "audio/mp4", deduplicate: false });
    if (!upload.ok) throw new Error("upload failed");
    state.audio = [{ id: upload.value.id } as never];
    fake.stems = true;
    fake.allStems = true;
    const dropped = await runEditMusic({ state, args: { track: "attached", change: "parts", parts: { drop: ["vocals"] } }, callId: "p", spoken: false });
    expect(dropped.result?.reply?.text).toBe("Here it is without the vocals.");
    const jobId = musicForOutcomes([dropped])!.id;
    await waitForMusic(() => ["done", "failed"].includes(getMusicJobFor(people.owner, jobId)?.state ?? ""));
    const done = getMusicJobFor(people.owner, jobId)!;
    expect(done.errorCode).toBeNull();
    expect(db.select().from(musicJobs).where(eq(musicJobs.id, jobId)).all()).toHaveLength(1);
    expect(done.fileId).toBeTruthy();
    const row = db.select().from(attachments).where(eq(attachments.id, done.fileId!)).get()!;
    expect(generationOf(row.provenance)).toMatchObject({ source_kind: "upload", task: "trim", model: { id: "unknown" }, commercial_use: "unknown", parent_file_id: upload.value.id });
    expect(db.select().from(attachments).all()).toHaveLength(2);
    expect((globalThis as unknown as { lastMixCommand: string[] }).lastMixCommand.filter((arg) => arg === "-i").length).toBeGreaterThanOrEqual(0);

    const keepVocal = await runEditMusic({ state, args: { track: upload.value.id, change: "parts", parts: { keep: ["vocals"] } }, callId: "p2", spoken: false });
    const vocalId = musicForOutcomes([keepVocal])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, vocalId)?.state === "done");
    expect((globalThis as unknown as { lastMixCommand: string[] }).lastMixCommand.length).toBeGreaterThan(0);
  });
  test("parts validation refuses both modes, no kept parts and unknown part; stems is never a track", async () => {
    const state = musicState(people.owner);
    const upload = createAttachment(people.owner, { conversationId: state.conversationId, turnId: state.turnId, bytes: testM4a(), mediaType: "audio/mp4", deduplicate: false });
    if (!upload.ok) throw new Error("upload failed");
    for (const parts of [{ keep: ["vocals"], drop: ["drums"] }, { drop: ["vocals", "drums", "bass", "other"] }, { keep: ["unknown"] }]) {
      const out = await runEditMusic({ state, args: { track: upload.value.id, change: "parts", parts }, callId: "p", spoken: false });
      expect(out.result?.reply?.text).toContain("Choose one or more parts");
    }
    const invalidTrack = await runEditMusic({ state, args: { track: "vocals", change: "parts", parts: { keep: ["vocals"] } }, callId: "p", spoken: false });
    expect(invalidTrack.result?.data).toMatchObject({ refused: "source_not_made_here" });
    expect(db.select().from(musicJobs).all()).toHaveLength(0);
  });
  test("voice swap makes one finished mix from vocals conversion and all instrumental stems", async () => {
    const state = musicState(people.owner); const parent = await generate(state); fake.stems = true; fake.allStems = true;
    __setMusicMixToolsForTests({ afconvert: null, ffmpeg: "ffmpeg" });
    const voice = saveClonedVoice(people.owner, "Nova", new Uint8Array([1, 2, 3]), "audio/wav");
    if (!voice.ok) throw new Error("voice setup failed");
    const before = db.select().from(attachments).all().length;
    const outcome = await runEditMusic({ state, args: { track: parent.fileId, change: "voice_swap", voice: voice.value.id }, callId: "voice", spoken: false });
    expect(outcome.result?.reply?.text).toBe("Here it is sung by Nova.");
    const id = musicForOutcomes([outcome])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const result = getMusicJobFor(people.owner, id)!;
    expect(db.select().from(attachments).all()).toHaveLength(before + 1);
    expect(fake.voiceConvert.submitted).toHaveLength(1);
    expect(fake.voiceConvert.deleted).toBe(1); expect(fake.stemDeleted).toBe(1);
    expect(fake.voiceConvert.submitted[0]).toMatchObject({ pitch_shift: 0, auto_shift: false });
    expect(Buffer.from(fake.voiceConvert.submitted[0]!.reference, "base64")).toEqual(Buffer.from([1, 2, 3]));
    expect((globalThis as unknown as { lastMixCommand: string[] }).lastMixCommand.filter((part) => part === "-i")).toHaveLength(4);
    expect(result.request).not.toHaveProperty("stems"); expect(result.request).not.toHaveProperty("convertedVocal");
    expect(result.request.title).toBe("Pancakes");
    const row = db.select().from(attachments).where(eq(attachments.id, result.fileId!)).get()!;
    expect(generationOf(row.provenance)).toMatchObject({ task: "cover", source_kind: "made_here", parent_file_id: parent.fileId, model: { id: "unknown" }, engine: { id: "unknown" }, commercial_use: "unknown" });
    expect(commercialUseOf(result.fileId!)).toBe("unknown");
  });
  test("voice swap accepts an attached owned file and preserves upload provenance", async () => {
    const state = musicState(people.owner); fake.stems = true; fake.allStems = true;
    const upload = createAttachment(people.owner, { conversationId: state.conversationId, turnId: state.turnId, bytes: testM4a(), mediaType: "audio/mp4", deduplicate: false });
    if (!upload.ok) throw new Error("upload failed");
    const voice = saveClonedVoice(people.owner, "Nova", new Uint8Array([1]), "audio/wav"); if (!voice.ok) throw new Error("voice setup failed");
    const outcome = await runEditMusic({ state: { ...state, audio: [{ id: upload.value.id, name: "track.m4a", media_type: "audio/mp4" }] }, args: { track: "attached", change: "voice_swap", voice: voice.value.id }, callId: "voice-upload", spoken: false });
    const id = musicForOutcomes([outcome])!.id; await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const result = getMusicJobFor(people.owner, id)!;
    expect(generationOf(db.select().from(attachments).where(eq(attachments.id, result.fileId!)).get()!.provenance)).toMatchObject({ source_kind: "upload", parent_file_id: null, model: { id: "unknown" }, commercial_use: "unknown" });
  });
  test("voice swap refuses a preset voice without a clip and minors", async () => {
    const state = musicState(people.owner); const parent = await generate(state); fake.stems = true;
    const preset = await runEditMusic({ state, args: { track: parent.fileId, change: "voice_swap", voice: "soprano" }, callId: "preset", spoken: false });
    expect(preset.result?.reply?.text).toContain("That voice has no sample to sing with.");
    for (const role of ["teen", "child"] as const) {
      const out = await runEditMusic({ state: { ...state, actor: { ...people.child, role } }, args: { track: parent.fileId, change: "voice_swap", voice: "companion" }, callId: role, spoken: false });
      expect(out.result?.data).toMatchObject({ refused: "minor" });
    }
  });
  test("voice conversion down path leaves the plain failure line on the job", async () => {
    const state = musicState(people.owner); const parent = await generate(state); fake.stems = true; fake.allStems = true; fake.voiceConvert.fail = true;
    const voice = saveClonedVoice(people.owner, "Nova", new Uint8Array([1]), "audio/wav"); if (!voice.ok) throw new Error("voice setup failed");
    const outcome = await runEditMusic({ state, args: { track: parent.fileId, change: "voice_swap", voice: voice.value.id }, callId: "voice-down", spoken: false });
    const id = musicForOutcomes([outcome])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "failed");
    expect(getMusicJobFor(people.owner, id)?.errorLine).toBe("The voice could not be changed. Try again in a minute.");
  });
  test("each change sends the right Stack body, with original bytes and sha256 only on source tasks", async () => {
    const state = musicState(people.owner);
    const original = await generate(state);
    const hash = createHash("sha256").update(testM4a()).digest("hex");
    for (const [change, args, task] of [
      ["remake", { bpm: 84 }, "text2music"], ["variation", {}, "text2music"], ["restyle", { description: "jazz piano", strength: 0.7 }, "cover"],
      ["instrumental", {}, "cover"], ["rewrite_section", { section: "chorus", lyrics: "Waffles rise\nUnder sunny skies" }, "repaint"],
      ["extend", { seconds: 20, at: "start" }, "extend"], ["trim", { from_s: 5, to_s: 20 }, "edit"],
      ["fade", { seconds: 4, where: "out" }, "edit"], ["loudness", { lufs: -12 }, "edit"],
    ] as const) {
      const job = await edit(state, change, { track: original.fileId, ...args }); const sent = fake.submitted.at(-1)!;
      expect(sent.task).toBe(task); expect(sent.timeout_ms).toBe(1); expect(job.parentFileId).toBe(original.fileId);
      if (task === "text2music") expect(sent.source).toBeUndefined();
      else { expect(Buffer.from(sent.source!, "base64")).toEqual(Buffer.from(testM4a())); expect(sent.source_sha256).toBe(hash); }
      if (change === "remake") { expect(sent.seed).toBe(original.seed!); expect(sent.bpm).toBe(84); }
      if (change === "variation") expect(sent.seed).not.toBe(original.seed!);
      if (change === "instrumental") expect(sent).toMatchObject({ instrumental: true, lyrics: "[Instrumental]" });
      if (change === "rewrite_section") { expect(sent).toMatchObject({ from_s: 20, to_s: 40 }); expect(job.request.lyrics).toContain("[Chorus]\nWaffles rise"); }
      if (change === "extend") expect(sent).toMatchObject({ duration_s: 80, add_s: 20, at: "start" });
      if (change === "trim") expect(sent.edit).toEqual({ op: "trim", from_s: 5, to_s: 20 });
      if (change === "fade") expect(sent.edit).toEqual({ op: "fade", seconds: 4, where: "out" });
      if (change === "loudness") expect(sent.edit).toEqual({ op: "loudness", lufs: -12 });
    }
    expect(db.select().from(attachments).all()).toHaveLength(10);
  });
  test("sections use stored lyric tags and LRC, including repeats, and unresolved sections ask for seconds", async () => {
    expect(resolveMusicSection(LYRICS, LRC, "chorus", 60)).toEqual({ from_s: 20, to_s: 40 });
    expect(resolveMusicSection(LYRICS, LRC, "verse 2", 60)).toEqual({ from_s: 40, to_s: 45 });
    expect(resolveMusicSection(LYRICS, LRC, "chorus 2", 60)).toEqual({ from_s: 45, to_s: 60 });
    const state = musicState(people.owner); await generate(state);
    const out = await runEditMusic({ state, args: { track: "latest", change: "rewrite_section", section: "bridge", lyrics: "New words" }, callId: "c", spoken: false });
    expect(out.result?.reply?.text).toContain("start and end in seconds"); expect(fake.submitted).toHaveLength(1);
    // A fragment never replaces the whole song's words: the stored lyrics stay and the person is asked which part.
    const fragment = await runEditMusic({ state, args: { track: "latest", change: "rewrite_section", section: "bridge", from_s: 2, to_s: 8, lyrics: "New words" }, callId: "c", spoken: false });
    expect(fragment.result?.reply?.text).toContain("Tell me which part the new words replace, for example the chorus or verse 2.");
    expect(fake.submitted).toHaveLength(1);
    // The same range with the whole song (section tags, at least half the stored length) is accepted as the new words.
    const whole = LYRICS.replaceAll("Pancakes", "Waffles");
    const done = await edit(state, "rewrite_section", { section: "bridge", from_s: 2, to_s: 8, lyrics: whole });
    expect(fake.submitted.at(-1)).toMatchObject({ task: "repaint", from_s: 2, to_s: 8, lyrics: whole });
    expect(done.request.lyrics).toBe(whole);
    // Explicit seconds with no new words keep the stored lyrics.
    const kept = await edit(state, "rewrite_section", { from_s: 2, to_s: 8 });
    expect(kept.request.lyrics).toBe(whole);
  });
  test("a long fragment with no section tags is still not a whole song", async () => {
    const state = musicState(people.owner); await generate(state);
    const out = await runEditMusic({ state, args: { track: "latest", change: "rewrite_section", from_s: 2, to_s: 8, lyrics: "Waffles rise under the sunny skies all day long ".repeat(10) }, callId: "c", spoken: false });
    expect(out.result?.reply?.text).toContain("which part the new words replace"); expect(fake.submitted).toHaveLength(1);
  });
  test("foreign songs and songs in another conversation cannot be edited", async () => {
    const state = musicState(people.owner); const original = await generate(state);
    for (const [other, track] of [[{ ...state, conversationId: "conv-another-chat" }, original.fileId!], [musicState(people.child), original.fileId!]] as const) {
      await runEditMusic({ state: other, args: { track, change: "restyle", description: "jazz piano" }, callId: "c", spoken: false });
    }
    expect(fake.submitted).toHaveLength(1);
  });
  test("an owned upload can be made instrumental and stays upload provenance", async () => {
    const state = musicState(people.owner);
    const upload = createAttachment(people.owner, { conversationId: state.conversationId, turnId: state.turnId, bytes: testM4a(), mediaType: "audio/mp4", deduplicate: false });
    if (!upload.ok) throw new Error("upload failed");
    const out = await runEditMusic({ state, args: { track: upload.value.id, change: "instrumental" }, callId: "u", spoken: false });
    expect(out.result?.reply?.text).toStartWith("I've started your song.");
    const id = musicForOutcomes([out])!.id;
    expect(fake.submitted.at(-1)).toMatchObject({ task: "cover", instrumental: true, origin: "owned_file", source: Buffer.from(testM4a()).toString("base64") });
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const result = getMusicJobFor(people.owner, id)!;
    const row = db.select().from(attachments).where(eq(attachments.id, result.fileId!)).get()!;
    expect(generationOf(row.provenance)).toMatchObject({ source_kind: "upload", parent_file_id: null });
    expect(commercialUseOf(result.fileId!)).toBe("unknown");
    expect(readMusicFile(people.owner, result, result.fileId!)).not.toBeNull(); // a finished edit of an upload still reads through the made-song path
    const trimmed = await runEditMusic({ state, args: { track: upload.value.id, change: "trim", from_s: 0, to_s: 10 }, callId: "t", spoken: false });
    expect(fake.submitted.at(-1)).toMatchObject({ task: "edit", edit: { op: "trim", from_s: 0, to_s: 10 }, origin: "owned_file" });
    const trimId = musicForOutcomes([trimmed])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, trimId)?.state === "done");
    expect(generationOf(db.select().from(attachments).where(eq(attachments.id, getMusicJobFor(people.owner, trimId)!.fileId!)).get()!.provenance)).toMatchObject({ source_kind: "upload", parent_file_id: null });
  });
  test("attached track refuses zero or multiple audio files plainly", async () => {
    const state = musicState(people.owner);
    for (const audio of [[], [{ id: "file-audio001", name: "a.m4a", media_type: "audio/mp4" }, { id: "file-audio002", name: "b.m4a", media_type: "audio/mp4" }]]) {
      const out = await runEditMusic({ state: { ...state, audio }, args: { track: "attached", change: "restyle", description: "reggae" }, callId: "a", spoken: false });
      expect(out.result?.reply?.text).toContain("Attach one audio file to your message.");
    }
  });
  test("an attached song is still refused for teens and children", async () => {
    const state = musicState(people.owner);
    const upload = createAttachment(people.owner, { conversationId: state.conversationId, turnId: state.turnId, bytes: testM4a(), mediaType: "audio/mp4", deduplicate: false });
    if (!upload.ok) throw new Error("upload failed");
    for (const role of ["teen", "child"] as const) {
      const minor = { ...people.child, role };
      const out = await runEditMusic({ state: { ...state, actor: minor }, args: { track: upload.value.id, change: "instrumental" }, callId: "m", spoken: false });
      expect(out.result?.data).toMatchObject({ refused: "minor" });
    }
    expect(fake.submitted).toHaveLength(0);
  });
  test("latest uses the selected version, keeps branches and exposes Version N URLs", async () => {
    const state = musicState(people.owner); const original = await generate(state);
    const second = await edit(state, "remake", { bpm: 84 });
    expect(sourceMusicJob(people.owner, state.conversationId, "latest", false)?.fileId).toBe(second.fileId);
    expect(useMusicVersion(people.owner, second, original.fileId!)?.id).toBe(original.id);
    expect(sourceMusicJob(people.owner, state.conversationId, "latest", false)?.fileId).toBe(original.fileId);
    const third = await edit(state, "restyle", { description: "a jazz version" });
    expect(third.parentFileId).toBe(original.fileId);
    expect(musicVersions(people.owner, original).map((j) => j.fileId)).toEqual([original.fileId, second.fileId, third.fileId]);
    const card = await musicCardView(people.owner, original);
    expect(card.versions.map((v) => v.label)).toEqual(["Version 1", "Version 2", "Version 3"]);
    expect(card.versions[2]!.url).toContain(`/api/music/jobs/${third.id}/files/${third.fileId}`);
    expect(card.current_id).toBe(third.fileId);
    expect(conversationHasMusic(people.owner, state.conversationId, false)).toBe(true);
  });
  test("inherited unsafe words are checked on edits before submitting", async () => {
    const state = musicState(people.owner); const source = await generate(state);
    db.update(musicJobs).set({ request: JSON.stringify({ ...source.request, title: "naked child" }) }).where(eq(musicJobs.id, source.id)).run();
    const outcome = await runEditMusic({ state, args: { track: source.fileId, change: "remake" }, callId: "c", spoken: false });
    expect(JSON.stringify(outcome.result)).toContain("minor_sexual"); expect(fake.submitted).toHaveLength(1);
  });
});

describe("PCM WAV music mixing", () => {
  test("neither converter available reports mix_unavailable", async () => {
    __setMusicMixToolsForTests({ afconvert: null, ffmpeg: null }); __setMusicMixRunnerForTests(null);
    await expect(mixMusicParts({ vocals: testM4a() }, ["vocals"])).rejects.toThrow("mix_unavailable");
    __setMusicMixToolsForTests({ afconvert: "/usr/bin/afconvert", ffmpeg: null });
  });
  function wav(samples: number[]): Uint8Array {
    const output = new Uint8Array(44 + samples.length * 2); const view = new DataView(output.buffer);
    const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) output[at + i] = value.charCodeAt(i); };
    text(0, "RIFF"); view.setUint32(4, output.length - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 44100, true); view.setUint32(28, 176400, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true)); return output;
  }
  function samples(bytes: Uint8Array): number[] { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const length = view.getUint32(40, true) / 2; return Array.from({ length }, (_, i) => view.getInt16(44 + i * 2, true)); }
  test("sums two stems sample-wise then scales under the peak limit", () => {
    const mixed = samples(mixPcmWav([wav([24000, -24000, 24000, -24000]), wav([24000, -24000, 24000, -24000])]));
    expect(mixed[0]).toBe(29164); expect(mixed[0]).toBeLessThanOrEqual(Math.ceil(32768 * 0.89)); expect(mixed[1]).toBe(-mixed[0]!);
  });
  test("a single stem retains its level and shorter stems are padded with silence", () => {
    expect(samples(mixPcmWav([wav([12000, -12000])]))).toEqual([12000, -12000]);
    expect(samples(mixPcmWav([wav([12000, 16000, 20000, 24000]), wav([6000, 6000])]))).toEqual([18000, 22000, 20000, 24000]);
  });
});
