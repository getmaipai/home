import { describe, expect, test } from "bun:test";
import { songNameScore, type SongNameRun } from "./songNameScore";

describe("songNameScore", () => {
  test("passes when recall is at least 90% and other-run false calls are at most 2%", () => {
    const results: SongNameRun[] = [
      ...Array.from({ length: 90 }, () => ({ label: "song_name" as const, called: true, passed: true })),
      ...Array.from({ length: 10 }, () => ({ label: "song_name" as const, called: true, passed: false })),
      ...Array.from({ length: 50 }, () => ({ label: "N" as const, called: false })),
    ];
    expect(songNameScore(results)).toEqual({ songPass: 90, songRuns: 100, falseCalls: 0, otherRuns: 50, ok: true });
  });

  test("fails recall or false-call limits", () => {
    expect(songNameScore([
      { label: "song_name", called: true, passed: false },
      { label: "N", called: true },
    ])).toEqual({ songPass: 0, songRuns: 1, falseCalls: 1, otherRuns: 1, ok: false });
  });
});
