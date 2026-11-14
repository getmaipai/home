import { describe, expect, test } from "bun:test";
import { __resetHeardSongsForTests, heardSongContextLine, noteNowPlaying } from "@/lib/music/heardSong";
import dataset from "./datasets/song-name.json";

describe("song-name dataset", () => {
  test("every row has an id, label and text; action rows use a supported action", () => {
    for (const row of dataset.rows) {
      expect(row.id).toBeTruthy();
      expect(row.label).toBeTruthy();
      expect(row.text).toBeTruthy();
      if ("action" in row && row.action !== undefined) expect(["listen", "playback", "reject", "suggest", "confirm"]).toContain(row.action);
    }
  });
});

describe("song name heldout3 Home context", () => {
  test("heldout3-home rows use the generated now-playing context line", () => {
    __resetHeardSongsForTests();
    const now = 1_800_000_000_000;
    noteNowPlaying("robot", { title: "Moonlight Drive", artist: "Quill", album: "Night Tide", year: 2024 }, now);
    const expected = heardSongContextLine({ title: "Moonlight Drive", artist: "Quill", album: "Night Tide", year: 2024, source: "home", nowPlaying: true, at: now }, now);
    const rows = dataset.rows.filter((row) => row.id.startsWith("heldout3-home-"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.messages?.find((message) => message.role === "system")?.content).toBe(expected);
    }
  });
});
