import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { NextDataTable } from "@/next/components/NextDataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { formatBytes } from "@/apps/settings/formatBytes";
import { api, ApiError, isOwnerOrAdminRole, type BackupInfo, type PendingRestore, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/backups: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/backups` through Home's
 * shared table: date and size, the same two fields `BackupsSection.tsx`
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
 * confirm step) - Home's shared table is deliberately read-only, so running a backup
 * and restoring one stay on the old route. Gated to owner/admin like
 * the old page (`BackupsPage.tsx`'s own `AdminGatedContent`); reading
 * the pending-restore state is owner-or-admin on the backend too
 * (`routes/backups.ts`), the same "someone who can restart the hub
 * should not be the last to know" reasoning `BackupsSection.tsx`'s own
 * header already documents. */
// Exported: CHAT-HEADER-02's own nextPageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own.
export const BackupsIcon = getIcon("archive");

interface Row extends Record<string, unknown> {
  date: string;
  size: string;
  filename: string;
}

function toRow(backup: BackupInfo): Row {
  const row = { date: whenText(backup.createdAt), size: formatBytes(backup.bytes) };
  Object.defineProperty(row, "filename", { value: backup.filename });
  return row as Row;
}

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function NextBackupsPage({ person }: { person: Roster }) {
  useDocumentTitle("Backups");
  const canManage = isOwnerOrAdminRole(person.role);
  const canRestore = person.role === "owner";
  const backupsQuery = useQuery<BackupInfo[]>({ queryKey: ["backups"], queryFn: () => api.backups(), enabled: canManage });
  const pendingQuery = useQuery<{ pending: PendingRestore | null }>({ queryKey: ["backups-pending"], queryFn: () => api.pendingRestore(), enabled: canManage });
  const [running, setRunning] = useState(false);
  const [busyFilename, setBusyFilename] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function handleRunBackup() {
    setRunning(true);
    try {
      await api.runBackup();
      await backupsQuery.refetch();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not run a backup.");
    } finally {
      setRunning(false);
    }
  }

  async function handleRestore(filename: string) {
    setBusyFilename(filename);
    try {
      await api.stageRestore(filename);
      await pendingQuery.refetch();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not get that backup ready.");
    } finally {
      setBusyFilename(null);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await api.cancelRestore();
      await pendingQuery.refetch();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not cancel the restore.");
    } finally {
      setCancelling(false);
    }
  }

  function backupDate(filename: string, backups: BackupInfo[]): string {
    const match = backups.find((backup) => backup.filename === filename);
    return match ? whenText(match.createdAt) : "the one you chose";
  }

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
                      The backup from {backupDate(pendingQuery.data.pending.filename, backups)} will replace everything in MaiPai Home the next time it starts.
                    </p>
                    {canRestore ? <Button variant="secondary" onClick={handleCancel} disabled={cancelling} className="mt-3">Cancel restore</Button> : null}
                  </CardContent>
                </Card>
              ) : null}
              <NextDataTable
                data={backups.map(toRow)}
                rowKey={(row) => row.filename}
                rowActions={canRestore && !pendingQuery.data?.pending ? (row) => [{
                  label: "Restore",
                  destructive: true,
                  confirmLabel: `Restore the backup from ${row.date}? Everyone in your household, everything MaiPai remembers, and every conversation will go back to how they were then. Anything added since will be gone. This takes effect the next time MaiPai Home starts.`,
                  disabled: busyFilename !== null,
                  onClick: () => handleRestore(row.filename),
                }] : undefined}
              />
              <Button variant="secondary" onClick={handleRunBackup} disabled={running} className="w-fit">
                {running ? "Backing up…" : "Back up now"}
              </Button>
            </>
          )}
        </AsyncState>
      )}
    </div>
  );
}
