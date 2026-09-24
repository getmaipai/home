// SIGNAL-02: rungOf() had no direct unit coverage at all before this -
// a review of the item found narrowing `target` off of "world" for a
// computed question (math/clock/date) silently dropped that turn's rung
// from model_knowledge to none whenever the model answered directly
// with no tool call, an unremarked telemetry regression. These tests
// pin rungOf()'s own contract now that a target can be "computed".
import { describe, expect, test } from "bun:test";
import { rungOf } from "@/lib/ruleNames";
import type { ToolExecutionOutcome } from "@/lib/turnContext";

const NO_OUTCOMES: readonly ToolExecutionOutcome[] = [];

describe("rungOf()", () => {
  test("a world question the model answered with no lookup is model_knowledge", () => {
    expect(rungOf({ source: "model", plugin_id: undefined }, NO_OUTCOMES, { target: "world", primary_act: "question" })).toBe("model_knowledge");
  });

  test("SIGNAL-02: a computed question the model answered directly, with no tool call, is model_knowledge too - not silently none", () => {
    expect(rungOf({ source: "model", plugin_id: undefined }, NO_OUTCOMES, { target: "computed", primary_act: "question" })).toBe("model_knowledge");
  });

  test("a computed question answered THROUGH a tool call is typed_source, not model_knowledge", () => {
    const outcomes: ToolExecutionOutcome[] = [{ callId: "c1", packageId: "math", status: "succeeded" }];
    expect(rungOf({ source: "plugin", plugin_id: "math" }, outcomes, { target: "computed", primary_act: "question" })).toBe("typed_source");
  });

  test("a non-question turn (an action, a statement) is never model_knowledge just because target is world or computed", () => {
    expect(rungOf({ source: "model", plugin_id: undefined }, NO_OUTCOMES, { target: "world", primary_act: "inform" })).toBe("none");
    expect(rungOf({ source: "model", plugin_id: undefined }, NO_OUTCOMES, { target: "computed", primary_act: "inform" })).toBe("none");
  });
});
