// ADMIN-PERF-01 (docs/BACKLOG.md, design note in docs/dev.md): the
// admin performance dashboard's one aggregate read. No new collection -
// every field is computed from conversation_turns' own `stats` JSON
// column (wire.ts's TurnStats/TurnGeneration/TurnNodeExecution), the
// Repairs issues table, the memory/embedding queues, the label
// harvest's own report builder (backend/scripts/bench/labels.ts, reused
// live against DB rows rather than depending on that weekly script
// having run), and the Stack client - the same shape lib/dashboard.ts's
// getDashboard() already takes for GET /api/dashboard.
import { and, gte, isNotNull } from "drizzle-orm";
import { sqlite, db } from "@/db";
import { conversationTurns, entities, pendingEmbeddings, pendingMemoryWork } from "@/db/schema";
import { listActivePeople } from "@/lib/access";
import { judgeQueueStats } from "@/lib/memoryJudge";
import { storageSummary } from "@/lib/storage";
import { isStackConfigured, getStackClient } from "@/lib/stackEngine";
import { syncStackHealthIssues } from "@/lib/stackHealthSync";
import { listIssues } from "@/lib/issues";
import { effectiveRetentionDays } from "@/lib/conversationHistory";
import type { TurnStats, TurnNodeExecution } from "@/wire";
import type {
  Performance,
  PerformanceTurns,
  PerformanceTurnDayStats,
  PerformanceEngineStats,
  PerformanceQueues,
  PerformanceLabels,
  PerformanceLayers,
  PerformanceLayerStats,
  PerformanceEngines,
  PerformanceHardware,
  PerformanceDisk,
} from "@/wire";
export type { Performance, PerformanceTurns, PerformanceTurnDayStats, PerformanceEngineStats, PerformanceQueues, PerformanceLabels, PerformanceLayers, PerformanceLayerStats, PerformanceEngines, PerformanceHardware, PerformanceDisk } from "@/wire";
// The one reverse import in this codebase from backend/src into
// backend/scripts: labels.ts's own header already says its pure halves
// (the report builder, the roster form, the week key) are "exported for
// the tests" - this route is the second real consumer, and reusing them
// here is what keeps the label-harvest counting logic in exactly one
// place rather than growing a second, driftable copy for the dashboard.
import { labelOf, weeklyReport, type LabelRow, type Label } from "../../scripts/bench/labels";

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function p95(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, idx)]!;
}

interface StatSample {
  ttft: number | null;
  total: number | null;
  tps: number | null;
}

function summarize(samples: readonly StatSample[]): { count: number; median_ttft_ms: number | null; p95_ttft_ms: number | null; median_total_ms: number | null; p95_total_ms: number | null; median_tokens_per_second: number | null } {
  const ttfts = samples.map((s) => s.ttft).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const totals = samples.map((s) => s.total).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const tps = samples.map((s) => s.tps).filter((n): n is number => n !== null).sort((a, b) => a - b);
  return {
    count: samples.length,
    median_ttft_ms: median(ttfts),
    p95_ttft_ms: p95(ttfts),
    median_total_ms: median(totals),
    p95_total_ms: p95(totals),
    median_tokens_per_second: median(tps),
  };
}

function windowStart(days: number): string {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

/** Every turn in the window that carries a `stats` blob, parsed once -
 * `turns()`, `queues()` (route breakdown) and `layers()` below each read
 * their own slice of the same rows rather than re-querying. */
function statsRows(since: string): Array<{ createdAt: string; stats: TurnStats }> {
  const rows = db
    .select({ createdAt: conversationTurns.createdAt, stats: conversationTurns.stats })
    .from(conversationTurns)
    .where(and(isNotNull(conversationTurns.stats), gte(conversationTurns.createdAt, since)))
    .all();
  const parsed: Array<{ createdAt: string; stats: TurnStats }> = [];
  for (const row of rows) {
    try {
      parsed.push({ createdAt: row.createdAt, stats: JSON.parse(row.stats!) as TurnStats });
    } catch {
      // A malformed stats blob is skipped, never thrown - the same
      // "aggregation degrades, never 500s" posture dashboard.ts's own
      // engineStatusCounts() takes for a Stack call that fails.
    }
  }
  return parsed;
}

function turnsPanel(days: number, rows: readonly { createdAt: string; stats: TurnStats }[]): PerformanceTurns {
  const byDay = new Map<string, StatSample[]>();
  const byEngine = new Map<string, StatSample[]>();
  for (const row of rows) {
    const sample: StatSample = { ttft: row.stats.time_to_first_token_ms, total: row.stats.total_time_ms, tps: row.stats.tokens_per_second };
    const day = row.createdAt.slice(0, 10);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(sample);
    const engine = row.stats.engine ?? "unknown";
    (byEngine.get(engine) ?? byEngine.set(engine, []).get(engine)!).push(sample);
  }
  const byDayOut: PerformanceTurnDayStats[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const s = summarize(byDay.get(date) ?? []);
    byDayOut.push({ date, count: s.count, median_ttft_ms: s.median_ttft_ms, p95_ttft_ms: s.p95_ttft_ms, median_total_ms: s.median_total_ms, p95_total_ms: s.p95_total_ms, median_tokens_per_second: s.median_tokens_per_second });
  }
  const byEngineOut: PerformanceEngineStats[] = [...byEngine.entries()].map(([engine, samples]) => ({ engine, ...summarize(samples) })).sort((a, b) => b.count - a.count);

  // The route taken: `conversation_turns.source` itself (wire.ts's
  // TurnValue.source) IS the route a turn took - no separate field to
  // invent, the same reason turnsPerDay() counts straight off an
  // existing column rather than deriving one.
  const since = windowStart(days);
  const routeRows = sqlite.query("SELECT source, COUNT(*) AS count FROM conversation_turns WHERE created_at >= ? GROUP BY source").all(since) as Array<{ source: string; count: number }>;
  const byRoute = routeRows.map((r) => ({ route: r.source, count: r.count })).sort((a, b) => b.count - a.count);

  return { window_days: days, by_day: byDayOut, by_engine: byEngineOut, by_route: byRoute };
}

function layersPanel(days: number, rows: readonly { createdAt: string; stats: TurnStats }[]): PerformanceLayers {
  const traced = rows.filter((r) => Array.isArray(r.stats.nodes) && r.stats.nodes.length > 0);
  const byNode = new Map<string, number[]>();
  for (const row of traced) {
    for (const node of row.stats.nodes as TurnNodeExecution[]) {
      const ms = node.endMs - node.startMs;
      (byNode.get(node.node) ?? byNode.set(node.node, []).get(node.node)!).push(ms);
    }
  }
  const nodes: PerformanceLayerStats[] = [...byNode.entries()].map(([node, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    return { node, count: sorted.length, median_ms: median(sorted), p95_ms: p95(sorted) };
  });
  return { window_days: days, turns_with_trace: traced.length, nodes };
}

function queuesPanel(): PerformanceQueues {
  const judge = judgeQueueStats();
  const embeddingPending = db.select({ memoryId: pendingEmbeddings.memoryId }).from(pendingEmbeddings).all().length;
  const ingestionRows = db.select({ reason: pendingMemoryWork.reason }).from(pendingMemoryWork).all();
  const byReason = new Map<string, number>();
  for (const row of ingestionRows) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
  return {
    judge: { pending: judge.pending, oldest_created_at: judge.oldestCreatedAt },
    embedding: { pending: embeddingPending },
    ingestion: { pending: ingestionRows.length, by_reason: [...byReason.entries()].map(([reason, count]) => ({ reason, count })) },
  };
}

/** The same query labels.ts's own main() runs, windowed by `days`
 * instead of a `--since` CLI date, and fed through its exported pure
 * report builder - one aggregation whether it's read from a weekly
 * export file or live here. Feedback fields are stubbed null:
 * weeklyReport() never reads them (only labelOf()'s LabelRow shape
 * requires the fields to exist), so querying replyFeedback here would
 * be a real join this panel doesn't need. */
function labelsPanel(days: number): PerformanceLabels {
  const since = windowStart(days);
  const rows = db
    .select({
      id: conversationTurns.id,
      createdAt: conversationTurns.createdAt,
      userText: conversationTurns.userText,
      source: conversationTurns.source,
      signal: conversationTurns.signal,
      rung: conversationTurns.rung,
      guardReason: conversationTurns.guardReason,
      rules: conversationTurns.rules,
      outcomes: conversationTurns.outcomes,
      correctedNextTurn: conversationTurns.correctedNextTurn,
    })
    .from(conversationTurns)
    .where(gte(conversationTurns.createdAt, since))
    .all();
  const people = listActivePeople().map((p) => p.displayName);
  const registry = db
    .select({ name: entities.name, aliases: entities.aliases, kind: entities.kind })
    .from(entities)
    .all()
    .filter((e) => e.kind === "person" || e.kind === "pet")
    .flatMap((e) => [e.name, ...(JSON.parse(e.aliases) as string[])]);
  const householdNames = [...people, ...registry];
  const labelRows: LabelRow[] = rows.map((r) => ({ ...r, feedbackVerdict: null, feedbackReason: null }));
  const labels = labelRows.map((row) => labelOf(row, householdNames)).filter((l): l is Label => l !== null);
  const report = weeklyReport(`${days}d window`, labels);
  return {
    window_days: days,
    turns: report.turns,
    guard_hits: Object.entries(report.guard_hits).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    rule_hits: Object.entries(report.rule_hits).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    rungs: Object.entries(report.rungs).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    retire_eligible: report.zero_hit_rules,
  };
}

/** Roster plus recent engine-sourced Repairs issues - there is no
 * restart-history table (see docs/dev.md's design note), so an issue's
 * own createdAt/resolvedAt is the closest real "history" this can show. */
async function enginesPanel(): Promise<PerformanceEngines> {
  if (!isStackConfigured()) return { configured: false, roles: [], engines: [], budget: null, recent_issues: [] };
  // syncStackHealthIssues() calls the Stack too (repairs.ts's own GET
  // does the same before listing) - a review caught an earlier version
  // of this function calling it outside the try/catch below, so an
  // unreachable-but-configured Stack threw here and 500'd the whole
  // route instead of degrading like every other panel.
  try {
    await syncStackHealthIssues();
  } catch {
    // Falls through to the recent-issues read below with whatever
    // Repairs already had on record - never a 500 for an unreachable
    // Stack, the same posture every other panel here takes.
  }
  const recentIssues = listIssues({ includeResolved: true })
    .filter((issue) => issue.source.startsWith("engine") || issue.source.startsWith("stack"))
    .slice(0, 20)
    .map((issue) => ({ source: issue.source, key: issue.key, severity: issue.severity, createdAt: issue.created_at, resolvedAt: issue.resolved_at ?? null }));
  try {
    const [{ roles }, { engines }, budget] = await Promise.all([getStackClient().roles(), getStackClient().engines(), getStackClient().budget()]);
    return { configured: true, roles, engines, budget, recent_issues: recentIssues };
  } catch {
    return { configured: true, roles: [], engines: [], budget: null, recent_issues: recentIssues };
  }
}

async function hardwarePanel(): Promise<PerformanceHardware> {
  if (!isStackConfigured()) return { configured: false, hardware: null };
  try {
    return { configured: true, hardware: (await getStackClient().hardware()) as Record<string, unknown> };
  } catch {
    return { configured: true, hardware: null };
  }
}

function diskPanel(): PerformanceDisk {
  const summary = storageSummary();
  return { total_bytes: summary.disk.totalBytes, free_bytes: summary.disk.freeBytes, areas: summary.areas };
}

export async function getPerformance(requestedDays: number | undefined): Promise<Performance> {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, requestedDays ?? DEFAULT_WINDOW_DAYS));
  const since = windowStart(days);
  const rows = statsRows(since);
  const [engines, hardware] = await Promise.all([enginesPanel(), hardwarePanel()]);
  return {
    turns: turnsPanel(days, rows),
    queues: queuesPanel(),
    labels: labelsPanel(days),
    layers: layersPanel(days, rows),
    engines,
    hardware,
    disk: diskPanel(),
    // A review finding on the first cut: this read a hardcoded fallback
    // rather than the household's real setting (effectiveRetentionDays()
    // is runRetention()'s own resolution, factored out so both read the
    // identical number).
    retention_days: effectiveRetentionDays(),
  };
}
