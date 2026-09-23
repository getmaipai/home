// COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): direct unit
// tests of answerNode's own provenance tagging - the same minimal-
// state pattern outputGate.test.ts's own header comment states for a
// node whose tested branches read only part of TurnState (here,
// nothing at all: answerNode's every branch reads only its own input).
import { describe, expect, test } from "bun:test";
import { answerNode } from "@/lib/turnMachine/nodes/answer";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";

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
});

test("answerNode: 'model_text' and 'context_quote' never carry the provenance tag - only a real outcome-sourced kind can", async () => {
  const modelText = await answerNode(STATE, { kind: "model_text", text: "a real model reply" }, SIGNAL);
  expect(modelText.output.provenance).toBeUndefined();
  const contextQuote = await answerNode(STATE, { kind: "context_quote", quote: "a line from the window" }, SIGNAL);
  expect(contextQuote.output.provenance).toBeUndefined();
});
