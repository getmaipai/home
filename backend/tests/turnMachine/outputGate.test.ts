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

// COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): the same place
// and shape as ENGINE-CONTRACT-03's own envelope catch above - a
// provenance check, not a safety call, checked right beside it.
describe("outputGateNode: a reply tagged outcome_error never reaches the person verbatim (COMMAND-FAIL-01)", () => {
  const RAW_ERROR = "MCP error -32000: fetch failed: 404 https://en.wikipedia.org/api/rest_v1/page/summary/Technical_benchmarking";

  test("a reply whose text equals a failed outcome's own userMessage, tagged outcome_error, is refused and replaced with the honest failure line", async () => {
    const { output } = await outputGateNode(
      STATE,
      { reply: { text: RAW_ERROR, sources: [], provenance: "outcome_error" }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null },
      SIGNAL,
    );
    expect(output.refused).toBe(false);
    expect(output.text).toBe(COMPOSE_FAILURE_LINE);
    expect(output.text).not.toContain("MCP error");
    expect(output.text).not.toContain("wikipedia");
  });

  test("the identical text with no provenance tag passes through untouched - the tag is what refuses it, never the text's own content", async () => {
    // Unlike every other case in this file, an untagged reply falls
    // through BOTH early catches into the real safety evaluation path
    // (evaluateReply/speakerAgeBand), which reads `state.actor` - a
    // minimal real actor, not the bare `{}` the rest of this file uses,
    // since this is the one test that genuinely exercises past both.
    const actorState = { actor: { role: "adult", birthdate: null } } as unknown as TurnState;
    const { output } = await outputGateNode(
      actorState,
      { reply: { text: RAW_ERROR, sources: [] }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null },
      SIGNAL,
    );
    expect(output.refused).toBe(false);
    // repairReply() may append a sentence terminator to prose-shaped
    // text (unrelated to this check) - proving the content survives,
    // not exact byte equality, is the actual claim here.
    expect(output.text).toContain("MCP error");
    expect(output.text).not.toBe(COMPOSE_FAILURE_LINE);
  });

  test("marked refused: false, never the safety-refusal branch machine.ts routes on", async () => {
    const { output } = await outputGateNode(
      STATE,
      { reply: { text: RAW_ERROR, sources: [], provenance: "outcome_error" }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null },
      SIGNAL,
    );
    expect(output.refused).toBe(false);
  });

  test("the context-decided withheld_for reason survives the provenance catch, never overwritten to null", async () => {
    const { output } = await outputGateNode(
      STATE,
      { reply: { text: RAW_ERROR, sources: [], provenance: "outcome_error" }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: "minor" },
      SIGNAL,
    );
    expect(output.reasoning.withheld_for).toBe("minor");
  });
});
