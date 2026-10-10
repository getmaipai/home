import { getIcon } from "@maipai/ui/src/icons";
import { Link } from "react-router-dom";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import type { PerformanceEngines } from "@/lib/api";

const ServerIcon = getIcon("server");

interface IssueRow extends Record<string, unknown> {
  issue: string;
  severity: string;
  since: string;
  status: string;
}

/** ADMIN-PERF-01: no restart-history table exists (docs/dev.md's design
 * note), so "engine health history" here is Repairs' own issues that
 * named an engine or Stack source - each row's own createdAt/resolvedAt
 * is the closest real history this can show. `/engines` already
 * covers the live roster and current health in full; this panel links
 * there rather than duplicating it. */
export function EnginesHealthBody({ engines }: { engines: PerformanceEngines }) {
  const rows: IssueRow[] = engines.recent_issues.map((i) => ({
    issue: i.key,
    severity: i.severity,
    since: new Date(i.createdAt).toLocaleString(),
    status: i.resolvedAt ? `Resolved ${new Date(i.resolvedAt).toLocaleDateString()}` : "Open",
  }));
  const model = useDataTableModel(rows, tableColumns<IssueRow>(["issue", "severity", "since", "status"], {
    issue: 180,
    severity: 100,
    since: 170,
    status: 120,
  }));
  return !engines.configured ? (
    <div className="flex items-center gap-3">
      <div className="rounded-md border border-border p-2.5">
        <ServerIcon size={16} />
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">No Stack configured</p>
        <p className="text-sm text-muted-foreground">Set up MaiPai Stack to run your own engines and see their health history here.</p>
      </div>
    </div>
  ) : (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        {engines.roles.length} role(s), {engines.engines.length} engine(s) -{" "}
        <Link to="/engines" className="underline hover:text-foreground">
          see the live roster
        </Link>
      </p>
      <DataTable {...model} toolbar={<DataTableControls model={model} />} caption="Recent engine issues" getRowId={(row) => `${row.issue}-${row.since}`} />
    </>
  );
}
