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
import { COMPOSE_FAILURE_LINE } from "@/lib/composer";

/** The reasons `policy` can refuse a proposal WITHOUT parking an ask
 * (consent_needed/confirm_needed always carry one, so machine.ts's
 * `policyHasParkedAsk` guard catches those first - only these ever
 * reach `policyAllRefused` and this node). GROUND-01 split the old
 * single `ungrounded_args` into three ("1. Split the reason", state
 * record): `unknown_tool` (the manifest failed to load) and
 * `context_tool_in_policy` (the answer-from-context tool reaching this
 * node, which should never happen) now carry their own names, so the
 * trace can tell them apart even though `policyRefusalLine()` below
 * still prints them all as the one honesty line. */
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
  | { kind: "policy_refused"; reason: PolicyRefusedReason }
  // DEADLINE-01: the model node's own generation never finished (a
  // deadline, a dead engine) on a turn where the builder row wasn't a
  // fit either (tool_choice not "required") - a real, honest line,
  // never the empty string this case used to deliver silently.
  | { kind: "model_failed" };

export interface AnswerOutput {
  text: string;
  speech?: string;
  sources: Source[];
  /** COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): set when
   * `text` was drawn directly from a failed outcome's own `error`/
   * `userMessage` field (the household's own custom command failing,
   * "immediate"; a tool round's own last call failing with nothing
   * else to say, "from_outcomes") - `output_gate`'s own provenance
   * check refuses to deliver it verbatim, the same place and shape as
   * the envelope catch (ENGINE-CONTRACT-03). A pattern outcome's own
   * failure never reaches this node this way any more (it returns
   * `matched: false` instead, commands.ts) - this tag is the
   * structural backstop for every OTHER producer of "immediate"/
   * "from_outcomes" text, present and future, not a single
   * enumerated list of today's callers. */
  provenance?: "outcome_error";
}

/** Three distinct lines plus one shared fallback, not a rule reading a
 * household member's words (RULES-AND-LEARNED-COMPONENTS.md's own
 * target), but the same kind of fixed internal-reason-code-to-text
 * mapping safety.ts's own refusal line and turnNext.ts's blocked line
 * already use. Individual branches, never a literal array, the same
 * reason messages.ts's windowRoleFromId() checks its four roles one at
 * a time (the rule-budget lint's word-list check is syntactic, not
 * semantic - a 3+-string array trips it whatever it holds). GROUND-01:
 * "the refusal line stays one sentence; the trace is what changes" -
 * `ungrounded_args`, `unknown_tool` and `context_tool_in_policy` all
 * fall to the same honesty line on purpose; the branch and the argument
 * name live in `stats.nodes[]`'s `policy` entry instead. */
function policyRefusalLine(reason: PolicyRefusedReason): string {
  if (reason === "min_role") return "That one needs a grown-up.";
  if (reason === "temporary_mode") return "I can't save anything in a temporary chat.";
  if (reason === "crisis_state") return "Let's stay with this for now. I'm here.";
  return "I don't actually have that in this conversation, so I won't guess.";
}

/** SEARCH-EMPTY-01: the identical fixed-code-to-text mapping
 * `policyRefusalLine` above already is, for a tool outcome's own
 * `errorCode` instead of a policy refusal reason. A package's raw
 * `userMessage` is still never delivered verbatim (COMMAND-FAIL-01's
 * own `outcome_error` provenance tag exists specifically because a raw
 * engine error string can carry anything, including a diagnostic no
 * household member should see) - but `search_unavailable`'s own
 * `userMessage` was never a raw diagnostic to begin with; it is one
 * fixed, safe, hand-written string `searxngSearch()` itself throws
 * ("Search isn't working right now.", never anything from the engine's
 * own response body). Named here, by code, the same closed way
 * `policyRefusalLine` names its own three reasons - never a rule
 * reading the string's own content. `null` for every other code keeps
 * the existing floor: an unrecognized failure still falls through to
 * `provenance: "outcome_error"` below and the generic swap. */
function toolOutageLine(errorCode: string | undefined): string | null {
  if (errorCode === "search_unavailable") return "Search isn't working right now.";
  return null;
}

export const answerNode: Node<AnswerInput, AnswerOutput> = async (state, input) => {
  switch (input.kind) {
    case "policy_refused":
      return { outcome: { ok: true }, output: { text: policyRefusalLine(input.reason), sources: [] } };
    case "immediate": {
      // COMMAND-FAIL-01: a failed household custom command still
      // returns `matched: true` with its own error text (lib/commands.ts's
      // runCommand, out of this item's own scope - a Home Assistant
      // failure, never a lookup) - tagged here rather than left for a
      // later node to guess at from the text alone.
      const provenance = input.outcome.status === "failed" ? ("outcome_error" as const) : undefined;
      return { outcome: { ok: true }, output: { text: input.text, speech: input.speech, sources: input.outcome.sources ?? [], provenance } };
    }
    case "model_text": {
      // A live acceptance run (U2d) caught this dropping every tool
      // round's own sources on the floor: the state table's own "the
      // outcomes' sources" is listed as this node's input generally,
      // not only for the "from_outcomes" case below. The common
      // budget.rounds >= 1 turn reaches this "model_text" case too
      // (the model returns to `model` for one more round after a
      // tool call, so `step` there is a fresh ModelOutput text kind),
      // so both cases need the same merge - a review caught an
      // earlier draft of this comment claiming "from_outcomes" was
      // near-unreachable, which is wrong: `answer_from_context_check`'s
      // own forced retry (forceSearchOnly, machine.ts) can still reach
      // `tool` with rounds already exhausted, landing there directly.
      // `state.outcomes` already carries every tool this turn ran, in
      // order, across every round, so flatMap-ing it here is safe
      // either way.
      const sources = state.outcomes.flatMap((o) => o.sources ?? []);
      // SEARCH-MIXED-01: model.ts's own phrasing round never hands the
      // model a failed outcome to answer around (its own tool_calls/
      // tool_result pair is filtered out of that round's prompt
      // entirely) - so a mixed round's own failure never has a chance
      // to become something the model quietly worked around or
      // answered from its own knowledge instead. The SAME fixed-code-
      // to-text mapping "from_outcomes" already uses is applied here,
      // deterministically, from the ORIGINAL unfiltered state.outcomes:
      // an unrecognized failure code is silently skipped (no raw
      // diagnostic ever reaches this line either way, only the fixed,
      // safe lines toolOutageLine() itself names), never a rule reading
      // what the model said.
      const outageLines = [...new Set(state.outcomes.filter((o) => o.status === "failed").map((o) => toolOutageLine(o.errorCode)).filter((line): line is string => line !== null))];
      const text = outageLines.length > 0 ? `${input.text} ${outageLines.join(" ")}`.trim() : input.text;
      return { outcome: { ok: true }, output: { text, sources } };
    }
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
      // COMMAND-FAIL-01: this text is machine.ts's own last-resort
      // fallback (`answerInputFrom`), built from `outcomes.at(-1)?.
      // userMessage` - the SAME field this checks, so a failed last
      // outcome (a tool round's own final call failing with rounds
      // exhausted, or SEARCH-EMPTY-01's own `toolAllFailed` guard
      // routing straight here) is tagged the identical way "immediate"
      // is - UNLESS `toolOutageLine` recognizes the failure's own code
      // as one of its fixed, safe lines, in which case that line is
      // delivered directly and never tagged `outcome_error` at all (it
      // was never a raw diagnostic to begin with).
      const sources = input.outcomes.flatMap((o) => o.sources ?? []);
      const lastOutcome = input.outcomes.at(-1);
      const lastFailed = lastOutcome?.status === "failed";
      const outageLine = lastFailed ? toolOutageLine(lastOutcome.errorCode) : null;
      if (outageLine !== null) return { outcome: { ok: true }, output: { text: outageLine, sources } };
      const provenance = lastFailed ? ("outcome_error" as const) : undefined;
      return { outcome: { ok: true }, output: { text: input.text, sources, provenance } };
    }
    // DEADLINE-01: the same shared line composer.ts's own all-failed
    // batch already uses for a technical failure - the identical
    // "something broke, not a refusal" case, one level up, imported
    // rather than re-typed so the two copies can't drift.
    case "model_failed":
      return { outcome: { ok: true }, output: { text: COMPOSE_FAILURE_LINE, sources: [] } };
  }
};
