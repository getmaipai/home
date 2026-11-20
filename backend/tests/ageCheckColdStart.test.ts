// COLD-CHECK-01: the picture check waits for its reader to start before the per-image timers run (measured 2026-11-20: a cold vision load took about 24 s against a 20 s
// deadline, so the first check after a quiet spell failed closed). The wait is bounded; a reader that never starts gives the same withhold as before; a warm reader adds
// no wait; nothing is ever passed without a verdict.
import { afterEach, describe, expect, test } from "bun:test";
import { __setReaderWaitForTests, waitForPictureReader, type ReaderWaitDeps } from "@/lib/pictures/ageCheck";

type Row = { id: string; state: { state: string }; model: { id: string; imageInput: boolean } };
const row = (state: string, id = "vision"): Row => ({ id, state: { state }, model: { id: `${id}-model`, imageInput: true } });

/** A scripted Stack on a fake clock: the reader's state is `state(t)`; each sleep moves the clock. */
function scripted(state: (seconds: number) => string, id = "vision") {
  let at = 0; const asked: string[] = []; const sleeps: number[] = [];
  const deps: ReaderWaitDeps = {
    roles: async () => ({ roles: [row(state(at / 1000), id)] }),
    ask: async (modelId) => { asked.push(modelId); },
    sleep: async (ms) => { sleeps.push(ms); at += ms; },
    now: () => at,
  };
  return { deps, asked, sleeps, seconds: () => at / 1000 };
}
afterEach(() => { __setReaderWaitForTests(null); });

describe("waitForPictureReader", () => {
  test("a warm reader adds no wait and asks nothing", async () => {
    for (const warm of ["ready", "busy"]) {
      const s = scripted(() => warm);
      expect(await waitForPictureReader("vision", s.deps)).toBe(true);
      expect(s.sleeps).toEqual([]); expect(s.asked).toEqual([]);
    }
  });
  test("a reader that is ready after 25 s is waited for, asked once to start, and then passes", async () => {
    const s = scripted((t) => (t < 25 ? "installed" : "ready"));
    expect(await waitForPictureReader("vision", s.deps)).toBe(true);
    expect(s.asked).toEqual(["vision-model"]);          // asked once, with the id the Stack named
    expect(s.seconds()).toBeGreaterThanOrEqual(25); expect(s.seconds()).toBeLessThan(27);
    expect(Math.max(...s.sleeps)).toBeLessThanOrEqual(1000); // a once-a-second look, no longer
  });
  test("a reader that is already loading is waited for and not asked again", async () => {
    const s = scripted((t) => (t < 6 ? "loading" : "ready"));
    expect(await waitForPictureReader("vision", s.deps)).toBe(true);
    expect(s.asked).toEqual([]);
  });
  test("a reader that is never ready within 60 s is given up on at 60 s: false", async () => {
    const s = scripted(() => "installed");
    expect(await waitForPictureReader("vision", s.deps)).toBe(false);
    expect(s.asked).toEqual(["vision-model"]);
    expect(s.seconds()).toBeGreaterThanOrEqual(60); expect(s.seconds()).toBeLessThan(62);
  });
  test("a Stack that cannot be read does not make the check wait: the check runs as before and decides", async () => {
    const deps: ReaderWaitDeps = { roles: async () => { throw new Error("down"); }, ask: async () => {}, sleep: async () => { throw new Error("must not sleep"); }, now: () => 0 };
    expect(await waitForPictureReader("vision", deps)).toBe(true);
  });
});
