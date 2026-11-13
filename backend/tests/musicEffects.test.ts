// MP-02: file effects on a saved song (ffmpeg in Home, no model). Pure filter tests first, then one job through a stubbed ffmpeg runner.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, LYRICS, waitForMusic } from "./musicFixture";
import { runEditMusic, runGenerateMusic } from "@/lib/music/tool";
import { EFFECT_CHANGES, checkEffect, effectFilter, effectGraph } from "@/lib/music/effects";
import { getMusicJobFor, musicVersions } from "@/lib/music/jobs";
import { __setMusicMixRunnerForTests, __setMusicMixToolsForTests } from "@/lib/music/mixParts";
import { musicForOutcomes } from "@/lib/composer";
import { generationOf, type MusicJob } from "@/lib/music/types";

describe("effect filters (pure)", () => {
  test("each effect builds its ffmpeg filter", () => {
    expect(effectFilter({ change: "gain", amount: -6 })).toBe("volume=-6dB");
    expect(effectFilter({ change: "reverse" })).toBe("areverse");
    expect(effectFilter({ change: "speed", amount: 1.5 })).toBe("atempo=1.5");
    expect(effectFilter({ change: "pitch", amount: 12 })).toBe("aresample=44100,asetrate=88200,aresample=44100,atempo=0.5");
    expect(effectFilter({ change: "pitch", amount: 0 })).toContain("atempo=1");
    expect(effectFilter({ change: "remove_silence" })).toContain("silenceremove=");
    expect(effectFilter({ change: "limit" })).toContain("alimiter=");
    expect(effectFilter({ change: "echo" })).toContain("aecho=");
    expect(effectFilter({ change: "reverb" })).toContain("aecho=");
    expect(effectFilter({ change: "denoise" })).toContain("afftdn");
    expect(effectFilter({ change: "eq", preset: "bass_boost" })).toBe("equalizer=f=60:t=q:w=1:g=6,equalizer=f=170:t=q:w=1:g=4,equalizer=f=500:t=q:w=1:g=1");
    expect(effectFilter({ change: "eq", bands: [0, 0, 0, 0, 0, -3] })).toBe("equalizer=f=12000:t=q:w=1:g=-3");
    expect(effectFilter({ change: "eq", bands: [0, 0, 0, 0, 0, 0] })).toBe("anull");
  });
  test("compress builds an acompressor filter from the five Studio settings, in ffmpeg's own units", () => {
    expect(effectFilter({ change: "compress", compressor: { threshold_db: -20, ratio: 4, attack_ms: 10, release_ms: 250, makeup_db: 6 } }))
      .toBe("acompressor=threshold=0.100000:ratio=4:attack=10:release=250:makeup=1.9953");
    // The bounds of the panel (-60 dB, 24 dB make-up) stay inside what ffmpeg accepts (threshold at least 0.000976563, make-up at most 64).
    const edge = effectFilter({ change: "compress", compressor: { threshold_db: -60, ratio: 20, attack_ms: 1, release_ms: 1000, makeup_db: 24 } });
    expect(edge).toContain("threshold=0.001000"); expect(Number(/makeup=([\d.]+)/.exec(edge)![1])).toBeLessThanOrEqual(64);
    expect(effectFilter({ change: "compress", compressor: { threshold_db: 0, ratio: 1, attack_ms: 10, release_ms: 100, makeup_db: 0 } })).toContain("threshold=1.000000");
  });
  test("compress bounds are checked, and a missing setting takes the panel default", () => {
    const bad = (compressor: unknown, match: string) => { const r = checkEffect({ change: "compress", compressor }, 60); expect(r.ok).toBe(false); expect(!r.ok && r.line).toContain(match); };
    bad({ threshold_db: 1 }, "-60 to 0");
    bad({ threshold_db: -61 }, "-60 to 0");
    bad({ ratio: 0.5 }, "1 to 20");
    bad({ ratio: 21 }, "1 to 20");
    bad({ attack_ms: 0 }, "1 to 200");
    bad({ attack_ms: 201 }, "1 to 200");
    bad({ release_ms: 5 }, "10 to 1000");
    bad({ makeup_db: 25 }, "0 to 24");
    bad({ makeup_db: -1 }, "0 to 24");
    bad({ ratio: "4" }, "1 to 20");
    expect(checkEffect({ change: "compress" }, 60)).toEqual({ ok: true, spec: { change: "compress", compressor: { threshold_db: -18, ratio: 3, attack_ms: 10, release_ms: 100, makeup_db: 0 } } });
    expect(checkEffect({ change: "compress", compressor: { ratio: 8 }, from_s: 2, to_s: 9 }, 60)).toEqual({ ok: true, spec: { change: "compress", compressor: { threshold_db: -18, ratio: 8, attack_ms: 10, release_ms: 100, makeup_db: 0 }, from_s: 2, to_s: 9 } });
  });
  test("no normalize effect exists (loudness stays a Stack edit)", () => { expect(EFFECT_CHANGES as readonly string[]).not.toContain("normalize"); });
  test("a whole-file effect has no split; a region leaves the rest untouched", () => {
    expect(effectGraph({ change: "reverse" })).toBe("[0:a]areverse[out]");
    const middle = effectGraph({ change: "gain", amount: 3, from_s: 10, to_s: 20 });
    expect(middle).toBe("[0:a]atrim=end=10,asetpts=PTS-STARTPTS[head];[0:a]atrim=start=10:end=20,asetpts=PTS-STARTPTS,volume=3dB[mid];[0:a]atrim=start=20,asetpts=PTS-STARTPTS[tail];[head][mid][tail]concat=n=3:v=0:a=1[out]");
    expect(effectGraph({ change: "reverse", to_s: 5 })).toBe("[0:a]atrim=start=0:end=5,asetpts=PTS-STARTPTS,areverse[mid];[0:a]atrim=start=5,asetpts=PTS-STARTPTS[tail];[mid][tail]concat=n=2:v=0:a=1[out]");
    expect(effectGraph({ change: "reverse", from_s: 5 })).toBe("[0:a]atrim=end=5,asetpts=PTS-STARTPTS[head];[0:a]atrim=start=5,asetpts=PTS-STARTPTS,areverse[mid];[head][mid]concat=n=2:v=0:a=1[out]");
  });
  test("bounds are checked and refusals say what to do", () => {
    const bad = (input: Parameters<typeof checkEffect>[0], match: string) => { const r = checkEffect(input, 60); expect(r.ok).toBe(false); expect(!r.ok && r.line).toContain(match); };
    bad({ change: "gain" }, "Say how much");
    bad({ change: "gain", amount: 25 }, "-24 to 24");
    bad({ change: "gain", amount: -24.5 }, "-24 to 24");
    bad({ change: "speed", amount: 0.4 }, "0.5 to 2");
    bad({ change: "speed", amount: 2.1 }, "0.5 to 2");
    bad({ change: "pitch", amount: 13 }, "-12 to 12");
    bad({ change: "eq" }, "preset");
    bad({ change: "eq", preset: "loud" }, "preset");
    bad({ change: "eq", bands: [1, 2, 3] }, "six equalizer gains");
    bad({ change: "eq", bands: [1, 2, 3, 4, 5, 13] }, "six equalizer gains");
    bad({ change: "reverse", from_s: 50, to_s: 40 }, "outside the song");
    bad({ change: "reverse", to_s: 90 }, "outside the song");
    bad({ change: "reverse", from_s: -1 }, "outside the song");
    bad({ change: "normalize" }, "not one I can make");
    expect(checkEffect({ change: "gain", amount: 24 }, 60)).toEqual({ ok: true, spec: { change: "gain", amount: 24 } });
    expect(checkEffect({ change: "speed", amount: 0.5, from_s: 1, to_s: 60 }, 60)).toEqual({ ok: true, spec: { change: "speed", amount: 0.5, from_s: 1, to_s: 60 } });
    expect(checkEffect({ change: "eq", preset: "warm" }, 60)).toEqual({ ok: true, spec: { change: "eq", preset: "warm" } });
    expect(checkEffect({ change: "echo", amount: 99 }, 60)).toEqual({ ok: true, spec: { change: "echo" } });
  });
});

let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
let lastCommand: string[] = [];
const M4A = new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); __setMusicMixToolsForTests({ afconvert: null, ffmpeg: "ffmpeg" }); __setMusicMixRunnerForTests(async (command) => { lastCommand = command; writeFileSync(command.at(-1)!, M4A); return true; }); });
afterEach(() => { __setMusicMixRunnerForTests(null); __setMusicMixToolsForTests(null); fake.restore(); });
async function song(state = musicState(people.owner)): Promise<MusicJob> {
  const outcome = await runGenerateMusic({ state, args: { description: "a gentle folk song with an original voice", lyrics: LYRICS, title: "Pancakes", seconds: 60 }, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
  return getMusicJobFor(people.owner, id)!;
}

describe("edit_music file effects through the job path", () => {
  test("an effect makes a new version, keeps the old one, inherits provenance and runs ffmpeg with the region graph", async () => {
    const state = musicState(people.owner); const parent = await song(state);
    const submittedBefore = fake.submitted.length;
    const outcome = await runEditMusic({ state, args: { track: parent.fileId, change: "gain", amount: -6, from_s: 10, to_s: 20 }, callId: "fx", spoken: false });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.result?.reply?.text).toContain("on the way");
    const id = musicForOutcomes([outcome])!.id;
    const running = getMusicJobFor(people.owner, id)!;
    expect(running.task).toBe("effect");
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const done = getMusicJobFor(people.owner, id)!;
    expect(fake.submitted.length).toBe(submittedBefore); // no Stack call
    expect(lastCommand[0]).toBe("ffmpeg");
    expect(lastCommand[lastCommand.indexOf("-filter_complex") + 1]).toContain("volume=-6dB");
    expect(done.fileId).not.toBe(parent.fileId); expect(done.parentFileId).toBe(parent.fileId);
    expect(musicVersions(people.owner, parent).map((j) => j.fileId)).toEqual(expect.arrayContaining([parent.fileId, done.fileId]));
    const row = db.select().from(attachments).where(eq(attachments.id, done.fileId!)).get()!;
    const origin = db.select().from(attachments).where(eq(attachments.id, parent.fileId!)).get()!;
    expect(generationOf(row.provenance)).toMatchObject({ task: "trim", source_kind: "made_here", parent_file_id: parent.fileId, model: generationOf(origin.provenance)!.model, commercial_use: generationOf(origin.provenance)!.commercial_use });
    expect(JSON.stringify(generationOf(row.provenance))).not.toContain("Pancakes");
    expect(done.request.title).toBe("Pancakes");
  });
  test("bad bounds are refused before any job exists", async () => {
    const state = musicState(people.owner); const parent = await song(state);
    const out = await runEditMusic({ state, args: { track: parent.fileId, change: "speed", amount: 3 }, callId: "fx", spoken: false });
    expect(out.result?.data).toMatchObject({ refused: "section_or_range" });
    expect(out.result?.reply?.text).toContain("0.5 to 2");
  });
  test("without ffmpeg the answer says so and nothing is made", async () => {
    const state = musicState(people.owner); const parent = await song(state);
    __setMusicMixToolsForTests({ afconvert: "/usr/bin/afconvert", ffmpeg: null });
    const out = await runEditMusic({ state, args: { track: parent.fileId, change: "reverse" }, callId: "fx", spoken: false });
    expect(out.result?.data).toMatchObject({ refused: "effect_unavailable" });
    expect(out.result?.reply?.text).toContain("Install ffmpeg");
  });
  test("a failed ffmpeg ends the job with a plain line and the song stays", async () => {
    const state = musicState(people.owner); const parent = await song(state);
    __setMusicMixRunnerForTests(async () => false);
    const out = await runEditMusic({ state, args: { track: parent.fileId, change: "denoise" }, callId: "fx", spoken: false });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "failed");
    expect(getMusicJobFor(people.owner, id)!.errorLine).toContain("Try again");
    expect(getMusicJobFor(people.owner, parent.id)!.state).toBe("done");
  });
});
