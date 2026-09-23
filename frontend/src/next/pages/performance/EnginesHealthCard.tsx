import { getIcon } from "@maipai/ui/src/icons";
import { Link } from "react-router-dom";
import DataTable from "@maipai/ui/src/dashboard/components/tables/data-table/DataTable";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
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
 * is the closest real history this can show. `/next/engines` already
 * covers the live roster and current health in full; this panel links
 * there rather than duplicating it. */
export function EnginesHealthCard({ engines }: { engines: PerformanceEngines }) {
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <ServerIcon size={16} className="text-muted-foreground" />
          Engines
        </CardTitle>
      </CardHeader>
      <CardContent className={engines.configured ? "px-0!" : "p-6"}>
        {!engines.configured ? (
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
            <p className="px-4 pt-3 pb-2 text-sm text-muted-foreground">
              {engines.roles.length} role(s), {engines.engines.length} engine(s) -{" "}
              <Link to="/next/engines" className="underline hover:text-foreground">
                see the live roster
              </Link>
            </p>
            <DataTable
              data={engines.recent_issues.map(
                (i): IssueRow => ({
                  issue: i.key,
                  severity: i.severity,
                  since: new Date(i.createdAt).toLocaleString(),
                  status: i.resolvedAt ? `Resolved ${new Date(i.resolvedAt).toLocaleDateString()}` : "Open",
                }),
              )}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
