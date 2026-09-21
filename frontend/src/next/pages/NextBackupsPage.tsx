import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import DataTable from "@maipai/ui/src/dashboard/components/tables/data-table/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { formatBytes } from "@/apps/settings/formatBytes";
import { api, ApiError, isOwnerOrAdminRole, type BackupInfo, type PendingRestore, type Roster } from "@/lib/api";

/** /next/backups: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/backups` through the template's
 * `DataTable`: date and size, the same two fields `BackupsSection.tsx`
 * shows per row, plus the real "ready to restore" banner
 * (`GET /api/backups/restore/pending`) when one is staged.
 *
 * A correction, not a gap: the row's own ask named "size and outcome"
 * and a "schedule card" - `BackupInfo` (backend/src/wire.ts) carries
 * only `filename`/`createdAt`/`bytes`, no outcome field (a backup that
 * failed never produces a listed file - there is nothing to show as a
 * failed row), and neither `BackupsSection.tsx` nor `GET /api/backups`
 * has ever had a schedule concept of its own (the household-level
 * "Backup storage limit" setting's own help text names a fixed seven-
 * daily/four-weekly/three-monthly retention cadence, but that is a
 * quantity limit, not a schedule anything renders). Built against what
 * is actually there: history rows and the pending-restore state.
 *
 * Named gap: running a backup now and restoring one are real actions on
 * the old page (`BackupsSection.tsx`'s own `Button`s, with a real
 * confirm step) - the vendored `DataTable`'s Action column has no click
 * handler wired to either icon, the same gap every `/next` data-table
 * has found, so those stay on the old route. Gated to owner/admin like
 * the old page (`BackupsPage.tsx`'s own `AdminGatedContent`); reading
 * the pending-restore state is owner-or-admin on the backend too
 * (`routes/backups.ts`), the same "someone who can restart the hub
 * should not be the last to know" reasoning `BackupsSection.tsx`'s own
 * header already documents. */
const BackupsIcon = getIcon("archive");

interface Row extends Record<string, unknown> {
  date: string;
  size: string;
}

function toRow(backup: BackupInfo): Row {
  return { date: new Date(backup.createdAt).toLocaleString(), size: formatBytes(backup.bytes) };
}

export function NextBackupsPage({ person }: { person: Roster }) {
  const canManage = isOwnerOrAdminRole(person.role);
  const backupsQuery = useQuery<BackupInfo[]>({ queryKey: ["backups"], queryFn: () => api.backups(), enabled: canManage });
  const pendingQuery = useQuery<{ pending: PendingRestore | null }>({ queryKey: ["backups-pending"], queryFn: () => api.pendingRestore(), enabled: canManage });

  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <BackupsIcon size={16} className="text-muted-foreground" />
          Backups
        </CardTitle>
      </CardHeader>

      {!canManage ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage backups.</p>
          </CardContent>
        </Card>
      ) : (
        <AsyncState
          data={backupsQuery.data}
          error={backupsQuery.isError}
          isFetching={backupsQuery.isFetching}
          onRetry={() => backupsQuery.refetch()}
          errorMessage={backupsQuery.error instanceof ApiError ? backupsQuery.error.message : "Could not load backups."}
          loadingLabel="Loading backups"
        >
          {(backups: BackupInfo[]) => (
            <>
              {pendingQuery.data?.pending ? (
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm font-medium">Ready to restore</p>
                    <p className="text-sm text-muted-foreground">
                      The backup from {new Date(pendingQuery.data.pending.stagedAt).toLocaleString()} will replace everything in MaiPai Home the next time it starts.
                    </p>
                  </CardContent>
                </Card>
              ) : null}
              <DataTable data={backups.map(toRow)} />
            </>
          )}
        </AsyncState>
      )}
    </div>
  );
}
