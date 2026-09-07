// getmaipai/home#63: a live diagnosis (2026-09-07) measured the memory
// judge's own extraction call adding 2 to 4.7 seconds to a chat reply
// that started while the judge was mid-batch - runJudgeBatch() only
// checked turnActiveWithin() once, at the top of a ten-turn batch.
// These are the direct unit tests for the fix's own primitive: a turn
// still in flight (not just recently STARTED) blocks background work,
// and a finished turn's own cooldown is measured from when it ended.
import { describe, expect, test, beforeEach } from "bun:test";
import { markTurnStarted, markTurnFinished, turnActiveWithin, __resetTurnActivityForTests } from "@/lib/turnActivity";

beforeEach(() => {
  __resetTurnActivityForTests();
});

describe("turnActiveWithin()", () => {
  test("false before any turn has ever started (the safe default right after a restart)", () => {
    expect(turnActiveWithin(20_000)).toBe(false);
  });

  test("true the instant a turn starts", () => {
    markTurnStarted();
    expect(turnActiveWithin(20_000)).toBe(true);
  });

  test("a turn still in flight blocks background work regardless of the window size - there is no 'quiet' reading of a reply still streaming", () => {
    markTurnStarted();
    expect(turnActiveWithin(0)).toBe(true);
  });

  test("finishing a turn keeps the household 'recently active' for the cooldown window, not just while it was streaming", () => {
    markTurnStarted();
    markTurnFinished();
    expect(turnActiveWithin(20_000)).toBe(true); // just finished, still inside the window
    expect(turnActiveWithin(-1)).toBe(false); // a negative window is always expired, proving this isn't the unconditional in-flight branch
  });

  test("a second in-flight turn is not falsely cleared by the first one finishing", () => {
    markTurnStarted(); // turn A
    markTurnStarted(); // turn B, still running
    markTurnFinished(); // A finishes
    expect(turnActiveWithin(0)).toBe(true); // B is still in flight
  });

  test("markTurnFinished() without a matching start never underflows into a false negative later", () => {
    markTurnFinished(); // no corresponding markTurnStarted()
    markTurnStarted();
    markTurnFinished();
    expect(turnActiveWithin(0)).toBe(false); // both real turns are done, nothing in flight
  });
});
