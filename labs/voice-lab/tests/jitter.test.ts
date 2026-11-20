import { expect, test } from "bun:test";
import { JitterGate, replay } from "../public/jitter.js";

const frames = (spec: Array<[number, number]>) => spec.map(([at, sec]) => ({ at, sec }));

test("steady audio starts after the small start buffer and has no gaps", () => {
  const f = frames(Array.from({ length: 40 }, (_, i) => [i * 40, 0.16] as [number, number]));
  const r = replay(f, new JitterGate());
  expect(r.gaps).toBe(0);
  expect(r.startAt! - f[0]!.at).toBeLessThanOrEqual(60);
});

test("a late burst is a gap the first time, then the buffer grows so the same jitter is absorbed", () => {
  const gate = new JitterGate();
  // 100 ms frames every 50 ms with a 400 ms stall every 10 frames
  const mk = () => { let at = 0; const out: Array<[number, number]> = []; for (let i = 0; i < 60; i++) { at += i % 10 === 9 ? 700 : 90; out.push([at, 0.1]); } return frames(out); };
  const first = replay(mk(), gate);
  expect(first.gaps).toBeGreaterThan(0);
  expect(gate.targetMs).toBeGreaterThan(200);
  const second = replay(mk(), gate);
  expect(second.gaps).toBeLessThanOrEqual(first.gaps);
});

test("the end of a reply never counts as an underrun and short tails still play", () => {
  const gate = new JitterGate();
  const r = replay(frames([[0, 0.2], [30, 0.2], [60, 0.03]]), gate);
  expect(r.gaps).toBe(0);
  expect(gate.underruns).toBe(0);
});

test("target eases back after clean turns and never goes below the minimum", () => {
  const gate = new JitterGate(); gate.targetMs = 400;
  for (let i = 0; i < 30; i++) gate.cleanTurn();
  expect(gate.targetMs).toBe(160);
});
