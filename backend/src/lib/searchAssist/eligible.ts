// ROUTER-BUILD-01c: who the search assist may score and who it may rescue.
// Pure and decided before any embed is requested (rule 0 wins by
// construction, not by a threshold): children and teens are never scored,
// spoken turns are scored but never rescued.
import { turnAgeBand, speakerIsAnonymous } from "@/lib/turnMachine/speaker";
import type { TurnState } from "@/lib/turnMachine/contract";

export type SearchAssistMode = "off" | "shadow" | "rescue";

export type EligibilityState = Pick<
  TurnState,
  "surface" | "actor" | "speakerEvidence" | "spoken" | "bare" | "crisis" | "continuation" | "promptLimit" | "budget" | "planBasis" | "outcomes"
>;

export type OffReason = "mode_off" | "band_child" | "band_teen" | "anonymous" | "no_websearch" | "no_tools_turn";

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
  if (band !== "adult") return NOT_SCORED(band === "child" ? "band_child" : "band_teen");
  if (!state.budget.tools_offered.includes("websearch")) return NOT_SCORED("no_websearch");
  if (noToolsTurn(state)) return NOT_SCORED("no_tools_turn");
  const rescuable =
    mode === "rescue" &&
    !state.spoken &&
    state.planBasis.surfaceClass === "written" &&
    state.outcomes.length === 0 &&
    ctx.modelToolCalls === 0;
  return { scored: true, rescuable };
}
