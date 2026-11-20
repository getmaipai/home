import { expect, test } from "bun:test";
import { LevelMatcher, LEVEL } from "../src/levelMatch";
const tone = (n: number, amp: number) => { const x = new Int16Array(n); for (let i = 0; i < n; i++) x[i] = Math.round(Math.sin(i / 7) * amp * 32768); return x; };
const rms = (x: Int16Array) => { let s = 0; for (const v of x) s += (v / 32768) ** 2; return Math.sqrt(s / Math.max(1, x.length)); };
const run = (m: LevelMatcher, x: Int16Array) => { m.startChunk(); const out: Int16Array[] = []; for (let i = 0; i < x.length; i += 2400) out.push(...m.push(x.subarray(i, i + 2400))); out.push(...m.endChunk()); const all = new Int16Array(out.reduce((a, b) => a + b.length, 0)); let o = 0; for (const b of out) { all.set(b, o); o += b.length; } return all; };
test("the first chunk sets the level; a louder later chunk is brought down toward it, a quieter one up, within 6 dB", () => {
  const m = new LevelMatcher(); const first = run(m, tone(24000, 0.1)); expect(rms(first)).toBeCloseTo(rms(tone(24000, 0.1)), 3);
  const loud = run(m, tone(24000, 0.2)); expect(rms(loud.subarray(6000))).toBeLessThan(rms(tone(24000, 0.2)) * 0.7); expect(loud.length).toBe(24000);
  const quiet = run(m, tone(24000, 0.02)); expect(rms(quiet.subarray(6000))).toBeGreaterThan(rms(tone(24000, 0.02)) * 1.8); expect(rms(quiet.subarray(6000))).toBeLessThanOrEqual(rms(tone(24000, 0.02)) * LEVEL.maxGain * 1.05);
});
test("audio is never lost or delayed overall: every sample comes out, and a short chunk is released at its end", () => {
  const m = new LevelMatcher(); run(m, tone(24000, 0.1)); const short = run(m, tone(3000, 0.2)); expect(short.length).toBe(3000);
});
test("the start of a changed chunk ramps instead of jumping", () => {
  const m = new LevelMatcher(); run(m, tone(24000, 0.1)); const x = tone(24000, 0.2); const y = run(m, x);
  const ratio = (i: number) => Math.abs(y[i]!) / Math.max(1, Math.abs(x[i]!)); const peak = (a: number, b: number) => { let r = 0; for (let i = a; i < b; i++) if (Math.abs(x[i]!) > 3000) r = Math.max(r, ratio(i)); return r; };
  expect(peak(0, 300)).toBeGreaterThan(0.9); expect(peak(6000, 8000)).toBeLessThan(0.7);
});
