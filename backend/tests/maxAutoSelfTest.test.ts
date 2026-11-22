import { describe, expect, test } from "bun:test";
import { ensureSelfTest } from "@/lib/maxAutoSelfTest";

const fast = { pollMs: 1, maxWaitMs: 50 };

describe("ensureSelfTest", () => {
  test("runs the test when it is the missing step and reports it passed", async () => {
    let starts = 0; let polls = 0;
    const ok = await ensureSelfTest({ ...fast, firstUnmet: async () => (starts === 0 || ++polls < 3 ? "self_test" : null), start: async () => { starts += 1; } });
    expect(ok).toBe(true); expect(starts).toBe(1);
  });
  test("does nothing when another step is missing", async () => {
    let starts = 0;
    expect(await ensureSelfTest({ ...fast, firstUnmet: async () => "engine", start: async () => { starts += 1; } })).toBe(false);
    expect(starts).toBe(0);
  });
  test("gives up when the test never finishes", async () => {
    expect(await ensureSelfTest({ ...fast, firstUnmet: async () => "self_test", start: async () => {} })).toBe(false);
  });
  test("a start failure returns false", async () => {
    expect(await ensureSelfTest({ ...fast, firstUnmet: async () => "self_test", start: async () => { throw new Error("x"); } })).toBe(false);
  });
  test("two callers share one test", async () => {
    let starts = 0; let done = false;
    const deps = { ...fast, firstUnmet: async () => (done ? null : "self_test"), start: async () => { starts += 1; setTimeout(() => { done = true; }, 5); } };
    const [a, b] = await Promise.all([ensureSelfTest(deps), ensureSelfTest(deps)]);
    expect(a && b).toBe(true); expect(starts).toBe(1);
  });
});
