// The items of one section, drawn as the kit's tile grid or as the kit's table. Both open the same per-item menu.
import { useMemo, type ReactElement } from "react";
import { FileGrid } from "@maipai/ui/src/primitives/FileGrid";
import type { FileTileData } from "@maipai/ui/src/primitives/FileTile";
import { DataTable, type DataTableColumn, type DataTableSort } from "@maipai/ui/src/elements/data-table";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { getIcon } from "@maipai/ui/src/icons";
import { formatBytes } from "@maipai/ui/src/format";
import { formatRelative } from "@maipai/ui/src/relativeTime";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { canShareFiles, extensionOf, fileKind, hasThumbnail, isAdultRole, ownerName, secondaryLine, spokenDetail, type SortId } from "./libraryModel";

const MoreIcon = getIcon("more-horizontal");

export interface ItemActions {
  open(item: LibraryItem): void;
  rename(item: LibraryItem): void;
  keep(item: LibraryItem): void;
  share(item: LibraryItem): void;
  trash(item: LibraryItem): void;
  recheck(item: LibraryItem): void;
}

/** What the menu offers. The hub refuses the rest again, so this only keeps the menu short. */
export function itemMenu(item: LibraryItem, me: Roster, actions: ItemActions) {
  const mine = item.owner.id === me.id;
  return (
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => actions.open(item)}>Open</DropdownMenuItem>
      <DropdownMenuItem asChild><a href={api.fileContentUrl(item.id)} download={item.name}>Download</a></DropdownMenuItem>
      {mine && canShareFiles(me) ? <DropdownMenuItem onSelect={() => actions.share(item)}>Share</DropdownMenuItem> : null}
      {mine ? <DropdownMenuItem onSelect={() => actions.rename(item)}>Rename</DropdownMenuItem> : null}
      {mine && item.retention !== "kept" ? <DropdownMenuItem onSelect={() => actions.keep(item)}>Keep</DropdownMenuItem> : null}
      {mine && isAdultRole(me) && item.kind === "image" && item.audience === "adult-only" ? <DropdownMenuItem onSelect={() => actions.recheck(item)}>Mark all-ages</DropdownMenuItem> : null}
      {mine ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => actions.trash(item)}>Delete</DropdownMenuItem></> : null}
    </DropdownMenuContent>
  );
}

export function tileOf(item: LibraryItem, me: Roster): FileTileData {
  const extension = extensionOf(item);
  return {
    id: item.id,
    name: item.name,
    kind: fileKind(item.kind),
    thumbnailUrl: hasThumbnail(item) ? item.thumb_url : null,
    ...(extension ? { extension } : {}),
    durationSeconds: item.duration_seconds,
    secondary: secondaryLine(item, me),
    description: spokenDetail(item, me),
    sharedWith: item.shared_with.household ? [{ id: "household", name: "everyone in the home", seed: "household" }] : [],
  };
}

interface ItemsProps {
  items: readonly LibraryItem[];
  me: Roster;
  layout: "grid" | "list";
  phone: boolean;
  selectedIds: readonly string[];
  onSelectionChange: (ids: string[]) => void;
  selectionMode: boolean;
  onExitSelectionMode: () => void;
  actions: ItemActions;
  sort: SortId;
  onSort: (sort: SortId) => void;
}

const SORT_TO_TABLE: Record<SortId, DataTableSort> = {
  newest: { columnId: "modified", direction: "desc" }, oldest: { columnId: "modified", direction: "asc" },
  name: { columnId: "name", direction: "asc" }, size: { columnId: "size", direction: "desc" },
};

function NameCell({ item }: { item: LibraryItem }) {
  const Icon = getIcon({ image: "camera", video: "film", audio: "music", document: "file-text" }[fileKind(item.kind) as string] ?? "box");
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-5" />
        {hasThumbnail(item) ? <img src={item.thumb_url} alt="" width={48} height={48} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} className="absolute inset-0 size-full object-cover" /> : null}
      </span>
      <span className="min-w-0 truncate text-base font-medium text-foreground">{item.name}</span>
    </span>
  );
}

export function LibraryItems({ items, me, layout, phone, selectedIds, onSelectionChange, selectionMode, onExitSelectionMode, actions, sort, onSort }: ItemsProps) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const tiles = useMemo(() => items.map((item) => tileOf(item, me)), [items, me]);

  if (layout === "grid") {
    return (
      <>
      <FileGrid
        items={tiles}
        label="Library files"
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        selectionMode={selectionMode}
        onExitSelectionMode={onExitSelectionMode}
        onOpen={(id) => { const item = byId.get(id); if (item) actions.open(item); }}
        wrapActions={(id, button: ReactElement) => {
          const item = byId.get(id);
          return item ? <DropdownMenu><DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>{itemMenu(item, me, actions)}</DropdownMenu> : button;
        }}
        density={phone ? "compact" : "slider"}
      />
      </>
    );
  }
  const columns: DataTableColumn<LibraryItem>[] = [
    { id: "name", header: "Name", sortable: true, cell: (item) => <NameCell item={item} />, minWidth: 220 },
    { id: "type", header: "Type", minWidth: 80, cell: (item) => extensionOf(item) ?? fileKind(item.kind) },
    { id: "size", header: "Size", align: "end", sortable: true, minWidth: 88, cell: (item) => formatBytes(item.size_bytes) },
    { id: "owner", header: "Owner", minWidth: 96, cell: (item) => ownerName(item, me) },
    { id: "shared", header: "Shared with", minWidth: 120, cell: (item) => item.shared_with.household ? "Everyone in the home" : item.shared_with.count > 0 ? `${item.shared_with.count} ${item.shared_with.count === 1 ? "person" : "people"}` : "Only the owner" },
    // The menu lives in the last cell: the table gives the header no matching actions cell, so a separate one would push every column out of line.
    { id: "modified", header: "Added", sortable: true, minWidth: 168, cell: (item) => (
      <span className="flex items-center justify-between gap-2">
        <span>{formatRelative(item.created_at)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${item.name}`}><MoreIcon aria-hidden className="size-4" /></Button>
          </DropdownMenuTrigger>
          {itemMenu(item, me, actions)}
        </DropdownMenu>
      </span>
    ) },
  ];
  return (
    <>
    <DataTable
      rows={items}
      columns={columns}
      caption="Library files"
      getRowId={(item) => item.id}
      getRowLabel={(item) => item.name}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      selectionMode={selectionMode}
      sort={SORT_TO_TABLE[sort]}
      onSortChange={(next) => {
        if (!next) return onSort("newest");
        onSort(next.columnId === "name" ? "name" : next.columnId === "size" ? "size" : next.direction === "asc" ? "oldest" : "newest");
      }}
    />
    </>
  );
}
