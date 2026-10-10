import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { DataTableRowActions } from "@/shell/components/DataTableRowActions";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { formatBytes } from "@/apps/settings/formatBytes";
import { api, ApiError, isOwnerOrAdminRole, type BackupInfo, type PendingRestore, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

/** /backups: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
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
// Exported: CHAT-HEADER-02's own pageHeaderTitle.tsx imports this
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

export function BackupsPage({ person }: { person: Roster }) {
  useTabItem("Backups");
  const canManage = isOwnerOrAdminRole(person.role);
  const canRestore = person.role === "owner";
  const backupsQuery = useQuery<BackupInfo[]>({ queryKey: ["backups"], queryFn: () => api.backups(), enabled: canManage });
  const pendingQuery = useQuery<{ pending: PendingRestore | null }>({ queryKey: ["backups-pending"], queryFn: () => api.pendingRestore(), enabled: canManage });
  const [running, setRunning] = useState(false);
  const [busyFilename, setBusyFilename] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const tableRows = (backupsQuery.data ?? []).map(toRow);
  const model = useDataTableModel(tableRows, tableColumns<Row>(["date", "size"], { date: 220, size: 120 }));
  const Download = getIcon("download");

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
    <>
      <CardHeader>
        <CardTitle>
          <BackupsIcon size={16} className="mr-2 inline text-muted-foreground" />
          Backups
        </CardTitle>
      </CardHeader>

      {!canManage ? (
        <Card>
          <CardContent>
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
                  <CardContent>
                    <p className="text-sm font-medium">Ready to restore</p>
                    <p className="text-sm text-muted-foreground">
                      The backup from {backupDate(pendingQuery.data.pending.filename, backups)} will replace everything in MaiPai Home the next time it starts.
                    </p>
                    {canRestore ? <div className="mt-3"><Button variant="secondary" size="row" onClick={handleCancel} disabled={cancelling}>Cancel restore</Button></div> : null}
                  </CardContent>
                </Card>
              ) : null}
              <DataTable
                {...model}
                caption="Backup history"
                getRowId={(row) => row.filename}
                toolbar={<div className="flex w-full flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Input size="row" type="search" aria-label="Search table rows" value={model.filter} onChange={(event) => { model.setFilter(event.target.value); model.setPageIndex(0); }} placeholder="Search rows…" />
                    <Button type="button" size="row" variant="outline" aria-label="Download table as CSV" onClick={model.downloadCsv}><Download aria-hidden="true" className="size-4" /><span>Download CSV</span></Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2"><Button type="button" size="row" variant="secondary" disabled={model.currentPage === 0} onClick={() => model.setPageIndex((page) => Math.max(0, page - 1))}>Previous</Button><Button type="button" size="row" disabled={model.currentPage + 1 >= model.pageCount} onClick={() => model.setPageIndex((page) => Math.min(model.pageCount - 1, page + 1))}>Next</Button></div>
                    <p className="text-sm text-muted-foreground" aria-live="polite">Page {model.currentPage + 1} of {model.pageCount}</p>
                    <div className="flex items-center gap-2"><Label htmlFor={model.pageSizeId}>Rows per page:</Label><Select value={String(model.pageSize)} onValueChange={(value) => { model.setPageSize(Number(value)); model.setPageIndex(0); }}><SelectTrigger id={model.pageSizeId} size="row"><SelectValue /></SelectTrigger><SelectContent>{model.availablePageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                </div>}
                rowActions={canRestore && !pendingQuery.data?.pending ? (row) => (
                  <DataTableRowActions actions={[{
                    label: "Restore",
                    destructive: true,
                    confirmLabel: `Restore the backup from ${row.date}? Everyone in your household, everything MaiPai remembers, and every conversation will go back to how they were then. Anything added since will be gone. This takes effect the next time MaiPai Home starts.`,
                    disabled: busyFilename !== null,
                    onClick: () => handleRestore(row.filename),
                  }]} />
                ) : undefined}
              />
              <div className="w-fit">
                <Button variant="secondary" size="row" onClick={handleRunBackup} disabled={running}>
                  {running ? "Backing up…" : "Back up now"}
                </Button>
              </div>
            </>
          )}
        </AsyncState>
      )}
    </>
  );
}
