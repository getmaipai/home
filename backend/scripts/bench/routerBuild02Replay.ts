// ROUTER-BUILD-03: stage 1 of ROUTER-BUILD-02 section 5. Replays each decider over the recorded first-round outcomes of the
// plain arm on the lock box, no engine. A decider acts only where the plain turn returned text with no tool call; recall counts
// a repeat as searched if plain searched or the decider fired on such a turn. Prints M1 and M2 with family-bootstrap intervals.
// It refuses to run when the lock box on disk differs from the sha256 frozen in PREREG.json.
//
//   bun run scripts/bench/routerBuild02Replay.ts --plain <results.json> --prereg <PREREG.json> --lockbox <lockbox.json>
//        --decisions A=<a.json>,B=<b.json>,C=<c.json>,D=<d.json> [--floor 0.91] [--out <report.json>]
// A decisions file maps a row id to "SEARCH"/"NO_SEARCH", or to {"1": ..., "2": ..., "3": ...} per repeat (B and D make one call per repeat).
import { readFileSync, writeFileSync } from "node:fs";
import { assertLockboxMatches, clusterBootstrap, familyValues, type Interval, type Obs } from "./routerBuild02Stats";

export interface PlainRun {
  arm: string; row: string; band: string; rep: number; error: string | null; searches: number;
  firstRound: { calls: { name: string }[] } | null;
}
export interface ReplayRow { id: string; category: string; family: string; followUp?: boolean; contested?: boolean }
export type DecisionFile = Record<string, string | Record<string, string>>;
export type Marks = { floor: number; diffFloor: number; followUpFloor: number; perRepFloor: number; falseMax: number; falseUpper: number; falseDiffUpper: number; noToolFollowUpMax: number };
export const DEFAULT_MARKS: Marks = { floor: 0.91, diffFloor: 0.2, followUpFloor: 0.85, perRepFloor: 0.88, falseMax: 0.03, falseUpper: 0.06, falseDiffUpper: 0.03, noToolFollowUpMax: 1 };

export interface ArmReport {
  arm: string;
  recall: Interval | null;
  recallDiff: Interval | null;
  followUpRecall: number | null;
  perRepRecall: Record<number, number>;
  falseSearch: Record<"stable" | "no_tool", { rate: Interval | null; diff: Interval | null }>;
  noToolFollowUpsSearched: number;
  /** Runs where the decider fired on a turn plain did not search. */
  fired: number;
  m1: boolean | null;
  m2: boolean | null;
}
export interface ReplayReport { runsUsed: number; rowsUsed: number; contestedExcluded: number; arms: ArmReport[]; notMeasuredHere: string[] }

const decisionFor = (file: DecisionFile | undefined, row: string, rep: number): string | null => {
  const v = file?.[row];
  if (v === undefined) return null;
  return typeof v === "string" ? v : (v[String(rep)] ?? null);
};

/** Did this plain run return text with no tool call at all (the only turn a decider acts on)? */
export const plainReturnedNoCall = (r: PlainRun): boolean => r.error === null && r.firstRound !== null && r.firstRound.calls.length === 0;

export function replay(plain: readonly PlainRun[], rows: readonly ReplayRow[], decisions: Record<string, DecisionFile>, marks: Marks = DEFAULT_MARKS): ReplayReport {
  const meta = new Map(rows.map((r) => [r.id, r] as const));
  const used = plain.filter((r) => r.arm === "plain" && r.band === "adult" && r.error === null && meta.has(r.row) && !meta.get(r.row)!.contested);
  const contestedExcluded = rows.filter((r) => r.contested).length;
  const searchedBy = (arm: string, r: PlainRun): { searched: boolean; fired: boolean } => {
    const modelSearched = r.searches > 0;
    if (arm === "plain") return { searched: modelSearched, fired: false };
    const d = decisionFor(decisions[arm], r.row, r.rep);
    if (plainReturnedNoCall(r) && d === null) throw new Error(`decider ${arm} has no decision for row ${r.row} repeat ${r.rep}; regenerate its decisions file for the whole lock box before replaying.`);
    const fired = !modelSearched && plainReturnedNoCall(r) && d === "SEARCH";
    return { searched: modelSearched || fired, fired };
  };
  const obsOf = (arm: string, pred: (m: ReplayRow) => boolean): Obs[] =>
    used.filter((r) => pred(meta.get(r.row)!)).map((r) => ({ family: meta.get(r.row)!.family, row: r.row, value: searchedBy(arm, r).searched ? 1 : 0 }));
  const recency = (m: ReplayRow) => m.category === "recency";
  const baseRecall = familyValues(obsOf("plain", (m) => recency(m)));
  const baseFalse = { stable: familyValues(obsOf("plain", (m) => m.category === "stable")), no_tool: familyValues(obsOf("plain", (m) => m.category === "no_tool")) };
  const reps = [...new Set(used.map((r) => r.rep))].sort((a, b) => a - b);

  const arms: ArmReport[] = ["plain", ...Object.keys(decisions)].map((arm) => {
    const recallMap = familyValues(obsOf(arm, (m) => recency(m)));
    const recall = clusterBootstrap(recallMap);
    const recallDiff = arm === "plain" ? null : clusterBootstrap(recallMap, baseRecall);
    const fuMap = familyValues(obsOf(arm, (m) => recency(m) && !!m.followUp));
    const followUpRecall = fuMap.size === 0 ? null : [...fuMap.values()].reduce((a, b) => a + b, 0) / fuMap.size;
    const perRepRecall: Record<number, number> = {};
    for (const rep of reps) {
      const m = familyValues(used.filter((r) => r.rep === rep && recency(meta.get(r.row)!)).map((r) => ({ family: meta.get(r.row)!.family, row: r.row, value: searchedBy(arm, r).searched ? 1 : 0 })));
      perRepRecall[rep] = m.size === 0 ? 0 : [...m.values()].reduce((a, b) => a + b, 0) / m.size;
    }
    const falseSearch = {} as ArmReport["falseSearch"];
    for (const cat of ["stable", "no_tool"] as const) {
      const map = familyValues(obsOf(arm, (m) => m.category === cat));
      falseSearch[cat] = { rate: clusterBootstrap(map), diff: arm === "plain" ? null : clusterBootstrap(map, baseFalse[cat]) };
    }
    const ntFu = new Map<string, number[]>();
    for (const r of used.filter((x) => meta.get(x.row)!.category === "no_tool" && meta.get(x.row)!.followUp)) ntFu.set(r.row, [...(ntFu.get(r.row) ?? []), searchedBy(arm, r).searched ? 1 : 0]);
    const noToolFollowUpsSearched = [...ntFu.values()].filter((v) => v.reduce((a, b) => a + b, 0) / v.length >= 0.5).length;
    const fired = used.filter((r) => searchedBy(arm, r).fired).length;
    const m1 = recall && (arm === "plain" || recallDiff)
      ? recall.low >= marks.floor && (arm === "plain" ? false : recallDiff!.low > marks.diffFloor) && (followUpRecall ?? 0) >= marks.followUpFloor && reps.every((rep) => perRepRecall[rep]! >= marks.perRepFloor)
      : null;
    const falseOk = (cat: "stable" | "no_tool"): boolean => {
      const f = falseSearch[cat];
      if (!f.rate) return false;
      return f.rate.mean <= marks.falseMax && f.rate.high <= marks.falseUpper && (f.diff === null || f.diff.high <= marks.falseDiffUpper);
    };
    const m2 = falseSearch.stable.rate && falseSearch.no_tool.rate ? falseOk("stable") && falseOk("no_tool") && noToolFollowUpsSearched <= marks.noToolFollowUpMax : null;
    return { arm, recall, recallDiff, followUpRecall, perRepRecall, falseSearch, noToolFollowUpsSearched, fired, m1, m2 };
  });
  return { runsUsed: used.length, rowsUsed: new Set(used.map((r) => r.row)).size, contestedExcluded, arms, notMeasuredHere: ["M3 latency (stage 2)", "M4 call-shape regression (stage 2)", "M5 minors and spoken (counter and unit tests)", "M6 privacy (architect)"] };
}

const pc = (x: number | null | undefined): string => (x === null || x === undefined ? "n/a" : `${(100 * x).toFixed(1)}%`);
const iv = (b: Interval | null): string => (b ? `${pc(b.mean)} [${pc(b.low)}, ${pc(b.high)}] over ${b.n} families` : "n/a");

export function renderReplay(r: ReplayReport, marks: Marks = DEFAULT_MARKS): string {
  const out = [`# ROUTER-BUILD-02 stage 1 replay`, "", `${r.runsUsed} plain runs over ${r.rowsUsed} rows; ${r.contestedExcluded} contested rows excluded from every numerator and denominator.`, ""];
  for (const a of r.arms) {
    out.push(`## ${a.arm}`, `- recency recall: ${iv(a.recall)}`);
    if (a.recallDiff) out.push(`- paired diff to plain: ${iv(a.recallDiff)}`);
    out.push(`- follow-up recency recall: ${pc(a.followUpRecall)} (mark ${pc(marks.followUpFloor)})`, `- per repeat: ${Object.entries(a.perRepRecall).map(([k, v]) => `rep ${k} ${pc(v)}`).join(", ")} (mark ${pc(marks.perRepFloor)} each)`);
    for (const cat of ["stable", "no_tool"] as const) out.push(`- ${cat} false searches: ${iv(a.falseSearch[cat].rate)}${a.falseSearch[cat].diff ? `; diff to plain ${iv(a.falseSearch[cat].diff)}` : ""}`);
    out.push(`- no_tool follow-ups searched: ${a.noToolFollowUpsSearched} (mark at most ${marks.noToolFollowUpMax})`, `- decider fired on ${a.fired} runs plain did not search`, `- M1 ${a.m1 === null ? "not measurable" : a.m1 ? "PASS" : "FAIL"}, M2 ${a.m2 === null ? "not measurable" : a.m2 ? "PASS" : "FAIL"}`, "");
  }
  out.push(`Not measured here: ${r.notMeasuredHere.join("; ")}.`);
  return out.join("\n");
}

if (import.meta.main) {
  const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i < 0 ? null : (process.argv[i + 1] ?? null); };
  const need = (n: string): string => { const v = arg(n); if (!v) { console.error(`routerBuild02Replay: ${n} is required. Example: bun run scripts/bench/routerBuild02Replay.ts --plain /full/path/results.json --prereg /full/path/PREREG.json --lockbox /full/path/lockbox.json --decisions A=/full/path/a.json`); process.exit(2); } return v; };
  try {
    const prereg = JSON.parse(readFileSync(need("--prereg"), "utf-8"));
    const lockboxPath = need("--lockbox");
    assertLockboxMatches(lockboxPath, prereg);
    const rows = (JSON.parse(readFileSync(lockboxPath, "utf-8")).rows as ReplayRow[]);
    const plain = (JSON.parse(readFileSync(need("--plain"), "utf-8")) as { runs: PlainRun[] }).runs;
    const decisions: Record<string, DecisionFile> = {};
    for (const kv of (arg("--decisions") ?? "").split(",").filter(Boolean)) { const [k, p] = kv.split("="); decisions[k!] = JSON.parse(readFileSync(p!, "utf-8")); }
    const marks: Marks = { ...DEFAULT_MARKS, ...(prereg.marks ?? {}), ...(arg("--floor") ? { floor: Number(arg("--floor")) } : {}) };
    const report = replay(plain, rows, decisions, marks);
    console.log(renderReplay(report, marks));
    if (arg("--out")) writeFileSync(arg("--out")!, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(`routerBuild02Replay refused: ${(err as Error).message}`);
    process.exit(2);
  }
}
