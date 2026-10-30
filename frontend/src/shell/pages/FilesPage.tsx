import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { getIcon } from "@maipai/ui/src/icons";
import { HitField } from "@maipai/ui/src/settings/HitField";
import { formatBytes } from "@maipai/ui/src/format";
import { useIsPhoneLayout } from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { SectionSidebar, SectionSidebarDrawerSections, SectionSidebarShowButton, type SectionSidebarGroup, type SectionSidebarItem } from "@maipai/ui/src/primitives/SectionSidebar";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { BatchBar, SelectModeToggle } from "@maipai/ui/src/primitives/BatchBar";
import { CardSizeSlider, useCardSize } from "@maipai/ui/src/primitives/CardSizeSlider";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { api, ApiError, type LibraryItem, type LibraryQuery, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { useDrawerSections } from "@/shell/drawerSections";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { readLibrarySidebarCollapsed, writeLibrarySidebarCollapsed } from "@/shell/library/librarySidebarPreference";
import {
  SECTIONS, SORT_LABELS, canAddFiles, canShareFiles, filterAllowed, filtersOf, parseView, queryOf, sectionOf, viewParams,
  type LibraryView, type SectionId, type SortId,
} from "@/shell/library/libraryModel";
import { batchSentence, useLibraryActions } from "@/shell/library/useLibraryActions";
import { LibraryItems, type ItemActions } from "@/shell/library/LibraryItems";
import { LibraryViewer } from "@/shell/library/LibraryViewer";
import { LibraryShareDialog } from "@/shell/library/LibraryShareDialog";
import { LibraryTrash } from "@/shell/library/LibraryTrash";
import { LibraryStorage } from "@/shell/library/LibraryStorage";
import { UploadTray, useLibraryUploads } from "@/shell/library/LibraryUploads";

export const FilesIcon = getIcon("folder");
const UploadIcon = getIcon("upload-cloud");
const LIBRARY_UPLOAD_EVENT = "maipai:library-upload";
let libraryCanAdd = false;
const libraryHeaderListeners = new Set<() => void>();
function publishLibraryCanAdd(value: boolean) { if (libraryCanAdd === value) return; libraryCanAdd = value; for (const listener of libraryHeaderListeners) listener(); }
function subscribeLibraryHeader(listener: () => void) { libraryHeaderListeners.add(listener); return () => libraryHeaderListeners.delete(listener); }
function libraryHeaderSnapshot() { return libraryCanAdd; }
function LibraryHeaderAction() {
  const canUpload = useSyncExternalStore(subscribeLibraryHeader, libraryHeaderSnapshot, libraryHeaderSnapshot);
  return <><Button type="button" onClick={() => window.dispatchEvent(new Event(LIBRARY_UPLOAD_EVENT))}>{canUpload ? <UploadIcon aria-hidden className="size-4" /> : null}{canUpload ? "Upload" : "Ask to add a file"}</Button></>;
}
const GridIcon = getIcon("layout-grid");
const ListIcon = getIcon("layout-list");

const LG_QUERY = "(min-width: 1024px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const query = window.matchMedia(LG_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(LG_QUERY).matches,
    () => false,
  );
}
const editable = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
const itemsWord = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
const CHILD_ADD = "Ask a grown-up to add this file. Adding files to the Library is turned off for your profile.";

/** The Library: a Dropbox-style page. Sections, search, filters and sort are all in the address; the hub does the filtering
 * and paging; the kit draws the tiles, the table, the viewer and the share dialog. No folders. */
export function FilesPage({ person }: { person: Roster }) {
  useHeaderExtra(PageHeaderTitle, LibraryHeaderAction);
  useTabItem("Library");
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);
  const wide = useWide();
  const phone = useIsPhoneLayout();
  const [cardSize, setCardSize] = useCardSize("library");
  const actions = useLibraryActions(person.id);
  const canAdd = canAddFiles(person);
  useEffect(() => { publishLibraryCanAdd(canAdd); return () => publishLibraryCanAdd(false); }, [canAdd]);
  const canShare = canShareFiles(person);

  const update = useCallback((change: Partial<LibraryView>, replace = true) => {
    const next = { ...view, ...change };
    if (!filterAllowed(next.section, next.filter)) next.filter = "any";
    setParams(viewParams(next), { replace });
  }, [view, setParams]);

  // Search: the field keeps its own text and the address follows a moment later.
  const [searchText, setSearchText] = useState(view.q);
  useEffect(() => { setSearchText(view.q); }, [view.q]);
  useEffect(() => {
    if (searchText === view.q) return;
    const timer = window.setTimeout(() => update({ q: searchText }), 250);
    return () => window.clearTimeout(timer);
  }, [searchText, view.q, update]);

  const trashView = view.section === "trash";
  const query: LibraryQuery = useMemo(() => queryOf(view), [view]);
  const list = useInfiniteQuery({
    queryKey: ["library", query],
    queryFn: ({ pageParam }) => api.library({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "" as string,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !trashView,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages ?? []).flatMap((page) => page.items).filter((item) => !seen.has(item.id) && seen.add(item.id));
  }, [list.data]);
  const summary = useQuery({ queryKey: ["library-summary", filtersOf(query)], queryFn: () => api.librarySummary(query) });
  const everything = useQuery({ queryKey: ["library-summary", {}], queryFn: () => api.librarySummary({}) });
  const withMe = useQuery({ queryKey: ["library-summary", { shared: "with-me" }], queryFn: () => api.librarySummary({ shared: "with-me" }) });
  const byMe = useQuery({ queryKey: ["library-summary", { shared: "by-me" }], queryFn: () => api.librarySummary({ shared: "by-me" }), enabled: person.role !== "child" });
  const onlyMe = useQuery({ queryKey: ["library-summary", { shared: "none" }], queryFn: () => api.librarySummary({ shared: "none" }) });
  const trash = useQuery({ queryKey: ["library-trash"], queryFn: () => api.libraryTrash(), enabled: trashView });
  const trashRows = (trash.data?.rows ?? []).filter((row) => row.kind === "file");

  // Selection.
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [confirm, setConfirm] = useState<LibraryItem[] | null>(null);
  const [renaming, setRenaming] = useState<LibraryItem | null>(null);
  const [renameText, setRenameText] = useState("");
  const [sharing, setSharing] = useState<LibraryItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const leaveSelection = useCallback(() => { setSelecting(false); setSelected([]); }, []);
  useEffect(() => { leaveSelection(); }, [view.section, view.filter, view.q, leaveSelection]);

  // A link to one file (`?file=<id>`) that is not on the loaded page is fetched on its own and drawn from its record.
  const deepId = view.file;
  const loaded = deepId !== null && items.some((item) => item.id === deepId);
  // The listing has no route for one item, so a link first pages on through the list (up to 12 pages) to find it with its
  // name and sharing; only then does it fall back to the file's own record.
  const pagesLoaded = list.data?.pages.length ?? 0;
  const searchingDeep = deepId !== null && !loaded && !trashView && (list.isPending || (list.hasNextPage && pagesLoaded < 12));
  useEffect(() => {
    if (searchingDeep && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [searchingDeep, list]);
  const deep = useQuery({ queryKey: ["library-file", deepId], queryFn: () => api.libraryFile(deepId!), enabled: deepId !== null && !loaded && !searchingDeep, retry: false });
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: deep.data !== undefined });
  const deepItem = useMemo<LibraryItem | null>(() => deep.data && deepId ? {
    id: deep.data.id, kind: deep.data.kind === "image" || deep.data.kind === "video" || deep.data.kind === "audio" || deep.data.kind === "document" || deep.data.kind === "story" ? deep.data.kind : "file",
    name: ({ image: "Picture", video: "Video", audio: "Song", document: "Document" } as Record<string, string>)[deep.data.kind] ?? "File",
    media_type: deep.data.media_type, size_bytes: deep.data.size, created_at: deep.data.created_at,
    owner: { id: deep.data.owner_person_id, display_name: deep.data.owner_person_id === person.id ? person.display_name : people.data?.find((entry) => entry.id === deep.data!.owner_person_id)?.display_name ?? "Someone in your home" },
    shared_with: { count: 0, household: false }, retention: deep.data.retention, chat_id: null, can_edit: false, audience: null, duration_seconds: null,
    thumb_url: `/api/files/${deep.data.id}/thumb?w=320`, expires_at: null, version_count: 1,
  } : null, [deep.data, deepId, people.data, person.id, person.display_name]);
  const viewerList = useMemo(() => (deepItem && !loaded ? [deepItem, ...items] : items), [deepItem, loaded, items]);
  useEffect(() => {
    if (deep.isError && deepId) {
      toast.error(deep.error instanceof ApiError && deep.error.message ? deep.error.message : "That file is not available to you. Ask the person who added it to share it again.");
      update({ file: null });
    }
  }, [deep.isError, deep.error, deepId, update]);

  const closeViewer = useCallback(() => update({ file: null }), [update]);

  const doTrash = useCallback(async (targets: readonly LibraryItem[]) => {
    setBusy(true);
    try {
      const result = await actions.trash(targets);
      leaveSelection(); setConfirm(null);
      if (result.done.includes(view.file ?? "")) closeViewer();
      const sentence = batchSentence(result, (count) => `${count === 1 ? `'${targets.find((item) => item.id === result.done[0])?.name ?? "File"}'` : `${count} files`} moved to Trash. Kept 30 days`, result.done.length ? "could not be moved" : "could not be moved to Trash");
      const done = [...result.done];
      if (done.length > 0) toast(sentence, { action: { label: "Undo", onClick: () => { void actions.restore(done).then((back) => { if (back.refused.length) toast.error(batchSentence(back, (count) => `${count} restored`, "could not be restored")); }); } } });
      else toast.error(sentence);
    } finally { setBusy(false); }
  }, [actions, closeViewer, leaveSelection, view.file]);

  const requestTrash = useCallback((targets: readonly LibraryItem[]) => {
    const own = targets.filter((item) => item.owner.id === person.id);
    if (own.length === 0) { toast.error("That file is not yours to delete. Ask the person who added it."); return; }
    const sharedOne = own.length === 1 && (own[0]!.shared_with.count > 0 || own[0]!.shared_with.household);
    if (own.length === 1 && !sharedOne && targets.length === 1) void doTrash(own);
    else setConfirm([...targets]);
  }, [doTrash, person.id]);

  const itemActions: ItemActions = useMemo(() => ({
    open: (item) => update({ file: item.id }, false),
    rename: (item) => { setRenaming(item); setRenameText(item.name); },
    keep: (item) => { void actions.keep([item]).then((result) => result.refused.length ? toast.error(batchSentence(result, () => "", "could not be kept")) : toast(`'${item.name}' is kept until you delete it.`)); },
    share: (item) => setSharing([item]),
    trash: (item) => requestTrash([item]),
    recheck: (item) => {
      toast("Checking the picture. This can take a minute.");
      void actions.recheck(item.id).then(() => toast.success(`'${item.name}' is now marked all-ages.`)).catch((error: unknown) => toast.error(actions.reason(error)));
    },
  }), [actions, requestTrash, update]);

  // Upload: the button, a dropped file, a pasted picture.
  const uploads = useLibraryUploads(useCallback(() => { void actions.refresh(); }, [actions]));
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const openUpload = () => { if (canAdd) fileInput.current?.click(); else toast(CHILD_ADD); };
    window.addEventListener(LIBRARY_UPLOAD_EVENT, openUpload);
    return () => window.removeEventListener(LIBRARY_UPLOAD_EVENT, openUpload);
  }, [canAdd]);
  const [dragging, setDragging] = useState(false);
  const addFiles = (files: readonly File[]) => { if (!canAdd) toast.error(CHILD_ADD); else uploads.add(files); };
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target)) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0 && canAdd) uploads.add(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canAdd, uploads]);

  // Keyboard: / searches, S selects, Delete moves to Trash.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
      const modal = document.querySelector('[role="dialog"], [role="alertdialog"]');
      if (event.key === "/" && !modal) {
        // The column's search field is hidden until its header icon opens it (as Chat's is); the icon's click opens it and the column focuses it.
        event.preventDefault();
        const field = document.querySelector<HTMLInputElement>('input[type="search"][aria-label="Search your Library"]');
        if (field) field.focus();
        else document.querySelector<HTMLButtonElement>('[data-slot="section-sidebar-search"][aria-label="Search your Library"]')?.click();
      } else if ((event.key === "s" || event.key === "S") && !modal && !trashView) {
        event.preventDefault(); setSelecting((on) => { if (on) setSelected([]); return !on; });
      } else if (event.key === "Delete") {
        const viewing = view.file ? viewerList.find((item) => item.id === view.file) : undefined;
        if (viewing) { event.preventDefault(); requestTrash([viewing]); }
        else if (selectedItems.length > 0 && !modal) { event.preventDefault(); requestTrash(selectedItems); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestTrash, selectedItems, trashView, view.file, viewerList]);

  // The infinite page: the next 60 load as the end comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError } = list;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchNextPageError || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError, items.length]);

  const counts: Record<SectionId, number | undefined> = {
    all: everything.data?.items, pictures: everything.data?.per_kind.image?.items, videos: everything.data?.per_kind.video?.items,
    songs: everything.data?.per_kind.audio?.items, documents: everything.data?.per_kind.document?.items,
    "shared-with-me": withMe.data?.items, "shared-by-me": byMe.data?.items, "only-me": onlyMe.data?.items, trash: everything.data?.trash.items,
  };
  const sections = SECTIONS.filter((section) => !(section.id === "shared-by-me" && person.role === "child"));
  const goSectionRef = useRef<(id: SectionId) => void>(() => {});
  goSectionRef.current = (id) => update({ section: id, file: null }, false);
  const goSection = (id: SectionId) => goSectionRef.current(id);
  const countsKey = JSON.stringify(counts);
  const groups = useMemo<SectionSidebarGroup[]>(() => {
    const row = (id: SectionId): SectionSidebarItem => {
      const section = sectionOf(id);
      const count = counts[id];
      return {
        id, label: section.label, icon: section.icon, active: view.section === id,
        href: `/files${id === "all" ? "" : `?section=${id}`}`,
        onClick: (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
          event.preventDefault(); goSectionRef.current(id);
        },
        ...(count !== undefined ? { trailing: <span className="text-base text-muted-foreground tabular-nums">{count}</span> } : {}),
      };
    };
    const ids = sections.map((section) => section.id);
    return [
      { id: "kinds", items: ids.slice(0, 5).map(row) },
      { id: "more", items: ids.slice(5).map(row) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.section, countsKey, person.role]);
  const footer = useMemo<SectionSidebarItem[]>(() => [{ id: "settings", label: "Settings", icon: "settings", href: "/settings" }], []);
  const drawer = useMemo(() => <SectionSidebarDrawerSections groups={groups} footer={footer} />, [groups, footer]);
  useDrawerSections(drawer);
  const [collapsed, setCollapsedState] = useState(() => readLibrarySidebarCollapsed(person.id));
  const setCollapsed = (next: boolean) => { setCollapsedState(next); writeLibrarySidebarCollapsed(person.id, next); };

  const current = trashView ? undefined : summary.data;
  const headline = trashView ? (trashRows.length > 0 || trash.data ? itemsWord(trashRows.length) : "") : current ? `${itemsWord(current.items)} · ${formatBytes(current.bytes)}` : "";
  const filtersOn = view.q.trim() !== "" || view.filter !== "any";
  const searchField = (
    <Input type="search" aria-label="Search your Library" placeholder="Search your Library" value={searchText} onChange={(event) => setSearchText(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape" && searchText) { event.preventDefault(); setSearchText(""); } }} />
  );

  const loadError = (message: string, retry: () => void) => (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="destructive" role="alert"><AlertDescription>{message}</AlertDescription></Alert>
      <Button type="button" variant="secondary" onClick={retry}>Try again</Button>
    </div>
  );
  const status = (() => {
    if (trashView) {
      if (trash.isError) return loadError("Home could not load your Trash. Check that Home is running, then try again.", () => void trash.refetch());
      if (!trash.data) return <RouteSkeleton label="Loading your files" />;
      return <LibraryTrash rows={trashRows} busy={busy} onRestore={(ids) => { setBusy(true); void actions.restore(ids).then((r) => toast(batchSentence(r, (n) => `${n === 1 ? "File" : `${n} files`} restored`, "could not be restored"))).finally(() => setBusy(false)); }}
        onPurge={(ids) => { setBusy(true); void actions.purge(ids).then((r) => toast(batchSentence(r, (n) => `${n === 1 ? "File" : `${n} files`} deleted forever`, "could not be deleted"))).finally(() => setBusy(false)); }} />;
    }
    if (list.isError && !list.isFetchNextPageError) return loadError(list.error instanceof ApiError && list.error.message ? list.error.message : "Home could not load your Library. Check that Home is running, then try again.", () => void list.refetch());
    if (list.isPending) return <RouteSkeleton label="Loading your files" />;
    if (items.length === 0) {
      if (filtersOn) return <EmptyState icon="search" text="No matches. Try a different word or clear a filter." actionLabel="Clear filters" onAction={() => { setSearchText(""); update({ q: "", filter: "any" }); }} />;
      if (view.section === "all") return <EmptyState icon="folder" text="Nothing here yet. Pictures, videos and songs you make in chat land here, along with files you upload. Drop a file anywhere on this page to add it." />;
      return <EmptyState icon={sectionOf(view.section).icon} text={`Nothing in ${sectionOf(view.section).label} yet.`} actionLabel="Show all files" onAction={() => goSection("all")} />;
    }
    return (
      <div className="flex flex-col gap-4" style={{ "--maipai-card-size": `${cardSize}px` } as CSSProperties}>
        <LibraryItems items={items} me={person} layout={view.layout} phone={phone} selectedIds={selected} onSelectionChange={setSelected} selectionMode={selecting}
          onExitSelectionMode={leaveSelection} actions={itemActions} sort={view.sort} onSort={(sort) => update({ sort })} />
        {list.isFetchNextPageError ? loadError("Home could not load more files. Check that Home is running, then try again.", () => void fetchNextPage()) : null}
        {hasNextPage ? <div ref={sentinel} className="flex justify-center"><Button type="button" variant="secondary" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? "Loading more files" : "Show more files"}</Button></div> : null}
      </div>
    );
  })();

  const batchActions = (
    <>
      {canShare ? <Button type="button" variant="secondary" disabled={selectedItems.length === 0} onClick={() => setSharing(selectedItems)}>Share</Button> : null}
      <Button type="button" variant="secondary" disabled={selectedItems.length === 0 || busy} onClick={() => { setBusy(true); void actions.keep(selectedItems).then((result) => { toast(batchSentence(result, (n) => `${n} kept until you delete ${n === 1 ? "it" : "them"}`, "could not be kept")); leaveSelection(); }).finally(() => setBusy(false)); }}>Keep</Button>
      <Button type="button" variant="destructive" disabled={selectedItems.length === 0 || busy} onClick={() => requestTrash(selectedItems)}>Delete</Button>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1" data-workspace-fill="" data-testid="library-page"
      onDragOver={(event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => { setDragging(false); const files = Array.from(event.dataTransfer?.files ?? []); if (files.length > 0) { event.preventDefault(); addFiles(files); } }}>
      <SectionSidebar standalone groups={groups} footer={footer} footerSlot={<div className="px-3 pb-2"><LibraryStorage me={person} /></div>} density="compact" collapsedStyle="hidden" collapsed={collapsed} onCollapsedChange={setCollapsed}
        sidebarProps={{ id: "library-sidebar" }}
        search={{ value: searchText, onChange: setSearchText, label: "Search your Library", onSubmit: () => update({ q: searchText }) }} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {wide && collapsed ? <SectionSidebarShowButton onClick={() => setCollapsed(false)} controls="library-sidebar" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{sectionOf(view.section).label}</h1>
            <p className="text-base text-muted-foreground" aria-live="polite">{headline}</p>
          </div>
          <input ref={fileInput} type="file" multiple hidden aria-label="Choose files to add" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length > 0) addFiles(files); }} />
        </div>

        {!wide ? (
          <div role="group" aria-label="Library sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {sections.map((section) => <div key={section.id} className="shrink-0"><Button type="button" variant={view.section === section.id ? "secondary" : "outline"} aria-pressed={view.section === section.id} onClick={() => goSection(section.id)}>{section.label}</Button></div>)}
          </div>
        ) : null}
        {!wide && !trashView ? <HitField pad={10}>{searchField}</HitField> : null}

        {!trashView ? (
          <div className="flex flex-wrap items-center gap-3">
            {filterAllowed(view.section, "mine") ? <div role="group" aria-label="Filters"><Button type="button" variant={view.filter === "mine" ? "secondary" : "outline"} aria-pressed={view.filter === "mine"} onClick={() => update({ filter: view.filter === "mine" ? "any" : "mine" })}>Mine</Button></div> : null}
            <div className="sm:ml-auto"><Select aria-label="Sort by" value={view.sort} onValueChange={(value) => update({ sort: value as SortId })} options={Object.keys(SORT_LABELS)} getLabel={(value) => SORT_LABELS[value as SortId]} /></div>
            {view.layout === "grid" && !phone ? <CardSizeSlider size={cardSize} onChange={setCardSize} label="Tile size" /> : null}
            <div role="group" aria-label="Layout" className="flex gap-1">
              <Button type="button" variant={view.layout === "grid" ? "secondary" : "ghost"} size="icon" aria-pressed={view.layout === "grid"} aria-label="Grid view" onClick={() => update({ layout: "grid" })}><GridIcon aria-hidden className="size-4" /></Button>
              <Button type="button" variant={view.layout === "list" ? "secondary" : "ghost"} size="icon" aria-pressed={view.layout === "list"} aria-label="List view" onClick={() => update({ layout: "list" })}><ListIcon aria-hidden className="size-4" /></Button>
            </div>
            {!selecting && selected.length === 0 ? <SelectModeToggle label="Select" onClick={() => setSelecting(true)} /> : null}
          </div>
        ) : null}

        {selecting || selected.length > 0 ? <BatchBar count={selected.length} onExit={leaveSelection}>{batchActions}</BatchBar> : null}
        {confirm ? (
          <DestructiveConfirm
            message={confirm.length === 1 ? `Delete '${confirm[0]!.name}'?` : `Move ${confirm.length} files to Trash?`}
            detail={`${confirm.some((item) => item.shared_with.household) ? "It is shared with everyone in the home. " : confirm.some((item) => item.shared_with.count > 0) ? "Some of it is shared with people in your home. " : ""}${confirm.some((item) => item.shared_with.count > 0 || item.shared_with.household) ? "They lose access now. " : ""}You can get it back from Trash for 30 days.`}
            confirmLabel="Move to Trash" busyLabel="Moving" busy={busy} cancelLabel="Keep it"
            onConfirm={() => void doTrash(confirm)} onCancel={() => setConfirm(null)} />
        ) : null}

        <UploadTray cards={uploads.cards} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.dismiss} />
        {dragging ? <div role="status" className="rounded-lg border-2 border-dashed border-primary p-6 text-center text-base">Drop to add to your Library</div> : null}
        {status}
        {!wide ? <div className="max-w-xl"><LibraryStorage me={person} /></div> : null}
      </div>

      <LibraryViewer phone={phone} items={viewerList} me={person} currentId={view.file} onCurrentIdChange={(id) => update({ file: id })} onClose={closeViewer} actions={itemActions} />
      {sharing ? <LibraryShareDialog items={sharing} me={person} open onOpenChange={(open) => { if (!open) setSharing(null); }} /> : null}
      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent>
          <form onSubmit={(event) => {
            event.preventDefault();
            const target = renaming; if (!target) return;
            void actions.rename(target.id, renameText).then(() => { setRenaming(null); toast.success("Renamed."); }).catch((error: unknown) => toast.error(actions.reason(error)));
          }}>
            <DialogHeader><DialogTitle>Rename file</DialogTitle><DialogDescription>Leave it empty to go back to the name Home chose.</DialogDescription></DialogHeader>
            <label htmlFor="library-rename" className="text-base font-medium">Name</label>
            <Input id="library-rename" value={renameText} maxLength={1000} onChange={(event) => setRenameText(event.target.value)} />
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button type="submit">Save name</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
