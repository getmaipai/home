import { describe, expect, test } from "bun:test";
import { aggregatePodcastStats } from "./podcastStats";

describe("podcast stats", () => {
  test("totals seconds, finished episodes, top shows and monthly listening for a year", () => {
    const progress = [
      { media_id: "e1", position: { seconds: 1800 }, duration_s: 2400, completed: true, updated_at: "2026-01-15T12:00:00.000Z" },
      { media_id: "e2", position: { seconds: 900 }, duration_s: 1800, completed: false, updated_at: "2026-01-20T12:00:00.000Z" },
      { media_id: "e3", position: { seconds: 3600 }, duration_s: 3600, completed: true, updated_at: "2026-02-02T12:00:00.000Z" },
      { media_id: "e4", position: { seconds: 1200 }, duration_s: 1800, completed: false, updated_at: "2025-12-30T12:00:00.000Z" },
    ] as const;
    const episodes = [
      { id: "e1", title: "One", source_id: "show-a", duration_s: 2400, artwork: null, external: null, added_at: "2026-01-01" },
      { id: "e2", title: "Two", source_id: "show-a", duration_s: 1800, artwork: null, external: null, added_at: "2026-01-01" },
      { id: "e3", title: "Three", source_id: "show-b", duration_s: 3600, artwork: null, external: null, added_at: "2026-01-01" },
      { id: "e4", title: "Four", source_id: "show-c", duration_s: 1800, artwork: null, external: null, added_at: "2025-01-01" },
    ] as const;
    expect(aggregatePodcastStats(progress, episodes, 2026)).toEqual({
      year: 2026,
      total_seconds: 6300,
      episodes_finished: 2,
      top_shows: [{ id: "show-a", title: "One", seconds: 2700 }, { id: "show-b", title: "Three", seconds: 3600 }].sort((a, b) => b.seconds - a.seconds),
      by_month: [{ month: "2026-01", seconds: 2700 }, { month: "2026-02", seconds: 3600 }],
    });
  });
});
