// ROUTER-BUILD-01d: counters for the search assist, on the
// retrieval/referenceCounters.ts pattern. A fixed name and, at most, an age
// band. Never an utterance, a query, a person id or a hash of any of them.
// The names are a closed list, so a counter outside it cannot be bumped (a
// type error, and a runtime refusal).
import type { AgeBand } from "@/lib/ageBand";

export const SEARCH_ASSIST_COUNTER_NAMES = [
  "scored",
  "over_threshold",
  "rescued",
  "rescued_at_budget",
  "skipped_band",
  "skipped_surface",
  "off",
  "weights_missing",
  "embed_mismatch",
  "error",
] as const;

export type SearchAssistCounterName = (typeof SEARCH_ASSIST_COUNTER_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(SEARCH_ASSIST_COUNTER_NAMES);
const counts = new Map<string, number>();

function key(name: SearchAssistCounterName, band?: AgeBand): string {
  return band ? `search_assist.${name}.${band}` : `search_assist.${name}`;
}

export function bumpSearchAssistCounter(name: SearchAssistCounterName, band?: AgeBand, by = 1): void {
  if (!NAME_SET.has(name) || by <= 0) return;
  const k = key(name, band);
  counts.set(k, (counts.get(k) ?? 0) + by);
}

/** A copy of every counter, keys like `search_assist.skipped_band.child`. */
export function searchAssistCounters(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function __resetSearchAssistCountersForTests(): void {
  counts.clear();
}
