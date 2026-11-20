import { expect, test } from "bun:test";
import { BurstFilter } from "../src/burstFilter";
const SPEECH = "pid=7328 40% /usr/local/maipai-home/stack/data/engines/mlx-audio/0.5.9/venv/bin/python";
const VIDEO = "pid=99 70% /Users/x/video-bench/ltx25-new/src/.venv/bin/python generate.py";
test("a single short hub speech burst keeps the window free and is counted", () => {
  const f = new BurstFilter(); let t = 0;
  expect(f.push((t += 5000), []).free).toBe(true);
  expect(f.push((t += 5000), [SPEECH])).toEqual({ free: true, burst: true });
  expect(f.push((t += 5000), []).free).toBe(true);
  f.finish(t); expect(f.summary().count).toBe(1);
});
test("a sustained speech load (10 s or more) blocks like any engine", () => {
  const f = new BurstFilter(); let t = 0; const r = [f.push((t += 5000), [SPEECH]), f.push((t += 5000), [SPEECH]), f.push((t += 5000), [SPEECH])];
  expect(r[0]!.free).toBe(true); expect(r[2]!.free).toBe(false);
});
test("a video or other engine always blocks, alone or together with a speech burst", () => {
  const f = new BurstFilter(); let t = 0;
  expect(f.push((t += 5000), [VIDEO]).free).toBe(false);
  expect(f.push((t += 5000), [SPEECH, VIDEO]).free).toBe(false);
});
