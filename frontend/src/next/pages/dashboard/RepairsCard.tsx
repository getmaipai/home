import { getIcon } from "@maipai/ui/src/icons";
import { StatCard } from "@/next/pages/dashboard/StatCard";

const WrenchIcon = getIcon("wrench");

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/advertisement-cost.tsx`,
 * via the shared `StatCard.tsx` shape (see its own header comment).
 * Owner/admin only (the wire's own `repairs_open` is absent for anyone
 * else) - `NextDashboardPage.tsx` only renders this card when the
 * field is present, never with a faked zero. */
export function RepairsCard({ open }: { open: number }) {
  return <StatCard label="Repairs" value={open} icon={WrenchIcon} to="/next/repairs" />;
}
