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

  test("never refills past capacity even after a long idle gap", async () => {
    const opts = { capacity: 2, refillPerSecond: 1000 }; // would refill far past capacity if unclamped
    expect(tryConsume("host-d", opts)).toBe(true);
    expect(tryConsume("host-d", opts)).toBe(true);
    await new Promise((r) => setTimeout(r, 50)); // long enough to refill hundreds of tokens if unclamped
    expect(tryConsume("host-d", opts)).toBe(true); // capped at capacity=2, not the unclamped ~50
    expect(tryConsume("host-d", opts)).toBe(true); // the 2nd of exactly 2 available tokens
    expect(tryConsume("host-d", opts)).toBe(false); // and no 3rd - proves the cap, not just "some refill happened"
  });
});
