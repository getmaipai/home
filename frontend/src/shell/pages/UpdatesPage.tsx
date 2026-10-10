import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
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
import { api, ApiError, isOwnerOrAdminRole, type UpdateProjection, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { useDataTableControls } from "@/shell/pages/dataTableControls";

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

const UPDATE_COLUMNS: readonly DataTableColumn<Row>[] = [
  { id: "name", header: "Name" },
  { id: "installed", header: "Installed", minWidth: 112 },
  { id: "available", header: "Available", minWidth: 112 },
  { id: "lastChecked", header: "Last checked", minWidth: 176 },
  { id: "status", header: "Status", minWidth: 176 },
];

function statusFor(row: UpdateRow): string {
  if (row.kind === "robot") {
    if (hasUpdate(row)) return row.blockedBy ? `Update available. ${row.blockedBy}` : "Update available";
    if (row.installed === null) return "Version unknown";
    if (row.available === null) return row.lastChecked ? "No release published yet" : "Not checked yet";
    return "Up to date";
  }
  return hasUpdate(row) ? "Update available" : "Up to date";
}

function toRow(row: UpdateRow): Row {
  return {
    id: row.id,
    name: row.detail ? `${row.name} (${row.detail.charAt(0).toLowerCase()}${row.detail.slice(1)})` : row.name,
    installed: row.installed ?? (row.kind === "robot" ? "Unknown" : "-"),
    available: row.available ?? (row.kind === "engine" ? "Unknown" : "-"),
    lastChecked: row.lastChecked ? new Date(row.lastChecked).toLocaleString() : "Never",
    status: statusFor(row),
  };
}

export function UpdatesPage({ person }: { person: Roster }) {
  useTabItem("Updates");
  const canManage = isOwnerOrAdminRole(person.role);
  const query = useQuery<UpdateProjection>({ queryKey: ["updates"], queryFn: () => api.updates(), enabled: canManage });
  const queryClient = useQueryClient();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [rollbackTargets, setRollbackTargets] = useState<Record<string, string>>({});
  const [pendingRollback, setPendingRollback] = useState<{ name: string; tag: string } | null>(null);
  const updateRows = (query.data ? rowsFrom(query.data) : []).map(toRow);
  const table = useDataTableControls(updateRows, UPDATE_COLUMNS, "No updates available.");

  async function withBusy(id: string, run: () => Promise<void>) {
    setBusyIds((previous) => new Set(previous).add(id));
    try {
      await run();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "That didn't work.");
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
      <div className="mb-4">
        <CardHeader>
          <CardTitle><span className="flex items-center gap-2">
            <UpdatesIcon size={16} className="text-muted-foreground" />
            Updates
          </span></CardTitle>
        </CardHeader>
      </div>

      {!canManage ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage updates.</p>
          </CardContent>
        </Card>
      ) : (
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load updates."}
          loadingLabel="Loading updates"
        >
          {() => (
            <DataTable
              rows={table.rows}
              columns={table.columns}
              getRowId={(row) => row.id}
              caption="Available updates"
              sort={table.sort}
              onSortChange={table.onSortChange}
              toolbar={table.toolbar}
              emptyLabel={table.emptyLabel}
              rowActionsLabel="Update actions"
              rowActions={(row) => {
                const update = query.data ? rowsFrom(query.data).find((candidate) => candidate.id === row.id) : undefined;
                if (!update || update.kind !== "engine") return null;
                const isBusy = busyIds.has(`engine:${update.name}`);
                const rollbackTag = rollbackTargets[update.name];
                const actions = [
                  ...(hasUpdate(update) ? [{ label: "Apply", onSelect: () => void applyEngine(update.name) }] : []),
                  ...(rollbackTag ? [{ label: "Go back", onSelect: () => setPendingRollback({ name: update.name, tag: rollbackTag }) }] : []),
                ];
                if (!actions.length) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={
                      <Button type="button" variant="ghost" size="icon-lg" aria-label="More actions">
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
        <p className="mt-4 text-sm text-destructive">Couldn't check for robot updates: {query.data.robotsError}</p>
      )}
      {canManage && query.data?.referenceError && (
        <p className="mt-4 text-sm text-destructive">Couldn't read installed reference sets for updates: {query.data.referenceError}</p>
      )}
      <AlertDialog open={pendingRollback !== null} onOpenChange={(open) => { if (!open) setPendingRollback(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Go back</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRollback ? `Go back to ${pendingRollback.tag}?` : "Confirm rollback."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              if (pendingRollback) await rollbackEngineTo(pendingRollback.name, pendingRollback.tag);
              setPendingRollback(null);
            }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
