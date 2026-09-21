import { getIcon } from "@maipai/ui/src/icons";
import { StatCard } from "@/next/pages/dashboard/StatCard";
import type { DashboardEngineCounts } from "@/lib/api";

const CpuIcon = getIcon("cpu");

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/total-orders.tsx`
 * again (only three distinct KPI-card shapes exist in the vendored set,
 * cycled across the four stat cards this page composes), via the
 * shared `StatCard.tsx` shape (see its own header comment). Owner/
 * admin only, same as RepairsCard.tsx. `engines === null` (owner/
 * admin, but no Stack configured - the common case today) is the
 * widget's own empty state, per the coordinator's rule: data the wire
 * doesn't carry yet is left as an empty state, never faked. */
export function EnginesCard({ engines }: { engines: DashboardEngineCounts | null }) {
  // A review finding: this re-derived the issue count as
  // critical+error+warning instead of reading the wire's own
  // precomputed `total` (backend/src/lib/dashboard.ts's own
  // engineStatusCounts()) - harmless today (the three severities are
  // the whole HealthItem union), but a future fourth severity added to
  // that union without updating this card would silently disagree with
  // `total`, the one field meant to be authoritative.
  const issues = engines?.total ?? 0;
  const value = engines === null ? "No Stack" : issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"}` : "Healthy";
  return <StatCard label="Engines" value={value} icon={CpuIcon} />;
}
