import { describe, expect, test } from "bun:test";
import { waitForAnimationSettle } from "./animationSettle";

describe("waitForAnimationSettle", () => {
  test("waits for animations to finish and remain quiet", async () => {
    let now = 0;
    let reads = 0;
    const counts = [2, 1, 0, 0, 0];

    await waitForAnimationSettle(
      async () => counts[reads++] ?? 0,
      async (ms) => { now += ms; },
      { quietMs: 50, pollMs: 25, timeoutMs: 500, now: () => now },
    );

    expect(reads).toBe(5);
    expect(now).toBe(100);
  });

  test("reports the last active count when its bounded wait expires", async () => {
    let now = 0;

    await expect(
      waitForAnimationSettle(
        async () => 1,
        async (ms) => { now += ms; },
        { timeoutMs: 60, quietMs: 50, pollMs: 25, now: () => now },
      ),
    ).rejects.toThrow("timed out after 60ms with 1 animation(s) still running or pending");
  });

  test("caps a stalled animation-state read", async () => {
    await expect(
      waitForAnimationSettle(
        () => new Promise<number>(() => {}),
        async () => {},
        { timeoutMs: 20 },
      ),
    ).rejects.toThrow("timed out after 20ms");
  });
});
