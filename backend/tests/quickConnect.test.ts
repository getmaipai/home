import { describe, expect, test, beforeEach } from "bun:test";
import {
  createQuickConnect,
  approveQuickConnect,
  consumeQuickConnect,
  isQuickConnectPending,
  __resetQuickConnectForTests,
} from "@/lib/quickConnect";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";

beforeEach(() => {
  __resetQuickConnectForTests();
  __resetRateLimiterForTests();
});

describe("createQuickConnect()", () => {
  test("returns a 6-character code with no 0/O/1/I, and a separate poll_token", () => {
    const req = createQuickConnect("Living room TV", "tv");
    expect(req).not.toBeNull();
    expect(req!.code).toHaveLength(6);
    expect(req!.code).not.toMatch(/[0O1I]/);
    expect(req!.pollToken).not.toBe(req!.code);
    expect(req!.pollToken.length).toBeGreaterThan(10);
  });

  test("null once the rate limit is exhausted", () => {
    let sawNull = false;
    for (let i = 0; i < 100; i++) {
      if (createQuickConnect("TV", "tv") === null) {
        sawNull = true;
        break;
      }
    }
    expect(sawNull).toBe(true);
  });
});

describe("the approve -> poll flow", () => {
  test("a code alone cannot redeem the session - only the matching poll_token can", () => {
    const req = createQuickConnect("Living room TV", "tv")!;
    expect(approveQuickConnect(req.code, "person-abc123")).toBe(true);

    // The code itself is not a valid poll_token - someone who only saw
    // the code on the TV screen cannot steal the approved session.
    expect(consumeQuickConnect(req.code)).toBeNull();
    expect(consumeQuickConnect(req.pollToken)).toEqual({ personId: "person-abc123", kind: "tv", label: "Living room TV" });
  });

  test("consumed exactly once - a second poll gets nothing", () => {
    const req = createQuickConnect("Living room TV", "tv")!;
    approveQuickConnect(req.code, "person-abc123");

    expect(consumeQuickConnect(req.pollToken)).not.toBeNull();
    expect(consumeQuickConnect(req.pollToken)).toBeNull();
  });

  test("approving twice fails the second time", () => {
    const req = createQuickConnect("Living room TV", "tv")!;
    expect(approveQuickConnect(req.code, "person-abc123")).toBe(true);
    expect(approveQuickConnect(req.code, "person-def456")).toBe(false);
  });

  test("an unknown code cannot be approved", () => {
    expect(approveQuickConnect("ZZZZZZ", "person-abc123")).toBe(false);
  });
});

describe("isQuickConnectPending()", () => {
  test("true before approval, false after consumption, false for an unknown token", () => {
    const req = createQuickConnect("Living room TV", "tv")!;
    expect(isQuickConnectPending(req.pollToken)).toBe(true);

    approveQuickConnect(req.code, "person-abc123");
    // Still "pending" from the poller's point of view until it actually consumes.
    expect(isQuickConnectPending(req.pollToken)).toBe(false);

    consumeQuickConnect(req.pollToken);
    expect(isQuickConnectPending(req.pollToken)).toBe(false);
    expect(isQuickConnectPending("unknown-poll-token")).toBe(false);
  });
});
