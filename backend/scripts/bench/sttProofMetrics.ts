export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s'’]/gu, " ").replace(/(?<![\p{L}\p{N}])['’]|['’](?![\p{L}\p{N}])/gu, " ").replace(/\s+/g, " ").trim();
}

export function wordErrorRate(reference: string, hypothesis: string): { errors: number; referenceWords: number; wer: number } {
  const ref = reference ? reference.split(/\s+/) : [];
  const hyp = hypothesis ? hypothesis.split(/\s+/) : [];
  const prev = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const curr = [i];
    for (let j = 1; j <= hyp.length; j++) curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    for (let j = 0; j <= hyp.length; j++) prev[j] = curr[j]!;
  }
  const errors = prev[hyp.length]!;
  return { errors, referenceWords: ref.length, wer: ref.length === 0 ? (hyp.length === 0 ? 0 : 1) : errors / ref.length };
}

export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error("sample rates must be positive");
  if (fromRate === toRate) return samples.slice();
  if (!samples.length) return new Float32Array();
  const length = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const at = i * fromRate / toRate;
    const left = Math.min(Math.floor(at), samples.length - 1);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = at - left;
    out[i] = samples[left]! * (1 - fraction) + samples[right]! * fraction;
  }
  return out;
}

export interface SttSide { text: string; wer: number; ms: number; errors: number }
export interface SttRow { line: number; reference: string; referenceWords: number; home: SttSide; stack: SttSide; comparison: ReturnType<typeof compareStt> }
export function compareStt(home: SttSide, stack: SttSide) {
  const stackWerDelta = (stack.wer - home.wer) * 100;
  const msDelta = stack.ms - home.ms;
  return { stackWerDelta, werOk: stackWerDelta <= 1, identical: normalizeText(home.text) === normalizeText(stack.text), msDelta, msOk: msDelta <= 150 };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p; const low = Math.floor(pos); const high = Math.ceil(pos);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (pos - low);
}
export function summarizeStt(rows: SttRow[], deterministic: boolean) {
  const referenceWords = rows.reduce((sum, row) => sum + row.referenceWords, 0);
  const homeErrors = rows.reduce((sum, row) => sum + row.home.errors, 0);
  const stackErrors = rows.reduce((sum, row) => sum + row.stack.errors, 0);
  const msDeltas = rows.map((row) => row.comparison.msDelta);
  const homeWer = rows.length ? rows.reduce((sum, row) => sum + row.home.wer, 0) / rows.length : 0;
  const stackWer = rows.length ? rows.reduce((sum, row) => sum + row.stack.wer, 0) / rows.length : 0;
  const aggregateHomeWer = referenceWords ? homeErrors / referenceWords : 0;
  const aggregateStackWer = referenceWords ? stackErrors / referenceWords : 0;
  const medianMsDelta = percentile(msDeltas, 0.5); const p95MsDelta = percentile(msDeltas, 0.95);
  const werOk = aggregateStackWer <= aggregateHomeWer + 0.01;
  const msOk = medianMsDelta <= 150 && p95MsDelta <= 400;
  return { homeWer, stackWer, identical: rows.filter((row) => row.comparison.identical).length, werOkRows: rows.filter((row) => row.comparison.werOk).length, medianMsDelta, p95MsDelta, aggregateHomeWer, aggregateStackWer, werOk, msOk, deterministic, passed: werOk && msOk && deterministic };
}

export function renderSttTable(rows: SttRow[], summary: ReturnType<typeof summarizeStt>): string {
  const lines = ["line home WER stack WER identical home ms stack ms reference"];
  for (const row of rows) lines.push(`${String(row.line).padStart(2)} ${row.home.wer.toFixed(3).padStart(8)} ${row.stack.wer.toFixed(3).padStart(9)} ${row.comparison.identical ? "yes" : "no "} ${row.home.ms.toFixed(1).padStart(7)} ${row.stack.ms.toFixed(1).padStart(8)} ${row.reference}`);
  lines.push(`Summary: ${summary.passed ? "PASS" : "FAIL"}; mean WER Home ${summary.homeWer.toFixed(4)}, Stack ${summary.stackWer.toFixed(4)}; aggregate WER Home ${summary.aggregateHomeWer.toFixed(4)}, Stack ${summary.aggregateStackWer.toFixed(4)}; identical ${summary.identical}/${rows.length}; WER rows ${summary.werOkRows}/${rows.length}; ms delta median ${summary.medianMsDelta.toFixed(1)}, p95 ${summary.p95MsDelta.toFixed(1)}; deterministic ${summary.deterministic ? "yes" : "no"}`);
  return lines.join("\n");
}
