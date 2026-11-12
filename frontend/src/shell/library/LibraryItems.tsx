import { i18n } from "@lingui/core";
// The items of one section, drawn as the kit's tile grid or as the kit's table. Both open the same per-item menu.
import { useMemo, type ReactElement } from "react";
import { FileGrid } from "@maipai/ui/src/primitives/FileGrid";
import type { FileTileData } from "@maipai/ui/src/primitives/FileTile";
import { DataTable, type DataTableColumn, type DataTableSort } from "@maipai/ui/src/elements/data-table";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { SafeImage, type ImageFallbackKind } from "@maipai/ui/src/primitives/SafeImage";
import { getIcon } from "@maipai/ui/src/icons";
import { formatBytes } from "@maipai/ui/src/format";
import { formatRelative } from "@/lib/time";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { canShareFiles, extensionOf, fileKind, hasThumbnail, isAdultRole, ownerName, secondaryLine, spokenDetail, type SortId } from "./libraryModel";

const MoreIcon = getIcon("more-horizontal");
const OpenLockIcon = getIcon("lock-open");

export interface ItemActions {
  open(item: LibraryItem): void;
  rename(item: LibraryItem): void;
  keep(item: LibraryItem): void;
  share(item: LibraryItem): void;
  trash(item: LibraryItem): void;
  recheck(item: LibraryItem): void;
  adultMark(item: LibraryItem): void;
  adultUnmark(item: LibraryItem): void;
}

/** What the menu offers. The hub refuses the rest again, so this only keeps the menu short. */
export function itemMenu(item: LibraryItem, me: Roster, actions: ItemActions) {
  const mine = item.owner.id === me.id;
  return (
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => actions.open(item)}>{i18n._({ id: "Open", message: "Open" })}</DropdownMenuItem>
      <DropdownMenuItem asChild><a href={api.fileContentUrl(item.id)} download={item.name}>{i18n._({ id: "Download", message: "Download" })}</a></DropdownMenuItem>
      {mine && canShareFiles(me) ? <DropdownMenuItem onSelect={() => actions.share(item)}>{i18n._({ id: "Share", message: "Share" })}</DropdownMenuItem> : null}
      {mine ? <DropdownMenuItem onSelect={() => actions.rename(item)}>{i18n._({ id: "Rename", message: "Rename" })}</DropdownMenuItem> : null}
      {mine && item.retention !== "kept" ? <DropdownMenuItem onSelect={() => actions.keep(item)}>{i18n._({ id: "Keep", message: "Keep" })}</DropdownMenuItem> : null}
      {mine && isAdultRole(me) && item.kind === "image" && item.audience === "adult-only" ? <DropdownMenuItem onSelect={() => actions.recheck(item)}>{i18n._({ id: "Mark all-ages", message: "Mark all-ages" })}</DropdownMenuItem> : null}
      {mine && item.adult?.can_mark ? <DropdownMenuItem onSelect={() => actions.adultMark(item)}>{i18n._({ id: "Lock", message: "Lock" })}</DropdownMenuItem> : null}
      {mine && item.adult?.can_clear ? <DropdownMenuItem onSelect={() => actions.adultUnmark(item)}>{i18n._({ id: "Remove lock", message: "Remove lock" })}</DropdownMenuItem> : null}
      {mine ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => actions.trash(item)}>{i18n._({ id: "Delete", message: "Delete" })}</DropdownMenuItem></> : null}
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
    secondary: item.unlocked
      ? <span className="inline-flex items-center gap-1"><OpenLockIcon aria-hidden className="size-3.5 shrink-0" /><span>{i18n._({ id: "Unlocked", message: "Unlocked" })} · {secondaryLine(item, me)}</span></span>
      : secondaryLine(item, me),
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

const THUMB_KIND: Record<string, ImageFallbackKind> = { image: "picture", video: "video", audio: "music", document: "file" };

export function NameCell({ item }: { item: LibraryItem }) {
  const kind = THUMB_KIND[fileKind(item.kind) as string] ?? "file";
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex size-12 shrink-0 overflow-hidden rounded-md">
        <SafeImage src={hasThumbnail(item) ? item.thumb_url : null} kind={kind} alt="" width={48} height={48} decoding="async" className="size-full object-cover" />
      </span>
      {item.unlocked ? <OpenLockIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
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
        captionOnArt
        items={tiles}
        label={i18n._({ id: "Library files", message: "Library files" })}
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
    { id: "shared", header: "Shared with", minWidth: 120, cell: (item) => item.shared_with.household ? "Everyone in the home" : item.shared_with.count > 0 ? i18n._({ id: "{count, plural, one {# person} other {# people}}", message: "{count, plural, one {# person} other {# people}}", values: { count: item.shared_with.count } }) : "Only the owner" },
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
      caption={i18n._({ id: "Library files", message: "Library files" })}
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
