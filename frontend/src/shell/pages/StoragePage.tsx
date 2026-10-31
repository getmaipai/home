import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { QuotaBanner } from "@maipai/ui/src/elements/quota-banner";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { DataTableRowActions } from "@/shell/components/DataTableRowActions";
import { formatBytes } from "@maipai/ui/src/format";
import { BackupsSection } from "@/apps/settings/BackupsSection";
import { api, ApiError, isOwnerOrAdminRole, type Roster, type StorageUsageOverview, type PersonStorageRow } from "@/lib/api";
import type { PackageCacheSourceRow } from "@maipai/home-backend/src/wire";
import { useTabItem } from "@/shell/tabIdentity";

// Exported: pageHeaderTitle.tsx's own MANAGE_PAGE_ENTRIES imports this
// directly for the header's left slot, the same "that page's own exported
// icon constant, not a second table" pattern PerformancePage.tsx's own
// PerformanceIcon already follows. "database" mirrors the icon
// performance/DiskHardwareCard.tsx already uses for the disk/storage
// concept, not picked independently.
export const StorageIcon = getIcon("database");

interface PersonUsageRow extends Record<string, unknown> {
  person: string;
  role: string;
  used: string;
  cap: string;
  "top kind": string;
}

interface CacheRow extends Record<string, unknown> {
  source: string;
  label: string;
  entries: string;
  size: string;
}

const CACHE_COLUMNS: readonly DataTableColumn<CacheRow>[] = [
  { id: "label", header: "Source" },
  { id: "entries", header: "Saved copies" },
  { id: "size", header: "Size" },
];

const CLEAR_CONFIRM = "Saved copies of weather, news and other things Home looked up online. Your own chats, memories and the news shelf stay. Home will fetch it again the next time someone asks.";

function capLabel(capBytes: number): string {
  // 0 is every cap key's own "no cap enforced at this level" (usage.ts's
  // own comment) - shown as a plain fact, never a fabricated number.
  return capBytes > 0 ? formatBytes(capBytes) : "No cap set";
}

function toRow(row: PersonStorageRow): PersonUsageRow {
  const top = row.byKind[0];
  return {
    person: row.displayName,
    role: row.role,
    used: formatBytes(row.usageBytes),
    cap: capLabel(row.capBytes),
    "top kind": top ? `${top.kind} (${formatBytes(top.bytes)})` : "None yet",
  };
}

// STORE-DELETE-01 (household-storage-2026-09-23.md, "When a person is
// deleted"): files a deleted person had shared stay, and the household
// owns them. A parent's page shows them under one row, "shared by people
// no longer here"; they count toward the household total, not a person.
function inheritedRow(inherited: { files: number; bytes: number }): PersonUsageRow {
  return {
    person: "Shared by people no longer here",
    role: "household",
    used: formatBytes(inherited.bytes),
    cap: "Household total",
    "top kind": `${inherited.files} ${inherited.files === 1 ? "file" : "files"}`,
  };
}

/** /storage (STORE-PAGE-01, docs/BACKLOG.md): each person's usage
 * against their cap, the household total against its cap, the largest
 * kinds per person, and the cap controls for an admin - composed
 * entirely from the template's `Card`/`DataTable` and the settings
 * standard's own generic renderer (docs/SETTINGS.md's "one declaration,
 * one implementation"), never a second hand-built cap-editing form:
 * `SettingsRenderer`'s new `only` prop (added for this page) renders
 * just the "household.storage" group's own `SettingField`s, the
 * identical write path Settings' Household tab already uses for these
 * same three keys.
 *
 * One source with the performance dashboard's own disk panel (STORE-
 * CAP-01/backend's own acceptance): `GET /api/storage/usage` and `GET
 * /api/performance`'s disk.areas both read `lib/storage/usage.ts`'s
 * `householdUsageBytes()` for the household's file-byte total - see that
 * route/lib pair's own comments for why a raw-disk area list
 * (`storageSummary()`) and this household-file-record concept are kept
 * distinct rather than conflated, while still sharing the one function
 * for the concept they DO have in common.
 *
 * Reachable by everyone, unlike Performance: the row-visibility rule (a
 * child sees only their own row, never the household total or a
 * sibling's row) lives entirely on the backend
 * (`storageUsageOverview()`), so this page renders exactly what the API
 * returns with no client-side role filtering of its own - the same
 * "backend is the one gate" posture PerformancePage.tsx's own
 * comment already states for its owner/admin-only case. */
export function StoragePage({ person }: { person: Roster }) {
  useTabItem("Storage");
  const query = useQuery<StorageUsageOverview>({ queryKey: ["storage-usage"], queryFn: () => api.storageUsage() });
  const isAdmin = isOwnerOrAdminRole(person.role);
  const cacheQuery = useQuery<PackageCacheSourceRow[]>({ queryKey: ["storage-package-cache"], queryFn: () => api.packageCacheSources(), enabled: isAdmin });
  const client = useQueryClient();
  const [clearAllOpen, setClearAllOpen] = useState(false);

  async function clear(source?: string, label?: string) {
    try {
      const result = await api.clearPackageCache(source);
      await client.invalidateQueries({ queryKey: ["storage-package-cache"] });
      toast.success(`Cleared ${result.removed} saved ${result.removed === 1 ? "copy" : "copies"} (${formatBytes(result.bytes)}) from ${label ?? "all sources"}.`);
      setClearAllOpen(false);
    } catch {
      toast.error("Home could not clear the saved copies. Check that Home is running and try again.");
    }
  }

  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load storage."}
      loadingLabel="Loading storage"
    >
      {(data: StorageUsageOverview) => <StorageContent data={data} person={person} isAdmin={isAdmin} cacheRows={cacheQuery.data ?? []} cacheLoading={cacheQuery.isLoading} clearAllOpen={clearAllOpen} setClearAllOpen={setClearAllOpen} clear={clear} />}
    </AsyncState>
  );
}

function StorageContent({ data, person, isAdmin, cacheRows, cacheLoading, clearAllOpen, setClearAllOpen, clear }: { data: StorageUsageOverview; person: Roster; isAdmin: boolean; cacheRows: PackageCacheSourceRow[]; cacheLoading: boolean; clearAllOpen: boolean; setClearAllOpen: (open: boolean) => void; clear: (source?: string, label?: string) => Promise<void> }) {
  const rows = [...data.people.map(toRow), ...(data.household && data.household.inherited.files > 0 ? [inheritedRow(data.household.inherited)] : [])];
  const model = useDataTableModel(rows, tableColumns<PersonUsageRow>(["person", "role", "used", "cap", "top kind"], {
    person: 180,
    role: 100,
    used: 120,
    cap: 140,
    "top kind": 240,
  }), "No files yet.");
  return (
    <>
      <CardHeader>
        <CardTitle><span className="flex items-center gap-2">
          <StorageIcon size={16} className="text-muted-foreground" />
          Storage
        </span></CardTitle>
      </CardHeader>
      {data.household?.capBytes && data.household.capBytes > 0 ? (
        <>
          <CardTitle>Household total</CardTitle>
          <QuotaBanner
            used={data.household.usageBytes}
            limit={data.household.capBytes}
            unit="bytes"
            formatAmount={formatBytes}
          />
        </>
      ) : data.household ? (
        <Card>
          <CardHeader>
            <CardTitle>Household total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{formatBytes(data.household.usageBytes)} used, no cap set</p>
          </CardContent>
        </Card>
      ) : null}
      <Button variant="outline" nativeButton={false} render={<Link to="/storage/trash" />}>Trash</Button>
      <DataTable {...model} toolbar={<DataTableControls model={model} />} caption="Storage usage by person" getRowId={(row) => row.person} />
      {isAdmin ? <>
        <SettingsRenderer scope="household" scopeValue="household" only={["household.storage"]} />
        <BackupsSection person={person} />
        <Card>
          <CardHeader>
            <CardTitle>Saved online data</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Saved copies of weather, news and other things Home looked up online. Your own chats, memories and the news shelf stay. Home will fetch cleared data again the next time someone asks.</p>
          </CardContent>
          <DataTable
            columns={CACHE_COLUMNS}
            rows={cacheRows.map((row) => ({ source: row.source, label: row.label, entries: String(row.entryCount), size: formatBytes(row.sizeBytes) }))}
            caption="Saved data by source"
            getRowId={(row) => row.source}
            emptyLabel={cacheLoading ? "Loading saved data…" : "No saved online data."}
            rowActions={(row) => <DataTableRowActions actions={[{ label: `Clear ${row.label}`, destructive: true, confirmLabel: CLEAR_CONFIRM, onClick: () => clear(row.source, row.label) }]} />}
          />
          <Button type="button" variant="destructive" disabled={cacheRows.length === 0} onClick={() => setClearAllOpen(true)}>Clear all</Button>
        </Card>
        <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all saved online data?</AlertDialogTitle>
              <AlertDialogDescription>{CLEAR_CONFIRM}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void clear()}>Clear all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </> : null}
    </>
  );
}
