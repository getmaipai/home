// KS-05, rule 6a (docs/design/RULES.md): shelf counters carry a fixed name
// and, at most, an age band. Never a feed address, a title, a publisher, a
// person id or a hash of any of them. The list is closed, so a counter that
// is not in it cannot be bumped, and the test that enumerates it is the row
// the org rule asks for ("a rule needs a counter and a row").
import type { AgeBand } from "@/lib/ageBand";

export const SHELF_COUNTER_NAMES = [
  "feeds_polled",
  "items_polled",
  "items_stored",
  "items_duplicate",
  "responses_304",
  "backoff_events",
  "poll_failed",
  "ssrf_blocked",
  "link_dropped",
  "floor_dropped_by_tier",
  "release_floor_dropped",
  "items_pruned",
  "skipped_busy",
] as const;

export type ShelfCounterName = (typeof SHELF_COUNTER_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(SHELF_COUNTER_NAMES);
const counts = new Map<string, number>();

export function bumpShelfCounter(name: ShelfCounterName, band?: AgeBand, by = 1): void {
  if (!NAME_SET.has(name) || by <= 0) return;
  const key = band ? `shelf.${name}.${band}` : `shelf.${name}`;
  counts.set(key, (counts.get(key) ?? 0) + by);
}

/** A copy of every counter, keys like `shelf.items_polled`. */
export function shelfCounters(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function __resetShelfCountersForTests(): void {
  counts.clear();
}
