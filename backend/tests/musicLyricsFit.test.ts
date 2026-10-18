// MUSIC-GEN-17 (design note 18.1): Jesse's first live song (v0.2.21) sent a 22-line lyric as a 60 s Quick song. ACE-Step sang the
// first chorus and squeezed the other 12 lines into the last second, where he heard words that were not in his lyrics. These are
// that song's own lyrics and the engine's own timed lyrics (lrc), copied from the live row.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fitLyricsToLength, lyricsTextOf, sungLyricsFromLrc, sungSecondsFor, secondsForWords, hookOf } from "@/lib/music/sections";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, waitForMusic } from "./musicFixture";
import { runGenerateMusic, runEditMusic } from "@/lib/music/tool";
import { getMusicJobFor } from "@/lib/music/jobs";
import { musicForOutcomes } from "@/lib/composer";

const BANANA = "[Intro]\nRiff scream, peel the night\n\n[Verse]\nYellow veins in the dark, curving blades in the market glow\nPlastic crown, a throne of pulp, we bite where the sweet starts to burn\nMonkeys fell from the trees, we took their war, we wear it in our teeth\nBananas split the sky, ripening fast under neon\n\n[Pre-Chorus]\nPeel back the skin, expose the core\nSour blood, sweet rot, we want more\n\n[Chorus]\nBANANA! Ripe and raw, we tear it down!\nBANANA! Heavy as a crown!\nPeel the world, eat it alive, split the fruit and watch it die!\nWe are the bruise, we are the bite, yellow lightning in the night!\n\n[Verse]\nFrom Congo soil to steel city, freight trains of fruit and flame\nSlip on the skin, fall hard, learn the weight of a falling name\nKryptonite in a bunch, soft flesh, iron hunger\nOne bite, one choke, one golden shock\n\n[Bridge]\nSplatter pulp on the amps, let the sugar ferment\nFerment rage, ferment rot, we are the harvest\n\n[Chorus]\nBANANA! Ripe and raw, we tear it down!\nBANANA! Heavy as a crown!\nPeel the world, eat it alive, split the fruit and watch it die!\nWe are the bruise, we are the bite, yellow lightning in the night!\n\n[Outro]\nPeel, bite, bleed yellow";
const BANANA_LRC = "[00:00.00][Intro]\n[00:00.24]Riff scream, peel the night\n[00:05.68][Verse]\n[00:05.92]Yellow veins in the dark, curving blades in the market glow\n[00:16.32]Plastic crown, a throne of pulp, we bite where the sweet starts to burn\n[00:22.80]Monkeys fell from the trees, we took their war, we wear it in our teeth\n[00:27.68]Bananas split the sky, ripening fast under neon\n[00:32.96][Pre-Chorus]\n[00:33.36]Peel back the skin, expose the core\n[00:39.04]Sour blood, sweet rot, we want more\n[00:44.32][Chorus]\n[00:44.64]BANANA! Ripe and raw, we tear it down!\n[00:50.64]BANANA! Heavy as a crown!\n[00:56.00]Peel the world, eat it alive, split the fruit and watch it die!\n[00:59.92]We are the bruise, we are the bite, yellow lightning in the night!\n[00:59.92][Verse]\n[00:59.92]From Congo soil to steel city, freight trains of fruit and flame\n[00:59.92]Slip on the skin, fall hard, learn the weight of a falling name\n[00:59.92]Kryptonite in a bunch, soft flesh, iron hunger\n[00:59.92]One bite, one choke, one golden shock\n[00:59.92][Bridge]\n[00:59.92]Splatter pulp on the amps, let the sugar ferment\n[00:59.92]Ferment rage, ferment rot, we are the harvest\n[00:59.92][Chorus]\n[00:59.92]BANANA! Ripe and raw, we tear it down!\n[00:59.92]BANANA! Heavy as a crown!\n[00:59.92]Peel the world, eat it alive, split the fruit and watch it die!\n[00:59.92]We are the bruise, we are the bite, yellow lightning in the night!\n[00:59.92][Outro]\n[00:59.92]Peel, bite, bleed yellow";
const sungLines = (text: string) => text.split("\n").filter((l) => l.trim() && !/^\[[^\]]+\]$/.test(l.trim())).length;

describe("words fit the song's length", () => {
  test("the live 22-line lyric keeps whole sections up to the first chorus in 76 s", () => {
    const fit = fitLyricsToLength(BANANA, 76);
    expect(fit.cut).toBe(true);
    expect(sungLines(BANANA)).toBe(22);
    expect(sungLines(fit.lyrics)).toBe(11);
    expect(sungSecondsFor(11)).toBeLessThanOrEqual(76);
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
    expect(sungLines(fitLyricsToLength(`[Verse]\n${long}`, 30).lyrics)).toBe(3);
    expect(sungLines(fitLyricsToLength(long, 30).lyrics)).toBe(3);
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
    expect(squeezed.timed_lyrics).toHaveLength(10);
    expect(squeezed.timed_lyrics?.[0]).toEqual({ t: 0.24, line: "Riff scream, peel the night", section: "Intro" });
    expect(squeezed.timed_lyrics?.at(-1)).toEqual({ t: 56, line: "Peel the world, eat it alive, split the fruit and watch it die!", section: "Chorus" });
    expect(squeezed.timed_lyrics?.some(({ t }) => t >= 59)).toBe(false);
    const instrumental = musicCardView(people.owner, { ...base, lrc: BANANA_LRC, request: { description: "folk", instrumental: true, seconds: 60 } });
    expect(instrumental.timed_lyrics).toBeNull();
    const noTiming = musicCardView(people.owner, { ...base, lrc: null, request: { description: "folk", lyrics: BANANA, instrumental: false, seconds: 60 } });
    expect(noTiming.timed_lyrics).toBeNull();
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

  test("a quick song sings the hook at 76 seconds, and Make it full sings every word at 142", async () => {
    const state = musicState(people.owner);
    const quick = await runGenerateMusic({ state, args: { description: "modern heavy metal", lyrics: BANANA, length: "quick" }, callId: "q", spoken: false });
    expect(quick.status).toBe("succeeded");
    expect(sungLines(fake.submitted.at(-1)!.lyrics!)).toBe(11);
    expect(fake.submitted.at(-1)!.duration_s).toBe(76);
    expect(fake.submitted.at(-1)!.lyrics).toBe(hookOf(BANANA));
    const id = musicForOutcomes([quick])!.id;
    const job = getMusicJobFor(people.owner, id)!;
    expect(job.request.written_lyrics).toBe(BANANA);
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const full = await runEditMusic({ state, args: { track: "latest", change: "make_full" }, callId: "f", spoken: false });
    expect(full.status).toBe("succeeded");
    expect(fake.submitted.at(-1)).toMatchObject({ duration_s: 142, lyrics: BANANA });
  });

  test("new words on a remake replace the kept words, so Make it full sings the new ones", async () => {
    const state = musicState(people.owner);
    const quick = await runGenerateMusic({ state, args: { description: "modern heavy metal", lyrics: BANANA, seconds: 60 }, callId: "q2", spoken: false });
    const id = musicForOutcomes([quick])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const fresh = "[Verse]\nA brand new line\n[Chorus]\nSing the new chorus";
    const remade = await runEditMusic({ state, args: { track: "latest", change: "remake", lyrics: fresh }, callId: "r", spoken: false });
    expect(remade.status).toBe("succeeded");
    expect(remade.result?.reply?.text).not.toContain("Make it full");
    const remadeId = musicForOutcomes([remade])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, remadeId)?.state === "done");
    expect(getMusicJobFor(people.owner, remadeId)!.request.written_lyrics).toBeUndefined();
    await runEditMusic({ state, args: { track: "latest", change: "make_full" }, callId: "f2", spoken: false });
    expect(fake.submitted.at(-1)!.lyrics).toBe(fresh);
  });

  test("words kept for Make it full pass the floor again before they are sung", async () => {
    const { refuseMusicPrompt } = await import("@/lib/music/policy");
    const banned = ["kids", "naked"].join(" ");
    expect(refuseMusicPrompt(banned)).not.toBeNull();
    const state = musicState(people.owner);
    const quick = await runGenerateMusic({ state, args: { description: "modern heavy metal", lyrics: BANANA, seconds: 60 }, callId: "q3", spoken: false });
    const id = musicForOutcomes([quick])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const { saveMusicJob } = await import("@/lib/music/store");
    const job = getMusicJobFor(people.owner, id)!;
    job.request.written_lyrics = `${BANANA}\n\n[Outro]\n${banned}`;
    saveMusicJob(job);
    const before = fake.submitted.length;
    const full = await runEditMusic({ state, args: { track: "latest", change: "make_full" }, callId: "f3", spoken: false });
    expect(full.result?.reply?.text).toContain("No song was made");
    expect(fake.submitted.length).toBe(before);
  });
});

describe("MUSIC-GEN-21: the length follows the words", () => {
  let people: ReturnType<typeof createBenchPeople>;
  let fake: ReturnType<typeof installFakeMusicStack>;
  beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
  afterEach(() => fake.restore());
  const generate = (args: Record<string, unknown> = {}) => runGenerateMusic({ state: musicState(people.owner, true), args: { description: "original metal song", lyrics: BANANA, ...args }, callId: "words", spoken: false });

  test("full is the default and all 22 lines get 142 seconds", async () => {
    const out = await generate();
    expect(out.status).toBe("succeeded");
    expect(secondsForWords(BANANA)).toBe(142);
    expect(fake.submitted[0]).toMatchObject({ lyrics: BANANA, duration_s: 142 });
    const job = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    expect(job.request).toMatchObject({ length: "full", max_seconds: 600 });
    expect(job.request.written_lyrics).toBeUndefined();
  });

  test("an asked length stays 60 seconds and explains why words were fitted", async () => {
    const out = await generate({ seconds: 60 });
    expect(fake.submitted[0]).toMatchObject({ duration_s: 60, lyrics: fitLyricsToLength(BANANA, 60).lyrics });
    expect(out.result?.reply?.text).toContain("The words are longer than the length asked for");
    expect(getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!.request).toMatchObject({ cut: "asked", written_lyrics: BANANA });
  });

  test("a 120 second ceiling fits a full song and reaches the card", async () => {
    const { __setMusicStatusForTests, readyMusicStatusForTests } = await import("@/lib/music/ready");
    const { musicCardView } = await import("@/routes/music");
    __setMusicStatusForTests(readyMusicStatusForTests({ limits: { min_seconds: 10, max_seconds: 120 } }));
    const out = await generate();
    expect(fake.submitted[0]).toMatchObject({ duration_s: 120, lyrics: fitLyricsToLength(BANANA, 120).lyrics });
    expect(out.result?.reply?.text).toContain("longest song this computer makes (2 minutes)");
    const job = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    expect(musicCardView(people.owner, job)).toMatchObject({ cut: "ceiling", max_seconds: 120, length: "full" });
    expect(job.request.written_lyrics).toBe(BANANA);
  });

  test.each([["quick", 45], ["full", 180]] as const)("an instrumental %s keeps its usual length", async (length, seconds) => {
    await generate({ instrumental: true, length });
    expect(fake.submitted[0]).toMatchObject({ instrumental: true, duration_s: seconds, lyrics: "[Instrumental]" });
  });

  test("Make it quick from full sings the hook and keeps every word", async () => {
    const state = musicState(people.owner, true);
    const out = await runGenerateMusic({ state, args: { description: "metal song", lyrics: BANANA }, callId: "full", spoken: false });
    await waitForMusic(() => getMusicJobFor(people.owner, musicForOutcomes([out])!.id)?.state === "done");
    const quick = await runEditMusic({ state, args: { track: "latest", change: "make_quick" }, callId: "hook", spoken: false });
    expect(fake.submitted.at(-1)).toMatchObject({ duration_s: 76, lyrics: hookOf(BANANA) });
    expect(getMusicJobFor(people.owner, musicForOutcomes([quick])!.id)!.request.written_lyrics).toBe(BANANA);
  });

  test("a squeezed ending gets exactly one new submit, 30 percent longer", async () => {
    const { musicStageLabel } = await import("@/routes/music");
    fake.lrc = (seconds) => `[00:01.00]First\n[00:${(seconds - 0.1).toFixed(2)}]Second\n[00:${(seconds - 0.1).toFixed(2)}]Third`;
    let stage = "";
    fake.beforeSubmit = async () => {
      if (fake.submitted.length === 2) {
        const job = getMusicJobFor(people.owner, id)!;
        stage = musicStageLabel(job);
        expect(job.progress).toBe(0);
        expect(job.fileId).toBeNull();
      }
    };
    const out = await generate({ seconds: 30 });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]).toEqual({ ...fake.submitted[0]!, duration_s: 39 });
    expect(stage).toBe("Making it longer so every line fits");
    expect(fake.deleted).toContain("mjob-1");
    expect(getMusicJobFor(people.owner, id)!).toMatchObject({ state: "done", durationS: 39, request: { retried: true, seconds: 39 } });
  });

  test.each([false, true])("a retry respects the ceiling, including immediate Stack replies (%s)", async (immediate) => {
    const { __setMusicStatusForTests, readyMusicStatusForTests } = await import("@/lib/music/ready");
    __setMusicStatusForTests(readyMusicStatusForTests({ limits: { min_seconds: 10, max_seconds: 35 } }));
    fake.immediate = immediate;
    fake.lrc = (seconds) => `[00:01.00]First\n[00:${(seconds - 0.1).toFixed(2)}]Second\n[00:${(seconds - 0.1).toFixed(2)}]Third`;
    const out = await generate({ seconds: 30 });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    expect(fake.submitted.map((body) => body.duration_s)).toEqual([30, 35]);
    expect(getMusicJobFor(people.owner, id)!.fileId).not.toBeNull();
  });

  test("a squeezed song already at the ceiling is stored without retry", async () => {
    const { __setMusicStatusForTests, readyMusicStatusForTests } = await import("@/lib/music/ready");
    __setMusicStatusForTests(readyMusicStatusForTests({ limits: { min_seconds: 10, max_seconds: 30 } }));
    fake.lrc = "[00:01.00]First\n[00:29.90]Second\n[00:29.90]Third";
    const out = await generate({ seconds: 30 });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    expect(fake.submitted).toHaveLength(1);
    expect(getMusicJobFor(people.owner, id)!.request.retried).toBeUndefined();
  });

  test("hook selection keeps two sections without a chorus and untagged text whole", () => {
    expect(hookOf("[Verse]\nOne\n[Bridge]\nTwo\n[Outro]\nThree")).toBe("[Verse]\nOne\n[Bridge]\nTwo");
    expect(hookOf("One\nTwo\nThree")).toBe("One\nTwo\nThree");
    expect(hookOf("[Verse]\r\nOne\r\n[Chorus]\r\nTwo\r\n[Outro]\r\nThree")).toBe("[Verse]\r\nOne\r\n[Chorus]\r\nTwo");
    expect(hookOf("[Intro]\nOne\n[CHORUS 1]\nTwo\n[Outro]\nThree")).toBe("[Intro]\nOne\n[CHORUS 1]\nTwo");
  });
});
