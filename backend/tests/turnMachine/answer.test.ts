// COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): direct unit
// tests of answerNode's own provenance tagging - the same minimal-
// state pattern outputGate.test.ts's own header comment states for a
// node whose tested branches read only part of TurnState (here,
// nothing at all: answerNode's every branch reads only its own input).
import { describe, expect, test } from "bun:test";
import { answerNode } from "@/lib/turnMachine/nodes/answer";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { FAILURE_COPY, failureLine, type FailureKind } from "@/lib/generationFailure";

const STATE = { outcomes: [] } as unknown as TurnState;
const SIGNAL = new AbortController().signal;

function outcome(overrides: Partial<ToolExecutionOutcome>): ToolExecutionOutcome {
  return { callId: "test", packageId: "test-package", status: "succeeded", via: "command", ...overrides };
}

describe("answerNode: 'immediate' tags provenance only for a failed outcome (COMMAND-FAIL-01)", () => {
  test("a succeeded command's own text carries no provenance tag, even though it equals the outcome's own userMessage", async () => {
    const succeeded = outcome({ status: "succeeded", userMessage: "Done." });
    const { output } = await answerNode(STATE, { kind: "immediate", text: "Done.", outcome: succeeded }, SIGNAL);
    expect(output.text).toBe("Done.");
    expect(output.provenance).toBeUndefined();
  });

  test("a failed command's own error text is tagged outcome_error", async () => {
    const failed = outcome({ status: "failed", userMessage: "MCP error -32000: fetch failed" });
    const { output } = await answerNode(STATE, { kind: "immediate", text: "MCP error -32000: fetch failed", outcome: failed }, SIGNAL);
    expect(output.provenance).toBe("outcome_error");
  });
});

describe("answerNode: 'from_outcomes' tags provenance from the LAST outcome only (COMMAND-FAIL-01)", () => {
  test("the last outcome succeeded: no tag, even when an earlier one in the same list failed", async () => {
    const outcomes = [outcome({ status: "failed", userMessage: "first try failed" }), outcome({ status: "succeeded", userMessage: "second try worked" })];
    const { output } = await answerNode(STATE, { kind: "from_outcomes", text: "second try worked", outcomes }, SIGNAL);
    expect(output.provenance).toBeUndefined();
  });

  test("the last outcome failed: tagged outcome_error", async () => {
    const outcomes = [outcome({ status: "succeeded", userMessage: "first try worked" }), outcome({ status: "failed", userMessage: "second try failed" })];
    const { output } = await answerNode(STATE, { kind: "from_outcomes", text: "second try failed", outcomes }, SIGNAL);
    expect(output.provenance).toBe("outcome_error");
  });

  // THIN-1D (inverts the SEARCH-EMPTY-01 row that delivered
  // "Search isn't working right now." directly): no failed code has a stored
  // line any more, so `search_unavailable` is tagged like every other code.
  test("a failed outcome whose code is search_unavailable is tagged outcome_error, never delivered as its own fixed line", async () => {
    const failed = outcome({ status: "failed", errorCode: "search_unavailable", userMessage: "Search isn't working right now." });
    const { output } = await answerNode(STATE, { kind: "from_outcomes", text: "Search isn't working right now.", outcomes: [failed] }, SIGNAL);
    expect(output.provenance).toBe("outcome_error");
  });

  test("a failed outcome with an unrecognized code still gets the generic outcome_error tag, never a free pass", async () => {
    const failed = outcome({ status: "failed", errorCode: "not_found", userMessage: "no such record" });
    const { output } = await answerNode(STATE, { kind: "from_outcomes", text: "no such record", outcomes: [failed] }, SIGNAL);
    expect(output.provenance).toBe("outcome_error");
  });
});

test("answerNode: 'model_text' never carries the provenance tag - only a real outcome-sourced kind can", async () => {
  const modelText = await answerNode(STATE, { kind: "model_text", text: "a real model reply" }, SIGNAL);
  expect(modelText.output.provenance).toBeUndefined();
});

// THIN-DL-02: a failed generation is told by its kind, never the generic
// apology, and a minor gets the short, kind wording.
describe("answerNode: a failed generation is told by its kind (THIN-DL-02)", () => {
  const ADULT = { plan: { age_band: "adult" }, outcomes: [] } as unknown as TurnState;
  const CHILD = { plan: { age_band: "child" }, outcomes: [] } as unknown as TurnState;
  for (const kind of ["busy", "memory", "slow", "unreachable", "other"] as FailureKind[]) {
    test(`kind "${kind}": adult and child wording, never the generic line`, async () => {
      const adult = await answerNode(ADULT, { kind: "model_failed", failure: kind }, SIGNAL);
      const child = await answerNode(CHILD, { kind: "model_failed", failure: kind }, SIGNAL);
      expect(adult.output.text).toBe(FAILURE_COPY[kind].adult);
      expect(child.output.text).toBe(FAILURE_COPY[kind].minor);
      expect(child.output.text.length).toBeLessThan(adult.output.text.length);
      for (const text of [adult.output.text, child.output.text]) {
        expect(text).not.toContain("couldn't do that");
        expect(text).not.toContain("\u2014");
      }
    });
  }
  test("a failure with no kind still gets the plain other-kind line", async () => {
    const { output } = await answerNode(ADULT, { kind: "model_failed" }, SIGNAL);
    expect(output.text).toBe(failureLine("other", false));
  });
});

// MANIFEST-REFUSAL-01 (fixes getmaipai/home#166): a manifest that fails
// validation is a real infrastructure defect, not a household member
// asking for something the conversation doesn't ground - it must never
// say the honesty line ("I don't actually have that in this
// conversation, so I won't guess."), which belongs to a genuinely
// ungrounded or invented tool call.
describe("answerNode: 'policy_refused' with reason manifest_invalid says something on my end isn't working, never the honesty line", () => {
  test("manifest_invalid gets its own line", async () => {
    const { output } = await answerNode(STATE, { kind: "policy_refused", reason: "manifest_invalid" }, SIGNAL);
    expect(output.text).toBe("I can't do that right now. Something on my end isn't working.");
  });

  test("unknown_tool is unchanged: still the honesty line", async () => {
    const { output } = await answerNode(STATE, { kind: "policy_refused", reason: "unknown_tool" }, SIGNAL);
    expect(output.text).toBe("I don't actually have that in this conversation, so I won't guess.");
  });
});
