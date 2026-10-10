import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type Performance } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { TurnsChartBody } from "@/shell/pages/performance/TurnsChartBody";
import { TurnsByEngineBody } from "@/shell/pages/performance/TurnsByEngineBody";
import { RoutesBody } from "@/shell/pages/performance/RoutesBody";
import { LayersBody } from "@/shell/pages/performance/LayersBody";
import { QueuesBody } from "@/shell/pages/performance/QueuesBody";
import { LabelsBody } from "@/shell/pages/performance/LabelsBody";
import { EnginesHealthBody } from "@/shell/pages/performance/EnginesHealthBody";
import { DiskHardwareBody } from "@/shell/pages/performance/DiskHardwareBody";

const icons = {
  gauge: getIcon("gauge"),
  inbox: getIcon("inbox"),
  cpu: getIcon("cpu"),
  history: getIcon("history"),
  workflow: getIcon("workflow"),
  filter: getIcon("filter"),
  server: getIcon("server"),
  database: getIcon("database"),
};

/** /performance (ADMIN-PERF-01, docs/dev.md's own design note): how
 * the hub is doing over time, composed entirely from the template's
 * shipped chart wrapper, Home's shared table and the kit's `Card` - the same one-query,
 * `AsyncState`-wrapped shape `DashboardPage.tsx` and
 * `EnginesPage.tsx` already use, `GET /api/performance` through one
 * `useQuery`. No card registry yet (DASH-CARDS-01 hasn't landed): each
 * panel's body is still its own component under `performance/`, specifically
 * so registering one as a card later is a wiring change, not a
 * rewrite. Owner/admin only - the route itself carries no client-side
 * role check (matches every sibling `/` page): a non-admin's 403
 * comes entirely from the backend, and this page is reachable only
 * through the Manage section, which `SettingsPage.tsx`'s Household
 * tab already hides from non-admins. */
// Exported: CHAT-HEADER-02's own pageHeaderTitle.tsx imports this
// directly for the header's left slot. This page has never shown an
// icon anywhere in its own content before - "gauge" is the pick here,
// the same icon ChatPage.tsx's own turn-details trigger already
// uses for a measurement concept, not mirrored from any prior
// declaration on this page since none existed.
export const PerformanceIcon = getIcon("gauge");

export function PerformancePage() {
  useTabItem("Performance");
  const query = useQuery<Performance>({ queryKey: ["performance"], queryFn: () => api.performance() });

  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load performance."}
      loadingLabel="Loading performance"
    >
      {(data: Performance) => (
        <div className="flex flex-col gap-4 pb-4">
          <div className="grid grid-cols-12 gap-4">
            <div className="lg:col-span-7 col-span-12">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.gauge size={16} className="mr-2 inline text-muted-foreground" />
                    Reply time per day
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TurnsChartBody byDay={data.turns.by_day} />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-5 col-span-12 flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.inbox size={16} className="mr-2 inline text-muted-foreground" />
                    Queues
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <QueuesBody queues={data.queues} />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-6 col-span-12">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.cpu size={16} className="mr-2 inline text-muted-foreground" />
                    Turns per engine
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TurnsByEngineBody byEngine={data.turns.by_engine} />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-6 col-span-12">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.history size={16} className="mr-2 inline text-muted-foreground" />
                    Route taken
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RoutesBody byRoute={data.turns.by_route} />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-6 col-span-12">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.workflow size={16} className="mr-2 inline text-muted-foreground" />
                    Layers
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LayersBody layers={data.layers} />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-6 col-span-12">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.filter size={16} className="mr-2 inline text-muted-foreground" />
                    Label harvest ({data.labels.turns} turn{data.labels.turns === 1 ? "" : "s"})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LabelsBody labels={data.labels} />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-6 col-span-12">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.server size={16} className="mr-2 inline text-muted-foreground" />
                    Engines
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <EnginesHealthBody engines={data.engines} />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-6 col-span-12">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <icons.database size={16} className="mr-2 inline text-muted-foreground" />
                    Storage &amp; hardware
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DiskHardwareBody disk={data.disk} hardware={data.hardware} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </AsyncState>
  );
}
