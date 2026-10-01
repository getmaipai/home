export interface EmbedRow {
  line: number; sentence: string; cosine: number; dimensionsEqual: boolean; cosineOk: boolean;
  homeMs: number; stackMs: number; deterministic: boolean; singleMsDelta: number; batchRatio: number;
}
export interface EmbedSummary { min: number; p05: number; median: number; cosineOk: number; count: number; deterministic: boolean; singleMsDelta: number; batchRatio: number; passed: boolean }

export function l2norm(v: number[]): number { return Math.sqrt(v.reduce((sum, value) => sum + value * value, 0)); }
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const denominator = l2norm(a) * l2norm(b);
  if (denominator === 0) return 0;
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0) / denominator;
}
export function compareEmbedding(home: number[], stack: number[]) {
  const dimensionsEqual = home.length === stack.length;
  const similarity = dimensionsEqual ? cosine(home, stack) : 0;
  return { cosine: similarity, dimensionsEqual, cosineOk: dimensionsEqual && similarity >= 0.999 };
}
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * p; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower]! + (sorted[Math.min(lower + 1, sorted.length - 1)]! - sorted[lower]!) * fraction;
}
export function summarizeEmbed(rows: EmbedRow[]): EmbedSummary {
  const values = rows.map((row) => row.cosine).sort((a, b) => a - b);
  const min = values[0] ?? 0; const p05 = percentile(values, 0.05); const median = percentile(values, 0.5);
  const deterministic = rows.length > 0 && rows.every((row) => row.deterministic);
  const singleMsDelta = rows.length ? percentile(rows.map((row) => row.singleMsDelta).sort((a, b) => a - b), 0.5) : Infinity;
  const batchRatio = rows.length ? rows[0]!.batchRatio : 0;
  const cosineOk = rows.filter((row) => row.cosineOk).length;
  return { min, p05, median, cosineOk, count: rows.length, deterministic, singleMsDelta, batchRatio,
    passed: rows.length > 0 && cosineOk === rows.length && rows.every((row) => row.dimensionsEqual) && deterministic && singleMsDelta <= 50 && batchRatio >= 0.8 };
}
export function renderEmbedTable(rows: EmbedRow[], summary: EmbedSummary): string {
  const lines = ["line  cosine   Home ms  Stack ms  dimensions  pass"];
  for (const row of rows) lines.push(`${String(row.line).padStart(4)}  ${row.cosine.toFixed(6)}  ${row.homeMs.toFixed(2).padStart(7)}  ${row.stackMs.toFixed(2).padStart(8)}  ${String(row.dimensionsEqual).padStart(10)}  ${row.cosineOk ? "yes" : "no"}`);
  lines.push(`Summary: ${summary.passed ? "PASS" : "FAIL"}; cosine min ${summary.min.toFixed(6)}, p05 ${summary.p05.toFixed(6)}, median ${summary.median.toFixed(6)}; at least 0.999 ${summary.cosineOk}/${summary.count}; deterministic ${summary.deterministic}; single median delta ${summary.singleMsDelta.toFixed(2)} ms; batch ratio ${summary.batchRatio.toFixed(3)}`);
  return lines.join("\n");
}
