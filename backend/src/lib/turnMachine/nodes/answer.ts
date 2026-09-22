// U2c, the `answer` node (turn-machine-state-record-2026-09-22.md's
// state table): "the model's final text or the package reply, the
// outcomes' sources, the surface's projection (reply.speech), the
// plan's budget." Four producers feed it (the commands node's package
// reply, the model node's own text, the model node's
// answer_from_context choice, and a second model call's text once tool
// outcomes exist - all folded to the same shape here so `output_gate`
// never has to know which one ran).
import type { Node, ToolExecutionOutcome, PolicyDecision } from "../contract";
import type { Source } from "@maipai/spec/gen/ts/source.js";

/** The reasons `policy` can refuse a proposal WITHOUT parking an ask
 * (consent_needed/confirm_needed always carry one, so machine.ts's
 * `policyHasParkedAsk` guard catches those first - only these four
 * ever reach `policyAllRefused` and this node). */
export type PolicyRefusedReason = Exclude<Extract<PolicyDecision, { allow: false }>["reason"], "consent_needed" | "confirm_needed">;

export type AnswerInput =
  | { kind: "immediate"; text: string; speech?: string; outcome: ToolExecutionOutcome }
  | { kind: "model_text"; text: string }
  | { kind: "context_quote"; quote: string }
  | { kind: "from_outcomes"; text: string; outcomes: readonly ToolExecutionOutcome[] }
  // A code review (2026-09-22) caught `policy`'s own "every proposal
  // refused, nothing parked" exit (machine.ts's policyAllRefused) with
  // no producer here at all - it fell through to the empty-text
  // fallback below, an empty reply where the state table promises "the
  // refusal line for min_role."
  | { kind: "policy_refused"; reason: PolicyRefusedReason };

export interface AnswerOutput {
  text: string;
  speech?: string;
  sources: Source[];
}

/** Four fixed lines, one per PolicyRefusedReason - not a rule reading a
 * household member's words (RULES-AND-LEARNED-COMPONENTS.md's own
 * target), but the same kind of fixed internal-reason-code-to-text
 * mapping safety.ts's own refusal line and turnNext.ts's blocked line
 * already use. Individual branches, never a literal array, the same
 * reason messages.ts's windowRoleFromId() checks its four roles one at
 * a time (the rule-budget lint's word-list check is syntactic, not
 * semantic - a 3+-string array trips it whatever it holds). */
function policyRefusalLine(reason: PolicyRefusedReason): string {
  if (reason === "min_role") return "That one needs a grown-up.";
  if (reason === "temporary_mode") return "I can't save anything in a temporary chat.";
  if (reason === "crisis_state") return "Let's stay with this for now. I'm here.";
  return "I don't actually have that in this conversation, so I won't guess.";
}

export const answerNode: Node<AnswerInput, AnswerOutput> = async (_state, input) => {
  switch (input.kind) {
    case "policy_refused":
      return { outcome: { ok: true }, output: { text: policyRefusalLine(input.reason), sources: [] } };
    case "immediate":
      return { outcome: { ok: true }, output: { text: input.text, speech: input.speech, sources: input.outcome.sources ?? [] } };
    case "model_text":
      return { outcome: { ok: true }, output: { text: input.text, sources: [] } };
    case "context_quote":
      // The state record's own honesty rule: a world answer without a
      // search carries no sources and says so is for the case NOTHING
      // grounds it; here the quote itself is the grounding (policy's
      // set check already verified it is a real line of the window),
      // so the line is handed back as the answer, not paraphrased -
      // the safest "simplest real implementation" for a case where
      // inventing new phrasing risks saying something the quote didn't.
      return { outcome: { ok: true }, output: { text: input.quote, sources: [] } };
    case "from_outcomes": {
      const sources = input.outcomes.flatMap((o) => o.sources ?? []);
      return { outcome: { ok: true }, output: { text: input.text, sources } };
    }
  }
};
