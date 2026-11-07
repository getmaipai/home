import { i18n } from "@lingui/core";
import { getIcon } from "@maipai/ui/src/icons";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import type { PerformanceLayers } from "@/lib/api";

const WorkflowIcon = getIcon("workflow");

interface NodeRow extends Record<string, unknown> {
  node: string;
  turns: number;
  "median (ms)": number | string;
  "p95 (ms)": number | string;
}

/** The coordinator's 2026-09-22 addition to ADMIN-PERF-01, a preview of
 * ADMIN-LAYERS-01's own fuller Layers panel: median and p95 per node of
 * U2's per-node trace (`stats.nodes[]`, on every row the
 * turn machine made). Same shared-table shape as every other table
 * here. The empty state below is the honest one - not an error, and
 * not a table with a "no data" row - the same `AsyncState` `isEmpty`
 * pattern would render if this whole page's query failed; here it's
 * this one panel that has nothing yet, because the new pipeline hasn't
 * produced a single traced turn on this hub. */
export function LayersBody({ layers }: { layers: PerformanceLayers }) {
  const rows: NodeRow[] = layers.nodes.map((n) => ({
    node: n.node,
    turns: n.count,
    "median (ms)": n.median_ms ?? "-",
    "p95 (ms)": n.p95_ms ?? "-",
  }));
  const model = useDataTableModel(rows, tableColumns<NodeRow>(["node", "turns", "median (ms)", "p95 (ms)"], {
    node: 140,
    turns: 80,
    "median (ms)": 120,
    "p95 (ms)": 100,
  }, { node: i18n._({ id: "Node", message: "Node" }), turns: i18n._({ id: "Turns", message: "Turns" }), "median (ms)": i18n._({ id: "Median (ms)", message: "Median (ms)" }), "p95 (ms)": i18n._({ id: "p95 (ms)", message: "p95 (ms)" }) }));
  return layers.turns_with_trace === 0 ? (
    <div className="flex items-center gap-3">
      <div className="rounded-md border border-border p-2.5">
        <WorkflowIcon size={16} />
      </div>
      <div className="flex flex-col gap-0.5">
        <EmptyState icon="workflow" text={i18n._({ id: "No traced turns yet. No turn on this hub has left a per-layer trace yet.", message: "No traced turns yet. No turn on this hub has left a per-layer trace yet." })} />
      </div>
    </div>
  ) : (
    <>
      <p className="mb-4 text-sm text-muted-foreground">{i18n._({ id: "{traced, plural, one {# traced turn} other {# traced turns}} in this window", message: "{traced, plural, one {# traced turn} other {# traced turns}} in this window", values: { traced: layers.turns_with_trace } })}</p>
      <DataTable {...model.tableProps} toolbar={model.rows.length >= 10 ? <DataTableControls model={model} /> : undefined} caption={i18n._({ id: "Layer timing", message: "Layer timing" })} getRowId={(row) => row.node} />
    </>
  );
}
