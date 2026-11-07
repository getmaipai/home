import { i18n } from "@lingui/core";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import type { PerformanceEngineStats } from "@/lib/api";


interface EngineRow extends Record<string, unknown> {
  engine: string;
  turns: number;
  "median first token (ms)": number | string;
  "median total (ms)": number | string;
  "tokens/sec": number | string;
}

function toRow(e: PerformanceEngineStats): EngineRow {
  return {
    engine: e.engine,
    turns: e.count,
    "median first token (ms)": e.median_ttft_ms ?? "-",
    "median total (ms)": e.median_total_ms ?? "-",
    "tokens/sec": e.median_tokens_per_second !== null ? Math.round(e.median_tokens_per_second) : "-",
  };
}

/** ADMIN-PERF-01: `stats.engine` (host, build, model file joined) is
 * the closest thing to "per model" a turn's own record carries - see
 * docs/dev.md's design note for why nothing here parses a model id out
 * of it. Home's shared table derives its columns from these plain rows,
 * the same way it does for every table in `/`. */
export function TurnsByEngineBody({ byEngine }: { byEngine: readonly PerformanceEngineStats[] }) {
  const rows = byEngine.map(toRow);
  const model = useDataTableModel(rows, [
    { id: "engine", header: i18n._({ id: "Engine", message: "Engine" }), sortable: true, minWidth: 100 },
    { id: "turns", header: i18n._({ id: "Turns", message: "Turns" }), sortable: true, minWidth: 55 },
    { id: "median first token (ms)", header: i18n._({ id: "Median first token", message: "Median first token" }), sortable: true, minWidth: 145 },
    { id: "median total (ms)", header: i18n._({ id: "Median total", message: "Median total" }), sortable: true, minWidth: 115 },
    { id: "tokens/sec", header: i18n._({ id: "Tokens/s", message: "Tokens/s" }), sortable: true, minWidth: 90 },
  ]);
  return (
    <>
      <DataTable {...model.tableProps} toolbar={model.rows.length >= 10 ? <DataTableControls model={model} /> : undefined} caption={i18n._({ id: "Turns per engine", message: "Turns per engine" })} getRowId={(row) => row.engine} />
    </>
  );
}
