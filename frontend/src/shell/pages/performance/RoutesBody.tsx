import { i18n } from "@lingui/core";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";


interface RouteRow extends Record<string, unknown> {
  route: string;
  turns: number;
}

/** ADMIN-PERF-01: a turn's own `source` column (wire.ts's TurnValue.
 * source: model | plugin | plugin_error | command | command_error |
 * safety_refuse | confirm | policy) IS the route it took - no field
 * invented, no `nodes[]` parsing needed for this one. */
export function RoutesBody({ byRoute }: { byRoute: readonly { route: string; count: number }[] }) {
  const rows: RouteRow[] = byRoute.map((r) => ({ route: r.route, turns: r.count }));
  const model = useDataTableModel(rows, tableColumns<RouteRow>(["route", "turns"], { route: 240, turns: 80 }, { route: i18n._({ id: "Route", message: "Route" }), turns: i18n._({ id: "Turns", message: "Turns" }) }));
  return (
    <>
      <DataTable {...model.tableProps} toolbar={model.rows.length >= 10 ? <DataTableControls model={model} /> : undefined} caption={i18n._({ id: "Turn routes", message: "Turn routes" })} getRowId={(row) => row.route} />
    </>
  );
}
