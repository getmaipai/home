import { getIcon } from "@maipai/ui/src/icons";
import { StatCard } from "@/next/pages/dashboard/StatCard";

const UsersIcon = getIcon("users");

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/total-orders.tsx`,
 * via the shared `StatCard.tsx` shape (see its own header comment). */
export function PeopleCountCard({ count }: { count: number }) {
  return <StatCard label="People" value={count} icon={UsersIcon} />;
}
