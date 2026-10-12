// MINOR-TOPICS-01g: the bench harness. It turns the dataset and the band records into the list of
// turns to run, calls an injected `respond` for each, and returns TopicRun records for score.ts.
// `respond` is the only thing that touches a model, so this file and the scorer are tested offline;
// run.ts supplies the live one (the real turn pipeline against a running Stack).
import type { Row } from "./schema";
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import { inZeroToleranceScope, needsLabel, type Arm, type Band, type Coverage, type Label, type Surface, type TopicRun } from "./score";

/** FNV-1a: a stable, dependency-free hash for the arm order. */
function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export interface BandTopic { stance: string; allowed: readonly string[]; fixed?: boolean }
export interface BandRecordLike { topics?: Record<string, BandTopic> }

/** One reachable setting combination: the keys to write and a stable id. */
export interface SettingCombo { id: string; band: Band; values: Record<string, string> }

export const CHILD_KEYS: Record<string, string> = { bodies: "topics.bodies", health: "topics.health", risk: "topics.risk", violence: "topics.violence" };
export const TEEN_KEYS: Record<string, string> = { bodies: "topics.teen.bodies", risk: "topics.teen.risk" };

/** Every setting a parent can reach for a band: a child's four keys and the family-story keep (32), the teen household's two keys (4). */
export function settingCombos(band: Band, record: BandRecordLike): SettingCombo[] {
  const keys = band === "child" ? CHILD_KEYS : TEEN_KEYS;
  const axes: { key: string; options: readonly string[] }[] = [];
  for (const [family, key] of Object.entries(keys)) {
    const t = record.topics?.[family];
    if (t && !t.fixed) axes.push({ key, options: t.allowed });
  }
  if (band === "child") axes.push({ key: "topics.family_stories", options: ["keep", "off"] });
  let combos: Record<string, string>[] = [{}];
  for (const axis of axes) combos = combos.flatMap((c) => axis.options.map((o) => ({ ...c, [axis.key]: o })));
  return combos.map((values) => ({ id: Object.entries(values).map(([k, v]) => `${k.replace("topics.", "")}=${v}`).join(";"), band, values }));
}

/** The band record's own default combination. Throws when none of the reachable combinations is the default, so a bench never runs under a setting that is not the shipped one. */
export function defaultCombo(band: Band, record: BandRecordLike & { family_stories?: { default?: string } }, combos: readonly SettingCombo[]): SettingCombo {
  const keys = band === "child" ? CHILD_KEYS : TEEN_KEYS;
  const want = (key: string): string | undefined => {
    if (key === "topics.family_stories") return record.family_stories?.default ?? "keep";
    const family = Object.entries(keys).find(([, k]) => k === key)?.[0];
    return family ? record.topics?.[family]?.stance : undefined;
  };
  const found = combos.find((c) => Object.entries(c.values).every(([k, v]) => want(k) === v));
  if (!found) throw new Error(`the ${band} band's default stances are not among its reachable setting combinations; the band record and the settings registry disagree. Fix spec/safety (the band's topics allowed list) or the key ranges before running the bench.`);
  return found;
}

export function coverageFor(child: readonly SettingCombo[], teen: readonly SettingCombo[]): Coverage {
  return { child: child.map((c) => c.id), teen: teen.map((c) => c.id) };
}

export interface RespondInput { arm: Arm; model: string; surface: Surface; row: Row; combo: SettingCombo; rep: number; cold: boolean }
export interface RespondOutput {
  reply: string;
  error: string | null;
  firstWordMs: number | null;
  promptTokens: number | null;
  reasoningChars: number;
  selfHarmTripped: boolean;
  crisisOverlay: boolean;
  topicTextInLogs: boolean;
}
export type Respond = (input: RespondInput) => Promise<RespondOutput>;

/** Rows that run at every setting combination: the scorer's zero-tolerance scope, implicit phrasings, and any row whose text trips the self-harm detector (check 3 reads those at every setting). */
export const isZeroToleranceRow = (r: Row): boolean => inZeroToleranceScope(r) || r.implicit || checkSafety(r.text, { isMinor: true }).categories.includes("self_harm");

/** Rows a surface runs. Written: everything not spoken-framed. Spoken: the spoken-framed rows, plus the hard-line and emergency rows (the dataset has no spoken-framed hard line) at the default combination only. */
export function rowsForSurface(rows: readonly Row[], surface: Surface): { row: Row; defaultOnly: boolean }[] {
  if (surface === "written") return rows.filter((r) => r.framing !== "spoken").map((row) => ({ row, defaultOnly: false }));
  return rows.flatMap<{ row: Row; defaultOnly: boolean }>((row) => (row.framing === "spoken" ? [{ row, defaultOnly: false }] : row.kind === "hard_line" || row.kind === "safety_emergency" ? [{ row, defaultOnly: true }] : []));
}

/** The plan for one band and surface, grouped by combination so a setting is written once per group. Zero-tolerance rows run at every combination, other rows at the default only. */
export function planTurns(rows: readonly { row: Row; defaultOnly?: boolean }[], combos: readonly SettingCombo[], defaultCombo: SettingCombo): { row: Row; combo: SettingCombo }[] {
  const plan: { row: Row; combo: SettingCombo }[] = [];
  for (const combo of combos) for (const { row, defaultOnly } of rows) if (combo.id === defaultCombo.id || (!defaultOnly && isZeroToleranceRow(row))) plan.push({ row, combo });
  return plan;
}

export interface RunOptions {
  rows: readonly Row[];
  combos: Record<Band, readonly SettingCombo[]>;
  /** The band record's own default combination per band. */
  defaults: Record<Band, SettingCombo>;
  models: readonly string[];
  surfaces: readonly Surface[];
  repeats: number;
  respond: Respond;
  /** Called after each finished turn, for a progress line or a resumable file. */
  onRun?: (run: TopicRun) => void;
  /** True for a run id that already has a record (a resumed run); the turn is not repeated. */
  skip?: (id: string) => boolean;
  /** Empties the engine's prompt cache so the next turn is cold; returns false when it cannot. Without it no turn is marked cold and the cold latency row reads no_evidence. */
  resetCache?: () => Promise<boolean>;
  /** A cold sample every this many turns per model, arm and surface (default 15), so the cold p95 has a sample. */
  coldEvery?: number;
}

export const runId = (parts: { arm: Arm; model: string; surface: Surface; row: string; setting: string; rep: number }): string => `${parts.arm}|${parts.model}|${parts.surface}|${parts.row}|${parts.setting}|${parts.rep}`;

/**
 * Runs every planned turn in both conditions. Baseline and block alternate within a row and repeat so a
 * drifting engine hits both; the first turn of each (model, arm) is the cold turn. A respond that throws
 * is recorded as an error run, never dropped.
 */
export async function runBench(opts: RunOptions): Promise<TopicRun[]> {
  const out: TopicRun[] = [];
  const counter = new Map<string, number>();
  const coldEvery = opts.coldEvery ?? 15;
  for (const model of opts.models) {
    for (const surface of opts.surfaces) {
      for (const band of ["child", "teen"] as const) {
        const plan = planTurns(rowsForSurface(opts.rows.filter((r) => r.band === band), surface), opts.combos[band], opts.defaults[band]);
        for (const { row, combo } of plan) {
          for (let rep = 1; rep <= opts.repeats; rep++) {
            const arms: Arm[] = stableHash(`${row.id}|${rep}`) % 2 === 0 ? ["baseline", "block"] : ["block", "baseline"];
            for (const arm of arms) {
              if (opts.skip?.(runId({ arm, model, surface, row: row.id, setting: combo.id, rep }))) continue;
              const key = `${model}|${arm}|${surface}`;
              const seen = counter.get(key) ?? 0;
              counter.set(key, seen + 1);
              const cold = seen % coldEvery === 0 && opts.resetCache ? await opts.resetCache().catch(() => false) : false;
              const input: RespondInput = { arm, model, surface, row, combo, rep, cold };
              let o: RespondOutput;
              try { o = await opts.respond(input); } catch (err) { o = { reply: "", error: (err as Error).message, firstWordMs: null, promptTokens: null, reasoningChars: 0, selfHarmTripped: false, crisisOverlay: false, topicTextInLogs: false }; }
              const run: TopicRun = { id: runId({ arm, model, surface, row: row.id, setting: combo.id, rep }), arm, model, surface, row: row.id, band, kind: row.kind, family: row.family, subtopic: row.subtopic, heldOut: row.split === "held_out", rep, setting: combo.id, cold, ...o };
              out.push(run);
              opts.onRun?.(run);
            }
          }
        }
      }
    }
  }
  return out;
}

export interface SheetEntry { key: string; prompt: string; kind: string; family: string; reply: string; label: null }

/**
 * The labelling sheet, blinded: an opaque key, the prompt and the reply, in a shuffled order, with no arm, model,
 * setting or run id, so a person's label cannot lean on which condition made the reply. The key-to-run map goes in a
 * separate file the labeller does not open. Labels are filled into labels.json by key and translated back with
 * `labelsByRun`.
 */
export function labelSheet(runs: readonly TopicRun[], rows: readonly Row[]): { sheet: SheetEntry[]; keyMap: Record<string, string> } {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const pick = runs.filter((r) => r.error === null && needsLabel(r)).sort((a, b) => stableHash(a.id) - stableHash(b.id) || (a.id < b.id ? -1 : 1));
  const keyMap: Record<string, string> = {};
  const sheet = pick.map((r, i) => {
    const key = `L${String(i + 1).padStart(5, "0")}`;
    keyMap[key] = r.id;
    return { key, prompt: byId.get(r.row)?.text ?? "", kind: r.kind, family: r.family, reply: r.reply, label: null };
  });
  return { sheet, keyMap };
}

/** Translates a labels file keyed by sheet key into labels keyed by run id. A key with no run is dropped. */
export function labelsByRun(labelsByKey: Readonly<Record<string, Label>>, keyMap: Readonly<Record<string, string>>): Record<string, Label> {
  const out: Record<string, Label> = {};
  for (const [key, label] of Object.entries(labelsByKey)) if (keyMap[key]) out[keyMap[key]!] = label;
  return out;
}
