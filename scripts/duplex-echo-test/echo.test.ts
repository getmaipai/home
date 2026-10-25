import { describe, expect, test } from "bun:test";
import { rms, toDb, windowedLevels, summarize, verdict } from "./echo.mjs";

describe("echo measurements", () => {
  test("known sine RMS", () => {
    const samples = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(2 * Math.PI * i / 100));
    expect(rms(samples)).toBeCloseTo(Math.SQRT1_2, 2);
  });
  test("dB of a ratio", () => expect(toDb(0.5)).toBeCloseTo(-6.0206, 3));
  test("windowing produces 100 ms RMS levels", () => {
    const samples = new Float32Array(4800).fill(0.25);
    expect(windowedLevels(samples, 48000, 100)).toEqual([0.25]);
  });
  test("summarizes relative to room floor", () => {
    const result = summarize([0.02, 0.04], 0.01);
    expect(result.meanDb).toBeCloseTo(9.03, 1);
    expect(result.worstDb).toBeCloseTo(12.04, 1);
  });
  test("verdict thresholds at 6 and 15 dB", () => {
    expect(verdict(5.99)).toBe("echo is cancelled");
    expect(verdict(6)).toBe("partly cancelled");
    expect(verdict(15)).toBe("partly cancelled");
    expect(verdict(15.01)).toBe("not cancelled");
  });
});
