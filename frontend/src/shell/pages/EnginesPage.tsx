import { i18n } from "@lingui/core";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { Button } from "@maipai/ui/src/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, isOwnerOrAdminRole, type EnginesOverview, type EnginesHealth, type StackRoleInfo, type StackEngineInfo, type StackHealthItem, type Roster } from "@/lib/api";
import { useDataTableControls } from "@/shell/pages/useDataTableControls";
import { useMutation } from "@tanstack/react-query";
import { severityLabel } from "@/shell/pages/severityLabel";
import { errorLine } from "@/lib/hubReachability";

/** /engines: SHELL-06's own row - `GET /api/engines` and
 * `GET /api/engines/health`, through the kit DataTable and its slots. */
export const EnginesIcon = getIcon("cpu");
const RolesIcon = getIcon("server");
const HealthIcon = getIcon("activity");
const MoreHorizontal = getIcon("more-horizontal");

const roleStateLabel = (state: StackRoleInfo["state"]["state"]): string => ({
  notInstalled: i18n._({ id: "Not installed", message: "Not installed" }),
  installed: i18n._({ id: "Installed", message: "Installed" }),
  loaded: i18n._({ id: "Loaded", message: "Loaded" }),
  ready: i18n._({ id: "Ready", message: "Ready" }),
  offline: i18n._({ id: "Offline", message: "Offline" }),
})[state];

interface RoleRow extends Record<string, unknown> {
  role: string;
  status: string;
  model: string;
  address: string;
}

const ROLE_COLUMNS = (): readonly DataTableColumn<RoleRow>[] => [
  { id: "role", header: i18n._({ id: "Role", message: "Role" }) },
  { id: "status", header: i18n._({ id: "Status", message: "Status" }), minWidth: 128 },
  { id: "model", header: i18n._({ id: "Model", message: "Model" }), minWidth: 200 },
  { id: "address", header: i18n._({ id: "Address", message: "Address" }), minWidth: 240 },
];

function toRoleRow(role: StackRoleInfo): RoleRow {
  return {
    role: role.label,
    status: roleStateLabel(role.state.state),
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

const ENGINE_COLUMNS = (): readonly DataTableColumn<EngineRow>[] => [
  { id: "engine", header: i18n._({ id: "Engine", message: "Engine" }) },
  { id: "version", header: i18n._({ id: "Version", message: "Version" }), minWidth: 120 },
  { id: "status", header: i18n._({ id: "Status", message: "Status" }), minWidth: 160 },
];

function toEngineRow(engine: StackEngineInfo): EngineRow {
  const row = {
    engine: engine.label,
    version: engine.currentTag ?? "-",
    status: engine.needsRestart ? i18n._({ id: "Needs restart", message: "Needs restart" }) : engine.state === "current" ? i18n._({ id: "Current", message: "Current" }) : i18n._({ id: "Update available", message: "Update available" }),
  };
  Object.defineProperty(row, "name", { value: engine.name });
  return row as EngineRow;
}

interface HealthRow extends Record<string, unknown> {
  item: string;
  status: string;
  since: string;
}

const HEALTH_COLUMNS = (): readonly DataTableColumn<HealthRow>[] => [
  { id: "item", header: i18n._({ id: "Issue", message: "Issue" }) },
  { id: "status", header: i18n._({ id: "Severity", message: "Severity" }), minWidth: 128 },
  { id: "since", header: i18n._({ id: "Since", message: "Since" }), minWidth: 176 },
];

function toHealthRow(item: StackHealthItem): HealthRow {
  return { item: item.title, status: severityLabel(item.severity), since: new Date(item.since).toLocaleString() };
}

/** ENGINES-AI-01: the engines console (roles, installed engines, health, the connection check), drawn inside Home
 * settings > Engines and AI as that section's trail view (`home.engine_admin`). It is no longer a page of its own:
 * /engines redirects to that section, so the person never leaves the settings shell. The "Where the engine runs"
 * keys are the section's own card above it. */
export function EnginesConsole({ person }: { person: Roster }) {
  const canManage = isOwnerOrAdminRole(person.role);
  const overviewQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines(), enabled: canManage });
  const healthQuery = useQuery<EnginesHealth>({ queryKey: ["engines-health"], queryFn: () => api.enginesHealth(), enabled: canManage });
  const queryClient = useQueryClient();
  const [busyNames, setBusyNames] = useState<ReadonlySet<string>>(new Set());
  const doctor = useMutation({ mutationFn: api.engineConnectionCheck });
  // Tolerant of an answer with no lists: this console now draws inside the settings page, which must open whatever
  // the engines routes answer (an unconfigured Stack, or an answer that has none of these fields).
  const roles = useMemo(() => overviewQuery.data?.roles?.map(toRoleRow) ?? [], [overviewQuery.data]);
  const engines = useMemo(() => overviewQuery.data?.engines?.map(toEngineRow) ?? [], [overviewQuery.data]);
  const health = useMemo(() => healthQuery.data?.health?.map(toHealthRow) ?? [], [healthQuery.data]);
  const rolesTable = useDataTableControls(roles, ROLE_COLUMNS());
  const enginesTable = useDataTableControls(engines, ENGINE_COLUMNS());
  const healthTable = useDataTableControls(health, HEALTH_COLUMNS());

  async function runAction(name: string, action: "start" | "stop" | "restart" | "install") {
    setBusyNames((previous) => new Set(previous).add(name));
    try {
      await api.engineAction(name, action);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["engines"] }),
        queryClient.invalidateQueries({ queryKey: ["engines-health"] }),
      ]);
    } catch (error) {
      toast.error(errorLine(error, i18n._({ id: "That didn't work.", message: "That didn't work." })));
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
      {!canManage ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{i18n._({ id: "Only an owner or admin can manage engines.", message: "Only an owner or admin can manage engines." })}</p>
          </CardContent>
        </Card>
      ) : <>
      <Button type="button" disabled={doctor.isPending} onClick={() => doctor.mutate()}>
        {doctor.isPending ? i18n._({ id: "Checking connection…", message: "Checking connection…" }) : i18n._({ id: "Check the connection", message: "Check the connection" })}
      </Button>
      {doctor.data && (
        <Card>
          <CardContent>
            {doctor.data.hops.map((hop) => (
              <p key={hop.id}>{hop.pass
                ? (hop.detail ? i18n._({ id: "PASS hop {id}: {detail}", message: "PASS hop {id}: {detail}", values: { id: hop.id, detail: hop.detail } }) : i18n._({ id: "PASS hop {id}", message: "PASS hop {id}", values: { id: hop.id } }))
                : (hop.detail ? i18n._({ id: "FAIL hop {id}: {detail} — Fix: {fix}", message: "FAIL hop {id}: {detail} — Fix: {fix}", values: { id: hop.id, detail: hop.detail, fix: hop.fix } }) : i18n._({ id: "FAIL hop {id} — Fix: {fix}", message: "FAIL hop {id} — Fix: {fix}", values: { id: hop.id, fix: hop.fix } }))}</p>
            ))}
          </CardContent>
        </Card>
      )}
      {doctor.isError && <p role="alert">{errorLine(doctor.error, i18n._({ id: "Could not check the connection.", message: "Could not check the connection." }))}</p>}
      <AsyncState
        data={data}
        error={error}
        isFetching={overviewQuery.isFetching || healthQuery.isFetching}
        onRetry={() => {
          if (overviewQuery.isError) overviewQuery.refetch();
          if (healthQuery.isError) healthQuery.refetch();
        }}
        errorMessage={errorLine(firstError, i18n._({ id: "Could not load engines.", message: "Could not load engines." }))}
        loadingLabel={i18n._({ id: "Loading engines", message: "Loading engines" })}
      >
        {({ overview }: { overview: EnginesOverview; health: EnginesHealth }) =>
          !overview.configured ? (
            <Card>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="rounded-md border border-border p-2.5">
                    <EnginesIcon size={16} />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium">{i18n._({ id: "No Stack configured", message: "No Stack configured" })}</p>
                    <p className="text-sm text-muted-foreground">{i18n._({ id: "Set up MaiPai Stack in Settings to run your own engines and see their roles, versions and health here.", message: "Set up MaiPai Stack in Settings to run your own engines and see their roles, versions and health here." })}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <section className="mb-4 flex flex-col gap-4" aria-labelledby="engine-roles-heading">
                <CardHeader>
                  <CardTitle id="engine-roles-heading"><span className="flex items-center gap-2">
                    <RolesIcon size={16} className="text-muted-foreground" />
                    {i18n._({ id: "Roles", message: "Roles" })}
                  </span></CardTitle>
                </CardHeader>
                <DataTable
                  rows={rolesTable.rows}
                  columns={rolesTable.columns}
                  caption={i18n._({ id: "Engine roles", message: "Engine roles" })}
                  sort={rolesTable.sort}
                  onSortChange={rolesTable.onSortChange}
                  toolbar={rolesTable.toolbar}
                  emptyLabel={rolesTable.emptyLabel}
                />
              </section>

              <section className="mb-4 flex flex-col gap-4" aria-labelledby="installed-engines-heading">
                <CardHeader>
                  <CardTitle id="installed-engines-heading"><span className="flex items-center gap-2">
                    <EnginesIcon size={16} className="text-muted-foreground" />
                    {i18n._({ id: "Installed engines", message: "Installed engines" })}
                  </span></CardTitle>
                </CardHeader>
                <DataTable
                  rows={enginesTable.rows}
                  columns={enginesTable.columns}
                  getRowId={(row) => row.name}
                  caption={i18n._({ id: "Installed engines", message: "Installed engines" })}
                  sort={enginesTable.sort}
                  onSortChange={enginesTable.onSortChange}
                  toolbar={enginesTable.toolbar}
                  emptyLabel={enginesTable.emptyLabel}
                  rowActionsLabel={i18n._({ id: "Engine actions", message: "Engine actions" })}
                  rowActions={(row) => {
                    const engine = overview.engines.find((candidate) => candidate.name === row.name);
                    if (!engine) return null;
                    const busy = busyNames.has(engine.name);
                    const actions = engine.installed
                      ? [
                          ...(engine.running === null ? [{ label: i18n._({ id: "Start", message: "Start" }), action: "start" as const }] : [{ label: i18n._({ id: "Stop", message: "Stop" }), action: "stop" as const }]),
                          { label: i18n._({ id: "Restart", message: "Restart" }), action: "restart" as const },
                        ]
                      : [{ label: i18n._({ id: "Install", message: "Install" }), action: "install" as const }];
                    return (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={
                          <Button type="button" variant="ghost" size="icon-lg" aria-label={i18n._({ id: "More actions", message: "More actions" })}>
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
                <CardHeader>
                  <CardTitle id="engine-health-heading"><span className="flex items-center gap-2">
                    <HealthIcon size={16} className="text-muted-foreground" />
                    {i18n._({ id: "Health", message: "Health" })}
                  </span></CardTitle>
                </CardHeader>
                <DataTable
                  rows={healthTable.rows}
                  columns={healthTable.columns}
                  caption={i18n._({ id: "Engine health", message: "Engine health" })}
                  sort={healthTable.sort}
                  onSortChange={healthTable.onSortChange}
                  toolbar={healthTable.toolbar}
                  emptyLabel={healthTable.emptyLabel}
                />
              </section>
            </>
          )
        }
      </AsyncState>
      </>}
    </>
  );
}
