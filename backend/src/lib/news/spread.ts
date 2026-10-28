// The Today list's rows come newest first, so one publisher that posts a whole batch at once (a journal's weekly issue) can fill a
// day group with its own stories. This keeps the first few of each publisher per group and leaves the rest to that publisher's own
// channel and its topic page.

/** Most rows one publisher gets under one day heading on the main Today list. */
export const ROWS_PER_PUBLISHER_PER_GROUP = 4;

/** Rows newest first in, rows newest first out, with at most `cap` per publisher in each group. */
export function spreadPublishers<T extends { publisher: string }>(rows: readonly T[], groupOf: (row: T) => string, cap = ROWS_PER_PUBLISHER_PER_GROUP): T[] {
  const counts = new Map<string, number>();
  return rows.filter((row) => {
    const key = `${groupOf(row)}\u0000${row.publisher}`;
    const count = counts.get(key) ?? 0;
    counts.set(key, count + 1);
    return count < cap;
  });
}
