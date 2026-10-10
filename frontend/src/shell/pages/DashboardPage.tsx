import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Timeline } from "@maipai/ui/src/elements/timeline";
import { ApiError, type Roster, type Dashboard } from "@/lib/api";
import { useDashboard } from "@/shell/useDashboard";
import { Greeting } from "@/shell/pages/dashboard/Greeting";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { NumberTicker } from "@maipai/ui/src/elements/number-ticker";
import { StatBody, StatLink } from "@/shell/pages/dashboard/StatCard";
import { UpdatesStat } from "@/shell/pages/dashboard/UpdatesCard";
import { recentActivityEvents } from "@/shell/pages/dashboard/recentActivityEvents";
import { useTabItem } from "@/shell/tabIdentity";

const UsersIcon = getIcon("users");
const WrenchIcon = getIcon("wrench");

/** The dashboard reads one route. Recent activity is presented by the
 * shipped Timeline from the route's existing rows; no extra person data
 * is fetched or joined in the browser. */
export function DashboardPage({ person }: { person: Roster }) {
  useTabItem("Home");
  const query = useDashboard();

  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the dashboard."}
      loadingLabel="Loading dashboard"
    >
      {(data: Dashboard) => {
        // Owner/admin only - the wire itself omits these fields for
        // anyone else (backend/src/lib/dashboard.ts's own header), so
        // their presence IS the visibility check; no second,
        // client-side role check invented.
        const showRepairs = data.repairs_open !== undefined;
        const activityEvents = recentActivityEvents(data.recent_activity);

        return (
          <div className="pb-4">
            <h1 className="sr-only">Home</h1>
            <div className="pb-4">
              <Greeting displayName={person.display_name} />
            </div>
            <div className="grid grid-cols-12 gap-4">
              <div className="lg:col-span-3 col-span-6">
                <Card><CardContent><StatBody icon={UsersIcon}><NumberTicker value={data.people_count} label="People" /></StatBody></CardContent></Card>
              </div>
              <div className="lg:col-span-3 col-span-6">
                <StatLink to="/updates"><Card><CardContent><UpdatesStat available={data.updates_available} /></CardContent></Card></StatLink>
              </div>
              {showRepairs && (
                <div className="lg:col-span-3 col-span-6">
                  <StatLink to="/repairs"><Card><CardContent><StatBody icon={WrenchIcon}><NumberTicker value={data.repairs_open!} label="Repairs" /></StatBody></CardContent></Card></StatLink>
                </div>
              )}
              <div className="lg:col-span-5 col-span-12">
                <h2 className="text-base leading-snug font-medium">Recent activity</h2>
                <Timeline events={activityEvents} visibleCount={activityEvents.length} />
              </div>
            </div>
          </div>
        );
      }}
    </AsyncState>
  );
}
