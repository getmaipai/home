import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../../tests/reset-db";
import { createBenchPeople } from "../../../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, waitForMusic } from "../../../tests/musicFixture";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "./ready";
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
