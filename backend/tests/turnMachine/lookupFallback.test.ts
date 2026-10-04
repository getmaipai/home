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

// T5 (tools design, R2): the failure kind is stored on the outcome itself; a retry round is
// offered only when every call in the round failed and none of the failed tools writes.
describe("failure kind on the outcome, and when a retry round is allowed", () => {
  test("lookupFailureKind reads the stored kind first (bad_arguments included), then the code", () => {
    expect(lookupFailureKind(outcome({ packageId: "weather", status: "failed", errorCode: "400", failureKind: "bad_arguments" }))).toBe("bad_arguments");
    expect(lookupFailureKind(outcome({ packageId: "weather", status: "failed", errorCode: "search_unavailable", failureKind: "timed_out" }))).toBe("timed_out");
  });

  test("retryEligible: every call failed and no failed tool writes", () => {
    const failed = (packageId: string) => outcome({ packageId, status: "failed", errorCode: "502" });
    expect(lookupFallback.retryEligible([failed("weather")])).toBe(true);
    expect(lookupFallback.retryEligible([failed("weather"), failed("websearch")])).toBe(true);
    expect(lookupFallback.retryEligible([failed("weather"), outcome({ packageId: "almanac-date", result: resultWith({ today: "Tuesday" }) })])).toBe(false);
    expect(lookupFallback.retryEligible([])).toBe(false);
  });

  test("retryEligible: a consequential (write) tool or start_project that failed is never retried", () => {
    const failed = (packageId: string) => outcome({ packageId, status: "failed", errorCode: "502" });
    expect(lookupFallback.retryEligible([failed("lock-doors")])).toBe(false);
    expect(lookupFallback.retryEligible([failed("start_project")])).toBe(false);
    expect(lookupFallback.retryEligible([failed("remind")])).toBe(false);
    expect(lookupFallback.retryEligible([failed("weather"), failed("lock-doors")])).toBe(false);
  });

  test("retryTools drops consequential tools from the block, and every writer in a temporary chat", () => {
    const spec = (id: string) => ({ id, description: id, args: {} });
    const block = ["lock-doors", "remember", "start_project", "timer", "weather", "websearch"].map(spec);
    expect(lookupFallback.retryTools(block, false).map((t) => t.id)).toEqual(["remember", "start_project", "timer", "weather", "websearch"]);
    expect(lookupFallback.retryTools(block, true).map((t) => t.id)).toEqual(["weather", "websearch"]);
    const readOnly = ["weather", "websearch"].map(spec);
    expect(lookupFallback.retryTools(readOnly, false)).toBe(readOnly);
  });

  test("retryInstruction names the failed tool and the kind, never any error text, and keeps a spoken turn short", () => {
    const text = lookupFallback.retryInstruction("spoken", "weather in oslo", [{ tool: "weather", kind: "bad_arguments" }]);
    expect(text).toContain("did not happen");
    expect(text).toContain("weather");
    expect(text).toContain("bad_arguments");
    expect(text).toContain("same call");
    expect(text).toContain("in one to three sentences");
    expect(lookupFallback.retryInstruction("written", "q", [{ tool: "websearch", kind: "timed_out" }])).not.toContain("three sentences");
  });

  test("isRepeatOfFailed compares tool and arguments byte for byte (key order aside)", () => {
    const failed = [outcome({ packageId: "weather", status: "failed", args: { place: "Oslo", unit: "c" } })];
    expect(lookupFallback.isRepeatOfFailed({ tool: "weather", args: { unit: "c", place: "Oslo" } }, failed)).toBe(true);
    expect(lookupFallback.isRepeatOfFailed({ tool: "weather", args: { place: "Oslo, Norway" } }, failed)).toBe(false);
    expect(lookupFallback.isRepeatOfFailed({ tool: "websearch", args: { place: "Oslo", unit: "c" } }, failed)).toBe(false);
  });
});
