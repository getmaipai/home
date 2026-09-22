import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import DataTable from "@maipai/ui/src/dashboard/components/tables/data-table/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, ApiError, type EnginesOverview, type EnginesHealth, type StackRoleInfo, type StackEngineInfo, type StackHealthItem } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/engines: SHELL-06's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/engines` and `GET /api/engines/
 * health` (HOME-STACK-04a, owner/admin only), the first frontend this
 * API has ever had: `docs/BACKLOG.md`'s own "Old file it retires: none
 * (new)" for this row, and a grep of the whole frontend for `/api/
 * engines` before writing this file came back empty. Three real
 * tables through the same `DataTable` pattern `/next/apps` and `/next/
 * people` already established: roles by address (`endpoints`), engine
 * state, and Stack health severities - the exact three things this
 * row asks for, nothing invented.
 *
 * The honest empty state, not an error: `routes/engines.ts`'s own
 * `overview`/`health` handlers now check `isStackConfigured()` before
 * ever calling the Stack, returning `configured: false` with empty/
 * null fields (200, never a 503) when no Stack is set up - the same
 * "null is the real answer, not a fabricated one" posture `dashboard.
 * ts`'s own `engineStatusCounts()` already takes, extended here since
 * neither route drew that distinction before this row needed it
 * (found landing this row, 2026-09-21: a household with no Stack
 * configured - Jesse's own - hit the Stack-unreachable branch and read
 * as a real error, not the calm, ordinary state it actually is). */
const EnginesIcon = getIcon("cpu");
const RolesIcon = getIcon("server");
const HealthIcon = getIcon("activity");

const ROLE_STATE_LABEL: Record<StackRoleInfo["state"]["state"], string> = {
  notInstalled: "Not installed",
  installed: "Installed",
  loaded: "Loaded",
  ready: "Ready",
  offline: "Offline",
};

interface RoleRow extends Record<string, unknown> {
  role: string;
  status: string;
  model: string;
  address: string;
}

function toRoleRow(role: StackRoleInfo): RoleRow {
  return {
    role: role.label,
    status: ROLE_STATE_LABEL[role.state.state],
    model: role.model?.id ?? "-",
    address: role.endpoints.join(", ") || "-",
  };
}

interface EngineRow extends Record<string, unknown> {
  engine: string;
  version: string;
  status: string;
}

function toEngineRow(engine: StackEngineInfo): EngineRow {
  return {
    engine: engine.label,
    version: engine.currentTag ?? "-",
    // `needsRestart` is its own real field, not derived from
    // `stateReason` (a review caught a first draft string-matching
    // stateReason === "newer installed" instead - the two can disagree
    // during a transition, and a future third reason string would have
    // silently fallen through to "Update available").
    status: engine.needsRestart ? "Needs restart" : engine.state === "current" ? "Current" : "Update available",
  };
}

interface HealthRow extends Record<string, unknown> {
  item: string;
  status: string;
  since: string;
}

function toHealthRow(item: StackHealthItem): HealthRow {
  return { item: item.title, status: item.severity.charAt(0).toUpperCase() + item.severity.slice(1), since: new Date(item.since).toLocaleString() };
}

export function NextEnginesPage() {
  useDocumentTitle("Engines");
  const overviewQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines() });
  const healthQuery = useQuery<EnginesHealth>({ queryKey: ["engines-health"], queryFn: () => api.enginesHealth() });

  const error = overviewQuery.isError || healthQuery.isError;
  const data = overviewQuery.data && healthQuery.data ? { overview: overviewQuery.data, health: healthQuery.data } : undefined;
  const firstError = overviewQuery.error ?? healthQuery.error;

  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <EnginesIcon size={16} className="text-muted-foreground" />
          Engines
        </CardTitle>
      </CardHeader>

      <AsyncState
        data={data}
        error={error}
        isFetching={overviewQuery.isFetching || healthQuery.isFetching}
        onRetry={() => {
          if (overviewQuery.isError) overviewQuery.refetch();
          if (healthQuery.isError) healthQuery.refetch();
        }}
        errorMessage={firstError instanceof ApiError ? firstError.message : "Could not load engines."}
        loadingLabel="Loading engines"
      >
        {({ overview, health }: { overview: EnginesOverview; health: EnginesHealth }) =>
          !overview.configured ? (
            <Card>
              <CardContent className="flex items-center gap-3 p-6">
                <div className="rounded-md border border-border p-2.5">
                  <EnginesIcon size={16} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">No Stack configured</p>
                  <p className="text-sm text-muted-foreground">Set up MaiPai Stack in Settings to run your own engines and see their roles, versions and health here.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                <CardHeader className="p-0">
                  <CardTitle className="flex items-center gap-2">
                    <RolesIcon size={16} className="text-muted-foreground" />
                    Roles
                  </CardTitle>
                </CardHeader>
                <DataTable data={overview.roles.map(toRoleRow)} />
              </div>

              <div className="flex flex-col gap-4">
                <CardHeader className="p-0">
                  <CardTitle className="flex items-center gap-2">
                    <EnginesIcon size={16} className="text-muted-foreground" />
                    Installed engines
                  </CardTitle>
                </CardHeader>
                <DataTable data={overview.engines.map(toEngineRow)} />
              </div>

              <div className="flex flex-col gap-4">
                <CardHeader className="p-0">
                  <CardTitle className="flex items-center gap-2">
                    <HealthIcon size={16} className="text-muted-foreground" />
                    Health
                  </CardTitle>
                </CardHeader>
                <DataTable data={health.health.map(toHealthRow)} />
              </div>
            </>
          )
        }
      </AsyncState>
    </div>
  );
}
