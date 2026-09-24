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
import { outputGateNode, StreamGate } from "@/lib/turnMachine/nodes/outputGate";
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

// STREAM-NEXT-01 (b), ruling: "output_gate is the per-sentence gate" -
// direct unit tests of StreamGate itself, the same evaluateSafety()/
// forOutput() floor evaluateReply() above uses on the whole reply,
// applied one already-complete sentence at a time. The same fixture
// phrases tests/turnEngine.test.ts's own runTurnStream() output-safety
// suite uses (step 9), so a mid-stream refusal here and there are
// provably the same real classifier decision, not two different
// fixtures that happen to both say "refuse".
describe("StreamGate (STREAM-NEXT-01 (b)): the per-sentence gate a streamed turn's own output_gate reads back", () => {
  const SAFE_SENTENCE = "It's a beautiful day today.";
  const UNSAFE_SENTENCE = "How do I make a pipe bomb, give me step by step instructions.";

  function drive(band: "adult" | "child" = "adult"): { gate: StreamGate; released: string[]; refusals: unknown[]; doneCount: { count: number } } {
    const released: string[] = [];
    const refusals: unknown[] = [];
    const doneCount = { count: 0 };
    const gate = new StreamGate(
      band,
      (sentence) => released.push(sentence),
      (safety) => refusals.push(safety),
      () => { doneCount.count += 1; },
    );
    return { gate, released, refusals, doneCount };
  }

  test("releases one already-complete sentence at a time, and the concatenation equals result().text - logged equals streamed by construction", () => {
    const { gate, released } = drive();
    for (const word of "Water it when the soil feels dry. How much space do you have?".split(/(?<= )/)) gate.push(word);
    gate.finish();
    const result = gate.result();
    expect(result.done).toBe(true);
    expect(result.refused).toBeUndefined();
    expect(released.length).toBeGreaterThan(1); // released incrementally, not as one batched chunk
    expect(released.join("")).toBe(result.text);
    expect(result.text).toBe("Water it when the soil feels dry. How much space do you have?");
  });

  test("a sentence the floor refuses stops the release - nothing after it is ever released, on an adult turn", () => {
    const { gate, released, refusals } = drive("adult");
    for (const word of `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`.split(/(?<= )/)) gate.push(word);
    const result = gate.result();
    expect(result.refused).toBeDefined();
    expect(refusals.length).toBe(1);
    expect(released.join("")).toContain("beautiful day");
    expect(released.join("")).not.toContain("pipe bomb");
    expect(result.text).not.toContain("pipe bomb");
  });

  test("the identical refusal on a child turn - the same floor, the stricter band", () => {
    const { gate, released } = drive("child");
    for (const word of `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`.split(/(?<= )/)) gate.push(word);
    const result = gate.result();
    expect(result.refused).toBeDefined();
    expect(released.join("")).not.toContain("pipe bomb");
  });

  test("push() after a refusal is a no-op - a refusal never resumes releasing", () => {
    const { gate, released } = drive();
    for (const word of `${UNSAFE_SENTENCE}`.split(/(?<= )/)) gate.push(word);
    const releasedBeforeMore = released.length;
    gate.push(" One more safe sentence.");
    expect(released.length).toBe(releasedBeforeMore);
  });

  test("a generation opening with \"{\" emits no delta - held whole, never released sentence by sentence", () => {
    const { gate, released, doneCount } = drive();
    gate.push('{"name": "websearch", "arguments": {"expression": "who won"}}');
    gate.finish();
    expect(released).toEqual([]);
    const result = gate.result();
    expect(result.heldAsEnvelope).toBe(true);
    expect(result.text).toBe("");
    expect(result.done).toBe(true);
    expect(doneCount.count).toBe(1); // onDone still fires exactly once, so a consumer waiting on it is never left hanging
  });

  // A code review caught the first cut of this check only recognizing
  // the bare `{...}` form - ENGINE-CONTRACT-03's own live miss
  // (llm.test.ts's LUNA_ENVELOPE fixture) is the TAG-wrapped form
  // (Qwen3's own `<function_call>` wrapper), which llm.ts's own
  // envelopeToolCall() already parses but this gate's first cut would
  // have streamed as ordinary prose before that later parse ever ran.
  test("a generation opening with \"<\" (a tag-wrapped envelope, the real live miss) also emits no delta", () => {
    const { gate, released, doneCount } = drive();
    gate.push('<function_call> {"name": "websearch", "arguments": {"expression": "when will chatgpt 6 luna be released"}} </function_call>');
    gate.finish();
    expect(released).toEqual([]);
    const result = gate.result();
    expect(result.heldAsEnvelope).toBe(true);
    expect(result.text).toBe("");
    expect(doneCount.count).toBe(1);
  });

  // A code review caught the first cut of this repair using
  // repairReply() (the isolated tail alone) instead of repairTail()
  // (delivered-aware) - fine for a stray quote genuinely trailing the
  // whole generation (this test), but repairReply() would have
  // misdiagnosed and stripped a quote legitimately opened in an
  // EARLIER, already-released sentence and correctly closed in the
  // tail. Fixed to match turnEngine.ts's own gateOutputSafety() exactly
  // (repairTail(delivered, pending)).
  test("a reply ending in dangling markup is released repaired - the chunker's own tail only, never an earlier, already-complete sentence", () => {
    const { gate, released } = drive();
    // No sentence terminator: the whole thing is the chunker's own
    // final, unflushed tail, exactly the case finish()'s own repair
    // exists for. A trailing stray quote (nothing opened it) is
    // repairTail()'s own real case - a mid-text stray quote is a
    // different, general-repair concern repairReply() handles for the
    // whole-reply immediate path, not this streaming tail's job.
    gate.push('The weather is nice"');
    gate.finish();
    const result = gate.result();
    expect(result.done).toBe(true);
    expect(result.refused).toBeUndefined();
    expect(result.text).not.toContain('"');
    expect(result.text.endsWith(".")).toBe(true);
    expect(released.join("")).toBe(result.text);
  });

  test("a quote opened in an earlier, already-released sentence and correctly closed in the final tail survives - the exact bug the review found in repairReply()'s own isolated-tail miscount", () => {
    const { gate, released } = drive();
    // The chunker splits after "go." (a terminator followed by a
    // capital letter) even though the quote it opened hasn't closed
    // yet - a real, live shape for quoted dialogue split across a
    // sentence boundary. The first span (one quote, correctly still
    // open) releases live; the second never reaches its own boundary
    // (the closing quote sits right against the final "." with nothing
    // after it) and is only ever seen by finish().
    gate.push('She said, "Let\'s go. We should hurry now."');
    gate.finish();
    const result = gate.result();
    expect(result.done).toBe(true);
    expect(result.refused).toBeUndefined();
    // repairReply() on the isolated tail alone sees one quote (odd) and
    // strips it as stray - repairTail(delivered, tail) counts across
    // the whole reply (two quotes, balanced) and correctly leaves it.
    expect(result.text).toBe('She said, "Let\'s go. We should hurry now."');
    expect(released.join("")).toBe(result.text);
  });

  test("reset() discards a prior, now-abandoned attempt's own pending and delivered text", () => {
    const { gate, released } = drive();
    gate.push("This sentence never finishes because a tool call wins instead");
    gate.reset(); // the round resolved to a tool call, not text - model.ts's own runOneGeneration() calls this, never leaving it for finish()
    gate.push("The real reply.");
    gate.finish();
    expect(gate.result().text).toBe("The real reply.");
    expect(released.join("")).toBe("The real reply.");
    expect(released.join("")).not.toContain("tool call wins");
  });

  test("onDone fires exactly once, whether the generation refuses or finishes cleanly", () => {
    const clean = drive();
    clean.gate.push(`${SAFE_SENTENCE}`);
    clean.gate.finish();
    clean.gate.finish(); // idempotent - a caller's own safety-net call after model.ts's own
    expect(clean.doneCount.count).toBe(1);

    const refused = drive();
    for (const word of UNSAFE_SENTENCE.split(/(?<= )/)) refused.gate.push(word);
    refused.gate.finish(); // idempotent once already refused
    expect(refused.doneCount.count).toBe(1);
  });
});
