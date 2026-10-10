import { getIcon } from "@maipai/ui/src/icons";
import { StatBody, StatText } from "@/shell/pages/dashboard/StatCard";

const DownloadIcon = getIcon("download");
const CheckIcon = getIcon("check");

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/total-profit.tsx`,
 * via the shared `StatCard.tsx` shape (see its own header comment). */
export function UpdatesStat({ available }: { available: boolean }) {
  return <StatBody icon={available ? DownloadIcon : CheckIcon}><StatText label="Updates" value={available ? "Available" : "Up to date"} /></StatBody>;
}
