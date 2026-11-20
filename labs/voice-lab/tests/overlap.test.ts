import { expect, test } from "bun:test";
import { OverlapDetector, shouldStopLocally, isBriefOverlap } from "../public/overlap.js";

const frame = (amp: number) => Float32Array.from({ length: 512 }, (_, i) => amp * Math.sin(i * 0.4));
test("residue after echo cancelling is not overlap; a person talking over her is, and the count restarts after a real pause", () => {
  const d = new OverlapDetector(); let ms = 0;
  for (let i = 0; i < 60; i++) ms = d.frame(frame(0.003), { playing: true });
  expect(ms).toBe(0);
  for (let i = 0; i < 22; i++) ms = d.frame(frame(0.05), { playing: true });   // about 700 ms of speech
  expect(ms).toBeGreaterThanOrEqual(650);
  for (let i = 0; i < 6; i++) ms = d.frame(frame(0.003), { playing: true });   // a pause of ~190 ms
  expect(ms).toBe(0);
});
test("a short mm-hm burst stays short and nothing counts while she is not playing", () => {
  const d = new OverlapDetector(); let ms = 0;
  for (let i = 0; i < 8; i++) ms = d.frame(frame(0.05), { playing: true });
  expect(ms).toBeLessThan(300);
  expect(d.frame(frame(0.2), { playing: false })).toBe(0);
});

test("brief overlap (both talking for a moment) never stops her on the device; a clear interruption does, once", () => {
  expect(shouldStopLocally(300, { playing: true, alreadySent: false })).toBe(false);
  expect(isBriefOverlap(300)).toBe(true); expect(isBriefOverlap(100)).toBe(false); expect(isBriefOverlap(700)).toBe(false);
  expect(shouldStopLocally(700, { playing: true, alreadySent: false })).toBe(true);
  expect(shouldStopLocally(900, { playing: true, alreadySent: true })).toBe(false);   // only once
  expect(shouldStopLocally(900, { playing: false, alreadySent: false })).toBe(false); // nothing is playing
});
