// U2 (turn-machine-state-record-2026-09-22.md, "The budget record"):
// resolves the household's selected chat model's turn_budget from the
// catalog. "A model with no record runs with model_transitions false" -
// the one fallback the design names, applied here rather than at every
// call site. THIN-6B (rule 8) narrows it to a child's or teen's turn: an
// adult's turn on a model without a record gets tools and thinking.
import { getHouseholdSettingValue } from "@/lib/settings";
import { CATALOG, thinkingModeFor } from "@/lib/modelCatalog";
import { listInstalledManifests } from "@/lib/plugins";
import { allPackageStatuses } from "@/lib/smoke";
import { VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { chatWindowContext, MINIMUM_CHAT_WINDOW_TOKENS } from "@/lib/roleHealth";
import type { AgeBand } from "@/lib/ageBand";
import type { TurnBudget } from "./contract";

/** DEADLINE-02: the stream watchdog's defaults, used when a model's record
 * (which carries only model, tool and total) names none. */
export const FIRST_TOKEN_DEADLINE_MS = 90000;
export const STALL_DEADLINE_MS = 20000;

type RecordedDeadlines = { model: number; tool: number; total: number; first_token_ms?: number; stall_ms?: number };
let offerOverridesForTests = new Set<string>();

/** Lets a focused test or benchmark measure a candidate while its manifest
 * remains off in production. Status and model-cap checks still apply. */
export function __setToolOfferOverridesForTests(ids: string[] | null): void {
  offerOverridesForTests = new Set(ids ?? []);
}

/** A catalog record's budget with the two stream fields filled in; the old
 * keys read exactly as measured. */
function withStreamDeadlines(
  budget: Omit<TurnBudget, "deadlines_ms" | "tools_offered"> & { tools_offered?: string[]; deadlines_ms: RecordedDeadlines },
): TurnBudget {
  const d = budget.deadlines_ms;
  // spec-v0.1.102 keeps tools_offered only as optional migration data.
  // A record without it is unmeasured for tools, so fail closed.
  return {
    ...budget,
    tools_offered: budget.tools_offered ?? [],
    deadlines_ms: { ...d, first_token_ms: d.first_token_ms ?? FIRST_TOKEN_DEADLINE_MS, stall_ms: d.stall_ms ?? STALL_DEADLINE_MS },
  };
}

/** No search, no second round, no model-driven transition: the safest
 * possible shape, identical to what the design says a record-less model
 * gets. Never mutated; returned as-is by resolveTurnBudget() below. */
export const NO_RECORD_BUDGET: TurnBudget = {
  rounds: 0,
  max_tools: 0,
  tools_offered: [],
  model_transitions: false,
  context_tokens: MINIMUM_CHAT_WINDOW_TOKENS,
  context_window_tokens: null,
  thinking_budget_tokens: 0,
  // THINK-DEFAULT-01: the safest shape stays safest even toggled on -
  // an unmeasured model gets no reasoning either way.
  thinking_budget_tokens_toggled: 0,
  thinking_for_minors: false,
  // The reply floor: 1024, the design record's own NO_RECORD_BUDGET
  // figure - smaller than a measured model's ceiling, matching this
  // budget's already-smaller context_tokens.
  reply_ceiling_tokens: 1024,
  deadlines_ms: { model: 20000, tool: 10000, total: 45000, first_token_ms: FIRST_TOKEN_DEADLINE_MS, stall_ms: STALL_DEADLINE_MS },
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
  return withStreamDeadlines({ ...internalBudgetFromRecord(reference), measured: { ...NO_RECORD_BUDGET.measured } });
}

type CatalogTurnBudget = NonNullable<(typeof CATALOG)[number]["turn_budget"]>;

/** Catalog tool ids are migration-only data. Convert every other measured
 * field into the turn contract and leave the live offer empty until the
 * manifest-derived policy below fills it. */
function internalBudgetFromRecord(record: CatalogTurnBudget): Omit<TurnBudget, "deadlines_ms"> & { deadlines_ms: RecordedDeadlines } {
  const { tools_offered: _deprecatedToolsOffered, max_tools, ...rest } = record;
  return { ...rest, max_tools: max_tools ?? 0, tools_offered: [] } as Omit<TurnBudget, "deadlines_ms"> & { deadlines_ms: RecordedDeadlines };
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
      return band === "adult" ? withTurnToolGates(unmeasuredAdultBudget(), false) : NO_RECORD_BUDGET;
    }
  }
  const entry = id ? CATALOG.find((m) => m.role === "chat" && m.id === id) : undefined;
  const base = entry?.turn_budget ? withStreamDeadlines(internalBudgetFromRecord(entry.turn_budget)) : band === "adult" ? unmeasuredAdultBudget() : NO_RECORD_BUDGET;
  // VISION-02d (rule 8): a model whose record declares no thinking mode is
  // never asked to think, whatever the person's toggle says.
  const resolved = thinkingModeFor(id) === "none" ? { ...base, thinking_budget_tokens: 0, thinking_budget_tokens_toggled: 0 } : base;
  return withTurnToolGates(resolved, false);
}

export async function resolveTurnBudgetWithStack(modelId?: string, band?: AgeBand): Promise<TurnBudget> {
  const base = resolveTurnBudget(modelId, band);
  const context = await chatWindowContext();
  // VISION-02d (rule 8, a review): the model the Stack actually runs also
  // decides thinking; a chat model with no thinking mode is never asked to
  // think, whatever the household setting or the person's toggle says.
  const runs = modelId ?? context.modelId;
  const thinking = runs !== undefined && thinkingModeFor(runs) === "none" ? { thinking_budget_tokens: 0, thinking_budget_tokens_toggled: 0 } : {};
  return { ...base, ...thinking, context_tokens: context.tokens, context_window_tokens: context.reported ? context.tokens : null };
}

function offerPassesGate(offer: { mode: string; gate?: string; bench_row?: string }, answerImagesOk: boolean): boolean {
  if (offer.mode === "base") return true;
  return offer.mode === "conditional" && offer.gate === "answerImagesAllowed" && Boolean(offer.bench_row) && answerImagesOk;
}

export function toolOfferLabel(manifest: { kind?: string; args?: unknown; offer?: { mode: string; reason?: string; gate?: string } }, status: "enabled" | "disabled", usedInChat = false): string | null {
  if (manifest.kind !== "plugin") return null;
  if (status === "disabled") return "not offered: package disabled";
  if (manifest.offer?.mode === "off") return `not offered: ${manifest.offer.reason ?? "off"}`;
  if (manifest.offer?.mode === "conditional" && !usedInChat) return `not offered: ${manifest.offer.gate ?? "gate not met"}`;
  if (!manifest.offer) return "not offered: not measured";
  return null;
}

/** Derives the one live offer set used by turns, token counting, warmup,
 * and the Customize page. Installed manifests and the virtual registry
 * are the only sources; disabled or smoke-failed packages are excluded,
 * off and unmeasured tools stay out, and exceeding the model cap is a
 * configuration error rather than a silently shortened offer. */
export function withTurnToolGates(budget: TurnBudget, answerImagesOk: boolean): TurnBudget {
  const cap = budget.max_tools ?? 0;
  if (budget === NO_RECORD_BUDGET) return budget;
  if (cap === 0) return budget.tools_offered.length === 0 ? budget : { ...budget, tools_offered: [] };

  const statuses = allPackageStatuses();
  const candidates = new Map<string, { id: string; priority: number }>();
  for (const manifest of listInstalledManifests()) {
    const offer = manifest.offer;
    const forcedForMeasurement = offerOverridesForTests.has(manifest.id);
    if (!forcedForMeasurement && (!offer || !offerPassesGate(offer, answerImagesOk))) continue;
    const status = statuses.get(manifest.id);
    if (status && (status.status !== "enabled" || status.smokeOk === false)) continue;
    candidates.set(manifest.id, { id: manifest.id, priority: offer?.priority ?? 1000 });
  }
  for (const tool of VIRTUAL_TOOL_REGISTRY) {
    if (offerOverridesForTests.has(tool.id) || offerPassesGate(tool.offer, answerImagesOk)) candidates.set(tool.id, { id: tool.id, priority: tool.offer.priority ?? 1000 });
  }

  const ordered = [...candidates.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  if (ordered.length > cap) {
    throw new Error(`Derived tool offer set (${ordered.length}) exceeds the model cap (${cap}).`);
  }
  return { ...budget, tools_offered: ordered.map(({ id }) => id) };
}
