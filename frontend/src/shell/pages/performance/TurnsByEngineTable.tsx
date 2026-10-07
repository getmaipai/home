import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import type { PerformanceEngineStats } from "@/lib/api";

const CpuIcon = getIcon("cpu");

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
export function TurnsByEngineTable({ byEngine }: { byEngine: readonly PerformanceEngineStats[] }) {
  const rows = byEngine.map(toRow);
  const model = useDataTableModel(rows, [
    { id: "engine", header: "Engine", sortable: true, minWidth: 100 },
    { id: "turns", header: "Turns", sortable: true, minWidth: 55 },
    { id: "median first token (ms)", header: "Median first token", sortable: true, minWidth: 145 },
    { id: "median total (ms)", header: "Median total", sortable: true, minWidth: 115 },
    { id: "tokens/sec", header: "Tokens/s", sortable: true, minWidth: 90 },
  ]);
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <CpuIcon size={16} className="text-muted-foreground" />
          Turns per engine
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0!">
        <DataTable {...model} toolbar={<DataTableControls model={model} />} caption="Turns per engine" getRowId={(row) => row.engine} />
      </CardContent>
    </Card>
  );
}
