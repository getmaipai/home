import { describe, expect, test } from "bun:test";
import { waitForAnimationSettle } from "./animationSettle";

describe("waitForAnimationSettle", () => {
  test("waits for running animations and a stable quiet window", async () => {
    let time = 0;
    const running = [2, 1, 0, 0, 0, 0];
    await waitForAnimationSettle(async () => running.shift() ?? 0, {
      timeoutMs: 500,
      stableMs: 50,
      pollMs: 25,
      now: () => time,
      sleep: async (ms) => { time += ms; },
    });
    expect(time).toBeGreaterThanOrEqual(50);
  });

  test("reports a bounded timeout with the remaining animation count", async () => {
    let time = 0;
    await expect(waitForAnimationSettle(async () => 3, {
      timeoutMs: 75,
      stableMs: 50,
      pollMs: 25,
      now: () => time,
      sleep: async (ms) => { time += ms; },
    })).rejects.toThrow("animations did not settle within 75ms (3 still running)");
    expect(time).toBe(75);
  });
});
