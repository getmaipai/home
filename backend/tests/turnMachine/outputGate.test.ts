// ENGINE-CONTRACT-03 (dev.md "U6 rerun ruling" (a)): direct unit tests
// of outputGateNode's own envelope catch, the floor for a whole-reply
// tool-call envelope that reaches this node as plain text however it
// got there. The model node's own catch (llm.test.ts's
// envelopeToolCall() tests) already stops the one live miss - Qwen3's
// <function_call> tag, unrecognized by llama-server's parser - before
// any real turn (turnNext.ts's own runTurnNext()) reaches this node
// with one; this file tests output_gate's own branch directly, the
// same way policy.test.ts tests argsGrounded() directly, since no
// currently-real turn can drive that branch end to end. The envelope
// check returns before this node ever reads `state.actor` (its only
// other read), so a real TurnState is not built here - what would be
// built is unused, not faked.
import { describe, expect, test } from "bun:test";
import { outputGateNode } from "@/lib/turnMachine/nodes/outputGate";
import { COMPOSE_FAILURE_LINE } from "@/lib/composer";
import type { TurnState } from "@/lib/turnMachine/contract";

const STATE = {} as TurnState;
const SIGNAL = new AbortController().signal;

const LUNA_ENVELOPE =
  '<function_call> {"name": "websearch", "arguments": {"expression": "when will chatgpt 6 luna be released"}} </function_call>';

describe("outputGateNode: the gate never delivers a bare envelope (ENGINE-CONTRACT-03)", () => {
  test("a reply whose whole text is the Luna envelope is delivered as the honest failure line, never verbatim", async () => {
    const { output } = await outputGateNode(
      STATE,
      { reply: { text: LUNA_ENVELOPE, sources: [] }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null },
      SIGNAL,
    );
    expect(output.refused).toBe(false);
    expect(output.text).toBe(COMPOSE_FAILURE_LINE);
    expect(output.text).not.toContain("function_call");
    expect(output.text).not.toContain("websearch");
  });

  test("an untagged bare envelope is caught the same way", async () => {
    const bare = '{"name": "websearch", "arguments": {"expression": "chatgpt 6 luna"}}';
    const { output } = await outputGateNode(
      STATE,
      { reply: { text: bare, sources: [] }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null },
      SIGNAL,
    );
    expect(output.refused).toBe(false);
    expect(output.text).toBe(COMPOSE_FAILURE_LINE);
  });

  // Never REFUSAL_FIRST: a wire-shape miss is not a safety refusal, so
  // this never routes through machine.ts's own "refused" branch - the
  // same honest, still-delivered line DEADLINE-01's own model_failed
  // case already uses one node up (answer.ts).
  test("marked refused: false, never the safety-refusal branch machine.ts routes on", async () => {
    const { output } = await outputGateNode(
      STATE,
      { reply: { text: LUNA_ENVELOPE, sources: [] }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null },
      SIGNAL,
    );
    expect(output.refused).toBe(false);
  });

  // A review caught the first cut hardcoding withheld_for: null here,
  // exactly the bug the safety-refusal branch a few lines down is
  // already careful to avoid: a minor's turn (context.ts's own
  // "minor" reason) whose reply happens to be a bare envelope must
  // still read back as withheld for age, never as "nothing to
  // withhold" - the same auditability invariant, one branch over.
  test("the context-decided withheld_for reason (a minor's turn) survives the envelope catch, never overwritten to null", async () => {
    const { output } = await outputGateNode(
      STATE,
      { reply: { text: LUNA_ENVELOPE, sources: [] }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: "minor" },
      SIGNAL,
    );
    expect(output.refused).toBe(false);
    expect(output.reasoning.withheld_for).toBe("minor");
  });
});
