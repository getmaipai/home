// U2c, the `policy` node (turn-machine-state-record-2026-09-22.md's
// state table): each ActionProposal against the manifest's min_role,
// consequential, permissions; the grounding of the arguments against
// the context list (a set check, not a judgment); the household-subject
// rule for a search; temporary mode (no memory:write); the crisis state
// (no lookups). A side-effecting proposal still needs a consent or a
// confirmation - CONSENT_WORD/AFFIRMATIVE_RE stay deterministic on
// purpose (RULES-AND-LEARNED-COMPONENTS.md); this node only decides
// WHETHER to ask, never reads a "yes" itself (turnNext.ts's own
// continuation handling does, before `safety`, per the state record).
import { loadManifestOnly, meetsMinRole } from "@/lib/plugins";
import { speakerNamedAny } from "@/lib/subjects";
import { tokenize } from "@/lib/text";
import type { Node, ActionProposal, PolicyDecision, ToolCall, TurnState } from "../contract";
import { ANSWER_FROM_CONTEXT_TOOL_ID } from "./model";

export interface PolicyInput {
  calls: readonly ToolCall[];
  /** Continuations (turn-machine-state-record's own "an affirmative
   * re-enters at policy with the stored proposal marked confirmed"):
   * the tool/args this turn's "yes" already confirmed, from the
   * pending ask turnNext.ts read before `safety`. A call matching this
   * proposal's tool skips the consent/confirm checks below entirely -
   * asking twice for the same action would be the stuck-question
   * failure REPLY-FIND-01 already named, just moved to a new node. */
  preConfirmed?: ActionProposal;
}

/** One call's own proposal and decision, paired by construction rather
 * than by matching index across two parallel arrays - a decision that
 * refused before a proposal was even built (min_role, an unknown tool)
 * still gets a placeholder proposal here so `machine.ts` never has to
 * guess which proposal a given decision was about. */
export interface PolicyEntry {
  proposal: ActionProposal;
  decision: PolicyDecision;
}

export interface PolicyOutput {
  entries: PolicyEntry[];
}

/** The owner's ruling (state record, "Grounding, stated exactly",
 * 2a28e4e8), after a live run caught the original substring version
 * refusing every real, naturally-reworded search query ("president of
 * Chile 2026" is not a substring of "who is the president of chile",
 * so it always refused): a string argument passes when it shares at
 * least one CONTENT TERM (case-folded, stop words dropped - the same
 * tokenize() guards.ts's own repeat guard already uses, reused rather
 * than a second tokenizer) with the source texts; a number, year or
 * date never counts against it (dropped before the overlap check, so
 * an arg that is nothing but digits neither passes nor fails on its
 * own weight); refuse exactly two things - a bare pronoun as the WHOLE
 * argument (unresolved: "he", "it", not a real query), and zero
 * overlap with every non-numeric term dropped. */
// rule: grounding.pure_number (docs/plans/turn-machine-state-record-2026-09-22.md, "Grounding, stated exactly", 2a28e4e8)
const PURE_NUMBER_RE = /^\d+$/;

/** GROUND-01 step 2 ("Ground the query, not every field"): the shape a
 * manifest's `args` JSON Schema carries for one property - only what
 * this function reads from it, never a schema validator of its own
 * (validatePackageArgs()/Ajv already own real schema validation
 * elsewhere; this is a term-overlap decision, not a shape check).
 *
 * A review of the first cut of this file caught it reading the design
 * record's own `search_text: true` mark as an OPT-IN gate (only a
 * marked field is ever checked) - that shape is exactly right for
 * websearch, whose manifest is the only one that carries the mark
 * today, but it silently switched every OTHER package's string
 * arguments (remember's `fact`, recall's/knowledge's `topic`, music's
 * `query`, define's `word`, ...) from "checked" to "never checked,"
 * since "the executor's own exact-match validation" the record names
 * for identifiers, recipients, quantities and durations does not
 * actually exist anywhere in this codebase as a distinct mechanism
 * (`validatePackageArgs()` is JSON-Schema shape validation only - type,
 * required, enum - never "does this value relate to what the person
 * said"). Shipping the literal opt-in reading would have quietly
 * removed the anti-hallucination check from every package but one.
 * Fixed here to the reading that actually matches "ground the query,
 * not every field": a string argument is checked by DEFAULT (the
 * original behavior, preserved for every package that isn't
 * websearch), and only a manifest's own schema-typed fields - enum or
 * boolean, values the manifest supplies rather than the person - are
 * exempt. `search_text` is kept as a mark a manifest MAY still carry
 * (websearch's `expression` does) for a future, more precise per-field
 * policy; nothing here requires it. */
interface ArgPropertySchema {
  type?: string;
  enum?: readonly unknown[];
}
interface ArgSchema {
  properties?: Record<string, ArgPropertySchema>;
}

/** Checked one word at a time, never a literal array (the rule-budget
 * lint's word-list check is syntactic: a 3+-string array trips it
 * whatever it holds - the same reason messages.ts's windowRoleFromId()
 * and nodes/answer.ts's policyRefusalLine() are written this way too). */
function isPronounWord(word: string): boolean {
  return word === "he" || word === "she" || word === "it" || word === "they" || word === "him" || word === "her" || word === "them" || word === "his" || word === "hers" || word === "their" || word === "theirs" || word === "its";
}

// A code review caught the first cut of this checking the raw value
// verbatim ("it" passed, "it?"/"It." did not) - split the SAME way
// tokenize() itself splits (@/lib/text's own `[^a-z0-9']+` word
// boundary), before tokenize()'s stopword drop ever gets a chance to
// silently erase a lone "it" into an empty, trivially-passing term
// list (the `terms.length === 0` branch below is for a genuinely
// numbers-only argument, not a punctuation-dressed pronoun).
function isBarePronoun(value: string): boolean {
  // rule: grounding.bare_pronoun (docs/plans/turn-machine-state-record-2026-09-22.md, "Grounding, stated exactly", 2a28e4e8)
  const words = value.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 0);
  return words.length === 1 && isPronounWord(words[0]!);
}

/** GROUND-01's own live capture (data-scratch/ground-01-capture.md):
 * `{ expression: "president of chile", category: "images", read_page:
 * false }` against "who is the president of chile" refused on
 * `category` - an enum value the manifest itself supplies, never
 * something the household said, checked for term overlap anyway
 * because the old version treated "every string argument" as a search
 * query. This is the actual result: which field failed, `undefined`
 * when every field grounds (or nothing needed grounding at all). */
interface GroundingCheck {
  ok: boolean;
  /** The refusing argument's name only - never checked in a test,
   * never logged with the value (the state record's own "terms are the
   * person's data" ruling). */
  arg?: string;
}

function checkGrounding(args: Record<string, unknown>, sourceTexts: readonly string[], schema: ArgSchema | undefined): GroundingCheck {
  const sourceTerms = tokenize(sourceTexts.join(" "));
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const prop = schema?.properties?.[key];
    // Enum and boolean fields pass by schema alone (the manifest's own
    // fixed values, never something a person said - "images" is never
    // going to be in the utterance, and checking it there is exactly
    // U2d's live-run defect). A boolean never reaches here as a string
    // value anyway; kept for a schema that declares one loosely. Every
    // other string field is checked, the same as before this fix -
    // that is the actual bug this step closes (category and read_page
    // wrongly checked as if they were free text), not a reason to stop
    // checking anything else.
    if (prop?.enum !== undefined || prop?.type === "boolean") continue;
    if (isBarePronoun(value)) return { ok: false, arg: key };
    const terms = [...tokenize(value)].filter((t) => !PURE_NUMBER_RE.test(t));
    if (terms.length === 0) continue; // nothing left but numbers/stopwords - never counts against it
    if (!terms.some((t) => sourceTerms.has(t))) return { ok: false, arg: key };
  }
  return { ok: true };
}

export function argsGrounded(args: Record<string, unknown>, sourceTexts: readonly string[], schema?: ArgSchema): boolean {
  return checkGrounding(args, sourceTexts, schema).ok;
}

/** "The utterance, the window's user turns or the hub-said names"
 * (the ruling's own three sources) - narrower than the full context
 * list: a memory or a clock line grounds nothing a model didn't
 * actually say or hear this turn. The roster stands in for "hub-said
 * names" (no name-extraction from the hub's own prior turns exists -
 * every real pronoun-resolution case is a household member's name,
 * which the roster already carries). */
function groundingSourceTexts(utterance: string, context: TurnState["context"]): string[] {
  const texts = [utterance];
  for (const item of context) {
    if (item.source === "roster") texts.push(item.text);
    if (item.source === "window" && item.id.split("-")[1] === "user") texts.push(item.text);
  }
  return texts;
}

function rosterNames(contextItems: readonly { source: string; text: string }[]): string[] {
  return contextItems.filter((c) => c.source === "roster").map((c) => c.text);
}

function placeholderProposal(tool: string, call: ToolCall): ActionProposal {
  return { kind: "read_only", request: { tool, args: (call.args ?? {}) as Record<string, unknown>, callId: call.id ?? tool } };
}

export const policyNode: Node<PolicyInput, PolicyOutput> = async (state, input) => {
  const entries: PolicyEntry[] = [];
  // GROUND-01 ("1. Split the reason"): the trace's own record of "the
  // branch and the argument name, never the terms" - the first refusal
  // this call produces, whichever kind. One node execution covers every
  // proposal this turn, so the node-level outcome below can only speak
  // for the first refusal; every entry's own PolicyDecision (returned
  // in `output.entries`) still carries its own full reason regardless.
  let firstRefusal: { code: string; arg?: string } | undefined;
  const noteRefusal = (code: string, arg?: string): void => {
    if (!firstRefusal) firstRefusal = arg !== undefined ? { code, arg } : { code };
  };

  // "The model's own tool arguments as the query, grounded against the
  // window, not the line" (U2's brief), stated exactly by the owner's
  // ruling (state record, "Grounding, stated exactly", 2a28e4e8): the
  // utterance, the window's user turns, or the hub-said names (the
  // roster stands in for the last - see groundingSourceTexts()) - a
  // first-turn query like "president of Chile 2026" grounds against
  // THIS utterance (sharing "president"/"chile"); a follow-up's query
  // grounds against the window's prior user turn instead.
  const sourceTexts = groundingSourceTexts(state.utterance, state.context);
  const roster = rosterNames(state.context);

  for (const call of input.calls) {
    // The interim rule's own alternative tool: never a package, grounded
    // by the model node's own quote check against the window before it
    // ever reaches here (that node returns "answer_from_context" and
    // skips policy entirely - see machine.ts) - listed here only so a
    // model that calls it outside the interim rule (tool_choice "auto"
    // still offers it when it's in the budget's tools_offered) is
    // refused cleanly rather than crashing on a missing manifest. This
    // should never actually happen in practice; GROUND-01 gives it its
    // own reason precisely so a trace that DOES show it stands out from
    // an ordinary ungrounded search.
    if (call.tool === ANSWER_FROM_CONTEXT_TOOL_ID) {
      noteRefusal("context_tool_in_policy", call.tool);
      entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "context_tool_in_policy" } });
      continue;
    }

    const loaded = loadManifestOnly(call.tool);
    if (!loaded.ok) {
      noteRefusal("unknown_tool", call.tool);
      entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "unknown_tool" } });
      continue;
    }
    const manifest = loaded.value;
    const args = (call.args ?? {}) as Record<string, unknown>;
    const proposal: ActionProposal = {
      kind: manifest.consequential ? "side_effecting" : "read_only",
      request: { tool: call.tool, args, callId: call.id ?? call.tool },
    };

    if (state.crisis) {
      noteRefusal("crisis_state");
      entries.push({ proposal, decision: { allow: false, reason: "crisis_state" } });
      continue;
    }
    if (!meetsMinRole(state.actor.role, manifest.min_role)) {
      noteRefusal("min_role");
      entries.push({ proposal, decision: { allow: false, reason: "min_role" } });
      continue;
    }
    if (state.temporary && manifest.permissions?.includes("memory:write")) {
      noteRefusal("temporary_mode");
      entries.push({ proposal, decision: { allow: false, reason: "temporary_mode" } });
      continue;
    }
    const isPreConfirmed = input.preConfirmed?.request.tool === call.tool && JSON.stringify(input.preConfirmed.request.args) === JSON.stringify(args);
    if (!isPreConfirmed) {
      if (call.tool === "websearch" && roster.length > 0 && speakerNamedAny(JSON.stringify(args), roster)) {
        noteRefusal("consent_needed");
        entries.push({ proposal, decision: { allow: false, reason: "consent_needed", ask: { prompt: `Want me to look that up?` } } });
        continue;
      }
      const grounding = checkGrounding(args, sourceTexts, manifest.args as ArgSchema | undefined);
      if (!grounding.ok) {
        noteRefusal("ungrounded_args", grounding.arg);
        entries.push({ proposal, decision: { allow: false, reason: "ungrounded_args" } });
        continue;
      }
      if (manifest.consequential) {
        noteRefusal("confirm_needed");
        entries.push({ proposal, decision: { allow: false, reason: "confirm_needed", ask: { prompt: `Go ahead and ${manifest.display.toLowerCase()}?` } } });
        continue;
      }
    }

    entries.push({ proposal, decision: { allow: true } });
  }

  const outcome = firstRefusal ? { ok: false as const, code: firstRefusal.code, arg: firstRefusal.arg } : { ok: true as const };
  return { outcome, output: { entries } };
};
