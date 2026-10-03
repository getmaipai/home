// THIN-1D (rule 6 as amended 2026-10-03): the note that a lookup did not
// happen is the model's own words, never a stored line. These are direct unit
// tests of what counts as a missed lookup, which failure kind the model is
// told, and the answering round's instruction. The end-to-end rows live in
// turnNext.test.ts.
import { describe, expect, test } from "bun:test";
import { lookupMissed, lookupFailureKind, lookupMissedInstruction } from "@/lib/turnMachine/nodes/lookupFallback";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import * as lookupFallback from "@/lib/turnMachine/nodes/lookupFallback";

function outcome(overrides: Partial<ToolExecutionOutcome>): ToolExecutionOutcome {
  return { callId: "test", packageId: "websearch", status: "succeeded", via: "tool_call", ...overrides };
}

/** Only `data` is read by lookupMissed(); the rest of a PluginResult is not built. */
function resultWith(data: Record<string, unknown>): ToolExecutionOutcome["result"] {
  return { data } as unknown as ToolExecutionOutcome["result"];
}

describe("no stored wording", () => {
  test("the module exports no fixed line or per-band table", () => {
    expect(Object.keys(lookupFallback)).not.toContain("lookupMissedLine");
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

describe("lookupFailureKind: the one thing the model is told", () => {
  test("maps the outcome's status and code to unavailable, timed out, found nothing or errored", () => {
    expect(lookupFailureKind(outcome({ status: "failed", errorCode: "search_unavailable" }))).toBe("unavailable");
    expect(lookupFailureKind(outcome({ status: "failed", errorCode: "deadline_exceeded" }))).toBe("timed_out");
    expect(lookupFailureKind(outcome({ result: resultWith({ rows: [] }) }))).toBe("found_nothing");
    expect(lookupFailureKind(outcome({ packageId: "weather", status: "failed", errorCode: "502" }))).toBe("errored");
  });
});

describe("lookupMissedInstruction: the answering round after a missed lookup", () => {
  test("names the failure kind, asks for an answer from what the model knows in its own voice, and keeps a spoken turn short", () => {
    const spoken = lookupMissedInstruction("spoken", "who won the game", ["timed_out"]);
    expect(spoken).toContain("did not happen");
    expect(spoken).toContain("timed out");
    expect(spoken).toContain("from what you know");
    expect(spoken).toContain("your own words");
    expect(spoken).toContain("in one to three sentences");
    expect(lookupMissedInstruction("written", "who won the game", ["unavailable"])).not.toContain("three sentences");
  });

  test("never says a note is added afterwards: the model writes it", () => {
    expect(lookupMissedInstruction("written", "q", ["errored"])).not.toContain("is added after");
  });
});
