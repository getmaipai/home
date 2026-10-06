// The fields a real turn always carries (turnNext.ts builds them before any
// node runs) for a test that hands a node a partial TurnState: the context
// node sizes the window from the budget, the persona and the plan (THIN-3C).
import { NO_RECORD_BUDGET } from "@/lib/turnMachine/budget";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { planFor } from "@/lib/register";
import { speakerAgeBand } from "@/lib/ageBand";
import type { TurnState } from "@/lib/turnMachine/contract";

export function withTurnDefaults(partial: TurnState): TurnState {
  const band = speakerAgeBand(partial.actor, new Date());
  const signal = partial.signal ?? classifyTurnSignal({ text: partial.utterance ?? "", ageBand: band, commandOpeners: new Set<string>() });
  const planBasis = partial.planBasis ?? ({ signal, surface: partial.surface, surfaceClass: "written", brevity: false, companion: { directness: "direct", engagement: "balanced", complexity: "standard" }, band, deferred: false, disclosureWithheld: false } as TurnState["planBasis"]);
  return { ...partial, budget: partial.budget ?? NO_RECORD_BUDGET, persona: partial.persona ?? DEFAULT_PERSONA, signal, planBasis, plan: partial.plan ?? planFor({ ...planBasis, evidence: { choices: 0, sources: 0, deliverable: false } }) } as TurnState;
}
