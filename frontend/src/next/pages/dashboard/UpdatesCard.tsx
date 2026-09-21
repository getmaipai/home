import { getIcon } from "@maipai/ui/src/icons";
import { StatCard } from "@/next/pages/dashboard/StatCard";

const DownloadIcon = getIcon("download");
const CheckIcon = getIcon("check");

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/total-profit.tsx`,
 * via the shared `StatCard.tsx` shape (see its own header comment). */
export function UpdatesCard({ available }: { available: boolean }) {
  return <StatCard label="Updates" value={available ? "Available" : "Up to date"} icon={available ? DownloadIcon : CheckIcon} />;
}
