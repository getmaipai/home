import { describe, expect, test, beforeEach } from "bun:test";
import { tryConsume, __resetRateLimiterForTests } from "@/lib/rateLimiter";

beforeEach(() => {
  __resetRateLimiterForTests();
});

describe("tryConsume", () => {
  test("allows up to capacity calls in a burst, then refuses", () => {
    const opts = { capacity: 3, refillPerSecond: 0.001 }; // negligible refill within the test's own runtime
    expect(tryConsume("host-a", opts)).toBe(true);
    expect(tryConsume("host-a", opts)).toBe(true);
    expect(tryConsume("host-a", opts)).toBe(true);
    expect(tryConsume("host-a", opts)).toBe(false);
  });

  test("a different key has its own independent bucket", () => {
    const opts = { capacity: 1, refillPerSecond: 0.001 };
    expect(tryConsume("host-a", opts)).toBe(true);
    expect(tryConsume("host-a", opts)).toBe(false); // host-a's bucket is empty
    expect(tryConsume("host-b", opts)).toBe(true); // host-b's own bucket is untouched
  });

  test("refills over real time, up to the capacity ceiling", async () => {
    const opts = { capacity: 1, refillPerSecond: 20 }; // one token every 50ms
    expect(tryConsume("host-c", opts)).toBe(true);
    expect(tryConsume("host-c", opts)).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(tryConsume("host-c", opts)).toBe(true);
  });

  // Observed flaky (2026-09-06) when the full suite runs under real
  // system load (many other files' real subprocess-spawning tests
  // competing for CPU at the same time): the original version used
  // refillPerSecond: 1000 (one token every 1ms), so as little as a few
  // milliseconds of scheduling jitter between the four tryConsume() calls
  // below could tip the bucket over into an accidental 3rd token,
  // failing the final assertion despite the clamp logic itself being
  // correct. Slower rate (50ms/token) and a longer sleep give the same
  // proof - "would refill way past capacity if unclamped" - with a
  // jitter margin two orders of magnitude wider than a real test runner
  // ever needs.
  test("never refills past capacity even after a long idle gap", async () => {
    const opts = { capacity: 2, refillPerSecond: 20 }; // would refill ~10 tokens in 500ms if unclamped
    expect(tryConsume("host-d", opts)).toBe(true);
    expect(tryConsume("host-d", opts)).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(tryConsume("host-d", opts)).toBe(true); // capped at capacity=2, not the unclamped ~10
    expect(tryConsume("host-d", opts)).toBe(true); // the 2nd of exactly 2 available tokens
    expect(tryConsume("host-d", opts)).toBe(false); // and no 3rd - proves the cap, not just "some refill happened"
  });
});
