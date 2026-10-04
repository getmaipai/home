// U2c, the `answer` node (turn-machine-state-record-2026-09-22.md's
// state table): "the model's final text or the package reply, the
// outcomes' sources, the surface's projection (reply.speech), the
// plan's budget." Three producers feed it (the commands node's package
// reply, the model node's own text, and a second model call's text once tool
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
 * record): `unknown_tool` (the manifest failed to load) carries its own name, so
 * the trace can tell it apart even though `policyRefusalLine()` below
 * still prints them all as the one honesty line. */
export type PolicyRefusedReason = Exclude<Extract<PolicyDecision, { allow: false }>["reason"], "consent_needed" | "confirm_needed">;

export type AnswerInput =
  | { kind: "immediate"; text: string; speech?: string; outcome: ToolExecutionOutcome }
  | { kind: "model_text"; text: string }
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
 * `ungrounded_args` and `unknown_tool` both
 * fall to the same honesty line on purpose; the branch and the argument
 * name live in `stats.nodes[]`'s `policy` entry instead.
 *
 * MANIFEST-REFUSAL-01 (fixes getmaipai/home#166): `manifest_invalid`
 * (a real package whose manifest failed Zod validation - policy.ts's
 * own split from `unknown_tool`) is NOT the honesty line: the
 * conversation isn't missing anything, something on the hub itself is
 * broken, and saying "I won't guess" told the household the wrong
 * thing entirely during the live incident this fixes. `unknown_tool`
 * (no such package, the ordinary case of a model inventing a tool
 * name) keeps the honesty line - GROUND-01's ruling stands. */
function policyRefusalLine(reason: PolicyRefusedReason): string {
  if (reason === "min_role") return "That one needs a grown-up.";
  if (reason === "temporary_mode") return "I can't save anything in a temporary chat.";
  if (reason === "anonymous_speaker") return "I don't know who's talking yet, so I can't use anyone's memories.";
  if (reason === "crisis_state") return "Let's stay with this for now. I'm here.";
  if (reason === "manifest_invalid") return "I can't do that right now. Something on my end isn't working.";
  return "I don't actually have that in this conversation, so I won't guess.";
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
      // near-unreachable, which is wrong.
      // `state.outcomes` already carries every tool this turn ran, in
      // order, across every round, so flatMap-ing it here is safe
      // either way.
      const sources = state.outcomes.flatMap((o) => o.sources ?? []);
      // SEARCH-MIXED-01 / THIN-1D: a failed or empty lookup is never handed
      // to the model (model.ts filters it out of the phrasing round and tells
      // it the failure kind only); the model's own note is part of its text,
      // so nothing is appended here.
      return { outcome: { ok: true }, output: { text: input.text, sources } };
    }
    case "from_outcomes": {
      // COMMAND-FAIL-01: this text is machine.ts's own last-resort
      // fallback (`answerInputFrom`), built from `outcomes.at(-1)?.
      // userMessage`, so a failed last outcome is tagged the identical way
      // "immediate" is. THIN-1D: no failed code has a stored line any more
      // (the old search_unavailable outage line is gone); the answering round
      // tells a failed lookup in the model's own words (model.ts).
      const sources = input.outcomes.flatMap((o) => o.sources ?? []);
      const lastFailed = input.outcomes.at(-1)?.status === "failed";
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
