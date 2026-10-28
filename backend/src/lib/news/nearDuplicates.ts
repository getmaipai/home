// NEWS-DEDUPE-01: two outlets' stories about one event collapse to one card on a mixed page. Pure and local: normalised title
// tokens, a publish-time window and a shared topic. No model, no network, no store, so it adds nothing to first paint.
//
// Two stories are the same event when they were published within DUPLICATE_WINDOW_H hours, share a topic (or both have none),
// and their content words overlap: at least SHARED_MIN shared and a Jaccard of at least JACCARD_MIN. The best of a cluster is
// the one with a picture, then more outlets, then the newest. The others are not deleted: a topic page does not collapse.

export interface DuplicateCandidate {
  item_id: string;
  title: string;
  topics: string[];
  published_at: string;
  outlets: number;
  has_image: boolean;
}

export const DUPLICATE_WINDOW_H = 24;
export const SHARED_MIN = 3;
export const JACCARD_MIN = 0.5;

const STOP = new Set(["the", "and", "for", "with", "from", "into", "over", "after", "about", "that", "this", "its", "his", "her", "their", "are", "was", "will", "has", "have", "had", "new", "says", "say", "could", "would", "than", "more", "not", "but", "you", "your", "all", "out", "off", "how", "why", "what", "who", "may", "can"]);

/** Content words of a headline: lower-case letters and digits, no short or stop words, a trailing plural `s` removed. */
export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of title.toLowerCase().replace(/[’']s\b/g, "").split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    tokens.add(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return tokens;
}

function sameEvent(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared >= SHARED_MIN && shared / (a.size + b.size - shared) >= JACCARD_MIN;
}

function better(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (a.has_image !== b.has_image) return a.has_image;
  if (a.outlets !== b.outlets) return a.outlets > b.outlets;
  const [ta, tb] = [Date.parse(a.published_at), Date.parse(b.published_at)];
  if (ta !== tb && Number.isFinite(ta) && Number.isFinite(tb)) return ta > tb;
  return a.item_id < b.item_id;
}

/** The item ids to keep, mapped to the item ids each one stands for ("also covered by"). Items not in a cluster map to []. */
export function collapseNearDuplicates(items: DuplicateCandidate[]): Map<string, string[]> {
  const tokens = items.map((item) => titleTokens(item.title));
  const times = items.map((item) => Date.parse(item.published_at));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const gap = Math.abs(times[i]! - times[j]!);
      if (Number.isFinite(gap) && gap > DUPLICATE_WINDOW_H * 3_600_000) continue;
      const a = items[i]!.topics;
      const b = items[j]!.topics;
      if (!(a.length === 0 && b.length === 0) && !a.some((t) => b.includes(t))) continue;
      if (sameEvent(tokens[i]!, tokens[j]!)) parent[find(j)] = find(i);
    }
  }
  const clusters = new Map<number, DuplicateCandidate[]>();
  items.forEach((item, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), item]));
  const kept = new Map<string, string[]>();
  for (const members of clusters.values()) {
    const best = members.reduce((x, y) => (better(y, x) ? y : x));
    kept.set(best.item_id, members.filter((m) => m !== best).map((m) => m.item_id));
  }
  return kept;
}
