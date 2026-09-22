// U2c, the `output_gate` node (turn-machine-state-record-2026-09-22.md's
// state table): "every streamed sentence through gateOutputSafety; the
// honesty invariant...; the malformed repair | done; refused when the
// output floor refuses." Simplest real implementation (U2b's own
// brief): evaluateReply() (safety.ts) runs the SAME evaluateSafety()/
// forOutput() floor turnEngine.ts's own gateOutputSafety() calls per
// sentence, over the whole composed reply at once rather than
// streamed sentence-by-sentence - real safety coverage of the actual
// text a household hears, not yet the per-sentence early-cut behavior
// the streaming gate adds. Malformed repair (wellFormed.ts, kept per
// RULES-AND-LEARNED-COMPONENTS.md) runs first, since a repair can only
// ever remove dangling markup, never change what the safety floor sees
// as a claim.
//
// The honesty invariant, applied structurally rather than by a new
// rule: this path's only two ways to compose a reply that could claim
// an action are `answer`'s "immediate" and "from_outcomes" kinds, and
// both are already built from a real ToolExecutionOutcome (the command
// that ran, or the tool that did) - there is no path here where the
// model's own free text ("model_text"/"context_quote") stands in for
// an action result, so nothing in this node re-parses that text for a
// claim a regex would have to invent (RULES-AND-LEARNED-COMPONENTS.md's
// "No hacky rules": understanding language is the model's job, and a
// text reply here was never granted an action result to misrepresent).
import { assessReply, repairReply } from "@/lib/wellFormed";
import { evaluateReply } from "@/lib/safety";
import { speakerAgeBand } from "@/lib/ageBand";
import { REFUSAL_FIRST } from "@/lib/replyVariation";
import type { Node, TurnState } from "../contract";
import type { AnswerOutput } from "./answer";

export interface OutputGateInput {
  reply: AnswerOutput;
  /** "Reasoning is a second output": the model node's own extracted
   * span, undefined whenever `context` already decided not to emit
   * (the model node drops it before this input is even built -
   * machine.ts's own `answerInputFrom`/output_gate wiring) or the
   * generation simply carried no think block this turn. */
  reasoningIn: string | undefined;
  reasoningEmit: boolean;
  reasoningWithheldFor: TurnState["reasoning"]["withheld_for"];
}

export type OutputGateOutput =
  | { refused: true; text: string; reasoning: { emitted: false; withheld_for: TurnState["reasoning"]["withheld_for"] } }
  | { refused: false; text: string; speech?: string; sources: AnswerOutput["sources"]; reasoningOut?: string; reasoning: { emitted: boolean; withheld_for: TurnState["reasoning"]["withheld_for"] } };

export const outputGateNode: Node<OutputGateInput, OutputGateOutput> = async (state, input) => {
  const repaired = assessReply(input.reply.text) ? repairReply(input.reply.text) : input.reply.text;
  const band = speakerAgeBand(state.actor, new Date());
  const evaluation = evaluateReply({ text: repaired, speech: input.reply.speech }, band);

  // The same safety pass the answer itself gets, over the reasoning
  // span too ("Reasoning passes the output gate ... before an adult
  // sees it"). Only ever runs when `context` already said this turn
  // may emit one AND the model actually produced a span - the false
  // branches (never asked to emit, or nothing to gate) pass the
  // context-decided reason straight through, never re-evaluated here.
  let reasoningOut: string | undefined;
  let withheldFor = input.reasoningWithheldFor;
  if (input.reasoningEmit && input.reasoningIn !== undefined) {
    const reasoningEvaluation = evaluateReply({ text: input.reasoningIn }, band);
    if (reasoningEvaluation.effective.action === "refuse") {
      withheldFor = "gate";
    } else {
      reasoningOut = input.reasoningIn;
      withheldFor = null;
    }
  } else if (input.reasoningEmit) {
    // Allowed to emit, but the model produced no think block this turn.
    withheldFor = null;
  }
  if (evaluation.effective.action === "refuse") {
    // A code review caught this reusing the reasoning span's own
    // withheldFor (from the check above, independent of the ANSWER's
    // own refusal) verbatim here: a benign span that had already
    // passed its own gate (withheldFor still null, meaning "nothing
    // wrong with it") would then be recorded as `withheld_for: null`
    // on a turn where it was never actually sent - indistinguishable
    // from "this turn had nothing to withhold" on the trace. The
    // ANSWER's own refusal is itself an output_gate decision that
    // drops the reasoning span too (a refused turn never emits one),
    // so it gets the same "gate" reason whenever there was something
    // to withhold in the first place (reasoningEmit true) - the
    // context-decided reason (minor/surface) still wins when emit was
    // already false, never overwritten by an unrelated answer refusal.
    const refusedWithheldFor = input.reasoningEmit ? "gate" : withheldFor;
    return { outcome: { ok: true }, output: { refused: true, text: REFUSAL_FIRST[0]!, reasoning: { emitted: false, withheld_for: refusedWithheldFor } } };
  }

  const reasoning = { emitted: reasoningOut !== undefined, withheld_for: withheldFor };
  return { outcome: { ok: true }, output: { refused: false, text: repaired, speech: input.reply.speech, sources: input.reply.sources, reasoningOut, reasoning } };
};
