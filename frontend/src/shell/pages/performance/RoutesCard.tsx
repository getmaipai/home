import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";

const HistoryIcon = getIcon("history");

interface RouteRow extends Record<string, unknown> {
  route: string;
  turns: number;
}

/** ADMIN-PERF-01: a turn's own `source` column (wire.ts's TurnValue.
 * source: model | plugin | plugin_error | command | command_error |
 * safety_refuse | confirm | policy) IS the route it took - no field
 * invented, no `nodes[]` parsing needed for this one. */
export function RoutesCard({ byRoute }: { byRoute: readonly { route: string; count: number }[] }) {
  const rows: RouteRow[] = byRoute.map((r) => ({ route: r.route, turns: r.count }));
  const model = useDataTableModel(rows, tableColumns<RouteRow>(["route", "turns"]));
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon size={16} className="text-muted-foreground" />
          Route taken
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0!">
        <DataTable {...model} caption="Turn routes" getRowId={(row) => row.route} />
      </CardContent>
    </Card>
  );
}
