import { describe, expect, test } from "bun:test";
import { tryConsume, __resetRateLimiterForTests, __setRateLimiterClockForTests } from "@/lib/rateLimiter";

// The limiter is a module singleton; isolate buckets and fake clocks.
import { beforeEach } from "bun:test";
beforeEach(() => __resetRateLimiterForTests());

describe("rateLimiter", () => {
  describe("tryConsume", () => {
    test("a key with available tokens consumes one and returns true", () => {
      expect(tryConsume("my-host", { capacity: 5, refillPerSecond: 1 })).toBe(true);
    });

    test("an empty key is still treated as a valid bucket and consumes if tokens exist", () => {
      expect(tryConsume("", { capacity: 5, refillPerSecond: 1 })).toBe(true);
    });

    test("a bucket with zero available tokens refuses to consume", () => {
      for (let i = 0; i < 5; i++) {
        expect(tryConsume("exhausted-host", { capacity: 5, refillPerSecond: 1 })).toBe(true);
      }
      expect(tryConsume("exhausted-host", { capacity: 5, refillPerSecond: 1 })).toBe(false);
    });

    test("a bucket with exactly one token available consumes it and returns true", () => {
      expect(tryConsume("one-token-host", { capacity: 1, refillPerSecond: 1 })).toBe(true);
    });

    test("a bucket that has been fully consumed will not consume again until time passes", () => {
      expect(tryConsume("fresh-host", { capacity: 1, refillPerSecond: 1 })).toBe(true);
      expect(tryConsume("fresh-host", { capacity: 1, refillPerSecond: 1 })).toBe(false);
    });

    test("a negative capacity bucket starts with zero tokens and always refuses", () => {
      expect(tryConsume("neg-capacity-host", { capacity: -1, refillPerSecond: 1 })).toBe(false);
    });

    test("a negative refillPerSecond does not cause token replenishment", () => {
      // Negative refillPerSecond means tokens never increase (elapsedSeconds * negative = negative,
      // but Math.max(0, ...) clamps to 0, so tokens stay the same).
      // With capacity=5, five calls are needed to exhaust the bucket.
      expect(tryConsume("neg-refill-host", { capacity: 5, refillPerSecond: -1 })).toBe(true);
      expect(tryConsume("neg-refill-host", { capacity: 5, refillPerSecond: -1 })).toBe(true);
      expect(tryConsume("neg-refill-host", { capacity: 5, refillPerSecond: -1 })).toBe(true);
      expect(tryConsume("neg-refill-host", { capacity: 5, refillPerSecond: -1 })).toBe(true);
      expect(tryConsume("neg-refill-host", { capacity: 5, refillPerSecond: -1 })).toBe(true);
      expect(tryConsume("neg-refill-host", { capacity: 5, refillPerSecond: -1 })).toBe(false);
    });

    test("a zero capacity bucket always refuses", () => {
      expect(tryConsume("zero-cap-host", { capacity: 0, refillPerSecond: 1 })).toBe(false);
    });

    test("a very large capacity allows many consecutive consumptions", () => {
      for (let i = 0; i < 100; i++) {
        expect(tryConsume("big-burst-host", { capacity: 100, refillPerSecond: 1 })).toBe(true);
      }
      expect(tryConsume("big-burst-host", { capacity: 100, refillPerSecond: 1 })).toBe(false);
    });

    test("a fractional capacity less than 1 yields zero tokens and always refuses", () => {
      expect(tryConsume("frac-cap-host", { capacity: 0.5, refillPerSecond: 1 })).toBe(false);
    });

    test("a fractional capacity >= 1 allows consumption", () => {
      expect(tryConsume("frac-cap-host-2", { capacity: 1.5, refillPerSecond: 1 })).toBe(true);
    });

    test("a zero refillPerSecond bucket never replenishes but still has its initial burst", () => {
      expect(tryConsume("no-refill-host", { capacity: 3, refillPerSecond: 0 })).toBe(true);
      expect(tryConsume("no-refill-host", { capacity: 3, refillPerSecond: 0 })).toBe(true);
      expect(tryConsume("no-refill-host", { capacity: 3, refillPerSecond: 0 })).toBe(true);
      expect(tryConsume("no-refill-host", { capacity: 3, refillPerSecond: 0 })).toBe(false);
    });

    test("a zero capacity and zero refillPerSecond bucket always refuses", () => {
      expect(tryConsume("zero-zero-host", { capacity: 0, refillPerSecond: 0 })).toBe(false);
    });
  });

  describe("__resetRateLimiterForTests", () => {
    test("resets the internal state so tests start with full tokens", () => {
      __resetRateLimiterForTests();
      expect(tryConsume("my-host", { capacity: 5, refillPerSecond: 1 })).toBe(true);
    });

    test("subsequent resets are idempotent", () => {
      __resetRateLimiterForTests();
      __resetRateLimiterForTests();
      __resetRateLimiterForTests();
      expect(tryConsume("my-host", { capacity: 5, refillPerSecond: 1 })).toBe(true);
    });
  });

  describe("__setRateLimiterClockForTests", () => {
    test("setting a future clock time advances the bucket", () => {
      __resetRateLimiterForTests();
      __setRateLimiterClockForTests(() => 2_000);
      expect(tryConsume("my-host", { capacity: 1, refillPerSecond: 1 }, 0)).toBe(true);
    });

    test("setting a past clock time does not replenish tokens", () => {
      __setRateLimiterClockForTests(() => 0);
      expect(tryConsume("my-host", { capacity: 1, refillPerSecond: 1 }, 0)).toBe(true);
      expect(tryConsume("my-host", { capacity: 1, refillPerSecond: 1 }, -1_000)).toBe(false);
    });

    test("setting a clock time in the future allows consumption after waiting", () => {
      __setRateLimiterClockForTests(() => 0);
      expect(tryConsume("my-host", { capacity: 1, refillPerSecond: 1 }, 0)).toBe(true);
      expect(tryConsume("my-host", { capacity: 1, refillPerSecond: 1 }, 1_000)).toBe(true);
    });

    test("setting the clock to the current time behaves like no-op", () => {
      __resetRateLimiterForTests();
      expect(tryConsume("my-host", { capacity: 1, refillPerSecond: 1 })).toBe(true);
    });
  });
});
