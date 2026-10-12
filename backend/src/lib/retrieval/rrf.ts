// SEARCH-SOURCES-01: reciprocal-rank fusion, defined once. Episode recall
// (episodes.ts) and the web-source blend (webSources.ts) both call it, so the
// constant and the tie rule have one home (principle 1). Pure: it reads ranks
// and keys, never text (rule 1).
export const RRF_K = 60;

export interface Fused<T> {
  key: string;
  /** The first occurrence of this key (the earliest list, then the best rank). */
  item: T;
  /** The last occurrence, for callers whose later list carries the fuller row. */
  last: T;
  /** sum over the lists that returned it of 1 / (k + rank + 1), rank counted from 0. */
  score: number;
}

/** Fuse ranked lists. Items sharing a key are one entry. Sorted by score, highest first;
 * a tie keeps the order of first appearance (list order, then rank), so the stored
 * order of the lists decides it. */
export function reciprocalRankFusion<T>(lists: readonly (readonly T[])[], keyOf: (item: T) => string, k: number = RRF_K): Fused<T>[] {
  const fused = new Map<string, Fused<T>>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      const gain = 1 / (k + rank + 1);
      const prev = fused.get(key);
      if (prev) {
        prev.score += gain;
        prev.last = item;
      } else {
        fused.set(key, { key, item, last: item, score: gain });
      }
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
