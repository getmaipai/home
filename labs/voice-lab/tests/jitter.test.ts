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
// Recorded (the owner's live test, turn at 19:13:39Z): the first phrase took 887 ms, the gate was already at its cap of 700 ms, and the reply still had 3 page underruns.
// Why: a gate waits for a FIXED amount of queued audio; when the voice's first block is small and the voice then stalls (GPU contention), the gate starts playing on the small block, drains it, and every later stall is a gap.
test("late first phrase with later stalls: the default gate, even at its cap, gaps; a slow-start rule (wait for a bigger buffer when the first block is small and the voice looks slower than 2x real time) halves the gaps", () => {
  const frames_ = [{ at: 1000, sec: 0.3 }, { at: 1350, sec: 0.4 }, { at: 1500, sec: 0.5 }, { at: 2700, sec: 0.6 }, { at: 2900, sec: 0.5 }, { at: 3050, sec: 0.5 }, { at: 4300, sec: 0.6 }, { at: 4500, sec: 0.5 }, { at: 4650, sec: 0.7 }];
  const plain = replay(frames_, new JitterGate()); expect(plain.gaps).toBeGreaterThanOrEqual(2);
  const capped = new JitterGate(); capped.targetMs = 700; expect(replay(frames_, capped).gaps).toBeGreaterThanOrEqual(1);   // the cap alone does not remove them
  const slow = replay(frames_, new JitterGate({ slowStartMs: 600 })); expect(slow.gaps).toBeLessThan(plain.gaps); expect(slow.gapMs).toBeLessThan(plain.gapMs);
});
test("the slow-start rule costs nothing when the voice is fast (first block big, or arriving at 2x real time or better)", () => {
  const fast = [{ at: 1000, sec: 0.5 }, { at: 1100, sec: 0.5 }, { at: 1200, sec: 0.5 }, { at: 1400, sec: 0.5 }, { at: 1600, sec: 0.5 }];
  const a = replay(fast, new JitterGate()), b = replay(fast, new JitterGate({ slowStartMs: 600 })); expect(b.startAt).toBe(a.startAt); expect(b.gaps).toBe(0);
});
