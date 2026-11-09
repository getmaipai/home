import { i18n } from "@lingui/core";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { QuotaBanner } from "@maipai/ui/src/elements/quota-banner";
import { PlainSection } from "@/apps/settings/PlainSection";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { DataTableRowActions } from "@/shell/components/DataTableRowActions";
import { formatBytes } from "@maipai/ui/src/format";
import { BackupsSection } from "@/apps/settings/BackupsSection";
import { api, isOwnerOrAdminRole, type Roster, type StorageUsageOverview, type PersonStorageRow } from "@/lib/api";
import type { PackageCacheSourceRow } from "@maipai/home-backend/src/wire";
import { useTabItem } from "@/shell/tabIdentity";
import { errorLine } from "@/lib/hubReachability";

// Exported: pageHeaderTitle.tsx's own MANAGE_PAGE_ENTRIES imports this
// directly for the header's left slot, the same "that page's own exported
// icon constant, not a second table" pattern PerformancePage.tsx's own
// PerformanceIcon already follows. "database" mirrors the icon
// performance/DiskHardwareCard.tsx already uses for the disk/storage
// concept, not picked independently.
export const StorageIcon = getIcon("database");
const TrashIcon = getIcon("trash");

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

const cacheColumns = (): readonly DataTableColumn<CacheRow>[] => [
  { id: "label", header: i18n._({ id: "Source", message: "Source" }) },
  { id: "entries", header: i18n._({ id: "Saved copies", message: "Saved copies" }) },
  { id: "size", header: i18n._({ id: "Size", message: "Size" }) },
];

const clearConfirm = (): string => i18n._({ id: "Saved copies of weather, news and other things Home looked up online. Your own chats, memories and the news shelf stay. Home will fetch it again the next time someone asks.", message: "Saved copies of weather, news and other things Home looked up online. Your own chats, memories and the news shelf stay. Home will fetch it again the next time someone asks." });

function capLabel(capBytes: number): string {
  // 0 is every cap key's own "no cap enforced at this level" (usage.ts's
  // own comment) - shown as a plain fact, never a fabricated number.
  return capBytes > 0 ? formatBytes(capBytes) : i18n._({ id: "No cap set", message: "No cap set" });
}

function toRow(row: PersonStorageRow): PersonUsageRow {
  const top = row.byKind[0];
  return {
    person: row.displayName,
    role: row.role,
    used: formatBytes(row.usageBytes),
    cap: capLabel(row.capBytes),
    "top kind": top ? i18n._({ id: "{kind} ({size})", message: "{kind} ({size})", values: { kind: top.kind, size: formatBytes(top.bytes) } }) : i18n._({ id: "None yet", message: "None yet" }),
  };
}

// STORE-DELETE-01 (household-storage-2026-09-23.md, "When a person is
// deleted"): files a deleted person had shared stay, and the household
// owns them. A parent's page shows them under one row, "shared by people
// no longer here"; they count toward the household total, not a person.
function inheritedRow(inherited: { files: number; bytes: number }): PersonUsageRow {
  return {
    person: i18n._({ id: "Shared by people no longer here", message: "Shared by people no longer here" }),
    role: "household",
    used: formatBytes(inherited.bytes),
    cap: i18n._({ id: "Household total", message: "Household total" }),
    "top kind": i18n._({ id: "{count, plural, one {# file} other {# files}}", message: "{count, plural, one {# file} other {# files}}", values: { count: inherited.files } }),
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
  useTabItem(i18n._({ id: "Storage", message: "Storage" }));
  const query = useQuery<StorageUsageOverview>({ queryKey: ["storage-usage"], queryFn: () => api.storageUsage() });
  const isAdmin = isOwnerOrAdminRole(person.role);
  const cacheQuery = useQuery<PackageCacheSourceRow[]>({ queryKey: ["storage-package-cache"], queryFn: () => api.packageCacheSources(), enabled: isAdmin });
  const client = useQueryClient();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearProblem, setClearProblem] = useState("");

  async function clear(source?: string, label?: string) {
    setClearProblem("");
    try {
      const result = await api.clearPackageCache(source);
      await client.invalidateQueries({ queryKey: ["storage-package-cache"] });
      toast.success(label ? i18n._({ id: "Cleared {count, plural, one {# saved copy} other {# saved copies}} ({size}) from {source}.", message: "Cleared {count, plural, one {# saved copy} other {# saved copies}} ({size}) from {source}.", values: { count: result.removed, size: formatBytes(result.bytes), source: label } }) : i18n._({ id: "Cleared {count, plural, one {# saved copy} other {# saved copies}} ({size}) from all sources.", message: "Cleared {count, plural, one {# saved copy} other {# saved copies}} ({size}) from all sources.", values: { count: result.removed, size: formatBytes(result.bytes) } }));
      setClearAllOpen(false);
    } catch {
      setClearAllOpen(false);
      setClearProblem(i18n._({ id: "Home could not clear the saved copies. Check that Home is running and try again.", message: "Home could not clear the saved copies. Check that Home is running and try again." }));
    }
  }

  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage={errorLine(query.error, i18n._({ id: "Could not load storage.", message: "Could not load storage." }))}
      loadingLabel={i18n._({ id: "Loading storage", message: "Loading storage" })}
    >
      {(data: StorageUsageOverview) => <StorageContent data={data} person={person} isAdmin={isAdmin} cacheRows={cacheQuery.data ?? []} cacheLoading={cacheQuery.isLoading} clearAllOpen={clearAllOpen} setClearAllOpen={setClearAllOpen} clear={clear} clearProblem={clearProblem} />}
    </AsyncState>
  );
}

function HouseholdTotal({ household }: { household: StorageUsageOverview["household"] }) {
  return (
    <PlainSection {...(household ? { heading: i18n._({ id: "Household total", message: "Household total" }) } : {})}>
      {household?.capBytes && household.capBytes > 0 ? (
        <QuotaBanner
          used={household.usageBytes}
          limit={household.capBytes}
          unit="bytes"
          formatAmount={formatBytes}
        />
      ) : household ? (
        <p className="text-body text-muted-foreground">{i18n._({ id: "{size} used, no cap set", message: "{size} used, no cap set", values: { size: formatBytes(household.usageBytes) } })}</p>
      ) : null}
      <div className="flex justify-end"><Button variant="ghost" nativeButton={false} render={<Link to="/storage/trash" />}><TrashIcon aria-hidden />{i18n._({ id: "Trash", message: "Trash" })}</Button></div>
    </PlainSection>
  );
}

function StorageContent({ data, person, isAdmin, cacheRows, cacheLoading, clearAllOpen, setClearAllOpen, clear, clearProblem }: { data: StorageUsageOverview; person: Roster; isAdmin: boolean; cacheRows: PackageCacheSourceRow[]; cacheLoading: boolean; clearAllOpen: boolean; setClearAllOpen: (open: boolean) => void; clear: (source?: string, label?: string) => Promise<void>; clearProblem: string }) {
  const rows = [...data.people.map(toRow), ...(data.household && data.household.inherited.files > 0 ? [inheritedRow(data.household.inherited)] : [])];
  const model = useDataTableModel(rows, tableColumns<PersonUsageRow>(["person", "role", "used", "cap", "top kind"], {
    person: 180,
    role: 100,
    used: 120,
    cap: 140,
    "top kind": 240,
  }, { person: i18n._({ id: "Person", message: "Person" }), role: i18n._({ id: "Role", message: "Role" }), used: i18n._({ id: "Used", message: "Used" }), cap: i18n._({ id: "Cap", message: "Cap" }), "top kind": i18n._({ id: "Top kind", message: "Top kind" }) }), i18n._({ id: "No files yet.", message: "No files yet." }));
  return (
    <PlainSection>
      <HouseholdTotal household={data.household} />
      <DataTable {...model.tableProps} toolbar={rows.length >= 10 ? <DataTableControls model={model} /> : undefined} caption={i18n._({ id: "Storage usage by person", message: "Storage usage by person" })} getRowId={(row) => row.person} />
      {isAdmin ? <>
        <SettingsRenderer scope="household" scopeValue="household" only={["household.storage"]} />
        <BackupsSection person={person} />
        <PlainSection heading={i18n._({ id: "Saved online data", message: "Saved online data" })}>
          {clearProblem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={clearProblem} /> : null}
          <p className="text-body text-muted-foreground">{i18n._({ id: "Saved copies of weather, news and other things Home looked up online. Your own chats, memories and the news shelf stay. Home will fetch cleared data again the next time someone asks.", message: "Saved copies of weather, news and other things Home looked up online. Your own chats, memories and the news shelf stay. Home will fetch cleared data again the next time someone asks." })}</p>
          <DataTable
            columns={cacheColumns()}
            rows={cacheRows.map((row) => ({ source: row.source, label: row.label, entries: String(row.entryCount), size: formatBytes(row.sizeBytes) }))}
            caption={i18n._({ id: "Saved data by source", message: "Saved data by source" })}
            getRowId={(row) => row.source}
            emptyLabel={cacheLoading ? i18n._({ id: "Loading saved data\u2026", message: "Loading saved data\u2026" }) : i18n._({ id: "No saved online data.", message: "No saved online data." })}
            rowActions={(row) => <DataTableRowActions actions={[{ label: i18n._({ id: "Clear {name}", message: "Clear {name}", values: { name: row.label } }), destructive: true, confirmLabel: clearConfirm(), onClick: () => clear(row.source, row.label) }]} />}
          />
          <div className="flex"><Button type="button" variant="ghost" disabled={cacheRows.length === 0} onClick={() => setClearAllOpen(true)}><TrashIcon aria-hidden />{i18n._({ id: "Clear all", message: "Clear all" })}</Button></div>
        </PlainSection>
        <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{i18n._({ id: "Clear all saved online data?", message: "Clear all saved online data?" })}</AlertDialogTitle>
              <AlertDialogDescription>{clearConfirm()}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void clear()}>{i18n._({ id: "Clear all", message: "Clear all" })}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </> : null}
    </PlainSection>
  );
}
