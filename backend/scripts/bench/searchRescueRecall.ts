// ROUTER-BUILD-01i: recency recall and false-search rates, plain vs assist_rescue, from a saved
// search-recency-02 results.json, with a paired bootstrap interval. No engine, no database: a rescued
// search is credited by the shared scorer (ksBenchScore.rescoreRecorded), so the numbers here are the
// numbers the bench summary shows.
//
//   bun run scripts/bench/searchRescueRecall.ts <results.json> [--floor 0.91]
import { readFileSync } from "node:fs";
import ks1 from "./datasets/ks-bench-01.json";
import { rescoreRecorded, type CategoryRule, type RecordedRun } from "./ksBenchScore";

export interface RescueRun extends RecordedRun {
  arm: string;
  row: string;
  band: string;
  heldOut: boolean;
  followUp: boolean;
}

/** Share of the runs that searched, per row (rows are the unit; repeats are averaged inside a row). */
export function rowRates(runs: readonly RescueRun[]): Map<string, number> {
  const acc = new Map<string, { k: number; n: number }>();
  for (const r of runs) {
    const a = acc.get(r.row) ?? { k: 0, n: 0 };
    a.n += 1;
    if (r.searches > 0) a.k += 1;
    acc.set(r.row, a);
  }
  return new Map([...acc].map(([row, a]) => [row, a.k / a.n] as const));
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Seeded generator so a rerun prints the same interval. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Bootstrap { n: number; mean: number; low: number; high: number }

/** Percentile bootstrap (2.5 and 97.5) over the rows both arms share; values are shares in [0, 1] (diff in [-1, 1]). */
export function pairedBootstrap(arm: ReadonlyMap<string, number>, base: ReadonlyMap<string, number> | null, iterations = 10000, seed = 1): Bootstrap | null {
  const values = [...arm.entries()].filter(([row]) => base === null || base.has(row)).map(([row, v]) => v - (base ? base.get(row)! : 0));
  const n = values.length;
  if (n < 2) return null;
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[Math.floor(rnd() * n)]!;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { n, mean: mean(values), low: means[Math.floor(0.025 * iterations)]!, high: means[Math.floor(0.975 * iterations)]! };
}

export interface RescueReport {
  recall: { plain: Bootstrap; rescue: Bootstrap; diff: Bootstrap } | null;
  falseSearch: Record<"stable" | "no_tool", { plain: number | null; rescue: number | null }>;
  /** Rescued turns by category (rescue arm), original rows only. */
  rescued: Record<string, number>;
  floor: number;
  floorMet: boolean | null;
}

const pct = (x: number | null): string => (x === null ? "n/a" : `${(100 * x).toFixed(1)}%`);

/** Recall = share of original recency rows (follow-ups excluded) with at least one search. */
export function rescueReport(saved: readonly RescueRun[], floor = 0.91, heldOutOnly = false): RescueReport {
  const rules = ks1.arms as Record<string, CategoryRule>;
  const runs = saved.filter((r) => r.band === "adult" && r.error === null && !r.followUp && (!heldOutOnly || r.heldOut)).map((r) => (r.arm === "assist_rescue" ? rescoreRecorded(r, rules) : r));
  const of = (arm: string, category: string) => runs.filter((r) => r.arm === arm && r.category === category);
  const plainRates = rowRates(of("plain", "recency"));
  const rescueRates = rowRates(of("assist_rescue", "recency"));
  const plain = pairedBootstrap(plainRates, null);
  const rescue = pairedBootstrap(rescueRates, null);
  const diff = pairedBootstrap(rescueRates, plainRates);
  const falseRate = (arm: string, category: string): number | null => {
    const rs = of(arm, category);
    return rs.length === 0 ? null : rs.filter((r) => r.searches > 0).length / rs.length;
  };
  const rescued: Record<string, number> = {};
  for (const r of runs.filter((x) => x.arm === "assist_rescue" && x.rescued)) rescued[r.category] = (rescued[r.category] ?? 0) + 1;
  return {
    recall: plain && rescue && diff ? { plain, rescue, diff } : null,
    falseSearch: {
      stable: { plain: falseRate("plain", "stable"), rescue: falseRate("assist_rescue", "stable") },
      no_tool: { plain: falseRate("plain", "no_tool"), rescue: falseRate("assist_rescue", "no_tool") },
    },
    rescued,
    floor,
    floorMet: rescue ? rescue.low >= floor : null,
  };
}

export function renderRescueReport(label: string, r: RescueReport): string {
  const iv = (b: Bootstrap) => `${pct(b.mean)} [${pct(b.low)}, ${pct(b.high)}] over ${b.n} rows`;
  const lines = [`## ${label}`, ""];
  if (r.recall) {
    lines.push(`- recency recall, plain: ${iv(r.recall.plain)}`, `- recency recall, assist_rescue: ${iv(r.recall.rescue)}`, `- paired diff (rescue minus plain): ${iv(r.recall.diff)}`);
  }
  lines.push(`- stable false searches: plain ${pct(r.falseSearch.stable.plain)}, rescue ${pct(r.falseSearch.stable.rescue)}`);
  lines.push(`- no_tool false searches: plain ${pct(r.falseSearch.no_tool.plain)}, rescue ${pct(r.falseSearch.no_tool.rescue)}`);
  lines.push(`- rescued turns by category: ${JSON.stringify(r.rescued)}`);
  lines.push(`- floor ${r.floor}: ${r.floorMet === null ? "not measurable" : r.floorMet ? "lower bound of the rescue interval clears it" : "NOT met (rescue interval lower bound is below it)"}`);
  return lines.join("\n");
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error("searchRescueRecall: pass the results.json path, for example: bun run scripts/bench/searchRescueRecall.ts /full/path/results.json");
    process.exit(2);
  }
  const at = process.argv.indexOf("--floor");
  const floor = at < 0 ? 0.91 : Number(process.argv[at + 1]);
  const saved = (JSON.parse(readFileSync(file, "utf-8")) as { runs: RescueRun[] }).runs;
  console.log(renderRescueReport("All original adult rows", rescueReport(saved, floor)));
  console.log("");
  console.log(renderRescueReport("Held-out original adult rows", rescueReport(saved, floor, true)));
}
