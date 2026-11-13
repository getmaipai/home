// ONE-COMPOSER-2026-11-13 (COMPOSER-04, architect condition 6): the scorer for composer-hint-bench.ts. Pure; the bench feeds it recorded runs.
// A run is one turn of one row, with the composer hint on or off. Rates are per row over its repeats, and the paired 95% interval is over
// rows (the same rows in both arms), hint on minus hint off, in points.
import { isEvidenceTool } from "./freshScore";
import { pairedInterval, type PairedInterval } from "./toolsRecallScore";

export type Group = "picture-request" | "plain" | "time-sensitive" | "timeless" | "hard-negative";
export type Arm = "on" | "off";
export const PICTURE_TOOL = "generate_image";

export interface HintRun {
  rowId: string;
  group: Group;
  rep: number;
  arm: Arm;
  /** Every tool the model called on the turn, in order. */
  calls: string[];
  /** How many tools the model was handed (the turn's stored `stats.tools_offered.count`; the stored record keeps the count, not the names). */
  offered: number;
  error: string | null;
}

export type Metric = "picture" | "search" | "other";
export const pictureCalled = (run: HintRun): boolean => run.calls.includes(PICTURE_TOOL);
export const searched = (run: HintRun): boolean => run.calls.some(isEvidenceTool);
export const otherCalled = (run: HintRun): boolean => run.calls.some((name) => name !== PICTURE_TOOL && !isEvidenceTool(name));
const OF: Record<Metric, (run: HintRun) => boolean> = { picture: pictureCalled, search: searched, other: otherCalled };

/** Per-row rate over the row's repeats (errored runs are left out of the rate, and counted in the report). */
export function rowRates(runs: readonly HintRun[], metric: Metric): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const run of runs) if (!run.error) by.set(run.rowId, [...(by.get(run.rowId) ?? []), OF[metric](run) ? 1 : 0]);
  return new Map([...by].map(([id, values]) => [id, values.reduce((a, b) => a + b, 0) / values.length]));
}

export interface Cell { metric: Metric; groups: Group[]; on: number | null; off: number | null; interval: PairedInterval | null; rows: number }

const mean = (values: Iterable<number>): number | null => { const all = [...values]; return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null; };

export function cell(runs: readonly HintRun[], metric: Metric, groups: readonly Group[]): Cell {
  const pick = (arm: Arm) => runs.filter((run) => run.arm === arm && groups.includes(run.group));
  const on = rowRates(pick("on"), metric), off = rowRates(pick("off"), metric);
  return { metric, groups: [...groups], on: mean(on.values()), off: mean(off.values()), interval: pairedInterval(off, on), rows: [...on.keys()].filter((id) => off.has(id)).length };
}

/** Rows where both arms ran, and how many (row, repeat) pairs were handed the same number of tools in both arms. */
export function offeredSetMatch(runs: readonly HintRun[]): { pairs: number; same: number } {
  const key = (run: HintRun) => `${run.rowId}#${run.rep}`;
  const off = new Map(runs.filter((r) => r.arm === "off" && !r.error).map((r) => [key(r), r.offered]));
  let pairs = 0, same = 0;
  for (const run of runs) {
    if (run.arm !== "on" || run.error) continue;
    const other = off.get(key(run));
    if (other === undefined) continue;
    pairs += 1;
    if (other === run.offered) same += 1;
  }
  return { pairs, same };
}

/** A stable half split by id: even hash is held-out. The fresh set of chat-ab-01 ships a dev split only. */
export function hashSplit(id: string): "dev" | "heldout" {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2 === 0 ? "heldout" : "dev";
}

const pct = (value: number | null) => (value === null ? "n/a" : `${(Math.round(value * 1000) / 10).toFixed(1)}%`);
const sign = (value: number) => `${value >= 0 ? "+" : ""}${(Math.round(value * 1000) / 10).toFixed(1)}`;

/** The rows of the report: what must not move, and what is expected to. */
export const CELLS: Array<{ label: string; metric: Metric; groups: Group[]; expect: "up" | "flat" }> = [
  { label: "picture tool called on a picture request", metric: "picture", groups: ["picture-request"], expect: "up" },
  { label: "picture tool called on a plain question", metric: "picture", groups: ["plain"], expect: "flat" },
  { label: "picture tool called on a fresh row (time-sensitive, timeless, hard negative)", metric: "picture", groups: ["time-sensitive", "timeless", "hard-negative"], expect: "flat" },
  { label: "search on a time-sensitive row (a hit)", metric: "search", groups: ["time-sensitive"], expect: "flat" },
  { label: "search on a timeless or hard-negative row (a false search)", metric: "search", groups: ["timeless", "hard-negative"], expect: "flat" },
  { label: "search on a picture request or plain question", metric: "search", groups: ["picture-request", "plain"], expect: "flat" },
  { label: "any other tool, on every row", metric: "other", groups: ["picture-request", "plain", "time-sensitive", "timeless", "hard-negative"], expect: "flat" },
];

export function renderReport(runs: readonly HintRun[]): string {
  const lines = ["Composer hint bench (hint on minus hint off, paired over rows, 95% bootstrap interval, points)", ""];
  for (const spec of CELLS) {
    const c = cell(runs, spec.metric, spec.groups);
    const interval = c.interval ? `${sign(c.interval.diff)} [${sign(c.interval.lo)}, ${sign(c.interval.hi)}]` : "n/a";
    const verdict = !c.interval ? "no data" : spec.expect === "up" ? (c.interval.lo > 0 ? "rises, as intended" : "no clear rise") : c.interval.lo <= 0 && c.interval.hi >= 0 ? "does not move" : "MOVES";
    lines.push(`${spec.label}: off ${pct(c.off)}, on ${pct(c.on)}, diff ${interval} over ${c.rows} rows: ${verdict}`);
  }
  const offered = offeredSetMatch(runs);
  lines.push("", `tool count handed to the model identical in both arms: ${offered.same} of ${offered.pairs} paired turns`);
  const errored = runs.filter((run) => run.error).length;
  lines.push(`runs ${runs.length}, errored and left out of the rates: ${errored}`);
  return lines.join("\n");
}
