import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../../tests/reset-db";
import { createBenchPeople } from "../../../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, waitForMusic } from "../../../tests/musicFixture";
import { __setMusicStatusForTests, __setSoundStatusForTests, readyMusicStatusForTests, readySoundStatusForTests, soundStatusReady } from "./ready";
import { __setMusicFetchForTests, cancelOrDeleteSound, fetchSound, getSoundJob, soundStatus, submitSound } from "./stack";
import { KNOWN_MUSIC_MODELS, modelStampFor } from "./models";
import { getMusicJobFor } from "./jobs";
import { attachments } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { toRecord } from "@/lib/attachments";
import { musicForOutcomes } from "../composer";
import { makeSoundArgs, runMakeSound } from "./soundMaker";
import { generationOf } from "./types";
import { runGenerateMusic } from "./tool";
import { toolNode } from "@/lib/turnMachine/nodes/tool";
import { musicCardView, musicStageIndex, musicStageLabel } from "@/routes/music";
import { LYRICS } from "../../../tests/musicFixture";
import { addSoundToSong, soundTakesOf } from "./soundTakes";
import { __setMusicMixRunnerForTests, __setMusicMixToolsForTests } from "./mixParts";
import { wavOfPcm } from "./soundAudio";
import { readMusicFile } from "./jobs";
import type { PersonRow } from "@/types";

let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => { fake.restore(); __setMusicStatusForTests(undefined); __setMusicMixRunnerForTests(null); __setMusicMixToolsForTests(null); });
const input = (actor: PersonRow, args: Record<string, unknown>) => runMakeSound({ state: musicState(actor), args, callId: "s", spoken: false });

describe("make_sound", () => {
  test("validates the bounded sound arguments", () => {
    expect(makeSoundArgs.safeParse({ description: "rain on a window", seconds: 1, loop: true, stick_to_words: false }).success).toBe(true);
    expect(makeSoundArgs.safeParse({ description: "no" }).success).toBe(false);
    expect(makeSoundArgs.safeParse({ description: "rain", seconds: 61 }).success).toBe(false);
  });
  test("starts instrumental ACE-Step sound with min clamp, loop wording and sound controls", async () => {
    const out = await input(people.owner, { description: "rain on a window", seconds: 1, loop: true, stick_to_words: false });
    expect(out.status).toBe("succeeded");
    const jobId = musicForOutcomes([out])!.id;
    const job = getMusicJobFor(people.owner, jobId)!;
    expect(job.request).toMatchObject({ instrumental: true, lyrics: "[Instrumental]", seconds: 10, quality: "quick", sound: { loop: true, surprise: true } });
    expect(job.request.description).toBe("sound effect, no melody, no singing: rain on a window, seamless loop");
    expect(out.result?.reply?.text).toContain("started");
    expect(out.result?.reply?.text).toContain("minimum length");
    expect(fake.submitted[0]).toMatchObject({ task: "text2music", duration_s: 10 });
  });
  test("generate_music kind=sound routes through the sound maker and keeps make_sound provenance", async () => {
    __setSoundStatusForTests(readySoundStatusForTests());
    const state = musicState(people.owner);
    const { output } = await toolNode(state, { proposals: [{ kind: "read_only", request: { tool: "generate_music", args: { kind: "sound", description: "rain on a tin roof", seconds: 4, loop: true }, callId: "kind-sound" } }] }, new AbortController().signal);
    const out = output.outcomes[0]!;
    expect(out.status).toBe("succeeded");
    expect(out.packageId).toBe("make_sound");
    const job = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    expect(job.request).toMatchObject({ instrumental: true, sound: { engine: "sfx", loop: true } });
    expect(job.request.seconds).toBe(4);
    expect(fake.sound.submitted).toHaveLength(1);
    job.state = "running";
    job.stage = "planning";
    expect(musicStageLabel(job)).toBe("Making");
    expect(musicStageIndex(job)).toBe(2);
    const card = await musicCardView(people.owner, job);
    expect(card.stages.map((stage) => stage.label)).toEqual(["Queued", "Loading", "Making", "Finishing"]);
  });
  test("the historical make_sound call id still routes to the same sound maker", async () => {
    const state = musicState(people.owner);
    const { output } = await toolNode(state, { proposals: [{ kind: "read_only", request: { tool: "make_sound", args: { description: "a short thunderclap" }, callId: "legacy-sound" } }] }, new AbortController().signal);
    expect(output.outcomes[0]).toMatchObject({ status: "succeeded", packageId: "make_sound" });
    expect(fake.submitted[0]).toMatchObject({ task: "text2music", duration_s: 10 });
  });
  test("passes policy refusals through musicRefusalFor", async () => {
    const out = await input(people.child, { description: "rain on a window" });
    expect(out.status).toBe("succeeded");
    expect(out.result?.data).toMatchObject({ refused: "minor" });
    expect(fake.submitted).toHaveLength(0);
  });
  test("reports unavailable engine and already making with the music outcome shapes", async () => {
    __setMusicStatusForTests({ available: false } as never);
    expect(await input(people.owner, { description: "rain on a window" })).toMatchObject({ status: "failed", errorCode: "no_engine" });
    __setMusicStatusForTests(readyMusicStatusForTests());
    fake.pollsToFinish = 1000;
    const first = await input(people.owner, { description: "rain on a window" });
    const second = await input(people.owner, { description: "wind in trees" });
    expect(first.status).toBe("succeeded");
    expect(second.result?.data).toMatchObject({ refused: "already_making" });
  });
  test("generationOf accepts sound provenance", () => {
    expect(generationOf(`music-gen:${JSON.stringify({ kind: "sound", task: "sfx" })}`)).toMatchObject({ kind: "sound", task: "sfx" });
  });
  test("finished sound job carries sound provenance and starts no cover or word timing", async () => {
    const out = await input(people.owner, { description: "rain on a window" });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const job = getMusicJobFor(people.owner, id)!;
    const file = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get();
    expect(generationOf(file?.provenance ?? null)).toMatchObject({ kind: "sound", task: "sfx" });
    expect(file && toRecord(file).provenance.package_id).toBe("make_sound");
    expect(job.coverJobId).toBeNull(); expect(job.coverFileId).toBeNull(); expect(job.timedWords).toBeNull();
    expect(fake.align.submitted).toHaveLength(0);
  });
  test("takes are limited to 1 to 3", () => {
    expect(makeSoundArgs.safeParse({ description: "a door knock", takes: 3 }).success).toBe(true);
    expect(makeSoundArgs.safeParse({ description: "a door knock", takes: 4 }).success).toBe(false);
    expect(makeSoundArgs.safeParse({ description: "a door knock", takes: 0 }).success).toBe(false);
  });
  test("one request makes three takes, one after another, each its own file", async () => {
    const out = await input(people.owner, { description: "a door knock", takes: 3 });
    expect(out.result?.reply?.text).toContain("3 takes");
    const first = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    const group = first.request.sound!.takes!.group;
    expect(first.request.sound!.takes).toMatchObject({ index: 0, total: 3 });
    await waitForMusic(() => soundTakesOf(people.owner, group).length === 3 && soundTakesOf(people.owner, group).every((take) => take.state === "done"));
    const takes = soundTakesOf(people.owner, group);
    expect(takes.map((take) => take.index)).toEqual([0, 1, 2]);
    expect(new Set(takes.map((take) => take.file_id)).size).toBe(3);
    expect(fake.submitted).toHaveLength(3);
  });
  test("a single take carries no group", async () => {
    const out = await input(people.owner, { description: "a door knock" });
    expect(getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!.request.sound?.takes).toBeUndefined();
  });
  test("a loop on a host with no audio tool keeps the sound and says it is not seamless", async () => {
    __setMusicMixToolsForTests({ afconvert: null, ffmpeg: null });
    const out = await input(people.owner, { description: "rain on a window", loop: true });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    expect(getMusicJobFor(people.owner, id)!.request.sound).toMatchObject({ loop: true, looped: false });
  });
  test("a sound under the minimum is made at the minimum and cut to the length asked", async () => {
    __setMusicMixToolsForTests({ afconvert: "/usr/bin/afconvert", ffmpeg: null });
    let decoded = 0;
    __setMusicMixRunnerForTests(async (command) => { const output = command.at(-1)!; if (command.includes("WAVE")) { decoded++; writeFileSync(output, wavOfPcm(new Int16Array(44100 * 2 * 10).fill(500))); } else writeFileSync(output, new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3, 4])); return true; });
    const out = await input(people.owner, { description: "a click", seconds: 3 });
    const id = musicForOutcomes([out])!.id;
    expect(fake.submitted[0]).toMatchObject({ duration_s: 10 });
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const job = getMusicJobFor(people.owner, id)!;
    expect(job.request.sound).toMatchObject({ trimTo: 3, trimmed: true });
    expect(decoded).toBe(1);
  });
  test("a loop is made seamless through the audio tool", async () => {
    __setMusicMixToolsForTests({ afconvert: "/usr/bin/afconvert", ffmpeg: null });
    const seen: string[][] = [];
    __setMusicMixRunnerForTests(async (command) => { seen.push(command); const output = command.at(-1)!; if (command.includes("WAVE")) writeFileSync(output, wavOfPcm(new Int16Array(44100 * 2 * 3).fill(500))); else writeFileSync(output, new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3, 4])); return true; });
    const out = await input(people.owner, { description: "rain on a window", loop: true });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const job = getMusicJobFor(people.owner, id)!;
    expect(job.request.sound).toMatchObject({ loop: true, looped: true });
    expect(seen.length).toBe(2);
    expect(readMusicFile(people.owner, job, job.fileId!)!.bytes.length).toBe(16);
  });
});

describe("add a sound to a song", () => {
  const wavRunner = () => { __setMusicMixToolsForTests({ afconvert: "/usr/bin/afconvert", ffmpeg: null });
    __setMusicMixRunnerForTests(async (command) => { const output = command.at(-1)!; if (command.includes("WAVE")) writeFileSync(output, wavOfPcm(new Int16Array(44100 * 2 * 3).fill(500))); else writeFileSync(output, new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 9, 9, 9, 9])); return true; }); };
  async function songAndSound() {
    const state = musicState(people.owner);
    const song = await runGenerateMusic({ state, args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes" }, callId: "g", spoken: false });
    const songId = musicForOutcomes([song])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, songId)?.state === "done");
    const out = await input(people.owner, { description: "a door knock" });
    const soundId = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, soundId)?.state === "done");
    return { songId, soundId };
  }
  test("lays the sound in as a new version and keeps the original", async () => {
    const { songId, soundId } = await songAndSound();
    wavRunner();
    const before = getMusicJobFor(people.owner, songId)!;
    const result = await addSoundToSong(people.owner, { soundJobId: soundId, songId, startSeconds: 1 });
    expect(result.ok).toBe(true);
    const root = getMusicJobFor(people.owner, songId)!;
    const versions = (await import("./jobs")).musicVersions(people.owner, root).filter((job) => job.fileId);
    expect(versions.length).toBe(2);
    expect(versions.some((job) => job.fileId === before.fileId)).toBe(true);
    const added = versions.find((job) => job.fileId !== before.fileId)!;
    expect(added.parentFileId).toBe(before.fileId);
    expect(added.state).toBe("done");
  });
  test("says what is wrong for a missing sound, a start after the end and no audio tool", async () => {
    const { songId, soundId } = await songAndSound();
    wavRunner();
    expect(await addSoundToSong(people.owner, { soundJobId: "mus-nope", songId, startSeconds: 1 })).toMatchObject({ ok: false, status: 404 });
    expect(await addSoundToSong(people.owner, { soundJobId: soundId, songId, startSeconds: 100000 })).toMatchObject({ ok: false, status: 422 });
    __setMusicMixRunnerForTests(null); __setMusicMixToolsForTests({ afconvert: null, ffmpeg: null });
    const none = await addSoundToSong(people.owner, { soundJobId: soundId, songId, startSeconds: 1 });
    expect(none).toMatchObject({ ok: false, status: 503 });
    expect(none.ok ? "" : none.line).toContain("audio tool");
  });
  test("another person's sound or song is not found", async () => {
    const { songId, soundId } = await songAndSound();
    wavRunner();
    expect(await addSoundToSong(people.child, { soundJobId: soundId, songId, startSeconds: 1 })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("the sound-effects model (MP-07)", () => {
  const useSfx = (overrides = {}) => { fake.sound.status = readySoundStatusForTests(overrides); __setSoundStatusForTests(readySoundStatusForTests(overrides)); };
  test("a ready sound model makes a sub-10 s sound at its own length, with no minimum or trim", async () => {
    useSfx();
    const out = await input(people.owner, { description: "a heavy wooden door slamming shut", seconds: 3 });
    expect(out.status).toBe("succeeded");
    expect(out.result?.reply?.text).not.toContain("minimum length");
    const id = musicForOutcomes([out])!.id;
    const job = getMusicJobFor(people.owner, id)!;
    expect(job.request.sound).toMatchObject({ engine: "sfx", loop: false });
    expect(job.request.sound?.trimTo).toBeUndefined();
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    expect(fake.sound.submitted).toEqual([{ prompt: "a heavy wooden door slamming shut", seconds: 3, timeout_ms: 1 }]);
    expect(fake.submitted).toHaveLength(0);
    expect(fake.sound.deleted).toContain("sjob-1");
    const done = getMusicJobFor(people.owner, id)!;
    expect(done.durationS).toBe(3);
    const file = db.select().from(attachments).where(eq(attachments.id, done.fileId!)).get();
    expect(generationOf(file?.provenance ?? null)).toMatchObject({ kind: "sound", task: "sfx", model: { id: "stable-audio-3-small-sfx", licence: "Stability AI Community Licence; Gemma Terms of Use" }, commercial_use: "personal_only" });
    expect(file?.provenance).not.toContain("door slamming");
    expect(done.coverJobId).toBeNull(); expect(fake.align.submitted).toHaveLength(0);
  });
  test("a long sound goes to ACE-Step when it is ready, and is cut to 47 s when it is not", async () => {
    useSfx();
    const long = await input(people.owner, { description: "a long steady rain", seconds: 55 });
    expect(getMusicJobFor(people.owner, musicForOutcomes([long])!.id)!.request.sound?.engine).toBeUndefined();
    expect(fake.submitted).toHaveLength(1); expect(fake.sound.submitted).toHaveLength(0);
    await waitForMusic(() => getMusicJobFor(people.owner, musicForOutcomes([long])!.id)?.state === "done");
    __setMusicStatusForTests({ available: false } as never);
    const only = await input(people.owner, { description: "a long steady rain", seconds: 55 });
    expect(getMusicJobFor(people.owner, musicForOutcomes([only])!.id)!.request).toMatchObject({ seconds: 47, sound: { engine: "sfx" } });
  });
  test("a model that is not installed falls back to ACE-Step, and with neither ready the answer is no engine", async () => {
    __setSoundStatusForTests(readySoundStatusForTests({ model: { id: "stable-audio-3-small-sfx", installed: false, licence: "x", licence_accepted_at: null } }));
    const out = await input(people.owner, { description: "rain on a window" });
    expect(getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!.request.sound?.engine).toBeUndefined();
    expect(fake.submitted).toHaveLength(1);
    __setMusicStatusForTests({ available: false } as never);
    expect(await input(people.owner, { description: "rain on a window" })).toMatchObject({ status: "failed", errorCode: "no_engine" });
  });
  test("takes run one after another through the sound model", async () => {
    useSfx();
    const out = await input(people.owner, { description: "a door knock", takes: 2 });
    const group = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!.request.sound!.takes!.group;
    await waitForMusic(() => soundTakesOf(people.owner, group).length === 2 && soundTakesOf(people.owner, group).every((take) => take.state === "done"));
    expect(fake.sound.submitted).toHaveLength(2); expect(fake.submitted).toHaveLength(0);
  });
  test("a failed sound says what happened in plain words and keeps the code", async () => {
    useSfx(); fake.sound.fail = "silent";
    const out = await input(people.owner, { description: "a door knock" });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "failed");
    const job = getMusicJobFor(people.owner, id)!;
    expect(job.errorCode).toBe("silent"); expect(job.errorLine).toContain("couldn't make that sound");
  });
  test("readiness needs the model installed and a state that can take a job", () => {
    expect(soundStatusReady(readySoundStatusForTests())).toBe(true);
    expect(soundStatusReady(readySoundStatusForTests({ state: "needs-setup" }))).toBe(true);
    expect(soundStatusReady(readySoundStatusForTests({ state: "not-installed", available: false }))).toBe(false);
    expect(soundStatusReady(readySoundStatusForTests({ state: "off", available: false }))).toBe(false);
    expect(soundStatusReady(null)).toBe(false);
  });
  test("the model's pin is in the provenance table and its licence is never cleared for commercial export", () => {
    expect(KNOWN_MUSIC_MODELS["stable-audio-3-small-sfx"]).toMatchObject({ commercial_use: "personal_only" });
    expect(modelStampFor("sfx", "stable-audio-3-small-sfx", null)).toMatchObject({ commercial_use: "personal_only", model: { id: "stable-audio-3-small-sfx" } });
    expect(modelStampFor("sfx", "something-else", null).commercial_use).toBe("unknown");
  });
});

describe("the Stack sound client", () => {
  const calls: Array<{ path: string; method: string; body?: string }> = [];
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  beforeEach(() => { calls.length = 0; });
  test("submit, poll, file, cancel and status use the sound routes", async () => {
    __setMusicFetchForTests((async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname;
      calls.push({ path, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (path === "/stack/v1/sound") return reply({ sound: readySoundStatusForTests() });
      if (path === "/v1/audio/sound" && init?.method === "POST") return reply({ created: 1, job: "s1", data: [{ url: "/v1/audio/sound/s1/file", duration_s: 4, seed: 9, model: "stable-audio-3-small-sfx" }] });
      if (path.endsWith("/file")) return new Response(new Uint8Array([1, 2, 3]));
      if (init?.method === "DELETE") return reply({ job: "s1", state: "deleted" });
      return reply({ state: "running", progress_fraction: 0.5 });
    }) as typeof fetch);
    expect((await soundStatus())?.model.installed).toBe(true);
    const sent = await submitSound({ prompt: "a click", seconds: 4, seed: 9, timeout_ms: 1 });
    expect(sent.job).toBe("s1"); expect(sent.done?.[0]?.seed).toBe(9);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ prompt: "a click", seconds: 4, seed: 9, timeout_ms: 1 });
    expect((await getSoundJob("s1")).state).toBe("running");
    expect([...await fetchSound("s1")]).toEqual([1, 2, 3]);
    await cancelOrDeleteSound("s1");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /stack/v1/sound", "POST /v1/audio/sound", "GET /v1/audio/sound/s1", "GET /v1/audio/sound/s1/file", "DELETE /v1/audio/sound/s1"]);
  });
  test("an older Stack (404) or a refusal reads as no sound engine, with the Stack's code on a refused submit", async () => {
    __setMusicFetchForTests((async (url: string | URL | Request) => {
      const path = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname;
      return path === "/stack/v1/sound" ? reply({ code: "unknown_route" }, 404) : reply({ error: "Install it.", code: "licence_required" }, 409);
    }) as typeof fetch);
    expect(await soundStatus()).toBeNull();
    await expect(submitSound({ prompt: "x y z", seconds: 5, timeout_ms: 1 })).rejects.toMatchObject({ code: "licence_required", status: 409 });
  });
});
