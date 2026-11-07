import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@maipai/ui/src/dashboard/components/ui/dropdown-menu";
import { rowsFrom, hasUpdate, type UpdateRow } from "@/apps/settings/updatesData";
import { api, isOwnerOrAdminRole, type UpdateProjection, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { useDataTableControls } from "@/shell/pages/useDataTableControls";
import { errorLine } from "@/lib/hubReachability";

/** /updates: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/updates` through the kit's
 * DataTable, reusing `updatesData.ts`'s own `rowsFrom()`/`hasUpdate()`
 * rather than a second definition of update availability. */
export const UpdatesIcon = getIcon("refresh-cw");
const MoreHorizontal = getIcon("more-horizontal");

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  installed: string;
  available: string;
  lastChecked: string;
  status: string;
}

const updateColumns = (): readonly DataTableColumn<Row>[] => [
  { id: "name", header: i18n._({ id: "Name", message: "Name" }) },
  { id: "installed", header: i18n._({ id: "Installed", message: "Installed" }), minWidth: 112, cell: (row) => row.installed.length > 7 ? <span title={row.installed}>{row.installed.slice(0, 7)}</span> : row.installed },
  { id: "available", header: i18n._({ id: "Available", message: "Available" }), minWidth: 112 },
  { id: "lastChecked", header: i18n._({ id: "Last checked", message: "Last checked" }), minWidth: 176 },
  { id: "status", header: i18n._({ id: "Status", message: "Status" }), minWidth: 176 },
];

function statusFor(row: UpdateRow): string {
  if (row.kind === "robot") {
    if (hasUpdate(row)) return row.blockedBy ? i18n._({ id: "Update available. {reason}", message: "Update available. {reason}", values: { reason: row.blockedBy } }) : i18n._({ id: "Update available", message: "Update available" });
    if (row.installed === null) return i18n._({ id: "Version unknown", message: "Version unknown" });
    if (row.available === null) return row.lastChecked ? i18n._({ id: "No release published yet", message: "No release published yet" }) : i18n._({ id: "Not checked yet", message: "Not checked yet" });
    return i18n._({ id: "Up to date", message: "Up to date" });
  }
  return hasUpdate(row) ? i18n._({ id: "Update available", message: "Update available" }) : i18n._({ id: "Up to date", message: "Up to date" });
}

function toRow(row: UpdateRow): Row {
  return {
    id: row.id,
    name: row.detail ? `${row.name} (${row.detail.charAt(0).toLowerCase()}${row.detail.slice(1)})` : row.name,
    installed: row.installed ?? (row.kind === "robot" ? i18n._({ id: "Unknown", message: "Unknown" }) : "-"),
    available: row.available ?? (row.kind === "engine" ? i18n._({ id: "Unknown", message: "Unknown" }) : "-"),
    lastChecked: row.lastChecked ? new Date(row.lastChecked).toLocaleString() : i18n._({ id: "Never", message: "Never" }),
    status: statusFor(row),
  };
}

export function UpdatesPage({ person }: { person: Roster }) {
  useTabItem(i18n._({ id: "Updates", message: "Updates" }));
  const canManage = isOwnerOrAdminRole(person.role);
  const query = useQuery<UpdateProjection>({ queryKey: ["updates"], queryFn: () => api.updates(), enabled: canManage });
  const queryClient = useQueryClient();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [rollbackTargets, setRollbackTargets] = useState<Record<string, string>>({});
  const [pendingRollback, setPendingRollback] = useState<{ name: string; tag: string } | null>(null);
  const updateRows = (query.data ? rowsFrom(query.data) : []).map(toRow);
  const table = useDataTableControls(updateRows, updateColumns(), i18n._({ id: "No updates available.", message: "No updates available." }));

  async function withBusy(id: string, run: () => Promise<void>) {
    setBusyIds((previous) => new Set(previous).add(id));
    try {
      await run();
    } catch (error) {
      toast.error(errorLine(error, i18n._({ id: "That didn't work.", message: "That didn't work." })));
    } finally {
      setBusyIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  async function applyEngine(name: string) {
    await withBusy(`engine:${name}`, async () => {
      const result = await api.applyStackEngineUpdate(name);
      if (result.applied && result.tag && result.previous) {
        setRollbackTargets((previous) => ({ ...previous, [name]: result.previous! }));
      }
      await queryClient.invalidateQueries({ queryKey: ["updates"] });
    });
  }

  async function rollbackEngineTo(name: string, tag: string) {
    await withBusy(`engine:${name}`, async () => {
      await api.rollbackStackEngine(name, tag);
      setRollbackTargets((previous) => {
        const next = { ...previous };
        delete next[name];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["updates"] });
    });
  }

  return (
    <>
      {!canManage ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{i18n._({ id: "Only an owner or admin can manage updates.", message: "Only an owner or admin can manage updates." })}</p>
          </CardContent>
        </Card>
      ) : (
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={errorLine(query.error, i18n._({ id: "Could not load updates.", message: "Could not load updates." }))}
          loadingLabel={i18n._({ id: "Loading updates", message: "Loading updates" })}
        >
          {() => (
            <DataTable
              rows={table.rows}
              columns={table.columns}
              getRowId={(row) => row.id}
              caption={i18n._({ id: "Available updates", message: "Available updates" })}
              sort={table.sort}
              onSortChange={table.onSortChange}
              toolbar={updateRows.length >= 10 ? table.toolbar : undefined}
              emptyLabel={table.emptyLabel}
              rowActionsLabel={i18n._({ id: "Update actions", message: "Update actions" })}
              rowActions={(row) => {
                const update = query.data ? rowsFrom(query.data).find((candidate) => candidate.id === row.id) : undefined;
                if (!update || update.kind !== "engine") return null;
                const isBusy = busyIds.has(`engine:${update.name}`);
                const rollbackTag = rollbackTargets[update.name];
                const actions = [
                  ...(hasUpdate(update) ? [{ label: i18n._({ id: "Apply", message: "Apply" }), onSelect: () => void applyEngine(update.name) }] : []),
                  ...(rollbackTag ? [{ label: i18n._({ id: "Go back", message: "Go back" }), onSelect: () => setPendingRollback({ name: update.name, tag: rollbackTag }) }] : []),
                ];
                if (!actions.length) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={
                      <Button type="button" variant="ghost" size="icon-lg" aria-label={i18n._({ id: "More actions", message: "More actions" })}>
                        <MoreHorizontal aria-hidden="true" size={16} />
                      </Button>
                    } />
                    <DropdownMenuContent align="end">
                      {actions.map((action) => (
                        <DropdownMenuItem key={action.label} disabled={isBusy} onClick={action.onSelect}>
                          {action.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }}
            />
          )}
        </AsyncState>
      )}
      {canManage && query.data?.robotsError && (
        <p className="mt-4 text-sm text-destructive">{i18n._({ id: "Couldn't check for robot updates: {robotsError}", message: "Couldn't check for robot updates: {robotsError}", values: { robotsError: query.data.robotsError } })}</p>
      )}
      {canManage && query.data?.referenceError && (
        <p className="mt-4 text-sm text-destructive">{i18n._({ id: "Couldn't read installed reference sets for updates: {referenceError}", message: "Couldn't read installed reference sets for updates: {referenceError}", values: { referenceError: query.data.referenceError } })}</p>
      )}
      <AlertDialog open={pendingRollback !== null} onOpenChange={(open) => { if (!open) setPendingRollback(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n._({ id: "Go back", message: "Go back" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRollback ? i18n._({ id: "Go back to {tag}?", message: "Go back to {tag}?", values: { tag: pendingRollback.tag } }) : i18n._({ id: "Confirm rollback.", message: "Confirm rollback." })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              if (pendingRollback) await rollbackEngineTo(pendingRollback.name, pendingRollback.tag);
              setPendingRollback(null);
            }}>{i18n._({ id: "Confirm", message: "Confirm" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
