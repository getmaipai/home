import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, ApiError, isOwnerOrAdminRole, type EnginesOverview, type EnginesHealth, type StackRoleInfo, type StackEngineInfo, type StackHealthItem, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { useDataTableControls } from "@/shell/pages/dataTableControls";

/** /engines: SHELL-06's own row - `GET /api/engines` and
 * `GET /api/engines/health`, through the kit DataTable and its slots. */
export const EnginesIcon = getIcon("cpu");
const RolesIcon = getIcon("server");
const HealthIcon = getIcon("activity");
const MoreHorizontal = getIcon("more-horizontal");

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

const ROLE_COLUMNS: readonly DataTableColumn<RoleRow>[] = [
  { id: "role", header: "Role" },
  { id: "status", header: "Status", minWidth: 128 },
  { id: "model", header: "Model", minWidth: 200 },
  { id: "address", header: "Address", minWidth: 240 },
];

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

const ENGINE_COLUMNS: readonly DataTableColumn<EngineRow>[] = [
  { id: "engine", header: "Engine" },
  { id: "version", header: "Version", minWidth: 120 },
  { id: "status", header: "Status", minWidth: 160 },
];

function toEngineRow(engine: StackEngineInfo): EngineRow {
  const row = {
    engine: engine.label,
    version: engine.currentTag ?? "-",
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

const HEALTH_COLUMNS: readonly DataTableColumn<HealthRow>[] = [
  { id: "item", header: "Issue" },
  { id: "status", header: "Severity", minWidth: 128 },
  { id: "since", header: "Since", minWidth: 176 },
];

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
  const roles = useMemo(() => overviewQuery.data?.roles.map(toRoleRow) ?? [], [overviewQuery.data]);
  const engines = useMemo(() => overviewQuery.data?.engines.map(toEngineRow) ?? [], [overviewQuery.data]);
  const health = useMemo(() => healthQuery.data?.health.map(toHealthRow) ?? [], [healthQuery.data]);
  const rolesTable = useDataTableControls(roles, ROLE_COLUMNS);
  const enginesTable = useDataTableControls(engines, ENGINE_COLUMNS);
  const healthTable = useDataTableControls(health, HEALTH_COLUMNS);

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
    <>
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
        {({ overview }: { overview: EnginesOverview; health: EnginesHealth }) =>
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
              <section className="mb-4 flex flex-col gap-4" aria-labelledby="engine-roles-heading">
                <CardHeader className="p-0">
                  <CardTitle id="engine-roles-heading" className="flex items-center gap-2">
                    <RolesIcon size={16} className="text-muted-foreground" />
                    Roles
                  </CardTitle>
                </CardHeader>
                <DataTable
                  rows={rolesTable.rows}
                  columns={rolesTable.columns}
                  caption="Engine roles"
                  sort={rolesTable.sort}
                  onSortChange={rolesTable.onSortChange}
                  toolbar={rolesTable.toolbar}
                  emptyLabel={rolesTable.emptyLabel}
                />
              </section>

              <section className="mb-4 flex flex-col gap-4" aria-labelledby="installed-engines-heading">
                <CardHeader className="p-0">
                  <CardTitle id="installed-engines-heading" className="flex items-center gap-2">
                    <EnginesIcon size={16} className="text-muted-foreground" />
                    Installed engines
                  </CardTitle>
                </CardHeader>
                <DataTable
                  rows={enginesTable.rows}
                  columns={enginesTable.columns}
                  getRowId={(row) => row.name}
                  caption="Installed engines"
                  sort={enginesTable.sort}
                  onSortChange={enginesTable.onSortChange}
                  toolbar={enginesTable.toolbar}
                  emptyLabel={enginesTable.emptyLabel}
                  rowActionsLabel="Engine actions"
                  rowActions={(row) => {
                    const engine = overview.engines.find((candidate) => candidate.name === row.name);
                    if (!engine) return null;
                    const busy = busyNames.has(engine.name);
                    const actions = engine.installed
                      ? [
                          ...(engine.running === null ? [{ label: "Start", action: "start" as const }] : [{ label: "Stop", action: "stop" as const }]),
                          { label: "Restart", action: "restart" as const },
                        ]
                      : [{ label: "Install", action: "install" as const }];
                    return (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={
                          <Button type="button" variant="ghost" size="icon-lg" aria-label="More actions">
                            <MoreHorizontal aria-hidden="true" size={16} />
                          </Button>
                        } />
                        <DropdownMenuContent align="end">
                          {actions.map(({ label, action }) => (
                            <DropdownMenuItem key={label} disabled={busy} onClick={() => void runAction(engine.name, action)}>
                              {label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  }}
                />
              </section>

              <section className="flex flex-col gap-4" aria-labelledby="engine-health-heading">
                <CardHeader className="p-0">
                  <CardTitle id="engine-health-heading" className="flex items-center gap-2">
                    <HealthIcon size={16} className="text-muted-foreground" />
                    Health
                  </CardTitle>
                </CardHeader>
                <DataTable
                  rows={healthTable.rows}
                  columns={healthTable.columns}
                  caption="Engine health"
                  sort={healthTable.sort}
                  onSortChange={healthTable.onSortChange}
                  toolbar={healthTable.toolbar}
                  emptyLabel={healthTable.emptyLabel}
                />
              </section>
            </>
          )
        }
      </AsyncState>}
    </>
  );
}
