import { getIcon } from "@maipai/ui/src/icons";
import { CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { DashboardCard } from "@maipai/ui/src/dashboard/components/shared/dashboard-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/dashboard/components/ui/table";
import type { DashboardActivityRow } from "@/lib/api";

const ActivityIcon = getIcon("activity");

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/projects-orders.tsx`:
 * the same Card shell, header row and Table shape. Dropped: `SimpleBar`
 * (not a Home dependency - a plain `overflow-x-auto` div does the same
 * job for a ten-row table), the per-row avatar image (the wire carries
 * no avatar), the sort-icon affordance (nothing here is sortable yet),
 * and the price/deadline/actions columns, which have no Home
 * counterpart at all. */
export function RecentActivityTable({ rows }: { rows: readonly DashboardActivityRow[] }) {
  return (
    <DashboardCard className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon size={16} className="text-foreground" />
          <span>Recent activity</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0!">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="pl-4! px-4 py-3 h-auto text-sm font-normal text-muted-foreground">Person</TableHead>
                <TableHead className="px-4 py-3 h-auto text-sm font-normal text-muted-foreground w-[130px]">Where</TableHead>
                <TableHead className="pr-4! px-4 py-3 h-auto text-sm font-normal text-muted-foreground w-[160px]">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="px-4 py-6 text-sm text-muted-foreground text-center">
                    Nothing yet
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.turn_id} className="border-border hover:bg-muted/30">
                    <TableCell className="pl-4! px-4 py-3">
                      <span className="text-sm font-medium text-foreground whitespace-nowrap">{row.display_name}</span>
                    </TableCell>
                    <TableCell className="px-4 py-3 w-[130px]">
                      <span className="text-sm font-normal text-muted-foreground whitespace-nowrap capitalize">{row.surface}</span>
                    </TableCell>
                    <TableCell className="pr-4! px-4 py-3 w-[160px]">
                      <span className="text-sm font-normal text-muted-foreground whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </DashboardCard>
  );
}
