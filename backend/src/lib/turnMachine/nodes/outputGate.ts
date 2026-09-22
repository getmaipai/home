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
import type { Node } from "../contract";
import type { AnswerOutput } from "./answer";

export interface OutputGateInput {
  reply: AnswerOutput;
}

export type OutputGateOutput = { refused: true; text: string } | { refused: false; text: string; speech?: string; sources: AnswerOutput["sources"] };

export const outputGateNode: Node<OutputGateInput, OutputGateOutput> = async (state, input) => {
  const repaired = assessReply(input.reply.text) ? repairReply(input.reply.text) : input.reply.text;
  const band = speakerAgeBand(state.actor, new Date());
  const evaluation = evaluateReply({ text: repaired, speech: input.reply.speech }, band);

  if (evaluation.effective.action === "refuse") {
    return { outcome: { ok: true }, output: { refused: true, text: REFUSAL_FIRST[0]! } };
  }

  return { outcome: { ok: true }, output: { refused: false, text: repaired, speech: input.reply.speech, sources: input.reply.sources } };
};
