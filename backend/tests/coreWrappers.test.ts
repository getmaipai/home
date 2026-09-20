import { describe, expect, test } from "bun:test";

describe("core wrapper instances", () => {
  test("one clock for every caller", async () => {
    const first = await import("@/lib/hlc");
    const second = await import("@/lib/hlc");
    expect(first.nextHlc).toBe(second.nextHlc);
  });

  test("one clock stays monotonic across importers", async () => {
    const first = await import("@/lib/hlc");
    const second = await import("@/lib/hlc");
    first.__resetHlcForTests();
    const before = first.nextHlc();
    const after = second.nextHlc();
    expect(second.compareHlc(after, before)).toBeGreaterThan(0);
  });

  test("one sign-in throttle for every caller", async () => {
    const first = await import("@/lib/secretThrottle");
    const second = await import("@/lib/secretThrottle");
    expect(first.throttleCheck).toBe(second.throttleCheck);
    expect(first.throttleFail).toBe(second.throttleFail);
  });

  test("one sign-in throttle counts failures across importers", async () => {
    const first = await import("@/lib/secretThrottle");
    const second = await import("@/lib/secretThrottle");
    first.__resetThrottleForTests();
    for (let i = 0; i < 20; i += 1) first.throttleFail("core-wrapper-test");
    expect(second.throttleCheck("core-wrapper-test").blocked).toBe(true);
  });

  test("one rate limiter for every caller", async () => {
    const first = await import("@/lib/rateLimiter");
    const second = await import("@/lib/rateLimiter");
    expect(first.tryConsume).toBe(second.tryConsume);
    expect(first.__resetRateLimiterForTests).toBe(second.__resetRateLimiterForTests);
  });

  test("one rate limiter spends a token across importers", async () => {
    const first = await import("@/lib/rateLimiter");
    const second = await import("@/lib/rateLimiter");
    first.__resetRateLimiterForTests();
    const options = { capacity: 1, refillPerSecond: 0 };
    expect(first.tryConsume("core-wrapper-test", options, 1_000)).toBe(true);
    expect(second.tryConsume("core-wrapper-test", options, 1_000)).toBe(false);
  });

  test("one logger for every caller", async () => {
    const first = await import("@/lib/log");
    const second = await import("@/lib/log");
    expect(first.appendLogLine).toBe(second.appendLogLine);
    expect(first.installConsoleFileMirror).toBe(second.installConsoleFileMirror);
  });

  test("one logger exposes one shared sink", async () => {
    const first = await import("@/lib/log");
    const second = await import("@/lib/log");
    expect(first.appendLogLine).toBe(second.appendLogLine);
  });
});
