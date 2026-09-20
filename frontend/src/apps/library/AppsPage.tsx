import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { ThingsPage } from "@maipai/ui/src/blocks/things-page/ThingsPage";
import { applyFilters, countFilterOptions, type FilterGroup } from "@maipai/ui/src/blocks/filter-column/FilterColumn";
import { ThingsTable, type ThingStatus, type ThingsTableColumn } from "@maipai/ui/src/blocks/things-table/ThingsTable";
import { DetailsPane } from "@maipai/ui/src/blocks/pane/DetailsPane";
import type { StatusKind } from "@maipai/ui/src/status";
import { KeyValueList } from "@maipai/ui/src/blocks/property-panel/KeyValueList";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { TypeBadge } from "@maipai/ui/src/blocks/cards/TypeBadge";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import type { IconName } from "@maipai/ui/src/icons";
import { api, ApiError, isOwnerOrAdminRole, type InstalledPackage, type Roster } from "@/lib/api";

// "Everything installed on this hub" (routeHeader.ts): the store's
// package catalog - the 33 voice-capability plugins/companions/skills
// GET /api/plugins reports, not the nav shortcuts (Chat, Settings...)
// APP_CATALOG already lists on the dashboard's own "Your apps" strip.
// Those are two different catalogs today; nothing on this page removes
// a nav destination.

interface KindStyle { label: string; hue: string; icon: IconName }

const KIND_STYLES: Record<string, KindStyle> = {
  plugin: { label: "Plugin", hue: "--hue-blue", icon: "puzzle" },
  companion: { label: "Companion", hue: "--hue-violet", icon: "bot" },
  skill: { label: "Skill", hue: "--hue-orange", icon: "sparkles" },
};

function kindStyle(kind: string): KindStyle {
  return KIND_STYLES[kind] ?? { label: kind.charAt(0).toUpperCase() + kind.slice(1), hue: "--hue-blue", icon: "package" };
}

function packageState(row: InstalledPackage): "Ready" | "Attention" {
  return row.status === "enabled" && row.smoke.ok !== false ? "Ready" : "Attention";
}

function tableStatus(row: InstalledPackage): ThingStatus {
  return packageState(row) === "Ready" ? "ready" : "attention";
}

function paneStatus(row: InstalledPackage): StatusKind {
  if (row.status === "disabled") return "disabled";
  if (row.smoke.ok === false) return "warning";
  return "ready";
}

const OFFLINE_LABEL: Record<string, string> = { full: "Works fully offline", degraded: "Works with limits offline", unavailable: "Needs the internet" };

const SOURCE_INSTALLED = "installed";
const SOURCE_CATALOG = "catalog";

export function AppsPage({ person }: { person: Roster }) {
  const canManage = isOwnerOrAdminRole(person.role);
  const [query, setQuery] = useState("");
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const pluginsQuery = useQuery<InstalledPackage[]>({ queryKey: ["plugins"], queryFn: () => api.plugins() });

  const selectedGroup = (id: string) => selections[id] ?? new Set<string>();
  const setGroup = (id: string) => (next: Set<string>) => setSelections((current) => ({ ...current, [id]: next }));

  const accessors = useMemo(
    () => ({
      source: () => SOURCE_INSTALLED,
      kind: (row: InstalledPackage) => kindStyle(row.kind).label,
      category: (row: InstalledPackage) => row.category,
      state: (row: InstalledPackage) => packageState(row),
      name: (row: InstalledPackage) => row.display,
      id: (row: InstalledPackage) => row.id,
    }),
    [],
  );

  const rows = pluginsQuery.data ?? [];
  const catalogSelectedAlone = selectedGroup("source").size === 1 && selectedGroup("source").has(SOURCE_CATALOG);
  const filteredRows = catalogSelectedAlone ? [] : applyFilters(rows, query, selections, accessors);

  const groups: FilterGroup[] = [
    {
      id: "source",
      title: "Source",
      options: [
        { id: SOURCE_INSTALLED, label: "Installed", count: rows.length },
        { id: SOURCE_CATALOG, label: "From the catalog", count: 0 },
      ],
      selected: selectedGroup("source"),
      onChange: setGroup("source"),
    },
    { id: "kind", title: "Kind", options: countFilterOptions(rows, accessors.kind), selected: selectedGroup("kind"), onChange: setGroup("kind") },
    { id: "category", title: "Category", options: countFilterOptions(rows, accessors.category), selected: selectedGroup("category"), onChange: setGroup("category") },
    { id: "state", title: "State", options: countFilterOptions(rows, accessors.state), selected: selectedGroup("state"), onChange: setGroup("state") },
  ];

  const columns: ThingsTableColumn<InstalledPackage>[] = [
    {
      key: "name",
      header: "Package",
      render: (row) => {
        const style = kindStyle(row.kind);
        return (
          <div className="flex min-w-0 items-center gap-2">
            <IconTile icon={style.icon} hue={style.hue} size="sm" glow={false} />
            <span className="truncate">{row.display}</span>
          </div>
        );
      },
    },
    { key: "category", header: "Category", render: (row) => row.category },
    { key: "kind", header: "Type", render: (row) => { const style = kindStyle(row.kind); return <TypeBadge label={style.label} hue={style.hue} />; } },
    { key: "version", header: "Version", align: "right", compact: true, render: (row) => row.installed_version },
  ];

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const installQuery = useQuery({
    queryKey: ["store-install", selectedId],
    queryFn: () => api.storeInstall(selectedId!),
    enabled: canManage && selectedId !== null,
  });

  // DetailsPane's own `busy` state (set the moment Confirm is clicked,
  // cleared once this settles) already disables every action button for
  // the duration - nothing here needs a second "in flight" flag.
  async function removePackage(id: string) {
    try {
      await api.uninstallPackage(id);
      await queryClient.invalidateQueries({ queryKey: ["plugins"] });
      setSelectedId(null);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Could not remove that package.");
    }
  }

  const removeDisabledReason = !canManage
    ? "Owners and admins only."
    : installQuery.isError
      ? "Couldn't check what's removable - try again."
      : installQuery.isLoading
        ? "Checking…"
        : !installQuery.data
          ? "This ships with Home; nothing to remove."
          : undefined;

  const emptyMessage = catalogSelectedAlone
    ? "Nothing here yet: the catalog isn't connected."
    : "No packages match your filters.";

  return (
    <Page title="Apps" hideTitle>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AsyncState
          data={pluginsQuery.data}
          error={pluginsQuery.isError}
          isFetching={pluginsQuery.isFetching}
          onRetry={() => pluginsQuery.refetch()}
          errorMessage={pluginsQuery.error instanceof ApiError ? pluginsQuery.error.message : "Could not load the installed packages."}
          loadingLabel="Loading your apps"
        >
          {() => (
            <ThingsPage
              filter={{ search: { value: query, onChange: setQuery, placeholder: "Search apps" }, groups, onClear: () => { setQuery(""); setSelections({}); } }}
              table={
                <ThingsTable
                  columns={columns}
                  rows={filteredRows}
                  getStatus={tableStatus}
                  getKey={(row) => row.id}
                  onRowClick={(row) => setSelectedId(row.id)}
                  selectedKey={selectedId ?? undefined}
                  empty={emptyMessage}
                />
              }
            />
          )}
        </AsyncState>
      </div>
      {selected && (
        <DetailsPane
          open
          onClose={() => setSelectedId(null)}
          icon={kindStyle(selected.kind).icon}
          hue={kindStyle(selected.kind).hue}
          name={selected.display}
          identifier={selected.id}
          status={paneStatus(selected)}
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: (
                <KeyValueList
                  items={[
                    { label: "Version", value: selected.installed_version },
                    { label: "Category", value: selected.category },
                    { label: "Type", value: kindStyle(selected.kind).label },
                    { label: "Quality", value: selected.quality_scale },
                    { label: "Minimum role", value: selected.min_role },
                    { label: "Offline", value: OFFLINE_LABEL[selected.offline] ?? selected.offline },
                    { label: "Permissions", value: selected.permissions && selected.permissions.length > 0 ? selected.permissions.join(", ") : "None" },
                  ]}
                />
              ),
            },
          ]}
          actions={[
            {
              label: "Remove",
              icon: "trash",
              destructive: true,
              disabledReason: removeDisabledReason,
              confirmLabel: `Remove ${selected.display}? This uninstalls it from the hub.`,
              onClick: () => removePackage(selected.id),
            },
          ]}
        />
      )}
    </Page>
  );
}
