/** SEARCH-FRESH-01 paired, family-clustered statistics. */
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { existsSync, readFileSync as readText, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

export interface RouteRow { id: string; family?: string; split?: string; rep: number; evidence: boolean; stage_codes?: string[]; kind?: string; gold?: string; false_search?: boolean; valid_query?: boolean | null; mangled_query?: boolean | null; decision_latency_ms?: number; }
export interface Interval { estimate: number; low: number; high: number; }
export interface PairedStats { difference: number; interval: Interval; signP: number; discordant: { aOnly: number; bOnly: number }; mcnemarP: number; }
const DEFAULT_SEED = 0x51ea7;
const mean = (xs: readonly number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
type IntervalMethod = "percentile" | "bca";

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - p : p;
}
function normalInv(p: number): number {
  // Acklam's rational approximation.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]!*q+c[1]!)*q+c[2]!)*q+c[3]!)*q+c[4]!)*q+c[5]!)/((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1); }
  if (p > 0.97575) return -normalInv(1-p);
  const q = p - 0.5, r = q*q;
  return (((((a[0]!*r+a[1]!)*r+a[2]!)*r+a[3]!)*r+a[4]!)*r+a[5]!)*q/(((((b[0]!*r+b[1]!)*r+b[2]!)*r+b[3]!)*r+b[4]!)*r+1);
}
function bcaBounds(samples: number[], observed: number, jackknife: number[]): [number, number] {
  const sorted = [...samples].sort((a,b)=>a-b);
  const less = sorted.filter((x) => x < observed).length, equal = sorted.filter((x) => x === observed).length;
  const z0 = normalInv((less + equal / 2) / sorted.length);
  const jackMean = mean(jackknife);
  const centered = jackknife.map((x) => jackMean - x);
  const numerator = centered.reduce((s,x)=>s+x**3,0), denominator = 6 * Math.pow(centered.reduce((s,x)=>s+x*x,0),1.5);
  const acceleration = denominator ? numerator / denominator : 0;
  const adj = (alpha: number) => {
    const z = normalInv(alpha), v = z0 + z;
    return normalCdf(z0 + v / (1 - acceleration * v));
  };
  return [sorted[Math.floor(Math.max(0,Math.min(1,adj(.025))) * (sorted.length-1))]!, sorted[Math.floor(Math.max(0,Math.min(1,adj(.975))) * (sorted.length-1))]!];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
export function hashValue(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

export interface HeldoutPlan { splitHash: string; configurations: { hash: string }[]; burnedSplitHashes?: string[]; }
export function parseHeldoutPlan(file: string): HeldoutPlan {
  const source = readText(file, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch {
    const block = source.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (!block) throw new Error("held-out plan must be JSON or contain a fenced JSON hash manifest");
    parsed = JSON.parse(block);
  }
  const plan = parsed as Partial<HeldoutPlan>;
  const configurations = (plan.configurations as unknown[] | undefined)?.map((item) => {
    const row = item as { hash?: unknown; configurationHash?: unknown };
    return { hash: String(row.hash ?? row.configurationHash ?? "") };
  });
  if (typeof plan.splitHash !== "string" || !configurations || !configurations.every((item) => item.hash.length > 0)) throw new Error("held-out plan must list splitHash and configurations[].hash");
  return { ...plan, configurations } as HeldoutPlan;
}
export function guardHeldout(input: { split: string; planFile?: string; configurationHash: string; splitHash: string; ledgerFile?: string; now?: string; record?: boolean }): void {
  if (input.split !== "heldout") return;
  if (!input.planFile) throw new Error("held-out scoring requires --plan <file>");
  const plan = parseHeldoutPlan(input.planFile);
  if (plan.splitHash !== input.splitHash) throw new Error(`held-out split hash mismatch: run ${input.splitHash}, plan ${plan.splitHash}`);
  if (!plan.configurations.some((configuration) => configuration.hash === input.configurationHash)) throw new Error(`configuration hash ${input.configurationHash} is not frozen in the held-out plan`);
  const burned = plan.burnedSplitHashes ?? [];
  if (burned.includes(input.splitHash)) throw new Error(`held-out split ${input.splitHash} is marked burned in the plan`);
  const ledgerFile = input.ledgerFile ?? "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/route-heldout-ledger.json";
  let ledger: { entries?: { splitHash?: string; burned?: boolean }[] } = { entries: [] };
  if (existsSync(ledgerFile)) ledger = JSON.parse(readText(ledgerFile, "utf8")) as typeof ledger;
  if (ledger.entries?.some((entry) => entry.splitHash === input.splitHash && entry.burned)) throw new Error(`held-out split ${input.splitHash} is burned in the ledger`);
  if (ledger.entries?.some((entry) => entry.splitHash === input.splitHash && (entry as { configurationHash?: string }).configurationHash === input.configurationHash)) throw new Error(`configuration ${input.configurationHash} already has a held-out ledger entry`);
  if (input.record === false) return;
  const entry = { date: input.now ?? new Date().toISOString(), planHash: hashValue(readText(input.planFile, "utf8")), configurationHash: input.configurationHash, splitHash: input.splitHash };
  ledger.entries ??= [];
  ledger.entries.push(entry);
  mkdirSync(dirname(ledgerFile), { recursive: true });
  writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
}

export function wilson(successes: number, n: number, z = 1.959963984540054): Interval {
  if (!n) return { estimate: 0, low: 0, high: 0 };
  const p = successes / n, z2 = z * z, den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n)) / den;
  return { estimate: p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let sum = 0; for (let i = 1; i <= k; i++) sum += Math.log(n - k + i) - Math.log(i); return sum;
}
export function exactMcNemar(aOnly: number, bOnly: number): number {
  const n = aOnly + bOnly; if (!n) return 1;
  let p = 0; for (let k = 0; k <= Math.min(aOnly, bOnly); k++) p += Math.exp(logChoose(n, k) - n * Math.log(2));
  return Math.min(1, 2 * p);
}
export function exactSignTest(differences: readonly number[]): { positive: number; negative: number; ties: number; p: number } {
  const positive = differences.filter((x) => x > 0).length, negative = differences.filter((x) => x < 0).length;
  const n = positive + negative; let p = 0;
  for (let k = 0; k <= Math.min(positive, negative); k++) p += Math.exp(logChoose(n, k) - n * Math.log(2));
  return { positive, negative, ties: differences.length - n, p: n ? Math.min(1, 2 * p) : 1 };
}

function pairedItems(a: readonly RouteRow[], b: readonly RouteRow[]) {
  const bm = new Map(b.map((r) => [`${r.id}\0${r.rep}`, r]));
  const am = new Map(a.map((r) => [`${r.id}\0${r.rep}`, r]));
  const keys = [...am.keys()].filter((key) => bm.has(key));
  const byItem = new Map<string, { family: string; av: number[]; bv: number[] }>();
  for (const key of keys) {
    const x = am.get(key)!, y = bm.get(key)!, item = byItem.get(x.id) ?? { family: x.family || x.id, av: [], bv: [] };
    item.av.push(Number(x.evidence)); item.bv.push(Number(y.evidence)); byItem.set(x.id, item);
  }
  return byItem;
}
export function perItemMeans(rows: readonly RouteRow[]): Map<string, { family: string; mean: number; n: number }> {
  const map = new Map<string, RouteRow[]>(); for (const row of rows) map.set(row.id, [...(map.get(row.id) ?? []), row]);
  return new Map([...map].map(([id, rs]) => [id, { family: rs[0]?.family || id, mean: mean(rs.map((r) => Number(r.evidence))), n: rs.length }]));
}

/** Same deterministic family-index draws are applied to both arms because the paired delta is resampled once. */
export function pairedFamilyBootstrap(a: readonly RouteRow[], b: readonly RouteRow[], iterations = 10_000, seed = DEFAULT_SEED, method: IntervalMethod = "percentile"): Interval {
  const items = pairedItems(a, b); if (!items.size) return { estimate: 0, low: 0, high: 0 };
  const familyItems = new Map<string, { av: number[]; bv: number[] }[]>();
  for (const item of items.values()) familyItems.set(item.family, [...(familyItems.get(item.family) ?? []), item]);
  const families = [...familyItems.keys()];
  const familyDelta = families.map((family) => familyItems.get(family)!.map((it) => mean(it.bv) - mean(it.av)));
  const estimate = mean([...items.values()].map((it) => mean(it.bv) - mean(it.av))); let state = seed >>> 0;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 0x1_0000_0000; };
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) { const picked: number[] = []; for (let j = 0; j < families.length; j++) picked.push(...familyDelta[Math.floor(random() * families.length)]!); samples.push(mean(picked)); }
  samples.sort((x, y) => x - y);
  let low = samples[Math.floor(iterations * 0.025)] ?? estimate, high = samples[Math.floor(iterations * 0.975)] ?? estimate;
  if (method === "bca") {
    const jackknife = families.map((omit) => mean([...items.values()].filter((it) => it.family !== omit).map((it) => mean(it.bv) - mean(it.av))));
    [low, high] = bcaBounds(samples, estimate, jackknife);
  }
  return { estimate, low, high };
}

export function comparePaired(a: readonly RouteRow[], b: readonly RouteRow[], iterations = 10_000, seed = DEFAULT_SEED, method: IntervalMethod = "percentile"): PairedStats {
  const items = pairedItems(a, b); const familyDiffs = new Map<string, number[]>(); let aOnly = 0, bOnly = 0;
  for (const item of items.values()) {
    const delta = mean(item.bv) - mean(item.av); familyDiffs.set(item.family, [...(familyDiffs.get(item.family) ?? []), delta]);
    const majA = mean(item.av) >= 0.5, majB = mean(item.bv) >= 0.5;
    if (majA && !majB) aOnly++; if (!majA && majB) bOnly++;
  }
  const familyMeans = [...familyDiffs.values()].map(mean);
  const interval = pairedFamilyBootstrap(a, b, iterations, seed, method);
  return { difference: interval.estimate, interval, signP: exactSignTest(familyMeans).p, discordant: { aOnly, bOnly }, mcnemarP: exactMcNemar(aOnly, bOnly) };
}

function percentile(xs: number[], p: number) { xs.sort((a, b) => a - b); return xs[Math.floor((xs.length - 1) * p)] ?? 0; }
export function clusterRate(rows: readonly RouteRow[], iterations = 10_000, seed = DEFAULT_SEED, method: IntervalMethod = "percentile"): { estimate: number; low: number; high: number; n_eff: number; wilson: Interval } {
  const itemRates = perItemMeans(rows); if (!itemRates.size) return { estimate: 0, low: 0, high: 0, n_eff: 0, wilson: wilson(0, 0) };
  const byFamily = new Map<string, number[]>();
  for (const item of itemRates.values()) byFamily.set(item.family, [...(byFamily.get(item.family) ?? []), item.mean]);
  const families = [...byFamily.values()], p = mean([...itemRates.values()].map((item) => item.mean));
  let state = seed >>> 0; const rand = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 0x1_0000_0000; };
  const draws: number[] = []; for (let i = 0; i < iterations; i++) { const sample: number[] = []; for (let j = 0; j < families.length; j++) sample.push(...families[Math.floor(rand() * families.length)]!); draws.push(mean(sample)); }
  const se2 = draws.reduce((s, x) => s + (x - mean(draws)) ** 2, 0) / Math.max(1, draws.length - 1);
  const nEff = se2 > 0 ? p * (1 - p) / se2 : families.length;
  const effWilson = wilson(p * nEff, nEff);
  let low = percentile([...draws], 0.025), high = percentile([...draws], 0.975);
  if (method === "bca") {
    const jackknife = families.map((_, omit) => mean(families.filter((_x, i) => i !== omit).flat()));
    [low, high] = bcaBounds(draws, p, jackknife);
  }
  return { estimate: p, low, high, n_eff: nEff, wilson: effWilson };
}

/** One-way random-effects ICC(1,1), using items as targets and repeats as raters. */
export function iccAcrossRepeats(rows: readonly RouteRow[]): number {
  const groups = [...perItemMeans(rows).keys()].map((id) => rows.filter((r) => r.id === id).map((r) => Number(r.evidence))).filter((x) => x.length > 1);
  if (groups.length < 2) return 0;
  const k = mean(groups.map((g) => g.length)), all = groups.flat(), grand = mean(all);
  const msBetween = groups.reduce((s, g) => s + g.length * (mean(g) - grand) ** 2, 0) / (groups.length - 1);
  const msWithin = groups.reduce((s, g) => s + g.reduce((v, x) => v + (x - mean(g)) ** 2, 0), 0) / Math.max(1, all.length - groups.length);
  return (msBetween - msWithin) / (msBetween + (k - 1) * msWithin || 1);
}
/** Same ICC calculation with families as targets to capture paraphrase clustering. */
export function iccAcrossParaphrases(rows: readonly RouteRow[]): number { return iccAcrossRepeats(rows.map((r) => ({ ...r, id: r.family || r.id }))); }

type ResultFile = { arm?: string; environment?: Record<string, unknown>; results?: RouteRow[]; runs?: RouteRow[] };
function readRows(path: string): ResultFile {
  const data = JSON.parse(readFileSync(path, "utf8")) as ResultFile;
  const rows = (data.results ?? data.runs ?? []).map((row) => row.stage_codes?.length ? { ...row, evidence: row.stage_codes.includes("D_HIT"), false_search: row.stage_codes.includes("D_FALSE") } : row);
  return { ...data, results: rows };
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  const splitAt = args.indexOf("--split"), planAt = args.indexOf("--plan");
  const split = splitAt >= 0 ? args[splitAt + 1] : "dev", planFile = planAt >= 0 ? args[planAt + 1] : undefined;
  const method: IntervalMethod = args.includes("--bca") ? "bca" : "percentile";
  const root = args.find((arg, i) => !arg.startsWith("--") && i !== splitAt + 1 && i !== planAt + 1);
  if (!root) throw new Error("usage: bun run scripts/bench/routeStats.ts [--split dev|heldout --plan <file> --bca] <run-directory>");
  const arms = new Map<string, { rows: RouteRow[]; env: Record<string, unknown> }>();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = entry.isDirectory() ? join(root, entry.name, "results.json") : join(root, entry.name);
    if (!entry.isDirectory() && !entry.name.endsWith(".json")) continue;
    try { const data = readRows(path); arms.set(data.arm ?? (entry.isDirectory() ? entry.name : entry.name.replace(/\.json$/, "")), { rows: data.results ?? data.runs ?? [], env: data.environment ?? {} }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (split === "heldout") {
    if (!planFile) throw new Error("held-out scoring requires --plan <file>");
    const splitHashes = new Set([...arms.values()].map(({ env }) => String(env.splitHash ?? "")));
    if (splitHashes.size !== 1 || splitHashes.has("")) throw new Error("held-out run files must carry one shared splitHash");
    for (const { rows, env } of arms.values()) {
      const heldoutRows = rows.filter((row) => row.split === "heldout");
      if (!heldoutRows.length) throw new Error("held-out run has no rows tagged split=heldout");
      if (!env.configurationHash) throw new Error("held-out run is missing configurationHash");
      guardHeldout({ split, planFile, configurationHash: String(env.configurationHash), splitHash: [...splitHashes][0]!, record: false });
    }
    for (const { env } of arms.values()) guardHeldout({ split, planFile, configurationHash: String(env.configurationHash), splitHash: [...splitHashes][0]! });
  }
  const names = [...arms.keys()], seed = DEFAULT_SEED;
  const lines = ["# Route decision statistics", "", split === "heldout" ? "Confirmatory held-out results; only the family-cluster bootstrap bound is judged." : "All comparisons are exploratory; no adoption decision is made here.", `Bootstrap: 10,000 family resamples; fixed seed ${seed}; identical paired family draws for both arms; interval method ${method}.`, "", "## Per-arm rates", "", "| Arm | Must-search recall | Judged bootstrap lower 95% | n_eff | Wilson lower 95% (approximation, not judged) | Per-item majority recall | Timeless false searches | Hard-negative false searches | Must-not false upper (judged bootstrap 95%) | n_eff | Wilson upper 95% (approximation, not judged) | Valid-query rate | Mangled queries | Decision latency p50/p95 ms | ICC repeats | ICC paraphrases |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
  const percentile = (values: number[], p: number) => { values.sort((a,b)=>a-b); return values.length ? values[Math.floor((values.length-1)*p)]! : 0; };
  for (const [arm, { rows }] of arms) {
    const must = rows.filter((r) => r.gold === "must" || r.kind === "time-sensitive");
    const mustNot = rows.filter((r) => r.gold === "must_not" || r.kind === "timeless" || r.kind === "hard-negative");
    const recall = clusterRate(must, 10_000, seed, method);
    const itemMeans = perItemMeans(must);
    const majorityRecall = itemMeans.size ? [...itemMeans.values()].filter((item) => item.mean >= 0.5).length / itemMeans.size : 0;
    const falseRows = mustNot.map((r) => ({ ...r, evidence: r.false_search ?? r.evidence }));
    const falseRate = clusterRate(falseRows, 10_000, seed, method);
    const rawFalseRate = (subset: RouteRow[]) => subset.length ? subset.filter((row) => row.false_search ?? row.evidence).length / subset.length : 0;
    const timelessFalse = rawFalseRate(rows.filter((r) => r.kind === "timeless"));
    const hardNegativeFalse = rawFalseRate(rows.filter((r) => r.kind === "hard-negative"));
    const validQueries = must.filter((r) => r.valid_query !== null && r.valid_query !== undefined);
    const valid = validQueries.length ? validQueries.filter((r) => r.valid_query).length / validQueries.length : 0;
    const mangled = must.filter((r) => r.mangled_query).length;
    const latencies = rows.flatMap((r) => r.decision_latency_ms === undefined ? [] : [r.decision_latency_ms]);
    lines.push(`| ${arm} | ${(100*recall.estimate).toFixed(1)}% | ${(100*recall.low).toFixed(1)}% | ${recall.n_eff.toFixed(1)} | ${(100*recall.wilson.low).toFixed(1)}% | ${(100*majorityRecall).toFixed(1)}% | ${(100*timelessFalse).toFixed(1)}% | ${(100*hardNegativeFalse).toFixed(1)}% | ${(100*falseRate.high).toFixed(1)}% | ${falseRate.n_eff.toFixed(1)} | ${(100*falseRate.wilson.high).toFixed(1)}% | ${(100*valid).toFixed(1)}% | ${mangled} | ${percentile([...latencies],.5).toFixed(0)}/${percentile([...latencies],.95).toFixed(0)} | ${iccAcrossRepeats(rows).toFixed(3)} | ${iccAcrossParaphrases(rows).toFixed(3)} |`);
  }
  const comparisons = [["A0", "A0n"], ["A0", "A2"], ["A2", "A2n"], ["A0n", "A1"]] as const;
  lines.push("", split === "heldout" ? "## Plan-listed confirmatory comparisons" : "## Preregistered E1 comparisons (exploratory)", "", "| Difference | Paired mean | Paired family bootstrap 95% interval | Exact family sign-test p | Item-majority exact McNemar p (secondary) |", "|---|---:|---:|---:|---:|");
  for (const [a, b] of comparisons) { if (!arms.has(a) || !arms.has(b)) continue; const ax = arms.get(a)!.rows.filter((r) => r.gold === "must" || r.kind === "time-sensitive"), bx = arms.get(b)!.rows.filter((r) => r.gold === "must" || r.kind === "time-sensitive"); const s = comparePaired(ax, bx, 10_000, seed, method); lines.push(`| ${b}−${a} | ${(100*s.difference).toFixed(1)} pp | ${(100*s.interval.low).toFixed(1)}–${(100*s.interval.high).toFixed(1)} pp | ${s.signP.toFixed(4)} | ${s.mcnemarP.toFixed(4)} |`); }
  if (split !== "heldout") lines.push("", "N* candidates are the highest-recall arms with acceptable false-search rates; this exploratory report does not select or adopt an arm.");
  console.log(lines.join("\n"));
}
