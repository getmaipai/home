// U2 (turn-machine-state-record-2026-09-22.md, "The budget record"):
// resolves the household's selected chat model's turn_budget from the
// catalog. "A model with no record runs with model_transitions false" -
// the one fallback the design names, applied here rather than at every
// call site. THIN-6B (rule 8) narrows it to a child's or teen's turn: an
// adult's turn on a model without a record gets tools and thinking.
import { getHouseholdSettingValue } from "@/lib/settings";
import { CATALOG } from "@/lib/modelCatalog";
import type { AgeBand } from "@/lib/ageBand";
import type { TurnBudget } from "./contract";

/** No search, no second round, no model-driven transition: the safest
 * possible shape, identical to what the design says a record-less model
 * gets. Never mutated; returned as-is by resolveTurnBudget() below. */
export const NO_RECORD_BUDGET: TurnBudget = {
  rounds: 0,
  tools_offered: [],
  answer_from_context_tool: false,
  model_transitions: false,
  context_tokens: 2000,
  thinking_budget_tokens: 0,
  // THINK-DEFAULT-01: the safest shape stays safest even toggled on -
  // an unmeasured model gets no reasoning either way.
  thinking_budget_tokens_toggled: 0,
  thinking_for_minors: false,
  // The reply floor: 1024, the design record's own NO_RECORD_BUDGET
  // figure - smaller than a measured model's ceiling, matching this
  // budget's already-smaller context_tokens.
  reply_ceiling_tokens: 1024,
  deadlines_ms: { model: 20000, tool: 10000, total: 45000 },
  measured: { false_call_rate: 0, inverse_miss_rate: 0, rewrite_pass_rate: 0, on: "no measured record" },
};

/** THIN-6B (rules 0 and 8): what an adult gets from a chat model that has
 * no measured record. Nothing is gated on one catalog id, so the model runs
 * with the tools and the toggled thinking budget of the catalog's reference
 * chat record (the tools block and the reasoning split come from the
 * engine's own template); only the figures that were measured for that one
 * model are not claimed for this one. Built per call, never shared. */
function unmeasuredAdultBudget(): TurnBudget {
  const reference = CATALOG.find((m) => m.role === "chat" && m.turn_budget)?.turn_budget;
  if (!reference) return NO_RECORD_BUDGET;
  return { ...reference, measured: { ...NO_RECORD_BUDGET.measured } };
}

/** Reads the household's selected chat model id (chat.model_id, the
 * same key llmSupervisor.ts already reads) and its catalog entry's
 * turn_budget. A modelId override lets a caller (U2d's second-model
 * acceptance run, a test) resolve a budget without changing the live
 * household setting.
 *
 * Age gates win (rule 0): a model with no record, a failed read of the
 * selected model, or a band that is not exactly "adult" keeps the no-tools
 * fail-safe for a child or teen. Only an adult's turn on a recordless model
 * is lifted to the reference record's tools and thinking. A band left out
 * reads as a minor. */
export function resolveTurnBudget(modelId?: string, band?: AgeBand): TurnBudget {
  let id = modelId;
  if (id === undefined) {
    try {
      id = getHouseholdSettingValue("chat.model_id") as string | undefined;
    } catch {
      return band === "adult" ? unmeasuredAdultBudget() : NO_RECORD_BUDGET;
    }
  }
  const entry = id ? CATALOG.find((m) => m.role === "chat" && m.id === id) : undefined;
  if (entry?.turn_budget) return entry.turn_budget;
  return band === "adult" ? unmeasuredAdultBudget() : NO_RECORD_BUDGET;
}
