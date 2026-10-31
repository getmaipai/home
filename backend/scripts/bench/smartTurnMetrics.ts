export interface BenchRow {
  text: string;
  finished: boolean;
  voice: string;
  pad: number;
  complete: boolean;
  probability: number;
  ms: number;
}

export function parseVoiceSelection(value: string, presets: readonly string[]): string[] {
  if (value === "all") return [...presets];
  const selected = value.split(",").map((voice) => voice.trim()).filter(Boolean);
  if (!selected.length) throw new Error("--voices must be 'all' or a comma-separated list of preset IDs");
  const unknown = selected.filter((voice) => !presets.includes(voice));
  if (unknown.length) throw new Error(`unknown voice preset(s): ${unknown.join(", ")}`);
  if (new Set(selected).size !== selected.length) throw new Error("--voices contains a duplicate preset ID");
  return selected;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1]!;
}

export function scoreRows(rows: readonly BenchRow[]) {
  const finished = rows.filter((row) => row.finished);
  const unfinished = rows.filter((row) => !row.finished);
  const latencies = rows.map((row) => row.ms);
  return {
    finishedTotal: finished.length,
    finishedCorrect: finished.filter((row) => row.complete).length,
    unfinishedTotal: unfinished.length,
    unfinishedCorrect: unfinished.filter((row) => !row.complete).length,
    falseComplete: unfinished.filter((row) => row.complete).length,
    medianMs: percentile(latencies, 0.5),
    p90Ms: percentile(latencies, 0.9),
  };
}
