// NEWS-02, RULES 6a: News counters carry a fixed name and nothing else. Never an item, a title, an address, a host, a person or a
// hash of any of them. The list is closed (a name outside it cannot be bumped), and the test that enumerates it is the row.
export const NEWS_COUNTER_NAMES = [
  "picture_fetched",
  "picture_failed",
  "picture_ssrf_blocked",
  "picture_host_backoff",
  "picture_host_quiet",
  "picture_paced",
  "picture_too_big",
  "story_opened",
  "story_text_fetched",
  "story_text_teaser",
  "story_text_failed",
  "story_gate_dropped",
  "route_refused",
] as const;

export type NewsCounterName = (typeof NEWS_COUNTER_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(NEWS_COUNTER_NAMES);
const counts = new Map<string, number>();

export function bumpNewsCounter(name: NewsCounterName, by = 1): void {
  if (!NAME_SET.has(name) || by <= 0) return;
  counts.set(`news.${name}`, (counts.get(`news.${name}`) ?? 0) + by);
}

/** A copy of every counter, keys like `news.picture_fetched`. */
export function newsCounters(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function __resetNewsCountersForTests(): void {
  counts.clear();
}
