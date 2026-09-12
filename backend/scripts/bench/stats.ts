// One quantile for every bench in this directory (a code review, 2026-09-12,
// found routing.ts and latency.ts each carrying their own with different
// index formulas, so "p95" meant two different things). Nearest-rank:
// the smallest value with at least p percent of the samples at or below
// it. `p` is a percentage (50, 95), the input need not be sorted.
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}
