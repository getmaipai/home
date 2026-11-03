// MUSIC-GEN-20b: a finished made song is timed word by word in the background; the card gets `timed_lyrics[].words`. The Stack is a fetch fake.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS, LRC } from "./musicFixture";
import { runGenerateMusic } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor } from "@/lib/music/jobs";
import { startWordTiming, timedLyricsFor } from "@/lib/music/timedWords";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import type { PersonRow } from "@/types";

let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); __resetThrottleForTests(); fake = installFakeMusicStack(); });
afterEach(() => fake.restore());
async function owner() {
  const client = new TestClient(); expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow };
}
async function song(actor: PersonRow, args: Record<string, unknown> = {}) {
  const state = musicState(actor);
  const outcome = await runGenerateMusic({ state, args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes", ...args }, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  return id;
}
const stored = (id: string) => db.select().from(musicJobs).where(eq(musicJobs.id, id)).get()!.timedWords;
const timedAfter = async (id: string) => { await waitForMusic(() => stored(id) !== null); return JSON.parse(stored(id)!) as { t: number; text: string; words: { text: string }[] }[]; };

describe("word timing job hook", () => {
  test("a finished song is aligned once in the background with its sung lines, and the words are stored beside the lrc", async () => {
    const { actor } = await owner(); const id = await song(actor);
    const lines = await timedAfter(id);
    expect(fake.align.submitted).toHaveLength(1);
    expect(fake.align.submitted[0]!.lyrics).toBe("Morning light\nWarm and bright\nPancakes rise\nUnder sunny skies\nCoffee flows\nPancakes rise\nUnder sunny skies");
    expect(fake.align.submitted[0]!.origin).toBe("made_here");
    expect(fake.align.submitted[0]!.bytes).toBe(4096);
    expect(lines).toHaveLength(7);
    expect(lines[0]!.words.map((w) => w.text)).toEqual(["Morning", "light"]);
    expect(getMusicJobFor(actor, id)!.lrc).toBe(LRC);
  });
  test("a slow Stack job is polled to the end and the Stack's copy is freed", async () => {
    fake.align.mode = "async";
    const { actor } = await owner(); const id = await song(actor);
    await timedAfter(id);
    expect(fake.align.polls).toBeGreaterThanOrEqual(2);
    await waitForMusic(() => fake.align.deleted > 0);
  });
  test("a Stack without the aligner, or a failed alignment, leaves the song and its line timing alone, and the 503 is remembered", async () => {
    fake.align.installed = false;
    const { actor, client } = await owner(); const id = await song(actor);
    await new Promise((r) => setTimeout(r, 40));
    expect(stored(id)).toBeNull();
    expect(getMusicJobFor(actor, id)!.state).toBe("done");
    await song(actor); await new Promise((r) => setTimeout(r, 20));
    expect(fake.align.submitted).toHaveLength(0);
    const card = await (await client.get(`/api/music/jobs/${id}`)).json() as { timed_lyrics: { t: number; words?: unknown }[] };
    expect(card.timed_lyrics).toHaveLength(7); expect(card.timed_lyrics[0]).not.toHaveProperty("words");
  });
  test("a failed alignment stores nothing and never fails the song", async () => {
    fake.align.mode = "fail";
    const { actor } = await owner(); const id = await song(actor);
    await waitForMusic(() => fake.align.deleted > 0);
    expect(stored(id)).toBeNull(); expect(getMusicJobFor(actor, id)!.state).toBe("done");
  });
  test("an instrumental song and a song over four minutes are not aligned", async () => {
    const { actor } = await owner(); const id = await song(actor);
    await timedAfter(id); fake.align.submitted.length = 0;
    const job = getMusicJobFor(actor, id)!;
    await startWordTiming({ ...job, id: "other-1", request: { ...job.request, instrumental: true }, timedWords: null }, new Uint8Array(8));
    await startWordTiming({ ...job, id: "other-2", durationS: 241, timedWords: null }, new Uint8Array(8));
    await startWordTiming({ ...job, id: "other-3", task: "cover", timedWords: null }, new Uint8Array(8));
    expect(fake.align.submitted).toHaveLength(0);
  });
});

describe("the card's timed lyrics", () => {
  test("lines carry their words once timed, and the old shape before and when the line count differs", async () => {
    const { actor, client } = await owner(); const id = await song(actor);
    await timedAfter(id);
    const card = await (await client.get(`/api/music/jobs/${id}`)).json() as { timed_lyrics: { t: number; line: string; section: string | null; words?: { t: number; end: number; text: string }[] }[] };
    expect(card.timed_lyrics).toHaveLength(7);
    expect(card.timed_lyrics[0]).toEqual({ t: 1, line: "Morning light", section: null, words: [{ t: 1, end: 1.4, text: "Morning" }, { t: 1.5, end: 1.9, text: "light" }] });
    const job = getMusicJobFor(actor, id)!;
    expect(timedLyricsFor({ ...job, timedWords: JSON.stringify([{ t: 1, text: "Morning light", words: [] }]) })).toEqual(timedLyricsFor({ ...job, timedWords: null }));
    expect(timedLyricsFor({ ...job, timedWords: "not json" })![0]).not.toHaveProperty("words");
    expect(timedLyricsFor({ ...job, timedWords: null })![0]).toEqual({ t: 1, line: "Morning light", section: null });
  });
  test("a stale copy of the job saved later does not wipe the stored words", async () => {
    const { actor } = await owner(); const id = await song(actor);
    const before = await timedAfter(id);
    const { saveMusicJob } = await import("@/lib/music/store");
    saveMusicJob({ ...getMusicJobFor(actor, id)!, timedWords: null });
    expect(JSON.parse(stored(id)!)).toEqual(before);
  });
});
