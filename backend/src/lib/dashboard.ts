// SHELL-01 (docs/BACKLOG.md, docs/plans/shell-on-shadcndashboard-2026-09-21.md):
// the one aggregate GET /next's modern-dashboard widgets read, built
// entirely from existing libs (updates.ts's own projection, issues.ts's
// Repairs list, the Stack client, access.ts's own person-visibility
// rule) rather than a second, parallel read path for any of them.
// Backend-only: this file and its route have no frontend caller yet,
// per the coordinator's own item scope - SHELL-01's page itself is a
// separate, later item.
//
// Person-scoped, not admin-only (COORDINATOR, 2026-09-21): every signed-
// in person gets `people_count`, `updates_available` (the same reach
// GET /api/updates already has), `recent_activity` and `turns_per_day`
// (both scoped through visibleTargetIds() below, which reuses
// canAccessPerson()'s own rule - an owner/admin sees a child's turns
// but never a teen's or another adult's - never a second, wider policy
// invented for this dashboard; a review finding moved both off
// conversationHistory.ts's list(), whose one-call-per-target-id shape
// was a real N+1 against an unindexed column, to one direct query
// each, still scoped to the identical target id set). `repairs_open` and
// `engines` are owner/admin only, matching repairs.ts's and engines.ts's
// own existing gates verbatim (Health/Repairs and the Stack are machine
// internals, "no ordinary household member needs" them, per engines.ts's
// own header) - simply absent from a non-admin's response, never a
// zeroed-out or null placeholder that would misread as "nothing wrong."
import { sqlite } from "@/db";
import { isOwnerOrAdmin, listActivePeople } from "@/lib/access";
import { cachedUpdateProjection } from "@/lib/updates";
import { isStackConfigured, getStackClient } from "@/lib/stackEngine";
import { syncStackHealthIssues } from "@/lib/stackHealthSync";
import { listIssues } from "@/lib/issues";
import type { PersonRow } from "@/types";
import type { HealthItem } from "@/lib/stack/types";
// The wire shape lives in @/wire, not here (its own header: alias-free,
// so frontend/src/lib/api.ts can import it too) - re-exported from this
// file so every other backend caller keeps importing from lib/dashboard.ts.
import type { Dashboard, DashboardActivityRow, DashboardTurnsPerDay, DashboardEngineCounts } from "@/wire";
export type { Dashboard, DashboardActivityRow, DashboardTurnsPerDay, DashboardEngineCounts } from "@/wire";

const RECENT_ACTIVITY_LIMIT = 10;
const TURNS_PER_DAY_WINDOW_DAYS = 30;

/** The turns a dashboard viewer may see the EXISTENCE of, reusing
 * conversationHistory.ts's own canAccessPerson() rule exactly (self,
 * plus every child when the viewer is owner/admin) rather than a new
 * household-wide view - an owner/admin still never sees another adult's
 * or a teen's own activity here, the same privacy wall list() already
 * enforces on every other read of this data. */
function visibleTargetIds(actor: PersonRow, activePeople: readonly PersonRow[]): string[] {
  if (!isOwnerOrAdmin(actor)) return [actor.id];
  const childIds = activePeople.filter((p) => p.role === "child" && p.id !== actor.id).map((p) => p.id);
  return [actor.id, ...childIds];
}

// A review finding: calling list(actor, id) once per target id (N
// queries, each its own full unindexed scan of conversation_turns) is a
// real N+1 - one direct query instead, the same "person_id IN (...)"
// shape turnsPerDay() below already uses. Never list()'s own memory_ids
// join (irrelevant here) or its LIST_CAP-then-JS-sort (this query sorts
// and limits in SQL, the one thing an index would speed up anyway).
function recentActivity(targetIds: readonly string[], namesById: ReadonlyMap<string, string>): DashboardActivityRow[] {
  if (targetIds.length === 0) return [];
  const placeholders = targetIds.map(() => "?").join(", ");
  const rows = sqlite
    .query(`SELECT id, person_id, created_at, surface, source FROM conversation_turns WHERE person_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`)
    .all(...targetIds, RECENT_ACTIVITY_LIMIT) as Array<{ id: string; person_id: string; created_at: string; surface: string; source: string }>;
  return rows.map((r) => ({
    turn_id: r.id,
    person_id: r.person_id,
    display_name: namesById.get(r.person_id) ?? r.person_id,
    created_at: r.created_at,
    surface: r.surface,
    source: r.source,
  }));
}

/** A full, gap-free daily series (a chart needs a point for every day
 * in range, zero included) - conversation_turns' own `person_id`/
 * `created_at` columns, grouped by the ISO date prefix, never `list()`
 * (its own LIST_CAP could silently undercount a busy 30-day window). */
function turnsPerDay(targetIds: readonly string[], days: number): DashboardTurnsPerDay[] {
  const today = new Date();
  const series: DashboardTurnsPerDay[] = [];
  const countByDay = new Map<string, number>();
  if (targetIds.length > 0) {
    const since = new Date(today);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    since.setUTCHours(0, 0, 0, 0);
    const placeholders = targetIds.map(() => "?").join(", ");
    const rows = sqlite
      .query(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM conversation_turns WHERE person_id IN (${placeholders}) AND created_at >= ? GROUP BY day`)
      .all(...targetIds, since.toISOString()) as Array<{ day: string; count: number }>;
    for (const row of rows) countByDay.set(row.day, row.count);
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    series.push({ date, count: countByDay.get(date) ?? 0 });
  }
  return series;
}

/** `null` for "owner/admin, but nothing to report" (no Stack configured,
 * or the Stack call itself failed) - the same "additive, degrades to
 * nothing when there's no Stack" posture GET /api/updates already takes
 * for its own `stack` field, never a 500 for a household that simply
 * doesn't have one. */
async function engineStatusCounts(): Promise<DashboardEngineCounts | null> {
  if (!isStackConfigured()) return null;
  let items: HealthItem[];
  try {
    ({ health: items } = await getStackClient().health());
  } catch {
    return null;
  }
  const counts: DashboardEngineCounts = { critical: 0, error: 0, warning: 0, total: items.length };
  for (const item of items) counts[item.severity]++;
  return counts;
}

export async function getDashboard(actor: PersonRow): Promise<Dashboard> {
  const activePeople = listActivePeople();
  const namesById = new Map(activePeople.map((p) => [p.id, p.displayName]));
  const targetIds = visibleTargetIds(actor, activePeople);

  const app = cachedUpdateProjection();
  const dashboard: Dashboard = {
    people_count: activePeople.length,
    // A review finding: a raw string inequality between `latest` (GitHub's
    // `vX.Y.Z` tag) and `installed` (an unprefixed version) reads a
    // household as needing an update forever, even fully up to date -
    // `isNewerVersion()`'s own doc comment already warns against exactly
    // this. `blockedBy` is projectionFromState()'s own already-correct
    // semver check (non-null precisely when `needsUpdate` was true),
    // reused here rather than re-deriving the same boolean a second way.
    updates_available: app.blockedBy !== null,
    recent_activity: recentActivity(targetIds, namesById),
    turns_per_day: turnsPerDay(targetIds, TURNS_PER_DAY_WINDOW_DAYS),
  };

  if (isOwnerOrAdmin(actor)) {
    // The same fold-Stack-health-into-Issues step repairs.ts's own GET
    // runs before listing, so `repairs_open` counts Stack problems too,
    // not just locally-raised ones - a no-op when no Stack is configured
    // (syncStackHealthIssues()'s own early return).
    await syncStackHealthIssues();
    dashboard.repairs_open = listIssues({ includeResolved: false }).length;
    dashboard.engines = await engineStatusCounts();
  }

  return dashboard;
}
