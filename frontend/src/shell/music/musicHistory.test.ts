import { describe, expect, test } from "bun:test";
import { createMusicHistoryTracker, musicHistoryThreshold } from "./musicHistory";

describe("music play history threshold", () => {
  test("records a long song after 30 seconds", () => {
    const tracker = createMusicHistoryTracker();
    tracker.reset(0);
    expect(musicHistoryThreshold(180)).toBe(30);
    for (let second = 1; second < 30; second++) expect(tracker.observe(second, 180, true)).toBe(false);
    expect(tracker.observe(30, 180, true)).toBe(true);
    expect(tracker.observe(31, 180, true)).toBe(false);
  });

  test("records half of a short song, whichever is shorter than 30 seconds", () => {
    const tracker = createMusicHistoryTracker();
    tracker.reset(0);
    expect(musicHistoryThreshold(20)).toBe(10);
    for (let second = 1; second < 10; second++) expect(tracker.observe(second, 20, true)).toBe(false);
    expect(tracker.observe(10, 20, true)).toBe(true);
  });

  test("does not count pauses or seek jumps as played time", () => {
    const tracker = createMusicHistoryTracker();
    tracker.reset(0);
    tracker.observe(4, 20, true);
    tracker.observe(4, 20, false);
    tracker.observe(14, 20, true);
    expect(tracker.elapsed()).toBe(4);
    expect(tracker.observe(14.5, 20, true)).toBe(false);
    expect(tracker.elapsed()).toBe(4.5);
  });

  test("ignores an explicit seek even when it is a small forward jump", () => {
    const tracker = createMusicHistoryTracker();
    tracker.reset(1);
    tracker.observe(2, 20, true);
    tracker.skipNextObservation();
    tracker.observe(4, 20, true);
    expect(tracker.elapsed()).toBe(1);
  });
});
