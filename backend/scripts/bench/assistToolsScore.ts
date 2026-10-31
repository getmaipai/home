// ASSIST-BENCH-01 scoring: pure functions, no engine and no database. The runner (assist-tools-bench.ts) feeds them
// what the model did; tests/ and assistToolsScore.test.ts prove them on fabricated outputs.
import { DEFAULT_ACTION } from "./assistActions";
import { pairedInterval, type PairedInterval } from "./searchRecency02Score";

export type Area = "lists" | "reminders" | "alarms" | "negatives";
export type Kind = "positive" | "negative" | "clarify";
export type Split = "dev" | "heldout";

export interface AssistRow {
  id: string;
  area: Area;
  kind: Kind;
  utterance: string;
  tool: "remind" | "timer" | "none";
  action: string;
  /** Words that must appear in the call's arguments (any field), keyed by the field they belong to. */
  keyArgs: Record<string, string[]>;
  split: Split;
  /** Earlier turns, each a user line and the assistant's scripted answer. */
  context?: { user: string; assistant: string }[];
}

export interface ObservedCall {
  tool: string;
  args: Record<string, unknown>;
}
export interface Observed {
  calls: ObservedCall[];
  reply: string;
  error?: string | null;
}

export interface RowScore {
  /** A remind or timer call was made. */
  called: boolean;
  toolOk: boolean;
  actionOk: boolean;
  argsOk: boolean;
  /** Negatives and clarify rows: no remind or timer call. */
  noCall: boolean;
  /** Clarify rows: no call and the reply asks a question. */
  clarifyOk: boolean;
  /** The row's headline result: tool and action for a positive, no call for a negative, a question for a clarify row. */
  pass: boolean;
  errored: boolean;
}

/** The bar from the design note section 5. Both rates are over held-out runs. */
export const BAR = {
  toolAndAction: 0.95,
  negativesNoCall: 0.95,
  /** The lower end of the paired interval, on-minus-off, must not fall below this many points on an existing row set. */
  regressionFloorPoints: -5,
} as const;

const ASSIST_TOOLS = ["remind", "timer"];

/** The first call to remind or timer, which is the one the bench scores. */
export function primaryCall(calls: readonly ObservedCall[]): ObservedCall | null {
  return calls.find((call) => ASSIST_TOOLS.includes(call.tool)) ?? null;
}

/** The action a call stands for: its `action`, or the tool's default when it names none. */
export function actionOf(call: ObservedCall): string {
  const action = call.args.action;
  if (typeof action === "string" && action.trim() !== "") return action.trim();
  return DEFAULT_ACTION[call.tool as "remind" | "timer"] ?? "";
}

function argText(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (key === "action") continue;
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) parts.push(...value.map(String));
    else if (value !== null && value !== undefined) parts.push(String(value));
  }
  return parts.join(" ").toLowerCase();
}

/** Every expected word appears somewhere in the call's arguments, ignoring case. */
export function keyArgsPresent(row: Pick<AssistRow, "keyArgs">, call: ObservedCall): boolean {
  const text = argText(call.args);
  return Object.values(row.keyArgs).flat().every((word) => text.includes(word.toLowerCase()));
}

export function asksQuestion(reply: string): boolean {
  return reply.includes("?");
}

export function scoreRow(row: AssistRow, observed: Observed): RowScore {
  const call = primaryCall(observed.calls);
  const called = call !== null;
  const errored = Boolean(observed.error);
  if (row.kind === "negative") {
    const pass = !called && !errored;
    return { called, toolOk: false, actionOk: false, argsOk: false, noCall: !called, clarifyOk: false, pass, errored };
  }
  if (row.kind === "clarify") {
    const clarifyOk = !called && asksQuestion(observed.reply);
    return { called, toolOk: false, actionOk: false, argsOk: false, noCall: !called, clarifyOk, pass: clarifyOk && !errored, errored };
  }
  const toolOk = call !== null && call.tool === row.tool;
  const actionOk = toolOk && call !== null && actionOf(call) === row.action;
  const argsOk = toolOk && call !== null && keyArgsPresent(row, call);
  return { called, toolOk, actionOk, argsOk, noCall: !called, clarifyOk: false, pass: toolOk && actionOk && !errored, errored };
}

export interface RunScore {
  rowId: string;
  rep: number;
  score: RowScore;
}

const rate = (hits: number, total: number): number | null => (total === 0 ? null : hits / total);

export interface Summary {
  positives: { runs: number; toolRate: number | null; actionRate: number | null; toolAndActionRate: number | null; argsRate: number | null };
  negatives: { runs: number; noCallRate: number | null };
  clarify: { runs: number; clarifyRate: number | null };
}

/** Rates over every run of the given rows (a row set is a split, an area, or everything). */
export function summarize(rows: readonly AssistRow[], runs: readonly RunScore[]): Summary {
  const kindOf = new Map(rows.map((row) => [row.id, row.kind]));
  const mine = runs.filter((run) => kindOf.has(run.rowId));
  const of = (kind: Kind) => mine.filter((run) => kindOf.get(run.rowId) === kind);
  const positives = of("positive");
  const negatives = of("negative");
  const clarify = of("clarify");
  const count = (list: readonly RunScore[], pick: (s: RowScore) => boolean) => list.filter((run) => pick(run.score)).length;
  return {
    positives: {
      runs: positives.length,
      toolRate: rate(count(positives, (s) => s.toolOk), positives.length),
      actionRate: rate(count(positives, (s) => s.actionOk), positives.length),
      toolAndActionRate: rate(count(positives, (s) => s.pass), positives.length),
      argsRate: rate(count(positives, (s) => s.argsOk), positives.length),
    },
    negatives: { runs: negatives.length, noCallRate: rate(count(negatives, (s) => s.pass), negatives.length) },
    clarify: { runs: clarify.length, clarifyRate: rate(count(clarify, (s) => s.pass), clarify.length) },
  };
}

/** Per-row pass rate over the row's repeats, the unit of the paired interval (rule 13: rows are the sample). */
export function rowRates(runs: readonly RunScore[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const run of runs) by.set(run.rowId, [...(by.get(run.rowId) ?? []), run.score.pass ? 1 : 0]);
  return new Map([...by].map(([id, values]) => [id, values.reduce((a, b) => a + b, 0) / values.length]));
}

/** Paired 95% interval, widened-on minus widened-off, over the rows both arms ran. Points, one decimal. */
export function pairedOnOff(on: readonly RunScore[], off: readonly RunScore[]): PairedInterval | null {
  return pairedInterval(rowRates(on), rowRates(off));
}

export interface BarVerdict {
  pass: boolean;
  toolAndAction: number | null;
  negativesNoCall: number | null;
  reasons: string[];
}

/** The held-out verdict against BAR. An empty set of runs never passes. */
export function judgeBar(heldout: Summary): BarVerdict {
  const toolAndAction = heldout.positives.toolAndActionRate;
  const negativesNoCall = heldout.negatives.noCallRate;
  const reasons: string[] = [];
  if (toolAndAction === null) reasons.push("no held-out positive runs");
  else if (toolAndAction < BAR.toolAndAction) reasons.push(`correct tool and action ${pct(toolAndAction)} is under ${pct(BAR.toolAndAction)}`);
  if (negativesNoCall === null) reasons.push("no held-out negative runs");
  else if (negativesNoCall < BAR.negativesNoCall) reasons.push(`no call on negatives ${pct(negativesNoCall)} is under ${pct(BAR.negativesNoCall)}`);
  return { pass: reasons.length === 0, toolAndAction, negativesNoCall, reasons };
}

export const pct = (value: number): string => `${(Math.round(value * 1000) / 10).toFixed(1)}%`;

export interface RegressionVerdict {
  name: string;
  n: number;
  meanDiffPct: number | null;
  lowPct: number | null;
  highPct: number | null;
  pass: boolean;
}

/** An existing row set must not get worse with the wider schema on: the paired interval's low end stays at or above the floor. */
export function judgeRegression(name: string, on: ReadonlyMap<string, number>, off: ReadonlyMap<string, number>): RegressionVerdict {
  const interval = pairedInterval(on, off);
  if (!interval) return { name, n: 0, meanDiffPct: null, lowPct: null, highPct: null, pass: false };
  return { name, n: interval.n, meanDiffPct: interval.meanDiffPct, lowPct: interval.lowPct, highPct: interval.highPct, pass: interval.lowPct >= BAR.regressionFloorPoints };
}

/** The stand-in for "was a reasonable first answer": a chat-ab-01 run that errored or came back empty counts 0. */
export function okRate(runs: readonly { item: string; reply: string; error: string | null }[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const run of runs) by.set(run.item, [...(by.get(run.item) ?? []), run.error === null && run.reply.trim() !== "" ? 1 : 0]);
  return new Map([...by].map(([id, values]) => [id, values.reduce((a, b) => a + b, 0) / values.length]));
}

/** A chat-ab-01 fresh run is right when a time-sensitive row searched and any other row did not. */
export function freshRates(runs: readonly { item: string; fresh?: { kind: string; evidenceFired: boolean } }[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const run of runs) {
    if (!run.fresh) continue;
    const right = run.fresh.kind === "time-sensitive" ? run.fresh.evidenceFired : !run.fresh.evidenceFired;
    by.set(run.item, [...(by.get(run.item) ?? []), right ? 1 : 0]);
  }
  return new Map([...by].map(([id, values]) => [id, values.reduce((a, b) => a + b, 0) / values.length]));
}

export type Arm = "on" | "off";
export interface ArmRun extends RunScore {
  arm: Arm;
  calls: ObservedCall[];
  reply: string;
  error: string | null;
}

export interface Report {
  /** The on arm on held-out rows: this is what the bar judges. */
  heldoutOn: Summary;
  devOn: Summary;
  heldoutOff: Summary;
  devOff: Summary;
  byArea: Record<string, Summary>;
  /** Widened-on minus widened-off, per split, on the same rows. */
  paired: { dev: PairedInterval | null; heldout: PairedInterval | null };
  bar: BarVerdict;
  /** Rows whose on-arm pass rate is under 1, worst first, for a person to read. */
  weakest: { id: string; utterance: string; passRate: number }[];
}

export function buildReport(rows: readonly AssistRow[], runs: readonly ArmRun[]): Report {
  const inSplit = (split: Split) => rows.filter((row) => row.split === split);
  const armRuns = (arm: Arm) => runs.filter((run) => run.arm === arm);
  const on = armRuns("on");
  const off = armRuns("off");
  const idsOf = (list: readonly AssistRow[]) => new Set(list.map((row) => row.id));
  const only = (list: readonly ArmRun[], ids: Set<string>) => list.filter((run) => ids.has(run.rowId));
  const dev = idsOf(inSplit("dev"));
  const held = idsOf(inSplit("heldout"));
  const byArea: Record<string, Summary> = {};
  for (const area of ["lists", "reminders", "alarms", "negatives"] as const) {
    byArea[area] = summarize(rows.filter((row) => row.area === area && row.split === "heldout"), on);
  }
  const heldoutOn = summarize(inSplit("heldout"), on);
  const rates = rowRates(on);
  const text = new Map(rows.map((row) => [row.id, row.utterance]));
  const weakest = [...rates].filter(([, value]) => value < 1).sort((a, b) => a[1] - b[1]).slice(0, 15)
    .map(([id, passRate]) => ({ id, utterance: text.get(id) ?? "", passRate }));
  return {
    heldoutOn,
    devOn: summarize(inSplit("dev"), on),
    heldoutOff: summarize(inSplit("heldout"), off),
    devOff: summarize(inSplit("dev"), off),
    byArea,
    paired: { dev: pairedOnOff(only(on, dev), only(off, dev)), heldout: pairedOnOff(only(on, held), only(off, held)) },
    bar: judgeBar(heldoutOn),
    weakest,
  };
}

const fmt = (value: number | null): string => (value === null ? "n/a" : pct(value));

export function renderReport(model: string, report: Report, regressions: readonly RegressionVerdict[]): string {
  const lines: string[] = [`ASSIST-BENCH-01 report for model ${model}`, ""];
  const table = (name: string, s: Summary) =>
    `${name}: tool ${fmt(s.positives.toolRate)}, action ${fmt(s.positives.actionRate)}, ` +
    `tool+action ${fmt(s.positives.toolAndActionRate)}, args ${fmt(s.positives.argsRate)} (${s.positives.runs} runs); ` +
    `no call on negatives ${fmt(s.negatives.noCallRate)} (${s.negatives.runs}); clarified when ambiguous ${fmt(s.clarify.clarifyRate)} (${s.clarify.runs})`;
  lines.push(table("held-out, widened on ", report.heldoutOn), table("held-out, widened off", report.heldoutOff));
  lines.push(table("dev, widened on     ", report.devOn), table("dev, widened off    ", report.devOff), "");
  for (const [area, summary] of Object.entries(report.byArea)) lines.push(table(`held-out ${area}`.padEnd(21), summary));
  const interval = (name: string, value: PairedInterval | null) =>
    value ? `${name}: on minus off ${value.meanDiffPct} points, 95% [${value.lowPct}, ${value.highPct}] over ${value.n} rows` : `${name}: not enough paired rows`;
  lines.push("", interval("dev", report.paired.dev), interval("held-out", report.paired.heldout), "");
  if (regressions.length === 0) lines.push("Existing rows: not run (pass --regression).");
  for (const r of regressions) {
    if (r.n === 0) {
      lines.push(`Existing rows, ${r.name}: no paired rows (FAIL)`);
      continue;
    }
    const verdict = r.pass ? "ok" : "REGRESSED";
    lines.push(`Existing rows, ${r.name}: on minus off ${r.meanDiffPct} points, 95% [${r.lowPct}, ${r.highPct}] over ${r.n} rows, floor ${BAR.regressionFloorPoints}: ${verdict}`);
  }
  if (report.weakest.length) lines.push("", "Weakest rows (widened on):", ...report.weakest.map((w) => `  ${w.id} ${pct(w.passRate)} ${w.utterance}`));
  const regressed = regressions.some((r) => !r.pass);
  const overall = report.bar.pass && regressions.length > 0 && !regressed;
  lines.push("", `Bar: tool+action >= ${pct(BAR.toolAndAction)} and no call on negatives >= ${pct(BAR.negativesNoCall)} on held-out rows, no regression on existing rows.`);
  lines.push(`Bar on held-out rows: ${report.bar.pass ? "PASS" : "FAIL"} ${report.bar.reasons.join("; ")}`);
  lines.push(`Overall: ${overall ? "PASS" : "FAIL"}${regressions.length === 0 ? " (regression arms not run, so it cannot pass)" : ""}`);
  return lines.join("\n") + "\n";
}
