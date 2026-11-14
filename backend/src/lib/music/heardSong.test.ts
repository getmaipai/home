import { describe, expect, test } from "bun:test";
import { __resetHeardSongsForTests, clearHeardSong, heardSongContextLine, heardSongFor, noteHeardSong } from "./heardSong";

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
});
