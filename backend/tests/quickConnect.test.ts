import { describe, expect, test, beforeEach } from "bun:test";
import {
  createQuickConnect,
  approveQuickConnect,
  consumeQuickConnect,
  isQuickConnectPending,
  recordQuickConnectWrongGuess,
  __resetQuickConnectForTests,
} from "@/lib/quickConnect";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";

beforeEach(() => {
  __resetQuickConnectForTests();
  __resetRateLimiterForTests();
});

describe("createQuickConnect()", () => {
  test("returns a 6-character code with no 0/O/1/I, and a separate poll_token", () => {
    const req = createQuickConnect("192.0.2.1", "Living room TV", "tv");
    expect(req).not.toBeNull();
    expect(req!.code).toHaveLength(6);
    expect(req!.code).not.toMatch(/[0O1I]/);
    expect(req!.pollToken).not.toBe(req!.code);
    expect(req!.pollToken.length).toBeGreaterThan(10);
  });

  test("null once the rate limit is exhausted", () => {
    let sawNull = false;
    for (let i = 0; i < 100; i++) {
      if (createQuickConnect("192.0.2.1", "TV", "tv") === null) {
        sawNull = true;
        break;
      }
    }
    expect(sawNull).toBe(true);
  });
});

describe("the approve -> poll flow", () => {
  test("a code alone cannot redeem the session - only the matching poll_token can", () => {
    const req = createQuickConnect("192.0.2.1", "Living room TV", "tv")!;
    expect(approveQuickConnect(req.code, "person-abc123")).toBe(true);

    // The code itself is not a valid poll_token - someone who only saw
    // the code on the TV screen cannot steal the approved session.
    expect(consumeQuickConnect(req.code, "192.0.2.1")).toBeNull();
    expect(consumeQuickConnect(req.pollToken, "192.0.2.1")).toEqual({ personId: "person-abc123", kind: "tv", label: "Living room TV", capabilities: [] });
  });

  test("consumed exactly once - a second poll gets nothing", () => {
    const req = createQuickConnect("192.0.2.1", "Living room TV", "tv")!;
    approveQuickConnect(req.code, "person-abc123");

    expect(consumeQuickConnect(req.pollToken, "192.0.2.1")).not.toBeNull();
    expect(consumeQuickConnect(req.pollToken, "192.0.2.1")).toBeNull();
  });

  test("approving twice fails the second time", () => {
    const req = createQuickConnect("192.0.2.1", "Living room TV", "tv")!;
    expect(approveQuickConnect(req.code, "person-abc123")).toBe(true);
    expect(approveQuickConnect(req.code, "person-def456")).toBe(false);
  });

  test("poll address buckets do not turn a rate limit into an expired token", () => {
    const req = createQuickConnect("192.0.2.1", "Living room TV", "tv")!;
    let last: unknown;
    for (let i = 0; i < 61; i++) last = consumeQuickConnect(req.pollToken, "192.0.2.1");
    expect(last).toEqual({ rateLimited: true });
    expect(consumeQuickConnect(req.pollToken, "192.0.2.2")).toBeNull();
  });

  test("an unknown code cannot be approved", () => {
    expect(approveQuickConnect("ZZZZZZ", "person-abc123")).toBe(false);
  });

  test("five wrong guesses lock only that code with the same refusal as a wrong code", () => {
    const a = createQuickConnect("192.0.2.1", "A TV", "tv")!;
    const b = createQuickConnect("192.0.2.1", "B TV", "tv")!;
    for (let i = 0; i < 5; i++) recordQuickConnectWrongGuess(a.code, "192.0.2.1");
    expect(approveQuickConnect(a.code, "person-abc123", "192.0.2.2")).toBe(false);
    expect(approveQuickConnect(b.code, "person-abc123", "192.0.2.2")).toBe(true);
  });

  test("ten wrong guesses lock their source but not another source", () => {
    const req = createQuickConnect("192.0.2.1", "TV", "tv")!;
    const other = createQuickConnect("192.0.2.2", "Other TV", "tv")!;
    for (let i = 0; i < 10; i++) recordQuickConnectWrongGuess("ZZZZZZ", "192.0.2.1");
    expect(approveQuickConnect(req.code, "person-abc123", "192.0.2.1")).toBe(false);
    expect(approveQuickConnect(other.code, "person-abc123", "192.0.2.2")).toBe(true);
  });

  test("wrong-guess lock state is swept when its code expires", () => {
    const req = createQuickConnect("192.0.2.1", "TV", "tv")!;
    for (let i = 0; i < 5; i++) recordQuickConnectWrongGuess(req.code, "192.0.2.1");
    req.expiresAt = Date.now() - 1;
    expect(approveQuickConnect("ZZZZZZ", "person-abc123", "192.0.2.2")).toBe(false);
  });

  test("refusals do not reveal the code", () => {
    const req = createQuickConnect("192.0.2.1", "TV", "tv")!;
    const answers: unknown[] = [];
    for (let i = 0; i < 5; i++) recordQuickConnectWrongGuess(req.code, "192.0.2.1");
    answers.push(approveQuickConnect(req.code, "person-abc123", "192.0.2.1"));
    expect(JSON.stringify(answers)).not.toContain(req.code);
  });
});

describe("isQuickConnectPending()", () => {
  test("true before approval, false after consumption, false for an unknown token", () => {
    const req = createQuickConnect("192.0.2.1", "Living room TV", "tv")!;
    expect(isQuickConnectPending(req.pollToken)).toBe(true);

    approveQuickConnect(req.code, "person-abc123");
    // Still "pending" from the poller's point of view until it actually consumes.
    expect(isQuickConnectPending(req.pollToken)).toBe(false);

    consumeQuickConnect(req.pollToken, "192.0.2.1");
    expect(isQuickConnectPending(req.pollToken)).toBe(false);
    expect(isQuickConnectPending("unknown-poll-token")).toBe(false);
  });
});
