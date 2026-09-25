import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type Performance } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { TurnsChart } from "@/next/pages/performance/TurnsChart";
import { TurnsByEngineTable } from "@/next/pages/performance/TurnsByEngineTable";
import { RoutesCard } from "@/next/pages/performance/RoutesCard";
import { LayersCard } from "@/next/pages/performance/LayersCard";
import { QueuesCard } from "@/next/pages/performance/QueuesCard";
import { LabelsCard } from "@/next/pages/performance/LabelsCard";
import { EnginesHealthCard } from "@/next/pages/performance/EnginesHealthCard";
import { DiskHardwareCard } from "@/next/pages/performance/DiskHardwareCard";

/** /next/performance (ADMIN-PERF-01, docs/dev.md's own design note): how
 * the hub is doing over time, composed entirely from the template's
 * shipped chart wrapper, Home's shared table and the kit's `Card` - the same one-query,
 * `AsyncState`-wrapped shape `NextDashboardPage.tsx` and
 * `NextEnginesPage.tsx` already use, `GET /api/performance` through one
 * `useQuery`. No card registry yet (DASH-CARDS-01 hasn't landed): each
 * panel is still its own component under `performance/`, specifically
 * so registering one as a card later is a wiring change, not a
 * rewrite. Owner/admin only - the route itself carries no client-side
 * role check (matches every sibling `/next` page): a non-admin's 403
 * comes entirely from the backend, and this page is reachable only
 * through the Manage section, which `NextSettingsPage.tsx`'s Household
 * tab already hides from non-admins. */
// Exported: CHAT-HEADER-02's own nextPageHeaderTitle.tsx imports this
// directly for the header's left slot. This page has never shown an
// icon anywhere in its own content before - "gauge" is the pick here,
// the same icon NextChatPage.tsx's own turn-details trigger already
// uses for a measurement concept, not mirrored from any prior
// declaration on this page since none existed.
export const PerformanceIcon = getIcon("gauge");

export function NextPerformancePage() {
  useDocumentTitle("Performance");
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
              <TurnsChart byDay={data.turns.by_day} />
            </div>
            <div className="lg:col-span-5 col-span-12 flex flex-col gap-4">
              <QueuesCard queues={data.queues} />
            </div>
            <div className="lg:col-span-6 col-span-12">
              <TurnsByEngineTable byEngine={data.turns.by_engine} />
            </div>
            <div className="lg:col-span-6 col-span-12">
              <RoutesCard byRoute={data.turns.by_route} />
            </div>
            <div className="lg:col-span-6 col-span-12">
              <LayersCard layers={data.layers} />
            </div>
            <div className="lg:col-span-6 col-span-12">
              <LabelsCard labels={data.labels} />
            </div>
            <div className="lg:col-span-6 col-span-12">
              <EnginesHealthCard engines={data.engines} />
            </div>
            <div className="lg:col-span-6 col-span-12">
              <DiskHardwareCard disk={data.disk} hardware={data.hardware} />
            </div>
          </div>
        </div>
      )}
    </AsyncState>
  );
}
