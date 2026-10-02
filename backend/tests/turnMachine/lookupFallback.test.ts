// THIN-1B (rule 6): direct unit tests of the fixed-line table and of what
// counts as a lookup that did not happen, the same minimal-input style as
// answer.test.ts. The end-to-end rows (search down, zero rows, a mixed
// round, a streamed turn, each age band) live in turnNext.test.ts.
import { describe, expect, test } from "bun:test";
import { lookupMissed, lookupMissedLine, lookupMissedInstruction } from "@/lib/turnMachine/nodes/lookupFallback";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

function outcome(overrides: Partial<ToolExecutionOutcome>): ToolExecutionOutcome {
  return { callId: "test", packageId: "websearch", status: "succeeded", via: "tool_call", ...overrides };
}

/** Only `data` is read by lookupMissed(); the rest of a PluginResult is not built. */
function resultWith(data: Record<string, unknown>): ToolExecutionOutcome["result"] {
  return { data } as unknown as ToolExecutionOutcome["result"];
}

describe("lookupMissedLine: one fixed line per age band", () => {
  test("the adult, teen and child lines are three different sentences", () => {
    const lines = new Set([lookupMissedLine("adult"), lookupMissedLine("teen"), lookupMissedLine("child")]);
    expect(lines.size).toBe(3);
  });
});

describe("lookupMissed: a lookup that gave the model nothing", () => {
  test("a failed tool is missed, whatever the code (down, error, timeout)", () => {
    expect(lookupMissed(outcome({ status: "failed", errorCode: "search_unavailable" }))).toBe(true);
    expect(lookupMissed(outcome({ status: "failed", errorCode: "deadline_exceeded" }))).toBe(true);
    expect(lookupMissed(outcome({ packageId: "weather", status: "failed", errorCode: "502" }))).toBe(true);
  });

  test("a search that succeeded with zero rows is missed", () => {
    expect(lookupMissed(outcome({ result: resultWith({ rows: [] }) }))).toBe(true);
  });

  test("another tool's truthful empty list (nothing on the list today) is its answer, not a missed lookup", () => {
    expect(lookupMissed(outcome({ packageId: "list-view", result: resultWith({ rows: [] }) }))).toBe(false);
  });

  test("a lookup with rows, or a tool with no rows at all, is not missed", () => {
    expect(lookupMissed(outcome({ result: resultWith({ rows: [{ title: "a" }] }) }))).toBe(false);
    expect(lookupMissed(outcome({ packageId: "almanac-date", result: resultWith({ today: "Tuesday" }) }))).toBe(false);
    expect(lookupMissed(outcome({ packageId: "timer", result: undefined }))).toBe(false);
  });
});

describe("lookupMissedInstruction: the answering round after a missed lookup", () => {
  test("says the lookup did not happen, asks for an answer from what the model knows, and keeps a spoken turn short", () => {
    const spoken = lookupMissedInstruction("spoken", "who won the game");
    expect(spoken).toContain("did not happen");
    expect(spoken).toContain("from what you know");
    expect(spoken).toContain("in one to three sentences");
    expect(lookupMissedInstruction("written", "who won the game")).not.toContain("three sentences");
  });
});
