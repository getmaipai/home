// KS-01, rule 6a (docs/design/RULES.md): counters for tier K carry a
// fixed name and, at most, an age band. Never a query, a title, a book
// path, a person id or a hash of any of them. The names are a closed
// list, so a counter that is not in it cannot be bumped (a type error,
// and a runtime refusal), and the test that enumerates the list is the
// row the org rule asks for ("a rule needs a counter and a row").
import type { AgeBand } from "@/lib/ageBand";

export const REFERENCE_COUNTER_NAMES = [
  "suggest",
  "search",
  "content",
  "cache_hit",
  "cache_miss",
  "title_match",
  "no_match",
  "disambiguation",
  "source_excluded",
  "floor_dropped",
  "ingest_floor_dropped",
  "unavailable",
  "extract_empty",
  "scope_reference",
  "scope_web",
  "scope_both",
  "k_lead",
  "wikimedia_live_call",
  "wikimedia_live_skipped_k_match",
  // KS-MODE-01: the search source mode. Names only, plus the age band.
  "mode_blocked_offline",
  "mode_mix_library_hit",
  "mode_mix_live_fallthrough",
  // KS-02C: show_images read the library for the subject's Wikipedia page.
  "image_k_hit",
  "image_k_miss",
  "image_wikipedia_calls_saved",
  // DEFINE-FALLBACK-01: the optional live Wiktionary word lookup. Names only, plus the age band.
  "dictionary_live_call",
  "dictionary_live_hit",
  "dictionary_live_cache_hit",
  "dictionary_live_backoff",
  "dictionary_live_failed",
] as const;

export type ReferenceCounterName = (typeof REFERENCE_COUNTER_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(REFERENCE_COUNTER_NAMES);
const counts = new Map<string, number>();

function key(name: ReferenceCounterName, band?: AgeBand): string {
  return band ? `reference.${name}.${band}` : `reference.${name}`;
}

export function bumpReferenceCounter(name: ReferenceCounterName, band?: AgeBand, by = 1): void {
  if (!NAME_SET.has(name) || by <= 0) return;
  const k = key(name, band);
  counts.set(k, (counts.get(k) ?? 0) + by);
}

/** A copy of every counter, keys like `reference.floor_dropped.child`. */
export function referenceCounters(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function __resetReferenceCountersForTests(): void {
  counts.clear();
}
