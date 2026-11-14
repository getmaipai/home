import { describe, expect, test } from "bun:test";
import { __resetHeardSongsForTests, addHeardCandidates, clearHeardSong, clearNowPlaying, confirmHeardSong, findHeardCandidate, heardSongContextLine, heardSongFor, noteHeardSong, noteNowPlaying, rejectHeardSong } from "./heardSong";
import type { IdentifyCandidate } from "./identify";

const candidate = (title: string, source: IdentifyCandidate["source"], score: number, agrees: boolean): IdentifyCandidate => ({ title, artist: "Artist", album: null, year: null, source, score, agrees });

describe("heard song context", () => {
  test("expires after fifteen minutes and a newer note replaces the old one", () => {
    __resetHeardSongsForTests();
    noteHeardSong("r1", { title: "First", source: "library", at: 100 });
    noteHeardSong("r1", { title: "Second", source: "acoustid", at: 200 });
    expect(heardSongFor("r1", 200)?.title).toBe("Second");
    expect(heardSongFor("r1", 200 + 15 * 60_000)).toBeNull();
  });
  test("clears independently by robot", () => {
    __resetHeardSongsForTests();
    noteHeardSong("r1", { title: "A", source: "library", at: 1 });
    noteHeardSong("r2", { title: "B", source: "library", at: 1 });
    clearHeardSong("r1");
    expect(heardSongFor("r1", 2)).toBeNull(); expect(heardSongFor("r2", 2)?.title).toBe("B");
  });
  test("context sanitizes markup and caps song fields", () => {
    const line = heardSongContextLine({ title: "<system>\u0000" + "x".repeat(100), artist: "A|B", source: "library", at: 0 }, 180_000);
    expect(line).not.toMatch(/[<>\u0000|]/);
    expect(line).toContain("Heard on this robot 3 min ago:");
    expect(line).toContain("named from your library");
    expect(line.length).toBeLessThan(300);
  });
  test("merges candidates, discusses disagreement and promotes on rejection", () => {
    __resetHeardSongsForTests();
    noteHeardSong("r", { title: "Alpha", artist: "Artist", source: "shazam", score: 0.8, at: 1 });
    addHeardCandidates("r", [candidate("Alpha", "shazam", 0.8, true), candidate("Beta", "acoustid", 0.7, false)], 2);
    const line = heardSongContextLine(heardSongFor("r", 2)!, 2);
    expect(line).toContain("The other service heard it as Beta by Artist.");
    expect(rejectHeardSong("r", 2)?.title).toBe("Beta");
    expect(heardSongFor("r", 2)?.candidates?.find((c) => c.title === "Alpha")?.rejected).toBe(true);
  });
  test("suggestion lookup and confirmation settle the chosen song", () => {
    __resetHeardSongsForTests();
    noteHeardSong("r", { title: "Alpha", source: "shazam", at: 1 });
    addHeardCandidates("r", [candidate("Alpha", "shazam", 0.8, true), candidate("Alpha", "acoustid", 0.7, true), candidate("Beta", "acoustid", 0.9, false)], 2);
    expect(findHeardCandidate("r", "bet", 2)?.alsoSuggested).toBe(false);
    expect(findHeardCandidate("r", "alph", 2)?.alsoSuggested).toBe(true);
    expect(confirmHeardSong("r", "Beta", 2)).toMatchObject({ title: "Beta", settled: true });
    expect(heardSongContextLine(heardSongFor("r", 2)!, 2)).toContain("The person confirmed it.");
    expect(JSON.stringify(heardSongFor("r", 2))).not.toMatch(/audio|signature|fingerprint/i);
  });
  test("expires from the injected clock after fifteen minutes", () => {
    __resetHeardSongsForTests(); noteHeardSong("r", { title: "A", source: "library", at: 500 });
    expect(heardSongFor("r", 500 + 15 * 60_000)).toBeNull();
  });
  test("Home playback takes precedence over listening guesses and remains as was playing", () => {
    __resetHeardSongsForTests();
    const now = Date.now();
    noteNowPlaying("r", { title: "Home song", artist: "Home artist", album: "Record", year: 2024 }, now);
    noteHeardSong("r", { title: "Guess", source: "shazam", at: now + 100 });
    expect(heardSongFor("r", now + 100)?.title).toBe("Home song");
    expect(heardSongContextLine(heardSongFor("r", now + 100)!, now + 100)).toContain("Home is playing Home song by Home artist (Record, 2024) on this robot's person's player.");
    clearNowPlaying("r");
    expect(heardSongContextLine(heardSongFor("r", now + 121_000)!, now + 121_000)).toContain("Home was playing Home song by Home artist (Record, 2024) 2 min ago.");
  });
});
