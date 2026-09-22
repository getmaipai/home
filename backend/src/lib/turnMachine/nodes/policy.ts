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
import type { Node, ActionProposal, PolicyDecision, ToolCall } from "../contract";
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

/** A string argument value is grounded when it appears, verbatim, in
 * some context item's text - the "set check, not a judgment" the state
 * record names. Numbers/booleans ground trivially (nothing to quote);
 * only string values (a query, a name, a quote) need to be traceable
 * back to something the conversation actually said. */
function argsGrounded(args: Record<string, unknown>, contextTexts: readonly string[]): boolean {
  for (const value of Object.values(args)) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const grounded = contextTexts.some((text) => text.toLowerCase().includes(value.toLowerCase()));
    if (!grounded) return false;
  }
  return true;
}

function rosterNames(contextItems: readonly { source: string; text: string }[]): string[] {
  return contextItems.filter((c) => c.source === "roster").map((c) => c.text);
}

function placeholderProposal(tool: string, call: ToolCall): ActionProposal {
  return { kind: "read_only", request: { tool, args: (call.args ?? {}) as Record<string, unknown>, callId: call.id ?? tool } };
}

export const policyNode: Node<PolicyInput, PolicyOutput> = async (state, input) => {
  const entries: PolicyEntry[] = [];
  // "The model's own tool arguments as the query, grounded against the
  // window, not the line" (U2's brief) reads, in unspokenArgs.ts's own
  // replacement note, as an expansion over the old path's utterance-
  // only check ("an argument must come from the conversation" - the
  // whole conversation, this turn's own line included, not only the
  // window's prior turns): a first-turn query like "president of
  // chile" grounds against THIS utterance; a follow-up's query grounds
  // against the window's prior turn instead. Both need to ground here.
  const contextTexts = [state.utterance, ...state.context.map((c) => c.text)];
  const roster = rosterNames(state.context);

  for (const call of input.calls) {
    // The interim rule's own alternative tool: never a package, grounded
    // by the model node's own quote check against the window before it
    // ever reaches here (that node returns "answer_from_context" and
    // skips policy entirely - see machine.ts) - listed here only so a
    // model that calls it outside the interim rule (tool_choice "auto"
    // still offers it when it's in the budget's tools_offered) is
    // refused cleanly rather than crashing on a missing manifest.
    if (call.tool === ANSWER_FROM_CONTEXT_TOOL_ID) {
      entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "ungrounded_args" } });
      continue;
    }

    const loaded = loadManifestOnly(call.tool);
    if (!loaded.ok) {
      entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "ungrounded_args" } });
      continue;
    }
    const manifest = loaded.value;
    const args = (call.args ?? {}) as Record<string, unknown>;
    const proposal: ActionProposal = {
      kind: manifest.consequential ? "side_effecting" : "read_only",
      request: { tool: call.tool, args, callId: call.id ?? call.tool },
    };

    if (state.crisis) {
      entries.push({ proposal, decision: { allow: false, reason: "crisis_state" } });
      continue;
    }
    if (!meetsMinRole(state.actor.role, manifest.min_role)) {
      entries.push({ proposal, decision: { allow: false, reason: "min_role" } });
      continue;
    }
    if (state.temporary && manifest.permissions?.includes("memory:write")) {
      entries.push({ proposal, decision: { allow: false, reason: "temporary_mode" } });
      continue;
    }
    const isPreConfirmed = input.preConfirmed?.request.tool === call.tool && JSON.stringify(input.preConfirmed.request.args) === JSON.stringify(args);
    if (!isPreConfirmed) {
      if (call.tool === "websearch" && roster.length > 0 && speakerNamedAny(JSON.stringify(args), roster)) {
        entries.push({ proposal, decision: { allow: false, reason: "consent_needed", ask: { prompt: `Want me to look that up?` } } });
        continue;
      }
      if (!argsGrounded(args, contextTexts)) {
        entries.push({ proposal, decision: { allow: false, reason: "ungrounded_args" } });
        continue;
      }
      if (manifest.consequential) {
        entries.push({ proposal, decision: { allow: false, reason: "confirm_needed", ask: { prompt: `Go ahead and ${manifest.display.toLowerCase()}?` } } });
        continue;
      }
    }

    entries.push({ proposal, decision: { allow: true } });
  }

  return { outcome: { ok: true }, output: { entries } };
};
