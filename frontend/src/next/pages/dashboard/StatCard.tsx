import type { Icon } from "@maipai/ui/src/icons";
import { CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { DashboardCard } from "@maipai/ui/src/dashboard/components/shared/dashboard-card";

/** The shared shape `PeopleCountCard.tsx`/`UpdatesCard.tsx`/
 * `RepairsCard.tsx`/`EnginesCard.tsx` all mirror - the vendored KPI-card
 * shape shared by `@maipai/ui/src/dashboard/components/dashboards/modern/
 * total-orders.tsx`, `total-profit.tsx` and `advertisement-cost.tsx`
 * (all three are the identical Card shell, header row and icon box,
 * differing only in label/value/icon). Factored out once here (a review
 * finding: four hand-copied files repeating the same JSX verbatim was
 * exactly the "smallest composition of shipped parts" rule's own
 * target, not a fourth parallel copy) rather than one file per
 * card mirroring the vendored file directly - each of the four callers
 * still has its own file, its own header comment naming what this
 * shares and why, and its own props; only the shared markup moved here.
 * Their own badge (a percent-change delta) and "See Statistics" button
 * are dropped everywhere - the wire carries plain counts, no delta and
 * no statistics page to link to. */
export function StatCard({ label, value, icon: IconComponent }: { label: string; value: React.ReactNode; icon: Icon }) {
  return (
    <DashboardCard className="py-6">
      <CardContent className="flex justify-between flex-row px-6">
        <div className="flex items-center justify-between w-full">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-normal text-foreground">{label}</p>
            <h3 className="text-2xl font-semibold">{value}</h3>
          </div>
          <div className="border border-border p-2.5 w-fit rounded-md">
            <IconComponent size={16} />
          </div>
        </div>
      </CardContent>
    </DashboardCard>
  );
}
