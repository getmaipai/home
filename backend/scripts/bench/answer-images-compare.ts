// IMGQ-09: paired comparison of two answer-images.ts runs (ON arm). Rows are the unit: each row's
// rate over its repeats, paired by row id, bootstrap 95% interval over rows (rule 13).
//   bun run scripts/bench/answer-images-compare.ts [--split held_out|dev] <base dirs,comma> <new dirs,comma>
// A dir list merges results.json files; a later dir replaces the same (row, rep) of an earlier one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import dataset from "./datasets/answer-images.json";

interface RunLite { arm: string; row: string; label: string; rep: number; called: string[]; images: { items: number } | null; totalMs: number; firstTextMs: number | null; trace: unknown }
const args = process.argv.slice(2);
const at = args.indexOf("--split");
const split = at >= 0 ? args.splice(at, 2)[1] : null;
const [baseArg, newArg] = args;
if (!baseArg || !newArg) { console.error("usage: answer-images-compare.ts [--split dev|held_out] <base dirs> <new dirs>"); process.exit(2); }

const splitOf = new Map((dataset.rows as { id: string; split?: string }[]).map((r) => [r.id, r.split === "held_out" ? "held_out" : "dev"]));
function load(list: string): Map<string, RunLite> {
  const m = new Map<string, RunLite>();
  for (const dir of list.split(",")) {
    const data = JSON.parse(readFileSync(join(dir, "results.json"), "utf-8")) as { runs: RunLite[] };
    for (const r of data.runs) if (r.arm === "ON" && (!split || splitOf.get(r.row) === split)) m.set(`${r.row}#${r.rep}`, r);
  }
  return m;
}
const base = load(baseArg);
const next = load(newArg);
function rates(m: Map<string, RunLite>, label: string): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of m.values()) if (r.label === label) by.set(r.row, [...(by.get(r.row) ?? []), r.called.includes("show_images") ? 1 : 0]);
  return new Map([...by].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
}
let seed = 20261012;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function interval(diffs: number[]): [number, number] {
  const means: number[] = [];
  for (let i = 0; i < 4000; i++) { let s = 0; for (let k = 0; k < diffs.length; k++) s += diffs[Math.floor(rnd() * diffs.length)]!; means.push(s / diffs.length); }
  means.sort((a, b) => a - b);
  return [means[100]!, means[3899]!];
}
for (const [label, name] of [["V", "recall"], ["N", "false offers"]] as const) {
  const a = rates(base, label), b = rates(next, label);
  const ids = [...a.keys()].filter((k) => b.has(k));
  const diffs = ids.map((k) => b.get(k)! - a.get(k)!);
  const [lo, hi] = interval(diffs);
  const calls = (m: Map<string, RunLite>) => [...m.values()].filter((r) => r.label === label);
  console.log(`${name}${split ? ` (${split})` : ""}: base ${mean(ids.map((k) => a.get(k)!)).toFixed(2)} (${calls(base).length} runs) -> new ${mean(ids.map((k) => b.get(k)!)).toFixed(2)} (${calls(next).length} runs), change ${mean(diffs).toFixed(3)} [95% ${lo.toFixed(3)}, ${hi.toFixed(3)}] over ${ids.length} rows`);
}
const misses = [...rates(next, "V")].filter(([, v]) => v < 1).map(([k, v]) => `${k}=${v.toFixed(2)}`);
console.log(`new arm V rows below 1.00: ${misses.join(", ") || "none"}`);
const fo = [...rates(next, "N")].filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v.toFixed(2)}`);
console.log(`new arm N rows with an offer: ${fo.join(", ") || "none"}`);
