import { getIcon } from "@maipai/ui/src/icons";
import DataTable from "@maipai/ui/src/dashboard/components/tables/data-table/DataTable";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
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
 * U2's per-node trace (`stats.nodes[]`, only on rows made with
 * `turn.pipeline.next` on). Same `DataTable` shape as every other table
 * here. The empty state below is the honest one - not an error, and
 * not a table with a "no data" row - the same `AsyncState` `isEmpty`
 * pattern would render if this whole page's query failed; here it's
 * this one panel that has nothing yet, because the new pipeline hasn't
 * produced a single traced turn on this hub. */
export function LayersCard({ layers }: { layers: PerformanceLayers }) {
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <WorkflowIcon size={16} className="text-muted-foreground" />
          Layers
        </CardTitle>
      </CardHeader>
      <CardContent className={layers.turns_with_trace === 0 ? "p-6" : "px-0!"}>
        {layers.turns_with_trace === 0 ? (
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-border p-2.5">
              <WorkflowIcon size={16} />
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium">No traced turns yet</p>
              <p className="text-sm text-muted-foreground">The new turn pipeline (turn.pipeline.next) hasn&apos;t run on this hub, so there&apos;s no per-layer trace to show.</p>
            </div>
          </div>
        ) : (
          <>
            <p className="px-4 pt-3 text-sm text-muted-foreground">{layers.turns_with_trace} traced turn(s) in this window</p>
            <DataTable
              data={layers.nodes.map(
                (n): NodeRow => ({
                  node: n.node,
                  turns: n.count,
                  "median (ms)": n.median_ms ?? "-",
                  "p95 (ms)": n.p95_ms ?? "-",
                }),
              )}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
