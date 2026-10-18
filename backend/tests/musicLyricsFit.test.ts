// MUSIC-GEN-17 (design note 18.1): Jesse's first live song (v0.2.21) sent a 22-line lyric as a 60 s Quick song. ACE-Step sang the
// first chorus and squeezed the other 12 lines into the last second, where he heard words that were not in his lyrics. These are
// that song's own lyrics and the engine's own timed lyrics (lrc), copied from the live row.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fitLyricsToLength, lyricsTextOf, sungLyricsFromLrc, sungSecondsFor } from "@/lib/music/sections";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, waitForMusic } from "./musicFixture";
import { runGenerateMusic, runEditMusic, FULL_SONG } from "@/lib/music/tool";
import { getMusicJobFor } from "@/lib/music/jobs";
import { musicForOutcomes } from "@/lib/composer";

const BANANA = "[Intro]\nRiff scream, peel the night\n\n[Verse]\nYellow veins in the dark, curving blades in the market glow\nPlastic crown, a throne of pulp, we bite where the sweet starts to burn\nMonkeys fell from the trees, we took their war, we wear it in our teeth\nBananas split the sky, ripening fast under neon\n\n[Pre-Chorus]\nPeel back the skin, expose the core\nSour blood, sweet rot, we want more\n\n[Chorus]\nBANANA! Ripe and raw, we tear it down!\nBANANA! Heavy as a crown!\nPeel the world, eat it alive, split the fruit and watch it die!\nWe are the bruise, we are the bite, yellow lightning in the night!\n\n[Verse]\nFrom Congo soil to steel city, freight trains of fruit and flame\nSlip on the skin, fall hard, learn the weight of a falling name\nKryptonite in a bunch, soft flesh, iron hunger\nOne bite, one choke, one golden shock\n\n[Bridge]\nSplatter pulp on the amps, let the sugar ferment\nFerment rage, ferment rot, we are the harvest\n\n[Chorus]\nBANANA! Ripe and raw, we tear it down!\nBANANA! Heavy as a crown!\nPeel the world, eat it alive, split the fruit and watch it die!\nWe are the bruise, we are the bite, yellow lightning in the night!\n\n[Outro]\nPeel, bite, bleed yellow";
const BANANA_LRC = "[00:00.00][Intro]\n[00:00.24]Riff scream, peel the night\n[00:05.68][Verse]\n[00:05.92]Yellow veins in the dark, curving blades in the market glow\n[00:16.32]Plastic crown, a throne of pulp, we bite where the sweet starts to burn\n[00:22.80]Monkeys fell from the trees, we took their war, we wear it in our teeth\n[00:27.68]Bananas split the sky, ripening fast under neon\n[00:32.96][Pre-Chorus]\n[00:33.36]Peel back the skin, expose the core\n[00:39.04]Sour blood, sweet rot, we want more\n[00:44.32][Chorus]\n[00:44.64]BANANA! Ripe and raw, we tear it down!\n[00:50.64]BANANA! Heavy as a crown!\n[00:56.00]Peel the world, eat it alive, split the fruit and watch it die!\n[00:59.92]We are the bruise, we are the bite, yellow lightning in the night!\n[00:59.92][Verse]\n[00:59.92]From Congo soil to steel city, freight trains of fruit and flame\n[00:59.92]Slip on the skin, fall hard, learn the weight of a falling name\n[00:59.92]Kryptonite in a bunch, soft flesh, iron hunger\n[00:59.92]One bite, one choke, one golden shock\n[00:59.92][Bridge]\n[00:59.92]Splatter pulp on the amps, let the sugar ferment\n[00:59.92]Ferment rage, ferment rot, we are the harvest\n[00:59.92][Chorus]\n[00:59.92]BANANA! Ripe and raw, we tear it down!\n[00:59.92]BANANA! Heavy as a crown!\n[00:59.92]Peel the world, eat it alive, split the fruit and watch it die!\n[00:59.92]We are the bruise, we are the bite, yellow lightning in the night!\n[00:59.92][Outro]\n[00:59.92]Peel, bite, bleed yellow";
const sungLines = (text: string) => text.split("\n").filter((l) => l.trim() && !/^\[[^\]]+\]$/.test(l.trim())).length;

describe("words fit the song's length", () => {
  test("the live 22-line lyric keeps whole sections up to the first chorus in 60 s", () => {
    const fit = fitLyricsToLength(BANANA, 60);
    expect(fit.cut).toBe(true);
    expect(sungLines(BANANA)).toBe(22);
    expect(sungLines(fit.lyrics)).toBe(11);
    expect(sungSecondsFor(11)).toBeLessThanOrEqual(60);
    expect(fit.lyrics.startsWith("[Intro]")).toBe(true);
    expect(fit.lyrics.trim().endsWith("yellow lightning in the night!")).toBe(true);
    expect(fit.lyrics).not.toContain("[Bridge]");
  });

  test("words that fit are sent unchanged, and a full song keeps every part", () => {
    const short = "[Verse]\nOne line\nTwo line\n\n[Chorus]\nSing it";
    expect(fitLyricsToLength(short, 45)).toEqual({ lyrics: short, cut: false });
    expect(fitLyricsToLength(BANANA, 180)).toEqual({ lyrics: BANANA, cut: false });
  });

  test("a first section that alone is too long, or untagged words, keep the lines that fit", () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    expect(sungLines(fitLyricsToLength(`[Verse]\n${long}`, 30).lyrics)).toBe(5);
    expect(sungLines(fitLyricsToLength(long, 30).lyrics)).toBe(5);
  });
});

describe("the lines the engine really sang", () => {
  test("the 12 lines squeezed into the last second of the live song are left off the card", () => {
    const sung = sungLyricsFromLrc(BANANA_LRC, 60);
    expect(sung).toHaveLength(10);
    expect(sung.at(-1)).toEqual({ t: 56, line: "Peel the world, eat it alive, split the fruit and watch it die!", section: "Chorus" });
    expect(sung.some((row) => row.line.startsWith("Peel, bite"))).toBe(false);
    expect(lyricsTextOf(sung).startsWith("[Intro]\nRiff scream, peel the night\n\n[Verse]")).toBe(true);
  });

  test("the card shows the squeezed song's sung words, and any other song's words as sent", async () => {
    const { musicCardView } = await import("@/routes/music");
    const people = createBenchPeople();
    const base = { id: "mus-test", personId: people.owner.id, conversationId: null, turnId: null, task: "text2music" as const, stackJob: null, state: "done" as const,
      stage: null, progress: 1, etaSeconds: 0, position: null, errorCode: null, errorLine: null, fileId: null, parentFileId: null, seed: 1, durationS: 60,
      chosenAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), temporary: false };
    const squeezed = musicCardView(people.owner, { ...base, lrc: BANANA_LRC, request: { description: "metal", lyrics: BANANA, instrumental: false, seconds: 60 } });
    expect(squeezed.lyrics).not.toContain("Peel, bite");
    expect(squeezed.lyrics).toContain("[Chorus]");
    const plain = "[Verse]\nOne\nTwo";
    const fine = musicCardView(people.owner, { ...base, lrc: "[00:01.00]One\n[00:05.00]Two", request: { description: "folk", lyrics: plain, instrumental: false, seconds: 60 } });
    expect(fine.lyrics).toBe(plain);
  });

  test("a song with nothing squeezed keeps every line", () => {
    const lrc = "[00:00.00][Verse]\n[00:01.00]One\n[00:05.00]Two\n[00:09.50]Three";
    expect(sungLyricsFromLrc(lrc, 10).map((row) => row.line)).toEqual(["One", "Two", "Three"]);
  });
});

describe("the tool fits the words and keeps them for Make it full", () => {
  let people: ReturnType<typeof createBenchPeople>;
  let fake: ReturnType<typeof installFakeMusicStack>;
  beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
  afterEach(() => fake.restore());

  test("a quick song sings the sections that fit, says so, and Make it full sings every word", async () => {
    const state = musicState(people.owner);
    const quick = await runGenerateMusic({ state, args: { description: "modern heavy metal", lyrics: BANANA, seconds: 60 }, callId: "q", spoken: false });
    expect(quick.status).toBe("succeeded");
    expect(sungLines(fake.submitted.at(-1)!.lyrics!)).toBe(11);
    expect(quick.result?.reply?.text).toContain("Make it full");
    const id = musicForOutcomes([quick])!.id;
    const job = getMusicJobFor(people.owner, id)!;
    expect(job.request.written_lyrics).toBe(BANANA);
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const full = await runEditMusic({ state, args: { track: "latest", change: "make_full" }, callId: "f", spoken: false });
    expect(full.status).toBe("succeeded");
    expect(fake.submitted.at(-1)).toMatchObject({ duration_s: FULL_SONG.default, lyrics: BANANA });
  });
});
