import { expect, test } from "bun:test";
import { FreeWindow } from "../src/gpuLoad";

test("a run starts only after 60 s of continuous free GPU; a busy blip restarts the clock", () => {
  const w = new FreeWindow(60_000); let t = 0; const at = (free: boolean) => w.push((t += 5000), free);
  for (let i = 0; i < 11; i++) expect(at(true).start).toBe(false);   // 55 s free: not yet
  expect(at(false).start).toBe(false);                               // a job appears: clock resets
  for (let i = 0; i < 12; i++) expect(at(true).start).toBe(false);   // 55 s of continuous freedom so far
  expect(at(true).start).toBe(true);                                 // 60 s continuous
});
test("a job appearing during a run aborts it (not a failure) and the wait starts over", () => {
  const w = new FreeWindow(10_000); let t = 0; const at = (free: boolean) => w.push((t += 5000), free);
  at(true); at(true); expect(at(true).start).toBe(true);
  expect(at(true).abort).toBe(false);
  expect(at(false).abort).toBe(true);                                // aborted
  expect(at(true).start).toBe(false);                                // must wait the full window again
  at(true); expect(at(true).start).toBe(true);
});
