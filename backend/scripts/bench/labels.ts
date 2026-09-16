// RVW-1 (docs/plans/chat-architecture-review-2026-09-16.md section 5,
// item 1): the label harvest and the per-rule report. Reads the turn
// rows since a date and writes, into the git-ignored data directory
// (`labels/`), one JSON lines file per ISO week with, per turn, the
// signal, the rung, the guard hits, whether a forced lookup ran, the
// correction flag, the rules that fired and the person's text in roster
// form (every household name replaced by a persona-roster name, by
// position); then prints the weekly report: hits per guard reason, hits
// per rule, rungs by count, corrections by rung, and the rules with
// zero hits in the window (the org rule: a rule with zero hits over the
// weekly report is retired). A credential turn (the policy's redacted
// row) is never exported.
//
// Usage, from backend/: bun run scripts/bench/labels.ts --since <ISO date>
//
// The pure halves (the roster form, the week key, the report) are
// exported for the tests; only main() touches the database.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import defectCodes from "@maipai/spec/vocab/defect-codes.json";
import { RULE_NAMES, RUNGS, guardRule, type Rung } from "@/lib/ruleNames";
import { CREDENTIAL_REDACTION } from "@/lib/memoryContentPolicy";

/** The persona roster (the org CLAUDE.md's list, the only names a
 * fixture, a doc or an export may carry), in its published order. */
export const PERSONA_ROSTER: readonly string[] = [
  "alfred", "astro", "atlas", "bramble", "bruno", "clover", "cosmo", "daisy", "ember", "indigo", "iris", "juniper", "lucia", "marlow", "marsh", "mopey",
  "nadia", "nova", "oliver", "pippa", "quill", "raven", "riff", "rivet", "rover", "sage", "serena", "sprout", "tempo", "velvet", "vincent", "willow",
];

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** Every household name replaced by a roster name by position: the
 * i-th household name (the order the caller gives, the people first)
 * becomes the i-th roster name, whole words only, case-insensitive,
 * the same name always the same roster name so a week's export reads
 * as one household. A household name that is itself a roster name maps
 * like any other, so nothing of the real household survives. */
export function toRosterForm(text: string, householdNames: readonly string[]): string {
  const names = [...new Set(householdNames.map((n) => n.trim()).filter((n) => n.length > 0))].sort((a, b) => b.length - a.length);
  const order = [...new Set(householdNames.map((n) => n.trim()).filter((n) => n.length > 0))];
  let out = text;
  for (const name of names) {
    const roster = capitalize(PERSONA_ROSTER[order.indexOf(name) % PERSONA_ROSTER.length]!);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), roster);
  }
  return out;
}

/** The ISO week a timestamp falls in, `YYYY-Www`. */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.floor(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1 + 6) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface LabelRow {
  id: string;
  createdAt: string;
  userText: string;
  source: string;
  signal: string | null;
  rung: string | null;
  guardReason: string | null;
  rules: string | null;
  outcomes: string | null;
  correctedNextTurn: number | null;
  feedbackVerdict: "up" | "down" | null;
  feedbackReason: string | null;
}

export interface FeedbackRating {
  id: string;
  verdict: "up" | "down";
  reason: string | null;
  createdAt: string;
  hlc: string;
}

export interface FeedbackRow extends FeedbackRating {
  turnId: string;
}

export interface FeedbackSummary {
  verdict: "up" | "down" | null;
  reason: string | null;
}

/** Aggregates the per-person labels for one turn without changing the turn. */
export function summarizeFeedback(rows: readonly FeedbackRating[]): FeedbackSummary {
  const down = rows.filter((row) => row.verdict === "down").sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return byTime || a.hlc.localeCompare(b.hlc) || a.id.localeCompare(b.id);
  });
  if (down.length > 0) {
    const latest = down[down.length - 1]!;
    return { verdict: "down", reason: latest.reason };
  }
  return rows.length > 0 ? { verdict: "up", reason: null } : { verdict: null, reason: null };
}

export interface Label {
  turn_id: string;
  at: string;
  week: string;
  text: string;
  source: string;
  signal: { act: string | null; stance: string | null; emotion: string | null; intensity: string | null; source: string | null };
  rung: Rung | null;
  guard_hits: string[];
  forced_lookup: boolean;
  corrected_next_turn: boolean;
  rules: string[];
  feedback_verdict: "up" | "down" | null;
  feedback_reason: string | null;
}

/** A row's label; null for a credential turn, which is never exported. */
export function labelOf(row: LabelRow, householdNames: readonly string[]): Label | null {
  if (row.userText.includes(CREDENTIAL_REDACTION)) return null;
  const signal = row.signal ? (JSON.parse(row.signal) as { primary_act?: string; expressed_emotion?: string; emotion_intensity?: string; source?: string; clauses?: { stance?: string }[] }) : null;
  const rules = row.rules ? (JSON.parse(row.rules) as string[]) : [];
  const outcomes = row.outcomes ? (JSON.parse(row.outcomes) as { via?: string }[]) : [];
  const guardHits = rules.filter((r) => r.startsWith("guard.")).map((r) => r.slice("guard.".length));
  if (row.guardReason && !guardHits.includes(row.guardReason)) guardHits.unshift(row.guardReason);
  return {
    turn_id: row.id,
    at: row.createdAt,
    week: weekKey(row.createdAt),
    text: toRosterForm(row.userText, householdNames),
    source: row.source,
    signal: { act: signal?.primary_act ?? null, stance: signal?.clauses?.[0]?.stance ?? null, emotion: signal?.expressed_emotion ?? null, intensity: signal?.emotion_intensity ?? null, source: signal?.source ?? null },
    rung: (RUNGS as readonly string[]).includes(row.rung ?? "") ? (row.rung as Rung) : null,
    guard_hits: guardHits,
    forced_lookup: outcomes.some((o) => o.via === "forced"),
    corrected_next_turn: row.correctedNextTurn === 1,
    rules,
    feedback_verdict: row.feedbackVerdict,
    feedback_reason: row.feedbackReason,
  };
}

export interface WeeklyReport {
  week: string;
  turns: number;
  guard_hits: Record<string, number>;
  rule_hits: Record<string, number>;
  rungs: Record<string, number>;
  corrections_by_rung: Record<string, number>;
  zero_hit_rules: string[];
}

/** Every rule the report knows: the engine's names and every guard
 * reason in the vocabulary as `guard.<reason>`. */
export function knownRules(): string[] {
  const guards = (defectCodes as { guard_reasons: { id: string }[] }).guard_reasons.map((g) => guardRule(g.id));
  return [...RULE_NAMES, ...guards];
}

const count = (into: Record<string, number>, key: string): void => { into[key] = (into[key] ?? 0) + 1; };

export function weeklyReport(week: string, labels: readonly Label[]): WeeklyReport {
  const report: WeeklyReport = { week, turns: labels.length, guard_hits: {}, rule_hits: {}, rungs: {}, corrections_by_rung: {}, zero_hit_rules: [] };
  for (const label of labels) {
    for (const hit of label.guard_hits) count(report.guard_hits, hit);
    for (const rule of label.rules) count(report.rule_hits, rule);
    count(report.rungs, label.rung ?? "unrecorded");
    if (label.corrected_next_turn) count(report.corrections_by_rung, label.rung ?? "unrecorded");
  }
  report.zero_hit_rules = knownRules().filter((rule) => !(rule in report.rule_hits)).sort();
  return report;
}

export function formatReport(report: WeeklyReport): string {
  const lines = [`== ${report.week}: ${report.turns} turn(s)`];
  const section = (title: string, counts: Record<string, number>) => {
    lines.push(`-- ${title}`);
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (entries.length === 0) lines.push("   (none)");
    for (const [key, n] of entries) lines.push(`   ${String(n).padStart(5)}  ${key}`);
  };
  section("hits per guard reason", report.guard_hits);
  section("hits per rule", report.rule_hits);
  section("rungs", report.rungs);
  section("corrections by rung", report.corrections_by_rung);
  lines.push(`-- rules with zero hits this week (${report.zero_hit_rules.length})`);
  for (const rule of report.zero_hit_rules) lines.push(`   ${rule}`);
  return lines.join("\n");
}

/** Groups the labels by week, writes one JSON lines file per week under
 * `<outDir>/<week>.jsonl`, and returns the reports in week order. */
export function exportLabels(labels: readonly Label[], outDir: string): WeeklyReport[] {
  mkdirSync(outDir, { recursive: true });
  const byWeek = new Map<string, Label[]>();
  for (const label of labels) {
    const list = byWeek.get(label.week) ?? [];
    list.push(label);
    byWeek.set(label.week, list);
  }
  const reports: WeeklyReport[] = [];
  for (const week of [...byWeek.keys()].sort()) {
    const list = byWeek.get(week)!;
    writeFileSync(join(outDir, `${week}.jsonl`), list.map((l) => JSON.stringify(l)).join("\n") + "\n");
    reports.push(weeklyReport(week, list));
  }
  return reports;
}

function sinceFromArgv(argv: readonly string[]): string {
  const at = argv.indexOf("--since");
  const raw = at >= 0 ? argv[at + 1] : undefined;
  if (!raw || Number.isNaN(Date.parse(raw))) throw new Error("usage: bun run scripts/bench/labels.ts --since <ISO date>");
  return new Date(raw).toISOString();
}

async function main(): Promise<void> {
  const since = sinceFromArgv(process.argv);
  const { db } = await import("@/db");
  const { conversationTurns, entities, replyFeedback } = await import("@/db/schema");
  const { gte, asc, inArray } = await import("drizzle-orm");
  const { listActivePeople } = await import("@/lib/access");
  const { dataDir } = await import("@/lib/paths");
  const rows = db
    .select({ id: conversationTurns.id, createdAt: conversationTurns.createdAt, userText: conversationTurns.userText, source: conversationTurns.source, signal: conversationTurns.signal, rung: conversationTurns.rung, guardReason: conversationTurns.guardReason, rules: conversationTurns.rules, outcomes: conversationTurns.outcomes, correctedNextTurn: conversationTurns.correctedNextTurn })
    .from(conversationTurns)
    .where(gte(conversationTurns.createdAt, since))
    .orderBy(asc(conversationTurns.createdAt))
    .all();
  // The household's names, the people first (by their own order) and
  // then every registry entity that is a person or a pet, with aliases.
  const people = listActivePeople().map((p) => p.displayName);
  const registry = db.select({ name: entities.name, aliases: entities.aliases, kind: entities.kind }).from(entities).all().filter((e) => e.kind === "person" || e.kind === "pet").flatMap((e) => [e.name, ...(JSON.parse(e.aliases) as string[])]);
  const householdNames = [...people, ...registry];
  const feedbackRows = rows.length > 0
    ? (db
        .select({ id: replyFeedback.id, turnId: replyFeedback.turnId, verdict: replyFeedback.verdict, reason: replyFeedback.reason, createdAt: replyFeedback.createdAt, hlc: replyFeedback.hlc })
        .from(replyFeedback)
        .where(inArray(replyFeedback.turnId, rows.map((row) => row.id)))
        .all() as FeedbackRow[])
    : [];
  const feedbackByTurn = new Map<string, FeedbackRating[]>();
  for (const feedback of feedbackRows) {
    const forTurn = feedbackByTurn.get(feedback.turnId) ?? [];
    forTurn.push(feedback);
    feedbackByTurn.set(feedback.turnId, forTurn);
  }
  const labels = rows
    .map((row) => {
      const summary = summarizeFeedback(feedbackByTurn.get(row.id) ?? []);
      return labelOf({ ...row, feedbackVerdict: summary.verdict, feedbackReason: summary.reason }, householdNames);
    })
    .filter((l): l is Label => l !== null);
  const outDir = join(dataDir, "labels");
  const reports = exportLabels(labels, outDir);
  console.log(`[labels] ${labels.length} turn(s) since ${since} (${rows.length - labels.length} credential turn(s) skipped) into ${outDir}`);
  for (const report of reports) console.log(formatReport(report));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[labels] ${(err as Error).message}`);
    process.exit(1);
  });
}
