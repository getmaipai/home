import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@/shell/components/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, ApiError, isOwnerOrAdminRole, type EnginesOverview, type EnginesHealth, type StackRoleInfo, type StackEngineInfo, type StackHealthItem, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

/** /engines: SHELL-06's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/engines` and `GET /api/engines/
 * health` (HOME-STACK-04a, owner/admin only), the first frontend this
 * API has ever had: `docs/BACKLOG.md`'s own "Old file it retires: none
 * (new)" for this row, and a grep of the whole frontend for `/api/
 * engines` before writing this file came back empty. Three real
 * tables through Home's shared read-only table: roles by address (`endpoints`), engine
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
// Exported: CHAT-HEADER-02's own pageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own.
export const EnginesIcon = getIcon("cpu");
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
  name: string;
}

function toEngineRow(engine: StackEngineInfo): EngineRow {
  const row = {
    engine: engine.label,
    version: engine.currentTag ?? "-",
    // `needsRestart` is its own real field, not derived from
    // `stateReason` (a review caught a first draft string-matching
    // stateReason === "newer installed" instead - the two can disagree
    // during a transition, and a future third reason string would have
    // silently fallen through to "Update available").
    status: engine.needsRestart ? "Needs restart" : engine.state === "current" ? "Current" : "Update available",
  };
  Object.defineProperty(row, "name", { value: engine.name });
  return row as EngineRow;
}

interface HealthRow extends Record<string, unknown> {
  item: string;
  status: string;
  since: string;
}

function toHealthRow(item: StackHealthItem): HealthRow {
  return { item: item.title, status: item.severity.charAt(0).toUpperCase() + item.severity.slice(1), since: new Date(item.since).toLocaleString() };
}

export function EnginesPage({ person }: { person: Roster }) {
  useTabItem("Engines");
  const canManage = isOwnerOrAdminRole(person.role);
  const overviewQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines(), enabled: canManage });
  const healthQuery = useQuery<EnginesHealth>({ queryKey: ["engines-health"], queryFn: () => api.enginesHealth(), enabled: canManage });
  const queryClient = useQueryClient();
  const [busyNames, setBusyNames] = useState<ReadonlySet<string>>(new Set());

  async function runAction(name: string, action: "start" | "stop" | "restart" | "install") {
    setBusyNames((previous) => new Set(previous).add(name));
    try {
      await api.engineAction(name, action);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["engines"] }),
        queryClient.invalidateQueries({ queryKey: ["engines-health"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "That didn't work.");
    } finally {
      setBusyNames((previous) => {
        const next = new Set(previous);
        next.delete(name);
        return next;
      });
    }
  }

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

      {!canManage ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage engines.</p>
          </CardContent>
        </Card>
      ) : <AsyncState
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
                <DataTable
                  data={overview.engines.map(toEngineRow)}
                  rowKey={(row) => row.name}
                  rowActions={(row) => {
                    const engine = overview.engines.find((candidate) => candidate.name === row.name);
                    if (!engine) return [];
                    const busy = busyNames.has(engine.name);
                    const actions = engine.installed
                      ? [
                          ...(engine.running === null ? [{ label: "Start", onClick: () => runAction(engine.name, "start"), disabled: busy }] : [{ label: "Stop", onClick: () => runAction(engine.name, "stop"), disabled: busy }]),
                          { label: "Restart", onClick: () => runAction(engine.name, "restart"), disabled: busy },
                        ]
                      : [{ label: "Install", onClick: () => runAction(engine.name, "install"), disabled: busy }];
                    return actions;
                  }}
                />
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
      </AsyncState>}
    </div>
  );
}
