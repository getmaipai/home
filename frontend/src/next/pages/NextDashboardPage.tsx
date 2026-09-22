import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { ApiError, type Roster, type Dashboard } from "@/lib/api";
import { useDashboard } from "@/next/useDashboard";
import { Greeting } from "@/next/pages/dashboard/Greeting";
import { PeopleCountCard } from "@/next/pages/dashboard/PeopleCountCard";
import { UpdatesCard } from "@/next/pages/dashboard/UpdatesCard";
import { RepairsCard } from "@/next/pages/dashboard/RepairsCard";
import { EnginesCard } from "@/next/pages/dashboard/EnginesCard";
import { TurnsPerDayChart } from "@/next/pages/dashboard/TurnsPerDayChart";
import { RecentActivityTable } from "@/next/pages/dashboard/RecentActivityTable";

/** /next: SHELL-01's page half (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md, the SHELL-01 row's own gap paragraph) - Home's own
 * composition of the template's shipped primitives (Card, chart, Table,
 * as `@maipai/ui/src/dashboard/components/ui/*` ships them), reading
 * GET /api/dashboard through one fetch hook (`useDashboard.ts`). The
 * vendored modern-dashboard widgets themselves
 * (`@maipai/ui/src/dashboard/components/dashboards/modern/*`) are
 * demo compositions with hardcoded numbers and no data-binding surface
 * at all - not components in the "as shipped" sense the no-hand-built-UI
 * rule means, since editing one to accept a prop would be forking a
 * vendored file. Named as the gap before writing this file (the plan
 * doc's own SHELL-01 row): Home composes its own page from the same
 * shipped primitives those widgets are built from, mirroring each
 * vendored widget's JSX 1:1 (see each file under `dashboard/` for its
 * own "mirrors" comment), never importing the demo widgets themselves.
 *
 * Only widgets with a real Home counterpart exist (the coordinator's
 * own list): the greeting, people count, updates available, repairs
 * open and engine health (owner/admin only - simply not rendered
 * otherwise, since the wire itself omits those fields for anyone
 * else), turns per day as the chart, recent activity as the table. No
 * revenue, sales, orders or profit cards - the demo widgets they came
 * from have no Home data to bind and are dropped from the composition
 * entirely, not redrawn.
 *
 * A review finding: the first cut checked only `isLoading`, so a
 * failed fetch (an expired session, a 500) left the loading skeleton
 * showing forever, with no error text and no retry - `AsyncState`
 * (`@maipai/ui/src/primitives/AsyncState`, the kit's own shared
 * loading/error/data triad, already used by every sibling `/next`-
 * adjacent page) is the shipped fix, not a hand-rolled error branch.
 *
 * DASH-LOOK-01 (Jesse: shaded like Settings and dashboard-01, not
 * flat): the stat cards and the chart/table panels were rendering
 * through the vendored shared `DashboardCard` wrapper
 * (`components/shared/dashboard-card.tsx`, part of the SHELL-01 gap
 * paragraph's own vendored snapshot), which explicitly overrides
 * `Card`'s own `bg-card`/`ring-1` with `bg-background`/`ring-0` - the
 * flat look the template's own demo KPI row wants, not this page's
 * ask. Each card here now uses the plain `Card` primitive directly
 * (see each file's own comment) - the real surface was already
 * there, one layer down. The `StyleDivider` row between the stats and
 * the chart/table is gone too: it rendered as a dotted decorative
 * strip (`components/shared/divider`, also vendored), not a plain
 * rule - with every card now carrying its own visible ring, a divider
 * between them added a second, competing separator rather than
 * fixing one; the grid's own gap is enough.
 *
 * The grid container itself: `StyleAwareWrapper`'s own
 * `lyraClassName="grid grid-cols-12 p-px gap-px bg-border"` (the
 * SHELL-01 gap paragraph's choice) is the hairline-grid pattern
 * (ui-v0.5.15's own `bg-border`-through-a-1px-gap seam) built for a
 * flat, ringless tile row - once every card carries its own visible
 * ring, a 1px gap reads as the cards touching, not seamed.
 * `StyleAwareWrapper`'s own `defaultClassName` prop has never actually
 * applied (it always renders `lyraClassName` regardless of look - a
 * dead prop, not something to route around), so keeping the wrapper
 * only added an unused indirection on top of the wrong spacing; a
 * plain grid `div` with dashboard-01's own real gutter (`gap-4`)
 * replaces it - the same gutter the stat row and the chart/table row
 * both now sit in, since they share this one grid container. */
export function NextDashboardPage({ person }: { person: Roster }) {
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
        const showEngines = data.engines !== undefined;

        return (
          <div className="pb-4">
            <div className="pb-4">
              <Greeting displayName={person.display_name} />
            </div>
            <div className="grid grid-cols-12 gap-4">
              <div className="lg:col-span-3 col-span-6">
                <PeopleCountCard count={data.people_count} />
              </div>
              <div className="lg:col-span-3 col-span-6">
                <UpdatesCard available={data.updates_available} />
              </div>
              {showRepairs && (
                <div className="lg:col-span-3 col-span-6">
                  <RepairsCard open={data.repairs_open!} />
                </div>
              )}
              {showEngines && (
                <div className="lg:col-span-3 col-span-6">
                  <EnginesCard engines={data.engines!} />
                </div>
              )}
              <div className="lg:col-span-7 col-span-12">
                <TurnsPerDayChart series={data.turns_per_day} />
              </div>
              <div className="lg:col-span-5 col-span-12">
                <RecentActivityTable rows={data.recent_activity} />
              </div>
            </div>
          </div>
        );
      }}
    </AsyncState>
  );
}
