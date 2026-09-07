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

  test("refills over time, up to the capacity ceiling", () => {
    const opts = { capacity: 1, refillPerSecond: 20 }; // one token every 50ms
    const t0 = 1_000_000;
    expect(tryConsume("host-c", opts, t0)).toBe(true);
    expect(tryConsume("host-c", opts, t0)).toBe(false);
    expect(tryConsume("host-c", opts, t0 + 80)).toBe(true); // 80ms elapsed, well past one refill
  });

  // Issue #13: the original version waited on a REAL setTimeout() and
  // asserted an exact token count afterward - under the full suite's
  // real load (scheduler jitter, CPU contention from every other file's
  // own timing), actual elapsed time past the wait could run long enough
  // to refill an extra token before the final tryConsume() call,
  // flaking roughly 1 in 4 full-suite runs. tryConsume()'s own `nowMs`
  // parameter (added for this fix) makes elapsed time exact and
  // deterministic instead - no real timer, no possible jitter, and no
  // margin to guess at.
  test("never refills past capacity even after a long idle gap", () => {
    const opts = { capacity: 2, refillPerSecond: 20 }; // would refill ~10 tokens in 500ms if unclamped
    const t0 = 1_000_000;
    expect(tryConsume("host-d", opts, t0)).toBe(true);
    expect(tryConsume("host-d", opts, t0)).toBe(true);
    expect(tryConsume("host-d", opts, t0 + 500)).toBe(true); // capped at capacity=2, not the unclamped ~10
    expect(tryConsume("host-d", opts, t0 + 500)).toBe(true); // the 2nd of exactly 2 available tokens
    expect(tryConsume("host-d", opts, t0 + 500)).toBe(false); // and no 3rd - proves the cap, not just "some refill happened"
  });
});
