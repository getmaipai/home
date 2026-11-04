// MUSIC-GEN-20c (slice d): word timing for a scanned Library track with synced LRCLIB lyrics. The Stack is a fetch fake; nothing touches the network.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, people } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { scanRoot } from "@/lib/media/scan";
import { itemFromRow } from "@/lib/media/model";
import { __setMusicFetchForTests } from "@/lib/music/stack";
import { __resetWordTimingForTests } from "@/lib/music/timedWords";
import {
  __resetLibraryAlignForTests, __setLibraryAlignPollMsForTests, lrclibMatchesFile, needsWords, quickWindow, requestRealign, startLibraryAlign, RETRY_AFTER_MS,
} from "@/lib/music/libraryAlign";
import { lookupLyricsFor } from "@/lib/media/lyricsAction";
import { itemViewFor } from "@/lib/media/appHost";
import type { PersonRow } from "@/types";

const LINES = [
  { t: 12, line: "Morning light" }, { t: 16, line: "Warm and bright" }, { t: 20, line: "" }, { t: 30, line: "Pancakes rise" },
  { t: 60, line: "Under sunny skies" }, { t: 100, line: "Coffee flows" },
];
/** The recording on disk is this much later than the one LRCLIB timed. */
const SHIFT_S = 3;

interface Sent { lyrics: string; origin?: string; from_s?: number; to_s?: number; bytes: number }
let sent: Sent[]; let installed: boolean; let failWith: number | null; let onSubmit: ((n: number) => void) | null;
function fakeStack(): void {
  sent = []; installed = true; failWith = null; onSubmit = null;
  __setMusicFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/v1/audio/align" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { lyrics: string; origin?: string; from_s?: number; to_s?: number; source: string };
      if (!installed) return json({ error: "Install the lyric timing model.", code: "not_installed" }, 503);
      if (failWith) return json({ error: "boom", code: "failed" }, failWith);
      sent.push({ lyrics: body.lyrics, origin: body.origin, from_s: body.from_s, to_s: body.to_s, bytes: Buffer.from(body.source, "base64").length });
      onSubmit?.(sent.length);
      const lines = body.lyrics.split("\n"); const words: { t: number; end: number; text: string }[] = []; const line_starts: number[] = [];
      for (const line of lines) {
        const at = (LINES.find((l) => l.line === line)?.t ?? 0) + SHIFT_S; line_starts.push(words.length);
        line.split(/\s+/).forEach((text, k) => words.push({ t: at + k * 0.5, end: at + k * 0.5 + 0.4, text }));
      }
      return json({ created: 1, job: "align-job", data: { words, aligned_words: words.length, total_words: words.length, line_starts } });
    }
    if (path === "/v1/audio/align/align-job") return json({ job: "align-job", state: "deleted" });
    return json({ error: "unexpected" }, 404);
  }) as typeof fetch);
}

let adult: PersonRow; let trackId: string;
beforeEach(async () => {
  resetDb(); __resetLibraryAlignForTests(); __resetWordTimingForTests(); __setLibraryAlignPollMsForTests(2); fakeStack();
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  adult = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const tree = buildMediaTree();
  const made = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  await scanRoot(((await made.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  trackId = db.select().from(mediaItems).all().find((item) => item.title === "Morning Light")!.id;
  db.update(mediaItems).set({ artist: "The Marlows", durationS: 120 }).where(eq(mediaItems.id, trackId)).run();
  storeLyrics({ source: "lrclib", text: LINES.map((l) => l.line).join("\n"), timed: LINES.map((l) => ({ ...l })) });
});
afterEach(() => { __setMusicFetchForTests(null); __resetWordTimingForTests(); __resetLibraryAlignForTests(); __setLibraryAlignPollMsForTests(null); });

const storeLyrics = (lyrics: unknown) => db.update(mediaItems).set({ lyrics: JSON.stringify(lyrics) }).where(eq(mediaItems.id, trackId)).run();
const item = () => itemFromRow(db.select().from(mediaItems).where(eq(mediaItems.id, trackId)).get()!);
const stored = () => (item().lyrics as { timed: { t: number; line: string; words?: { t: number; end: number; text: string }[] }[] }).timed;

describe("the pure checks", () => {
  test("words are needed only when the lines are timed and none has words", () => {
    expect(needsWords(null)).toBe(false);
    expect(needsWords({ source: "lrclib", text: "a" })).toBe(false);
    expect(needsWords({ source: "lrclib", text: "a", timed: [{ t: 1, line: "a" }] })).toBe(true);
    expect(needsWords({ source: "lrclib", text: "a", timed: [{ t: 1, line: "a", words: [{ t: 1, end: 2, text: "a" }] }] })).toBe(false);
  });
  test("LRCLIB's duration within a second of the file's counts as the same recording", () => {
    expect(lrclibMatchesFile(120.8, 120)).toBe(true);
    expect(lrclibMatchesFile(122, 120)).toBe(false);
    expect(lrclibMatchesFile(undefined, 120)).toBe(false);
  });
  test("the quick window starts four seconds before the first sung line and runs forty seconds", () => {
    expect(quickWindow([{ t: 12, line: "a" }])).toEqual({ from_s: 8, to_s: 48 });
    expect(quickWindow([{ t: 1, line: "" }, { t: 2, line: "a" }])).toEqual({ from_s: 0, to_s: 40 });
    expect(quickWindow([{ t: 5, line: " " }])).toBeNull();
  });
});

describe("the two passes", () => {
  test("a quick pass over the first lines is stored before the full pass, then the full pass fills every sung line", async () => {
    let afterQuick: ReturnType<typeof stored> | null = null;
    onSubmit = (n) => { if (n === 2) afterQuick = stored(); };
    const outcome = await startLibraryAlign(adult, item(), { lrclibDurationS: 120.4 });
    expect(outcome).toBe("done");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ origin: "owned_file", from_s: 8, to_s: 48 });
    expect(sent[0]!.lyrics).toBe("Morning light\nWarm and bright\nPancakes rise");
    expect(sent[1]!.from_s).toBeUndefined();
    expect(sent[1]!.lyrics.split("\n")).toHaveLength(5);
    // The card had words for the first lines in between, and only for those.
    expect(afterQuick!.filter((row) => row.words?.length).map((row) => row.line)).toEqual(["Morning light", "Warm and bright", "Pancakes rise"]);
    const final = stored();
    expect(final).toHaveLength(LINES.length);
    expect(final.map((row) => row.line)).toEqual(LINES.map((l) => l.line));
    expect(final.filter((row) => row.words?.length)).toHaveLength(5);
    expect(final[2]!.words).toBeUndefined();            // the blank line keeps its LRCLIB time and has no words
    expect(final[2]!.t).toBe(20);
    expect(final[0]!.words![0]).toMatchObject({ text: "Morning" });
    for (let i = 1; i < final.length; i++) expect(final[i]!.t).toBeGreaterThanOrEqual(final[i - 1]!.t);
  });

  test("the lyrics view carries the words once they are stored (the item parses as the spec shape)", async () => {
    await startLibraryAlign(adult, item());
    expect((item().lyrics as { timed: { words?: unknown[] }[] }).timed[0]!.words).toBeDefined();
    expect(needsWords(item().lyrics as never)).toBe(false);
    expect(startLibraryAlign(adult, item())).toBeNull();      // words are there: nothing more to start
    expect(sent).toHaveLength(2);
  });

  test("a track over four minutes gets the quick pass and a plain no-op for the full pass", async () => {
    db.update(mediaItems).set({ durationS: 300 }).where(eq(mediaItems.id, trackId)).run();
    expect(await startLibraryAlign(adult, item())).toBe("partial");
    expect(sent).toHaveLength(1);
    expect(stored().filter((row) => row.words?.length)).toHaveLength(3);
  });

  test("lyrics replaced while aligning are not overwritten", async () => {
    onSubmit = (n) => { if (n === 1) storeLyrics({ source: "lrclib", text: "x", timed: [{ t: 1, line: "Something else" }] }); };
    await startLibraryAlign(adult, item());
    expect(stored()).toEqual([{ t: 1, line: "Something else" }]);
  });

  test("logs carry counts and milliseconds, never a lyric word", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {});
    let text = "";
    try { await startLibraryAlign(adult, item(), { lrclibDurationS: 120 }); text = info.mock.calls.map((call) => call.join(" ")).join("\n"); } finally { info.mockRestore(); }
    expect(text).toContain("[lyrics-align]");
    for (const word of ["Morning", "Pancakes", "sunny", "Coffee"]) expect(text).not.toContain(word);
  });
});

describe("failures never reach the song or the lyrics", () => {
  test("a Stack without the aligner leaves the lyrics alone and is not asked again for five minutes", async () => {
    installed = false;
    expect(await startLibraryAlign(adult, item(), { now: 1000 })).toBe("paused");
    expect(stored().some((row) => row.words)).toBe(false);
    expect(startLibraryAlign(adult, item(), { now: Date.now() })).toBeNull();
  });
  test("a failed attempt is remembered for 24 hours for the same lyrics, and tried again after", async () => {
    failWith = 500;
    expect(await startLibraryAlign(adult, item())).toBe("failed");
    expect(stored().some((row) => row.words)).toBe(false);
    failWith = null;
    expect(startLibraryAlign(adult, item(), { now: Date.now() + 60_000 })).toBeNull();
    expect(await startLibraryAlign(adult, item(), { now: Date.now() + RETRY_AFTER_MS + 1000 })).toBe("done");
  });
  test("different lyrics are a new version and are tried at once", async () => {
    failWith = 500;
    await startLibraryAlign(adult, item());
    failWith = null;
    storeLyrics({ source: "lrclib", text: "a", timed: [{ t: 12, line: "A new line" }] });
    expect(startLibraryAlign(adult, item())).not.toBeNull();
  });
  test("a track without timed lyrics, or without a Stack address, starts nothing", () => {
    storeLyrics({ source: "lrclib", text: "plain only" });
    expect(startLibraryAlign(adult, item())).toBeNull();
    storeLyrics({ source: "lrclib", text: "a", timed: [{ t: 1, line: "a" }] });
    __setMusicFetchForTests(null);
    expect(startLibraryAlign(adult, item())).toBeNull();
  });
});

describe("Lyrics look off", () => {
  test("it reruns both passes over words that are already stored and answers 202 at once", async () => {
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: adult.id, secret: "correcthorse" });
    await startLibraryAlign(adult, item());
    expect(sent).toHaveLength(2);
    const asked = requestRealign(adult, trackId);
    expect(asked.result).toEqual({ ok: true, status: 202 });
    expect(await asked.done).toBe("done");
    expect(sent).toHaveLength(4);
    expect(sent[2]!.from_s).toBeDefined();               // the first quick pass moved the first line to its measured time, so the window follows it
  });
  test("a second request inside a minute is turned away with a plain line", async () => {
    const first = requestRealign(adult, trackId, { nowMs: () => 1_000 }); await first.done;
    const second = requestRealign(adult, trackId, { nowMs: () => 30_000 });
    expect(second.result).toMatchObject({ ok: false, status: 429 });
    const third = requestRealign(adult, trackId, { nowMs: () => 62_000 });
    expect(third.result).toEqual({ ok: true, status: 202 }); await third.done;
  });
  test("a song that is not in the library, or has no timed lyrics, is refused", () => {
    expect(requestRealign(adult, "media-nope").result).toMatchObject({ ok: false, status: 404 });
    storeLyrics({ source: "lrclib", text: "plain only" });
    expect(requestRealign(adult, trackId).result).toMatchObject({ ok: false, status: 422 });
  });
  test("the HTTP route answers 202 and then 429, and 404 for an unknown song", async () => {
    const client = new TestClient();
    expect((await client.post("/api/auth/verify-secret", { personId: adult.id, secret: "correcthorse" })).status).toBe(200);
    const unsigned = new TestClient();
    expect((await unsigned.post(`/api/music/library/${trackId}/lyrics-realign`, {})).status).toBe(401);
    const res = await client.post(`/api/music/library/${trackId}/lyrics-realign`, {});
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, state: "queued" });
    expect((await client.post(`/api/music/library/${trackId}/lyrics-realign`, {})).status).toBe(429);
    expect((await client.post("/api/music/library/media-nope/lyrics-realign", {})).status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  test("the player action reaches the same function", async () => {
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: adult.id, secret: "correcthorse" });
    const res = await client.post("/api/plugins/music/actions/lyrics-realign", { media_id: trackId });
    expect([202, 404]).toContain(res.status);
    if (res.status === 404) throw new Error("the music package does not serve lyrics-realign: the play page must name it");
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe("when it starts", () => {
  test("storing synced LRCLIB lyrics starts it, and the answer does not wait", async () => {
    db.update(mediaItems).set({ lyrics: null }).where(eq(mediaItems.id, trackId)).run();
    const synced = "[00:12.00]Morning light\n[00:16.00]Warm and bright";
    const fetchFake = (async () => new Response(JSON.stringify({ syncedLyrics: synced, duration: 120.5 }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const res = await lookupLyricsFor(adult, trackId, { fetch: fetchFake, nowMs: () => 1000 });
    expect(res).toMatchObject({ ok: true, value: { lookup: "found" } });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(stored().filter((row) => row.words?.length).length).toBe(2);
  });
  test("opening a track whose lyrics have timing but no words starts it once", async () => {
    expect(itemViewFor(adult, "music", trackId)).toBeTruthy();
    expect(itemViewFor(adult, "music", trackId)).toBeTruthy();   // the second open finds it running or done
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sent).toHaveLength(2);
    expect(stored().filter((row) => row.words?.length)).toHaveLength(5);
    const view = itemViewFor(adult, "music", trackId) as { timed_lyrics?: { words?: unknown[] }[] };
    expect(view.timed_lyrics?.[0]?.words?.length).toBe(2);
  });
});
