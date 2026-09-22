// U2 (turn-machine-state-record-2026-09-22.md, "The budget record"):
// resolves the household's selected chat model's turn_budget from the
// catalog. "A model with no record runs with model_transitions false" -
// the one fallback the design names, applied here rather than at every
// call site, so a model added to the catalog without a measured record
// yet still runs the machine, just with no model-driven transition.
import { getHouseholdSettingValue } from "@/lib/settings";
import { CATALOG } from "@/lib/modelCatalog";
import type { TurnBudget } from "./contract";

/** No search, no second round, no model-driven transition: the safest
 * possible shape, identical to what the design says a record-less model
 * gets. Never mutated; returned as-is by resolveTurnBudget() below. */
export const NO_RECORD_BUDGET: TurnBudget = {
  rounds: 0,
  tools_offered: [],
  always_search: false,
  answer_from_context_tool: false,
  model_transitions: false,
  context_tokens: 2000,
  thinking_budget_tokens: 0,
  deadlines_ms: { model: 20000, tool: 10000, total: 45000 },
  measured: { false_call_rate: 0, inverse_miss_rate: 0, rewrite_pass_rate: 0, on: "no measured record" },
};

/** Reads the household's selected chat model id (chat.model_id, the
 * same key llmSupervisor.ts already reads) and its catalog entry's
 * turn_budget. A modelId override lets a caller (U2d's second-model
 * acceptance run, a test) resolve a budget without changing the live
 * household setting. */
export function resolveTurnBudget(modelId?: string): TurnBudget {
  const id = modelId ?? (getHouseholdSettingValue("chat.model_id") as string | undefined);
  const entry = id ? CATALOG.find((m) => m.role === "chat" && m.id === id) : undefined;
  return entry?.turn_budget ?? NO_RECORD_BUDGET;
}
