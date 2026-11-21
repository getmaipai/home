export const SPECIFICS_CHECK_COUNTER_NAMES = ["checked", "flagged", "clear", "unavailable", "skipped"] as const;
export type SpecificsCheckCounterName = (typeof SPECIFICS_CHECK_COUNTER_NAMES)[number];
const allowed: ReadonlySet<string> = new Set(SPECIFICS_CHECK_COUNTER_NAMES);
const counts = new Map<string, number>();

export function bumpSpecificsCheckCounter(name: SpecificsCheckCounterName, by = 1): void {
  if (!allowed.has(name) || by <= 0) return;
  const key = `specifics_check.${name}`;
  counts.set(key, (counts.get(key) ?? 0) + by);
}

export function specificsCheckCounters(): Record<string, number> { return Object.fromEntries(counts); }
export function __resetSpecificsCheckCountersForTests(): void { counts.clear(); }
