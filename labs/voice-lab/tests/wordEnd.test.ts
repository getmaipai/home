import { expect, test } from "bun:test";
import { wordEnd } from "../public/word-end.js";
const sr = 24000;
const tone = (ms: number, amp: number) => Array.from({ length: Math.round(sr * ms / 1000) }, (_, i) => amp * Math.sin(i * 0.2));
test("stops at the gap after the word being spoken", () => {
  const s = [...tone(400, 0.3), ...tone(80, 0.001), ...tone(400, 0.3)];
  const at = wordEnd(s, Math.round(sr * 0.2), sr);
  expect(at).toBeGreaterThanOrEqual(Math.round(sr * 0.4));
  expect(at).toBeLessThan(Math.round(sr * 0.48));
});
test("stops at once when the voice is already between words", () => {
  const s = [...tone(300, 0.3), ...tone(200, 0.001), ...tone(300, 0.3)];
  const from = Math.round(sr * 0.35);
  expect(wordEnd(s, from, sr) - from).toBeLessThan(Math.round(sr * 0.03));
});
test("never waits longer than the limit when there is no gap", () => {
  const s = tone(2000, 0.3); const from = Math.round(sr * 0.5);
  expect(wordEnd(s, from, sr, 450) - from).toBeLessThanOrEqual(Math.round(sr * 0.45));
});
test("stops at the end of what has arrived when little audio is left", () => {
  const s = tone(100, 0.3);
  expect(wordEnd(s, s.length - 10, sr)).toBe(s.length);
});
