import { describe, expect, test } from "bun:test";
import { activeLineIndex, followScrollTop, fpsStops, frameGapMs, levelsFromBytes, LYRIC_FOLLOW_AT, nextFollow, SPECTRUM_BARS } from "./musicBarMath";
import { createSpectrum } from "./musicSpectrum";

describe("spectrum level math", () => {
  test("gives 64 bars, all between 0 and 1", () => {
    const levels = levelsFromBytes(new Uint8Array(128).fill(255));
    expect(levels.length).toBe(SPECTRUM_BARS);
    expect(levels.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(levels[0]).toBe(1);
  });
  test("silence is all zero and an empty spectrum does not throw", () => {
    expect(levelsFromBytes(new Uint8Array(128)).every((v) => v === 0)).toBe(true);
    expect(levelsFromBytes([]).length).toBe(SPECTRUM_BARS);
  });
  test("a bar rises at once and falls by the factor, snapping to 0 below 0.01", () => {
    const loud = levelsFromBytes(new Uint8Array(128).fill(255));
    const quiet = levelsFromBytes(new Uint8Array(128), SPECTRUM_BARS, loud, 0.5);
    expect(quiet[0]).toBe(0.5);
    let now = quiet;
    for (let i = 0; i < 10; i++) now = levelsFromBytes(new Uint8Array(128), SPECTRUM_BARS, now, 0.5);
    expect(now.every((v) => v === 0)).toBe(true);
  });
  test("a low tone lands in the low bars, not the high ones", () => {
    const bytes = new Uint8Array(128); bytes[2] = 255;
    const levels = levelsFromBytes(bytes);
    expect(levels.slice(0, 16).some((v) => v > 0)).toBe(true);
    expect(levels.slice(32).every((v) => v === 0)).toBe(true);
  });
  test("the fps ladder is 30, 60, the screen rate when reported, then uncapped", () => {
    expect(fpsStops()).toEqual([30, 60, 0]);
    expect(fpsStops(144)).toEqual([30, 60, 144, 0]);
    expect(fpsStops(1)).toEqual([30, 60, 0]);
    expect(frameGapMs(30)).toBeCloseTo(33.33, 1);
    expect(frameGapMs(0)).toBe(0);
  });
});

describe("spectrum source", () => {
  const analyser = (fill: number) => { let reads = 0; return { reads: () => reads, node: { frequencyBinCount: 128, getByteFrequencyData: (b: Uint8Array) => { reads++; b.fill(fill); } } }; };
  test("does not touch the analyser while paused or hidden", () => {
    const a = analyser(200);
    let playing = false, hidden = false;
    const s = createSpectrum({ analyser: () => a.node, playing: () => playing, hidden: () => hidden, now: () => 0 });
    expect(s.levels().every((v) => v === 0)).toBe(true);
    playing = true; hidden = true;
    s.levels();
    expect(a.reads()).toBe(0);
    hidden = false;
    expect(s.levels()[0]).toBeGreaterThan(0);
    expect(a.reads()).toBe(1);
  });
  test("reads at most once per frame gap, and returns zeros when the analyser is missing", () => {
    const a = analyser(200);
    let t = 0;
    const s = createSpectrum({ analyser: () => a.node, playing: () => true, hidden: () => false, now: () => t, fps: () => 30 });
    s.levels(); t = 10; s.levels();
    expect(a.reads()).toBe(1);
    t = 40; s.levels();
    expect(a.reads()).toBe(2);
    const none = createSpectrum({ analyser: () => null, playing: () => true, hidden: () => false });
    expect(none.levels().every((v) => v === 0)).toBe(true);
  });
});

describe("lyric follow math", () => {
  const lines = [{ t: 0 }, { t: 5 }, { t: 10 }, { t: 10.5 }, { t: 30 }];
  test("binary search finds the last line at or before the time", () => {
    expect(activeLineIndex(lines, -1)).toBe(-1);
    expect(activeLineIndex(lines, 0)).toBe(0);
    expect(activeLineIndex(lines, 9.99)).toBe(1);
    expect(activeLineIndex(lines, 10.5)).toBe(3);
    expect(activeLineIndex(lines, 999)).toBe(4);
    expect(activeLineIndex([], 3)).toBe(-1);
  });
  test("the line's middle sits at 20 percent of the viewport, never above the top", () => {
    expect(LYRIC_FOLLOW_AT).toBe(0.2);
    expect(followScrollTop(1000, 40, 500)).toBe(1000 + 20 - 100);
    expect(followScrollTop(10, 40, 500)).toBe(0);
  });
  test("a user scroll pauses following; a line click or Follow brings it back", () => {
    expect(nextFollow(true, "user-scroll")).toBe(false);
    expect(nextFollow(false, "line-click")).toBe(true);
    expect(nextFollow(false, "resume")).toBe(true);
  });
});
