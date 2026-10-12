// TOOLS-RECALL-01 scorer: per-tool call reliability for the ten base tools.
// Pure functions, no database and no engine, so a test can import it. Nothing
// here takes part in a live turn (rule 1: the model decides which tool to call).

export const BASE_TOOLS = ["weather", "timer", "remind", "convert", "math", "remember", "almanac-date", "almanac-time", "bedtime-storybook", "websearch"] as const;
export type BaseTool = (typeof BASE_TOOLS)[number];
export type Kind = "positive" | "followup" | "none" | "nearmiss";
export type Band = "adult" | "child" | "spoken";
export type Slice = "all" | "tuning" | "heldout";
export type Outcome = "correct" | "missed" | "wrong_tool" | "false_call" | "clean";

export interface Row {
  id: string; kind: Kind; expected: string | null; band: Band; heldOut: boolean; prompt: string;
  priorUser?: string; priorAssistant?: string; confusable?: string;
}
/** One scored turn: the tool names the model's first answer-bearing request called, and every later one. */
export interface Run {
  arm: string; row: string; rep: number; error: string | null;
  firstCalls: string[]; laterCalls: string[]; fixtureQueries: number;
}

/** FNV-1a 32-bit: the stable hash behind the tuning/held-out split. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** About 40% of ids are held out, decided by the id alone so adding rows never moves an old one. */
export const isHeldOut = (id: string): boolean => fnv1a(id) % 100 < 40;

export const expectsCall = (row: Row): boolean => row.kind === "positive" || row.kind === "followup";

/** What the model's first round did against the row's label. */
export function classify(row: Row, firstCalls: readonly string[]): Outcome {
  if (expectsCall(row)) {
    if (firstCalls.includes(row.expected!)) return "correct";
    return firstCalls.length === 0 ? "missed" : "wrong_tool";
  }
  return firstCalls.length === 0 ? "clean" : "false_call";
}

/** A child row must never produce a websearch call, in any round, nor a query reaching the search fixture. */
export function childSearchViolation(row: Row, run: Pick<Run, "firstCalls" | "laterCalls" | "fixtureQueries">): boolean {
  if (row.band !== "child") return false;
  return run.fixtureQueries > 0 || [...run.firstCalls, ...run.laterCalls].includes("websearch");
}

/** Problems with a fixture, empty when it is sound. */
export function validateFixture(rows: readonly Row[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const prompts = new Set<string>();
  for (const r of rows) {
    if (ids.has(r.id)) problems.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    if (prompts.has(r.prompt)) problems.push(`${r.id}: duplicate prompt`);
    prompts.add(r.prompt);
    if (r.heldOut !== isHeldOut(r.id)) problems.push(`${r.id}: heldOut does not match the id hash`);
    if (expectsCall(r) && !(BASE_TOOLS as readonly string[]).includes(r.expected ?? "")) problems.push(`${r.id}: expected tool is not a base tool`);
    if (!expectsCall(r) && r.expected !== null) problems.push(`${r.id}: ${r.kind} rows expect no tool`);
    if (r.kind === "followup" && (!r.priorUser || !r.priorAssistant)) problems.push(`${r.id}: follow-up lacks a prior turn`);
    if (r.kind !== "followup" && (r.priorUser || r.priorAssistant)) problems.push(`${r.id}: only follow-ups carry a prior turn`);
    if (r.kind === "nearmiss" && !(BASE_TOOLS as readonly string[]).includes(r.confusable ?? "")) problems.push(`${r.id}: near-miss names no confusable base tool`);
    if (r.band === "child" && r.expected === "websearch") problems.push(`${r.id}: a child row may not expect websearch`);
  }
  return problems;
}

export function countRows(rows: readonly Row[]) {
  const perTool: Record<string, { positive: number; followup: number }> = {};
  for (const t of BASE_TOOLS) perTool[t] = { positive: rows.filter((r) => r.kind === "positive" && r.expected === t).length, followup: rows.filter((r) => r.kind === "followup" && r.expected === t).length };
  const by = (f: (r: Row) => string) => rows.reduce<Record<string, number>>((o, r) => ((o[f(r)] = (o[f(r)] ?? 0) + 1), o), {});
  return { total: rows.length, perTool, none: rows.filter((r) => r.kind === "none").length, nearmiss: rows.filter((r) => r.kind === "nearmiss").length, bands: by((r) => r.band), heldOut: rows.filter((r) => r.heldOut).length };
}

const inSlice = (row: Row, slice: Slice): boolean => slice === "all" || (slice === "heldout") === row.heldOut;
const rate = (n: number, d: number): number | null => (d === 0 ? null : Math.round((1000 * n) / d) / 1000);

export interface ToolCell { n: number; recall: number | null; wrongTool: number | null; missed: number | null }
export interface ArmSummary {
  arm: string; slice: Slice; runs: number; errors: number;
  perTool: Record<string, ToolCell>;
  overall: ToolCell;
  falseCall: { none: { n: number; rate: number | null }; nearmiss: { n: number; rate: number | null } };
  childSearchViolations: number;
}

/** Per-tool recall, wrong-tool rate and false-call rates for one arm and slice. Errored runs are counted, not scored. */
export function summarizeArm(rows: readonly Row[], runs: readonly Run[], arm: string, slice: Slice): ArmSummary {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const mine = runs.filter((r) => r.arm === arm && byId.has(r.row) && inSlice(byId.get(r.row)!, slice));
  const ok = mine.filter((r) => r.error === null);
  const cell = (pred: (row: Row) => boolean): ToolCell => {
    const rs = ok.filter((r) => pred(byId.get(r.row)!));
    const o = rs.map((r) => classify(byId.get(r.row)!, r.firstCalls));
    return { n: rs.length, recall: rate(o.filter((x) => x === "correct").length, rs.length), wrongTool: rate(o.filter((x) => x === "wrong_tool").length, rs.length), missed: rate(o.filter((x) => x === "missed").length, rs.length) };
  };
  const falseCall = (kind: Kind) => {
    const rs = ok.filter((r) => byId.get(r.row)!.kind === kind);
    return { n: rs.length, rate: rate(rs.filter((r) => classify(byId.get(r.row)!, r.firstCalls) === "false_call").length, rs.length) };
  };
  const perTool: Record<string, ToolCell> = {};
  for (const t of BASE_TOOLS) perTool[t] = cell((row) => expectsCall(row) && row.expected === t);
  return {
    arm, slice, runs: mine.length, errors: mine.length - ok.length, perTool, overall: cell(expectsCall),
    falseCall: { none: falseCall("none"), nearmiss: falseCall("nearmiss") },
    childSearchViolations: ok.filter((r) => childSearchViolation(byId.get(r.row)!, r)).length,
  };
}

export type Metric = "recall" | "wrongTool" | "falseCall";

/** Per-row mean over the arm's repeats of the 0/1 metric; rows with no scored run are absent. */
export function rowMeans(rows: readonly Row[], runs: readonly Run[], arm: string, metric: Metric, slice: Slice, tool?: string): Map<string, number> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const acc = new Map<string, number[]>();
  for (const run of runs) {
    const row = byId.get(run.row);
    if (!row || run.arm !== arm || run.error !== null || !inSlice(row, slice)) continue;
    const out = classify(row, run.firstCalls);
    let v: number | null = null;
    if (metric === "recall" && expectsCall(row) && (!tool || row.expected === tool)) v = out === "correct" ? 1 : 0;
    else if (metric === "wrongTool" && expectsCall(row) && (!tool || row.expected === tool)) v = out === "wrong_tool" ? 1 : 0;
    else if (metric === "falseCall" && !expectsCall(row)) v = out === "false_call" ? 1 : 0;
    if (v === null) continue;
    (acc.get(row.id) ?? acc.set(row.id, []).get(row.id)!).push(v);
  }
  return new Map([...acc].map(([id, vs]) => [id, vs.reduce((a, b) => a + b, 0) / vs.length]));
}

/** Small seeded PRNG (mulberry32) so an interval is reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PairedInterval { n: number; diff: number; lo: number; hi: number }

/** Paired bootstrap of (variant - baseline) over the rows both arms scored: resample rows, 95% percentile interval. */
export function pairedInterval(base: ReadonlyMap<string, number>, variant: ReadonlyMap<string, number>, iterations = 2000, seed = 1): PairedInterval | null {
  const ids = [...base.keys()].filter((id) => variant.has(id));
  if (ids.length === 0) return null;
  const d = ids.map((id) => variant.get(id)! - base.get(id)!);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const next = prng(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < d.length; j++) s += d[Math.floor(next() * d.length)]!;
    means.push(s / d.length);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))]!;
  return { n: ids.length, diff: mean(d), lo: at(0.025), hi: at(0.975) };
}

/** Replaces tool descriptions on the wire (bench-only variant arm). Returns the body unchanged when nothing matched. */
export function rewriteToolDescriptions(bodyText: string, descriptions: Readonly<Record<string, string>>): { body: string; rewritten: number } {
  try {
    const parsed = JSON.parse(bodyText) as { tools?: { function?: { name?: string; description?: string } }[] };
    let rewritten = 0;
    for (const tool of parsed.tools ?? []) {
      const name = tool.function?.name;
      if (name && tool.function && Object.hasOwn(descriptions, name)) {
        tool.function.description = descriptions[name]!;
        rewritten++;
      }
    }
    return rewritten > 0 ? { body: JSON.stringify(parsed), rewritten } : { body: bodyText, rewritten };
  } catch {
    return { body: bodyText, rewritten: 0 };
  }
}
