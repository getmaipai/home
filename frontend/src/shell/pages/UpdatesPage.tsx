import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@/shell/components/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { rowsFrom, hasUpdate, type UpdateRow } from "@/apps/settings/updatesData";
import { api, ApiError, isOwnerOrAdminRole, type UpdateProjection, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

/** /updates: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/updates` through Home's
 * shared table, reusing `updatesData.ts`'s own `rowsFrom()`/
 * `hasUpdate()` (exported, pure data logic) rather than a second
 * definition of "does this row have a real update" - one row for Home
 * itself, one per Stack engine and model when a Stack is configured,
 * exactly what the old page shows.
 *
 * Applying an engine update and rolling one back use this page's own
 * table actions. Gated to owner/admin like the old page's own access
 * check even though `GET /api/
 * updates` itself is `requireAuth` only - matching the old page's own
 * visible gate is the parity this row asks for, not a new rule. */
// Exported: CHAT-HEADER-02's own pageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own.
export const UpdatesIcon = getIcon("refresh-cw");

interface Row extends Record<string, unknown> {
  name: string;
  installed: string;
  available: string;
  lastChecked: string;
  status: string;
}

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
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <UpdatesIcon size={16} className="text-muted-foreground" />
          Updates
        </CardTitle>
      </CardHeader>

      {!canManage ? (
        <Card>
          <CardContent className="p-6">
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
          {(projection: UpdateProjection) => {
            const updateRows = rowsFrom(projection);
            return (
              <DataTable
                data={updateRows.map(toRow)}
                rowKey={(row) => row.name}
                rowActions={(row) => {
                  const update = updateRows.find((candidate) => candidate.name === row.name);
                  if (!update || update.kind !== "engine") return [];
                  const isBusy = busyIds.has(`engine:${update.name}`);
                  const rollbackTag = rollbackTargets[update.name];
                  return [
                    ...(hasUpdate(update) ? [{ label: "Apply", onClick: () => applyEngine(update.name), disabled: isBusy }] : []),
                    ...(rollbackTag ? [{ label: "Go back", destructive: true, confirmLabel: `Go back to ${rollbackTag}?`, onClick: () => rollbackEngineTo(update.name, rollbackTag), disabled: isBusy }] : []),
                  ];
                }}
              />
            );
          }}
        </AsyncState>
      )}
      {canManage && query.data?.robotsError && (
        <p className="text-sm text-destructive">Couldn't check for robot updates: {query.data.robotsError}</p>
      )}
      {canManage && query.data?.referenceError && (
        <p className="text-sm text-destructive">Couldn't read installed reference sets for updates: {query.data.referenceError}</p>
      )}
    </div>
  );
}
