import type { DashboardActivityRow } from "@/lib/api";

export function recentActivityEvents(rows: readonly DashboardActivityRow[]) {
  if (!rows.length) return [{ id: "empty", when: "past" as const, time: "", title: "Nothing yet" }];
  return rows.map((row) => ({
    id: row.turn_id,
    when: "past" as const,
    time: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(row.created_at)),
    title: row.display_name,
    detail: row.surface,
  }));
}
