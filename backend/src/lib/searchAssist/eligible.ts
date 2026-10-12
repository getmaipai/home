// ROUTER-BUILD-01c: who the search assist may score and who it may rescue.
// Pure and decided before any embed is requested (rule 0 wins by
// construction, not by a threshold). MINOR-SEARCH-01i: a child or teen is
// scored only when the gate would allow the search, the web is on for the
// band and the turn already has a recall vector; a minor is never rescued
// while MINOR_RESCUE_ENABLED is false. Spoken turns are scored, never rescued.
import type { AgeBand } from "@/lib/ageBand";
import { turnAgeBand, speakerIsAnonymous } from "@/lib/turnMachine/speaker";
import type { TurnState } from "@/lib/turnMachine/contract";

export type SearchAssistMode = "off" | "shadow" | "rescue";

export type EligibilityState = Pick<
  TurnState,
  "surface" | "actor" | "speakerEvidence" | "spoken" | "bare" | "crisis" | "continuation" | "promptLimit" | "budget" | "planBasis" | "outcomes"
>;

/** MINOR-SEARCH-01i: the one switch for rescuing a minor's turn. Stays false
 * until the minor bench passes (MINOR-SEARCH-01j); nothing reads a setting. */
export const MINOR_RESCUE_ENABLED = false;

export type OffReason = "mode_off" | "gate_not_allow" | "web_off_for_mode" | "no_recall_vector" | "anonymous" | "no_websearch" | "no_tools_turn";

/** What a minor's turn must show before it is scored; absent fails closed. */
export interface MinorEligibility {
  gateAllows: boolean;
  webOn: boolean;
  recallVector: boolean;
}

/** The mode a band may actually run: a minor never runs rescue while the constant is false. */
export function cappedSearchAssistMode(band: AgeBand, mode: SearchAssistMode): SearchAssistMode {
  return band !== "adult" && !MINOR_RESCUE_ENABLED && mode === "rescue" ? "shadow" : mode;
}

export interface Eligibility {
  scored: boolean;
  rescuable: boolean;
  off_reason?: OffReason;
}

export interface EligibilityContext {
  now?: Date;
  /** How many tool calls the model's round made. Left out until the round
   * has started: a rescue is never allowed without knowing it was zero. */
  modelToolCalls?: number;
  /** Required to score a child or teen. */
  minor?: MinorEligibility;
}

// Same rule as nodes/model.ts's noToolsTurn (private there): a bare turn, a
// continuation, a crisis turn or a core-only prompt offers no tool.
function noToolsTurn(state: EligibilityState): boolean {
  return state.bare === true || state.continuation !== undefined || state.crisis === true || state.promptLimit !== undefined;
}

const NOT_SCORED = (off_reason: OffReason): Eligibility => ({ scored: false, rescuable: false, off_reason });

export function searchAssistEligibility(state: EligibilityState, mode: SearchAssistMode, ctx: EligibilityContext = {}): Eligibility {
  if (mode === "off") return NOT_SCORED("mode_off");
  if (speakerIsAnonymous(state)) return NOT_SCORED("anonymous");
  const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, ctx.now ?? new Date());
  const minor = band !== "adult";
  if (!state.budget.tools_offered.includes("websearch")) return NOT_SCORED("no_websearch");
  if (noToolsTurn(state)) return NOT_SCORED("no_tools_turn");
  if (minor) {
    if (!ctx.minor || !ctx.minor.gateAllows) return NOT_SCORED("gate_not_allow");
    if (!ctx.minor.webOn) return NOT_SCORED("web_off_for_mode");
    if (!ctx.minor.recallVector) return NOT_SCORED("no_recall_vector");
  }
  const rescuable =
    cappedSearchAssistMode(band, mode) === "rescue" &&
    !state.spoken &&
    state.planBasis.surfaceClass === "written" &&
    state.outcomes.length === 0 &&
    ctx.modelToolCalls === 0;
  return { scored: true, rescuable };
}
