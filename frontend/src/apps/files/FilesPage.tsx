import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Select } from "@maipai/ui/src/primitives/Select";
import { ThingsPage } from "@maipai/ui/src/blocks/things-page/ThingsPage";
import { applyFilters, countFilterOptions, type FilterGroup } from "@maipai/ui/src/blocks/filter-column/FilterColumn";
import { ThingsTable, type ThingStatus, type ThingsTableColumn } from "@maipai/ui/src/blocks/things-table/ThingsTable";
import { DetailsPane } from "@maipai/ui/src/blocks/pane/DetailsPane";
import { KeyValueList } from "@maipai/ui/src/blocks/property-panel/KeyValueList";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { Button } from "@maipai/ui/src/ui/button";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import type { IconName } from "@maipai/ui/src/icons";
import { api, ApiError, type VisibleFile, type PersonRosterEntry, type Roster } from "@/lib/api";

// STORE-SHARE-01: the Library - every file the signed-in person owns,
// plus every file shared with them (by name or by the household), each
// listed once under its real owner (household-storage-2026-09-23.md:
// "a shared file appears in each recipient's Library under the owner's
// name and counts against the owner's usage only"). Not yet on the main
// nav (shell/nav.ts's own curated list - adding a destination there is a
// design decision for STORE-PAGE-01/PEOPLE-01, which will decide how
// this actually surfaces, e.g. a person's profile media grid); this
// route exists and works today at /files.

interface KindStyle { label: string; icon: IconName }

const KIND_STYLES: Record<string, KindStyle> = {
  image: { label: "Image", icon: "camera" },
  video: { label: "Video", icon: "play" },
  audio: { label: "Audio", icon: "mic" },
  document: { label: "Document", icon: "file-text" },
  story: { label: "Story", icon: "sparkles" },
  other: { label: "File", icon: "box" },
};

function kindStyle(kind: string): KindStyle {
  return KIND_STYLES[kind] ?? KIND_STYLES.other!;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

const SOURCE_MINE = "mine";
const SOURCE_SHARED = "shared";

export function FilesPage({ person }: { person: Roster }) {
  const [query, setQuery] = useState("");
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState("household");
  const queryClient = useQueryClient();
  const { push } = useToast();

  const filesQuery = useQuery<VisibleFile[]>({ queryKey: ["files"], queryFn: () => api.files() });
  const peopleQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });

  const rows = filesQuery.data ?? [];
  const people = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const nameFor = (personId: string) => (personId === person.id ? "You" : (people.find((p) => p.id === personId)?.display_name ?? personId));

  const selectedGroup = (id: string) => selections[id] ?? new Set<string>();
  const setGroup = (id: string) => (next: Set<string>) => setSelections((current) => ({ ...current, [id]: next }));

  const accessors = useMemo(
    () => ({
      source: (row: VisibleFile) => (row.shared ? SOURCE_SHARED : SOURCE_MINE),
      kind: (row: VisibleFile) => kindStyle(row.file.kind).label,
      owner: (row: VisibleFile) => (row.owner_person_id === person.id ? "You" : (people.find((p) => p.id === row.owner_person_id)?.display_name ?? row.owner_person_id)),
      id: (row: VisibleFile) => row.file.id,
      name: (row: VisibleFile) => row.file.id,
    }),
    [people, person.id],
  );

  const filteredRows = applyFilters(rows, query, selections, accessors);

  const groups: FilterGroup[] = [
    {
      id: "source",
      title: "Whose",
      options: [
        { id: SOURCE_MINE, label: "Mine", count: rows.filter((r) => !r.shared).length },
        { id: SOURCE_SHARED, label: "Shared with me", count: rows.filter((r) => r.shared).length },
      ],
      selected: selectedGroup("source"),
      onChange: setGroup("source"),
    },
    { id: "kind", title: "Kind", options: countFilterOptions(rows, accessors.kind), selected: selectedGroup("kind"), onChange: setGroup("kind") },
  ];

  const columns: ThingsTableColumn<VisibleFile>[] = [
    {
      key: "name",
      header: "File",
      render: (row) => {
        const style = kindStyle(row.file.kind);
        return (
          <div className="flex min-w-0 items-center gap-2">
            <IconTile icon={style.icon} hue="--hue-blue" size="sm" glow={false} />
            <span className="truncate">{row.file.media_type}</span>
          </div>
        );
      },
    },
    { key: "owner", header: "Owner", render: (row) => nameFor(row.owner_person_id) },
    { key: "kind", header: "Kind", render: (row) => kindStyle(row.file.kind).label },
    { key: "size", header: "Size", align: "right", compact: true, render: (row) => formatBytes(row.file.size) },
  ];

  const selected = rows.find((row) => row.file.id === selectedId) ?? null;
  const canManageSelected = selected !== null && !selected.shared;

  const sharesQuery = useQuery({
    queryKey: ["file-shares", selectedId],
    queryFn: () => api.fileShares(selectedId!),
    enabled: canManageSelected && selectedId !== null,
  });

  const shareTargetOptions = useMemo(() => ["household", ...people.filter((p) => p.id !== person.id).map((p) => p.id)], [people, person.id]);
  const shareTargetLabel = (id: string) => (id === "household" ? "The whole household" : nameFor(id));

  async function shareSelected() {
    if (!selected) return;
    try {
      await api.shareFile(selected.file.id, shareTarget);
      await queryClient.invalidateQueries({ queryKey: ["file-shares", selected.file.id] });
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Could not share that file.");
    }
  }

  async function unshare(shareId: string) {
    try {
      await api.unshare(shareId);
      await queryClient.invalidateQueries({ queryKey: ["file-shares", selectedId] });
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Could not unshare that file.");
    }
  }

  return (
    <Page title="Library" hideTitle>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AsyncState
          data={filesQuery.data}
          error={filesQuery.isError}
          isFetching={filesQuery.isFetching}
          onRetry={() => filesQuery.refetch()}
          errorMessage={filesQuery.error instanceof ApiError ? filesQuery.error.message : "Could not load your Library."}
          loadingLabel="Loading your files"
        >
          {() => (
            <ThingsPage
              filter={{ search: { value: query, onChange: setQuery, placeholder: "Search your Library" }, groups, onClear: () => { setQuery(""); setSelections({}); } }}
              table={
                <ThingsTable
                  columns={columns}
                  rows={filteredRows}
                  getStatus={(): ThingStatus => "ready"}
                  getKey={(row) => row.file.id}
                  onRowClick={(row) => setSelectedId(row.file.id)}
                  selectedKey={selectedId ?? undefined}
                  empty="Nothing here yet."
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
          icon={kindStyle(selected.file.kind).icon}
          hue="--hue-blue"
          name={selected.file.media_type}
          identifier={selected.file.id}
          status="ready"
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: (
                <div className="flex flex-col gap-4">
                  <KeyValueList
                    items={[
                      { label: "Owner", value: nameFor(selected.owner_person_id) },
                      { label: "Kind", value: kindStyle(selected.file.kind).label },
                      { label: "Size", value: formatBytes(selected.file.size) },
                      { label: "Retention", value: selected.file.retention === "kept" ? "Kept until deleted" : "Follows the conversation" },
                    ]}
                  />
                  {canManageSelected && (
                    <div className="flex flex-col gap-2 border-t pt-3">
                      <div className="text-sm font-medium">Shared with</div>
                      {(sharesQuery.data ?? []).length === 0 && <div className="text-sm text-muted-foreground">Not shared with anyone yet.</div>}
                      {(sharesQuery.data ?? []).map((share) => (
                        <div key={share.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm">{shareTargetLabel(share.to)}</span>
                          <Button size="sm" variant="ghost" onClick={() => unshare(share.id)}>
                            Unshare
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-2">
                        <Select aria-label="Share with" value={shareTarget} onValueChange={setShareTarget} options={shareTargetOptions} getLabel={shareTargetLabel} />
                        <Button size="sm" onClick={() => void shareSelected()}>
                          Share
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}
    </Page>
  );
}
