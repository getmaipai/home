// getmaipai/home#63: a live diagnosis (2026-09-07) measured the memory
// judge's own extraction call adding 2 to 4.7 seconds to a chat reply
// that started while the judge was mid-batch - runJudgeBatch() only
// checked turnActiveWithin() once, at the top of a ten-turn batch.
// These are the direct unit tests for the fix's own primitive: a turn
// still in flight (not just recently STARTED) blocks background work,
// and a finished turn's own cooldown is measured from when it ended.
//
// CHAT-18: the primitive is a lease. acquireTurnLease() returns an
// idempotent release() scoped to its own turn, so no exit path can
// decrement another turn, and the two-minute timer is a diagnostic, not
// the thing that keeps the count right. Time moves through the clock
// seam, never a real sleep.
import { describe, expect, test, beforeEach } from "bun:test";
import { acquireTurnLease, turnActiveWithin, activeTurnCount, __resetTurnActivityForTests, __setTurnActivityClockForTests, DEFAULT_IDLE_WINDOW_MS } from "@/lib/turnActivity";

let clock = 1_000_000;
const advance = (ms: number) => {
  clock += ms;
};

beforeEach(() => {
  __resetTurnActivityForTests();
  clock = 1_000_000;
  __setTurnActivityClockForTests(() => clock);
});

describe("turnActiveWithin()", () => {
  test("false before any turn has ever started (the safe default right after a restart)", () => {
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(false);
  });

  test("true the instant a turn holds a lease, even before it engages an engine", () => {
    acquireTurnLease();
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(true);
    expect(activeTurnCount()).toBe(1);
  });

  test("a turn still in flight blocks background work regardless of the window size - there is no 'quiet' reading of a reply still streaming", () => {
    const lease = acquireTurnLease();
    lease.engage();
    expect(turnActiveWithin(0)).toBe(true);
  });

  test("finishing an engaged turn keeps the household 'recently active' for the cooldown window, measured from the actual release", () => {
    const lease = acquireTurnLease();
    lease.engage();
    advance(5_000);
    lease.release();
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(true); // just finished, still inside the window
    advance(DEFAULT_IDLE_WINDOW_MS - 1);
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(true); // window counts from the release, not the start
    advance(2);
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(false); // maintenance permitted after the window
  });

  test("a turn that never engaged an engine (a refusal, a command) leaves no cooldown behind once released", () => {
    const lease = acquireTurnLease();
    lease.release();
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(false);
  });

  test("a second in-flight turn is not falsely cleared by the first one finishing", () => {
    const a = acquireTurnLease();
    const b = acquireTurnLease();
    b.engage();
    a.release();
    expect(turnActiveWithin(0)).toBe(true); // B is still in flight
    expect(activeTurnCount()).toBe(1);
  });

  test("an immediate refusal's release cannot release another user's long turn", () => {
    const long = acquireTurnLease();
    long.engage();
    const refusal = acquireTurnLease();
    refusal.release();
    refusal.release(); // and releasing it again changes nothing either
    expect(activeTurnCount()).toBe(1);
    expect(turnActiveWithin(0)).toBe(true);
    long.release();
    expect(activeTurnCount()).toBe(0);
  });

  test("release() is idempotent: a second call is a no-op and never underflows the count", () => {
    const lease = acquireTurnLease();
    lease.engage();
    lease.release();
    expect(lease.released).toBe(true);
    advance(10_000);
    lease.release(); // late second call: no count change, no new finish timestamp
    expect(activeTurnCount()).toBe(0);
    advance(DEFAULT_IDLE_WINDOW_MS - 10_000 - 1);
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(true); // still inside the window from the FIRST release
    advance(2);
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(false); // had the second call re-stamped, this would still be true
  });

  test("engage() after release() does nothing", () => {
    const lease = acquireTurnLease();
    lease.release();
    lease.engage();
    expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(false);
  });

  // Found live 2026-09-11: an in-progress change added a module-level
  // "already released" flag meant to guard one turn against a double
  // release, but the flag was shared across every turn, so after the
  // first turn anywhere finished every later release became a no-op and
  // the count grew without bound. A lease's flag is its own.
  test("a second, later turn still releases after an earlier turn already finished", () => {
    const a = acquireTurnLease();
    a.engage();
    a.release();
    const b = acquireTurnLease();
    b.engage();
    b.release();
    expect(activeTurnCount()).toBe(0);
    expect(turnActiveWithin(0)).toBe(false);
  });

  test("a lease held past two minutes is reported, never cleared: the count stays exact and background work stays gated", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const lease = acquireTurnLease();
      lease.engage();
      advance(120_000);
      expect(turnActiveWithin(0)).toBe(true);
      expect(activeTurnCount()).toBe(1);
      turnActiveWithin(0);
      expect(warnings.length).toBe(1); // once per lease, not once per check
      lease.release();
      expect(activeTurnCount()).toBe(0);
    } finally {
      console.warn = original;
    }
  });
});
