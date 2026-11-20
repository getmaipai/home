import { expect, test } from "bun:test";
import { stopPlan } from "../public/word-end.js";
import { TurnState } from "../public/turn-state.js";

const rate = 24000;
const tone = (ms: number) => Float32Array.from({ length: rate * ms / 1000 }, (_, i) => 0.3 * Math.sin(i * 0.3));
test("a stop makes her silent within the cap, even with seconds of audio already queued and no gap between words", () => {
  const queued = tone(6000);                                   // six seconds already waiting in the playback buffer, one unbroken word
  const plan = stopPlan(queued, 24000, rate);
  expect(plan.totalMs).toBeLessThanOrEqual(450 + 25);          // finish-the-word is capped, then the fade
  expect(plan.clearAfterMs).toBeLessThanOrEqual(450 + 30);     // and the queue is thrown away right after
});
test("with a gap between words she finishes the word and no more; with finish-the-word off she fades at once", () => {
  const a = tone(200), gap = new Float32Array(rate * 0.1), b = tone(3000);
  const queued = Float32Array.from([...a, ...gap, ...b]);
  const plan = stopPlan(queued, 2400, rate);                   // 100 ms into the first word
  expect(plan.waitMs).toBeLessThan(200);
  expect(stopPlan(queued, 2400, rate, { finishWord: false }).totalMs).toBe(25);
});
test("audio of a stopped turn that arrives late is refused, so nothing from it can start again", () => {
  const t = new TurnState(); expect(t.accepts(5)).toBe(true); expect(t.stop(5)).toBe(true);
  expect(t.accepts(5)).toBe(false); expect(t.accepts(4)).toBe(false); expect(t.accepts(6)).toBe(true);
});
