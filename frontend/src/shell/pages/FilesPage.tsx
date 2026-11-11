import { errorLine } from "@/lib/hubReachability";
import { i18n } from "@lingui/core";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
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
import { StatusCard } from "@maipai/ui/src/elements/status-card";
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
import { LockTile } from "@maipai/ui/src/elements/adult-lock";
import { useAdultMark } from "@/apps/chat/useAdultMark";
import { LibraryShareDialog } from "@/shell/library/LibraryShareDialog";
import { LibraryTrash } from "@/shell/library/LibraryTrash";
import { LibraryStorage } from "@/shell/library/LibraryStorage";
import { UploadTray, useLibraryUploads } from "@/shell/library/LibraryUploads";
import { getIcon } from "@maipai/ui/src/icons";
import { Chip } from "@maipai/ui/src/primitives/Chip";

const UploadIcon = getIcon("upload-cloud");
const LIBRARY_UPLOAD_EVENT = "maipai:library-upload";
let libraryCanAdd = false;
const libraryHeaderListeners = new Set<() => void>();
function publishLibraryCanAdd(value: boolean) { if (libraryCanAdd === value) return; libraryCanAdd = value; for (const listener of libraryHeaderListeners) listener(); }
function subscribeLibraryHeader(listener: () => void) { libraryHeaderListeners.add(listener); return () => libraryHeaderListeners.delete(listener); }
function libraryHeaderSnapshot() { return libraryCanAdd; }
function LibraryHeaderAction() {
  const canUpload = useSyncExternalStore(subscribeLibraryHeader, libraryHeaderSnapshot, libraryHeaderSnapshot);
  return <><Button type="button" onClick={() => window.dispatchEvent(new Event(LIBRARY_UPLOAD_EVENT))}>{canUpload ? <UploadIcon aria-hidden className="size-4" /> : null}{canUpload ? i18n._({ id: "Upload", message: "Upload" }) : i18n._({ id: "Ask to add a file", message: "Ask to add a file" })}</Button></>;
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
const itemsWord = (count: number) => i18n._({ id: "{count, plural, one {# item} other {# items}}", message: "{count, plural, one {# item} other {# items}}", values: { count } });
const CHILD_ADD = () => i18n._({ id: "Ask a grown-up to add this file. Adding files to the Library is turned off for your profile.", message: "Ask a grown-up to add this file. Adding files to the Library is turned off for your profile." });

/** The Library: a Dropbox-style page. Sections, search, filters and sort are all in the address; the hub does the filtering
 * and paging; the kit draws the tiles, the table, the viewer and the share dialog. No folders. */
const restoreFailed = (count: number, reason: string) => i18n._({ id: "{count, plural, one {# could not be restored: {reason}.} other {# could not be restored: {reason}.}}", message: "{count, plural, one {# could not be restored: {reason}.} other {# could not be restored: {reason}.}}", values: { count, reason } });
const keepFailed = (count: number, reason: string) => i18n._({ id: "{count, plural, one {# could not be kept: {reason}.} other {# could not be kept: {reason}.}}", message: "{count, plural, one {# could not be kept: {reason}.} other {# could not be kept: {reason}.}}", values: { count, reason } });

/** The adult-lock removal dialog for one Library item, opened from the item's menu; it asks for the person's passcode, password or passkey. */
function UnmarkDialogHost({ item, refresh, onClosed }: { item: LibraryItem; refresh: () => void; onClosed: () => void }) {
  const host = useAdultMark({ confirmUnmark: api.confirmLibraryUnmark, adultMark: api.libraryAdultMark }, item, refresh, () => null, { startOpen: true, onClosed });
  return <>{host.dialog}</>;
}

export function FilesPage({ person }: { person: Roster }) {
  useHeaderExtra(PageHeaderTitle, LibraryHeaderAction);
  useTabItem(i18n._({ id: "Library", message: "Library" }));
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);
  const wide = useWide();
  const phone = useIsPhoneLayout();
  const [cardSize, setCardSize] = useCardSize("library");
  const actions = useLibraryActions(person.id);
  const [unmarkItem, setUnmarkItem] = useState<LibraryItem | null>(null);
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
  // First page only: an adult with no unlock proof and locked items in this view sees one Locked items tile (no count, no name).
  const hasLocked = list.data?.pages[0]?.locked === true;
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
  const [problem, setProblem] = useState("");
  const [renameProblem, setRenameProblem] = useState("");
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
    name: ({ image: i18n._({ id: "Picture", message: "Picture" }), video: i18n._({ id: "Video", message: "Video" }), audio: i18n._({ id: "Song", message: "Song" }), document: i18n._({ id: "Document", message: "Document" }) } as Record<string, string>)[deep.data.kind] ?? i18n._({ id: "File", message: "File" }),
    media_type: deep.data.media_type, size_bytes: deep.data.size, created_at: deep.data.created_at,
    owner: { id: deep.data.owner_person_id, display_name: deep.data.owner_person_id === person.id ? person.display_name : people.data?.find((entry) => entry.id === deep.data!.owner_person_id)?.display_name ?? i18n._({ id: "Someone in your home", message: "Someone in your home" }) },
    shared_with: { count: 0, household: false }, retention: deep.data.retention, chat_id: null, can_edit: false, audience: null, duration_seconds: null,
    thumb_url: `/api/files/${deep.data.id}/thumb?w=320`, expires_at: null, version_count: 1,
  } : null, [deep.data, deepId, people.data, person.id, person.display_name]);
  const viewerList = useMemo(() => (deepItem && !loaded ? [deepItem, ...items] : items), [deepItem, loaded, items]);
  useEffect(() => {
    if (deep.isError && deepId) {
      setProblem(errorLine(deep.error, i18n._({ id: "That file is not available to you. Ask the person who added it to share it again.", message: "That file is not available to you. Ask the person who added it to share it again." })));
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
      const sentence = batchSentence(result, (count) => count === 1 ? i18n._({ id: "‘{name}’ moved to Trash. Kept 30 days", message: "‘{name}’ moved to Trash. Kept 30 days", values: { name: targets.find((item) => item.id === result.done[0])?.name ?? i18n._({ id: "File", message: "File" }) } }) : i18n._({ id: "{count} files moved to Trash. Kept 30 days", message: "{count} files moved to Trash. Kept 30 days", values: { count } }), (count, reason) => result.done.length ? i18n._({ id: "{count, plural, one {# could not be moved: {reason}.} other {# could not be moved: {reason}.}}", message: "{count, plural, one {# could not be moved: {reason}.} other {# could not be moved: {reason}.}}", values: { count, reason } }) : i18n._({ id: "{count, plural, one {# could not be moved to Trash: {reason}.} other {# could not be moved to Trash: {reason}.}}", message: "{count, plural, one {# could not be moved to Trash: {reason}.} other {# could not be moved to Trash: {reason}.}}", values: { count, reason } }));
      const done = [...result.done];
      if (done.length > 0) toast(sentence, { action: { label: i18n._({ id: "Undo", message: "Undo" }), onClick: () => { void actions.restore(done).then((back) => { if (back.refused.length) setProblem(batchSentence(back, (count) => i18n._({ id: "{count} restored", message: "{count} restored", values: { count } }), restoreFailed)); }); } } });
      else setProblem(sentence);
    } finally { setBusy(false); }
  }, [actions, closeViewer, leaveSelection, view.file]);

  const requestTrash = useCallback((targets: readonly LibraryItem[]) => {
    const own = targets.filter((item) => item.owner.id === person.id);
    if (own.length === 0) { setProblem(i18n._({ id: "That file is not yours to delete. Ask the person who added it.", message: "That file is not yours to delete. Ask the person who added it." })); return; }
    const sharedOne = own.length === 1 && (own[0]!.shared_with.count > 0 || own[0]!.shared_with.household);
    if (own.length === 1 && !sharedOne && targets.length === 1) void doTrash(own);
    else setConfirm([...targets]);
  }, [doTrash, person.id]);

  const itemActions: ItemActions = useMemo(() => ({
    open: (item) => update({ file: item.id }, false),
    rename: (item) => { setRenameProblem(""); setRenaming(item); setRenameText(item.name); },
    keep: (item) => { void actions.keep([item]).then((result) => result.refused.length ? setProblem(batchSentence(result, () => "", keepFailed)) : toast(i18n._({ id: "‘{name}’ is kept until you delete it.", message: "‘{name}’ is kept until you delete it.", values: { name: item.name } }))); },
    share: (item) => setSharing([item]),
    trash: (item) => requestTrash([item]),
    recheck: (item) => {
      toast(i18n._({ id: "Checking the picture. This can take a minute.", message: "Checking the picture. This can take a minute." }));
      void actions.recheck(item.id).then(() => toast.success(i18n._({ id: "‘{name}’ is now marked all-ages.", message: "‘{name}’ is now marked all-ages.", values: { name: item.name } }))).catch((error: unknown) => setProblem(actions.reason(error)));
    },
    adultMark: (item) => {
      void api.libraryAdultMark(item.id, { action: "mark" }).then(() => actions.refresh()).then(() => toast.success(i18n._({ id: "‘{name}’ is locked.", message: "‘{name}’ is locked.", values: { name: item.name } }))).catch((error: unknown) => setProblem(actions.reason(error)));
    },
    adultUnmark: (item) => setUnmarkItem(item),
  }), [actions, requestTrash, update]);

  // Upload: the button, a dropped file, a pasted picture.
  const uploads = useLibraryUploads(useCallback(() => { void actions.refresh(); }, [actions]));
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const openUpload = () => { if (canAdd) fileInput.current?.click(); else toast(CHILD_ADD()); };
    window.addEventListener(LIBRARY_UPLOAD_EVENT, openUpload);
    return () => window.removeEventListener(LIBRARY_UPLOAD_EVENT, openUpload);
  }, [canAdd]);
  const [dragging, setDragging] = useState(false);
  const addFiles = (files: readonly File[]) => { if (!canAdd) setProblem(CHILD_ADD()); else uploads.add(files); };
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
        ...(count !== undefined && count > 0 ? { trailing: <span className="text-base text-muted-foreground tabular-nums">{count}</span> } : {}),
      };
    };
    const ids = sections.map((section) => section.id);
    return [
      { id: "kinds", items: ids.slice(0, 5).map(row) },
      { id: "more", items: ids.slice(5).map(row) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.section, countsKey, person.role]);
  const footer = useMemo<SectionSidebarItem[]>(() => [{ id: "settings", label: i18n._({ id: "Settings", message: "Settings" }), icon: "settings", href: "/settings" }], []);
  const drawer = useMemo(() => <SectionSidebarDrawerSections groups={groups} footer={footer} />, [groups, footer]);
  useDrawerSections(drawer);
  const [collapsed, setCollapsedState] = useState(() => readLibrarySidebarCollapsed(person.id));
  const setCollapsed = (next: boolean) => { setCollapsedState(next); writeLibrarySidebarCollapsed(person.id, next); };

  const current = trashView ? undefined : summary.data;
  const headline = trashView ? (trashRows.length > 0 || trash.data ? itemsWord(trashRows.length) : "") : current ? `${itemsWord(current.items)} · ${formatBytes(current.bytes)}` : "";
  const filtersOn = view.q.trim() !== "" || view.filter !== "any";
  const searchField = (
    <Input type="search" shape="pill" fill="surface" aria-label={i18n._({ id: "Search your Library", message: "Search your Library" })} placeholder={i18n._({ id: "Search your Library", message: "Search your Library" })} value={searchText} onChange={(event) => setSearchText(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape" && searchText) { event.preventDefault(); setSearchText(""); } }} />
  );

  const loadError = (message: string, retry: () => void) => (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="destructive" role="alert"><AlertDescription>{message}</AlertDescription></Alert>
      <Button type="button" variant="secondary" onClick={retry}>{i18n._({ id: "Try again", message: "Try again" })}</Button>
    </div>
  );
  const status = (() => {
    if (trashView) {
      if (trash.isError) return loadError(i18n._({ id: "Home could not load your Trash. Check that Home is running, then try again.", message: "Home could not load your Trash. Check that Home is running, then try again." }), () => void trash.refetch());
      if (!trash.data) return <RouteSkeleton label={i18n._({ id: "Loading your files", message: "Loading your files" })} />;
      return <LibraryTrash rows={trashRows} busy={busy} onRestore={(ids) => { setBusy(true); void actions.restore(ids).then((r) => toast(batchSentence(r, (n) => i18n._({ id: "{count, plural, one {File restored} other {# files restored}}", message: "{count, plural, one {File restored} other {# files restored}}", values: { count: n } }), restoreFailed))).finally(() => setBusy(false)); }}
        onPurge={(ids) => { setBusy(true); void actions.purge(ids).then((r) => toast(batchSentence(r, (n) => i18n._({ id: "{count, plural, one {File deleted forever} other {# files deleted forever}}", message: "{count, plural, one {File deleted forever} other {# files deleted forever}}", values: { count: n } }), (count, reason) => i18n._({ id: "{count, plural, one {# could not be deleted: {reason}.} other {# could not be deleted: {reason}.}}", message: "{count, plural, one {# could not be deleted: {reason}.} other {# could not be deleted: {reason}.}}", values: { count, reason } })))).finally(() => setBusy(false)); }} />;
    }
    if (list.isError && !list.isFetchNextPageError) return loadError(list.error instanceof ApiError && list.error.message ? list.error.message : i18n._({ id: "Home could not load your Library. Check that Home is running, then try again.", message: "Home could not load your Library. Check that Home is running, then try again." }), () => void list.refetch());
    if (list.isPending) return <RouteSkeleton label={i18n._({ id: "Loading your files", message: "Loading your files" })} />;
    const lockTile = hasLocked ? <div className="max-w-sm"><LockTile shape="card" /></div> : null;
    if (items.length === 0 && lockTile) return lockTile;
    if (items.length === 0) {
      if (filtersOn) return <EmptyState variant="tile" icon="search" text={i18n._({ id: "No matches. Try a different word or clear a filter.", message: "No matches. Try a different word or clear a filter." })} actionLabel={i18n._({ id: "Clear filters", message: "Clear filters" })} onAction={() => { setSearchText(""); update({ q: "", filter: "any" }); }} />;
      if (view.section === "all") return <EmptyState variant="tile" icon="folder" text={i18n._({ id: "Nothing here yet. Pictures, videos and songs you make in chat land here, along with files you upload. Drop a file anywhere on this page to add it.", message: "Nothing here yet. Pictures, videos and songs you make in chat land here, along with files you upload. Drop a file anywhere on this page to add it." })} />;
      return <EmptyState variant="tile" icon={sectionOf(view.section).icon} text={i18n._({ id: "Nothing in {label} yet.", message: "Nothing in {label} yet.", values: { label: sectionOf(view.section).label } })} actionLabel={i18n._({ id: "Show all files", message: "Show all files" })} onAction={() => goSection("all")} />;
    }
    return (
      <div className="flex flex-col gap-4" style={{ "--maipai-card-size": `${cardSize}px` } as CSSProperties}>
        {lockTile}
        <LibraryItems items={items} me={person} layout={view.layout} phone={phone} selectedIds={selected} onSelectionChange={setSelected} selectionMode={selecting}
          onExitSelectionMode={leaveSelection} actions={itemActions} sort={view.sort} onSort={(sort) => update({ sort })} />
        {list.isFetchNextPageError ? loadError(i18n._({ id: "Home could not load more files. Check that Home is running, then try again.", message: "Home could not load more files. Check that Home is running, then try again." }), () => void fetchNextPage()) : null}
        {hasNextPage ? <div ref={sentinel} className="flex justify-center"><Button type="button" variant="secondary" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? i18n._({ id: "Loading more files", message: "Loading more files" }) : i18n._({ id: "Show more files", message: "Show more files" })}</Button></div> : null}
      </div>
    );
  })();

  const batchActions = (
    <>
      {canShare ? <Button type="button" variant="secondary" disabled={selectedItems.length === 0} onClick={() => setSharing(selectedItems)}>{i18n._({ id: "Share", message: "Share" })}</Button> : null}
      <Button type="button" variant="secondary" disabled={selectedItems.length === 0 || busy} onClick={() => { setBusy(true); void actions.keep(selectedItems).then((result) => { toast(batchSentence(result, (n) => i18n._({ id: "{count, plural, one {# kept until you delete it} other {# kept until you delete them}}", message: "{count, plural, one {# kept until you delete it} other {# kept until you delete them}}", values: { count: n } }), keepFailed)); leaveSelection(); }).finally(() => setBusy(false)); }}>{i18n._({ id: "Keep", message: "Keep" })}</Button>
      <Button type="button" variant="destructive" disabled={selectedItems.length === 0 || busy} onClick={() => requestTrash(selectedItems)}>{i18n._({ id: "Delete", message: "Delete" })}</Button>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1" data-workspace-fill="" data-testid="library-page"
      onDragOver={(event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => { setDragging(false); const files = Array.from(event.dataTransfer?.files ?? []); if (files.length > 0) { event.preventDefault(); addFiles(files); } }}>
      <SectionSidebar standalone groups={groups} footer={footer} footerSlot={<div className="px-3 pb-2"><LibraryStorage me={person} /></div>} density="compact" collapsedStyle="hidden" collapsed={collapsed} onCollapsedChange={setCollapsed}
        sidebarProps={{ id: "library-sidebar" }}
        search={{ value: searchText, onChange: setSearchText, label: i18n._({ id: "Search your Library", message: "Search your Library" }), onSubmit: () => update({ q: searchText }) }} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {wide && collapsed ? <SectionSidebarShowButton onClick={() => setCollapsed(false)} controls="library-sidebar" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-title">{sectionOf(view.section).label}</h1>
            <p className="text-supporting text-muted-foreground" aria-live="polite">{headline}</p>
          </div>
          <input ref={fileInput} type="file" multiple hidden aria-label={i18n._({ id: "Choose files to add", message: "Choose files to add" })} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length > 0) addFiles(files); }} />
        </div>

        {/* AUDIT-UI-01: shrink-0, or the column squeezes this scrolling strip down to the tops of its chips when the page is taller than the phone. */}
        {!wide ? (
          <div role="group" aria-label={i18n._({ id: "Library sections", message: "Library sections" })} className="-mx-4 flex shrink-0 flex-nowrap gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
            {sections.map((section) => <Chip key={section.id} tone="surface" selectedTone="inverse" size="strip" selected={view.section === section.id} onClick={() => goSection(section.id)}>{section.label}</Chip>)}
          </div>
        ) : null}
        {!wide && !trashView ? searchField : null}

        {!trashView ? (
          <div className="flex flex-wrap items-center gap-3">
            {filterAllowed(view.section, "mine") ? <div role="group" aria-label={i18n._({ id: "Filters", message: "Filters" })}><Chip tone="surface" selectedTone="inverse" size="strip" selected={view.filter === "mine"} onClick={() => update({ filter: view.filter === "mine" ? "any" : "mine" })}>{i18n._({ id: "Mine", message: "Mine" })}</Chip></div> : null}
            <div className="sm:ml-auto"><Select aria-label={i18n._({ id: "Sort by", message: "Sort by" })} value={view.sort} onValueChange={(value) => update({ sort: value as SortId })} options={Object.keys(SORT_LABELS)} getLabel={(value) => SORT_LABELS[value as SortId]} /></div>
            {view.layout === "grid" && !phone ? <CardSizeSlider size={cardSize} onChange={setCardSize} label={i18n._({ id: "Tile size", message: "Tile size" })} /> : null}
            <div role="group" aria-label={i18n._({ id: "Layout", message: "Layout" })} className="flex gap-1">
              <Button type="button" variant={view.layout === "grid" ? "secondary" : "ghost"} size="icon" aria-pressed={view.layout === "grid"} aria-label={i18n._({ id: "Grid view", message: "Grid view" })} onClick={() => update({ layout: "grid" })}><GridIcon aria-hidden className="size-4" /></Button>
              <Button type="button" variant={view.layout === "list" ? "secondary" : "ghost"} size="icon" aria-pressed={view.layout === "list"} aria-label={i18n._({ id: "List view", message: "List view" })} onClick={() => update({ layout: "list" })}><ListIcon aria-hidden className="size-4" /></Button>
            </div>
            {!selecting && selected.length === 0 ? <SelectModeToggle label={i18n._({ id: "Select", message: "Select" })} onClick={() => setSelecting(true)} /> : null}
          </div>
        ) : null}

        {selecting || selected.length > 0 ? <BatchBar count={selected.length} onExit={leaveSelection}>{batchActions}</BatchBar> : null}
        {confirm ? (
          <DestructiveConfirm
            message={confirm.length === 1 ? i18n._({ id: "Delete ‘{name}’?", message: "Delete ‘{name}’?", values: { name: confirm[0]!.name } }) : i18n._({ id: "Move {count} files to Trash?", message: "Move {count} files to Trash?", values: { count: confirm.length } })}
            detail={i18n._({ id: "{shared}{access}You can get it back from Trash for 30 days.", message: "{shared}{access}You can get it back from Trash for 30 days.", values: { shared: confirm.some((item) => item.shared_with.household) ? `${i18n._({ id: "It is shared with everyone in the home.", message: "It is shared with everyone in the home." })} ` : confirm.some((item) => item.shared_with.count > 0) ? `${i18n._({ id: "Some of it is shared with people in your home.", message: "Some of it is shared with people in your home." })} ` : "", access: confirm.some((item) => item.shared_with.count > 0 || item.shared_with.household) ? `${i18n._({ id: "They lose access now.", message: "They lose access now." })} ` : "" } })}
            confirmLabel={i18n._({ id: "Move to Trash", message: "Move to Trash" })} busyLabel={i18n._({ id: "Moving", message: "Moving" })} busy={busy} cancelLabel={i18n._({ id: "Keep it", message: "Keep it" })}
            onConfirm={() => void doTrash(confirm)} onCancel={() => setConfirm(null)} />
        ) : null}

        <UploadTray cards={uploads.cards} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.dismiss} />
        {dragging ? <div role="status" className="rounded-lg border-2 border-dashed border-primary p-6 text-center text-base">{i18n._({ id: "Drop to add to your Library", message: "Drop to add to your Library" })}</div> : null}
        {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
        {status}
        {!wide ? <div className="max-w-xl"><LibraryStorage me={person} /></div> : null}
      </div>

      {unmarkItem ? <UnmarkDialogHost key={unmarkItem.id} item={unmarkItem} refresh={() => { void actions.refresh(); }} onClosed={() => setUnmarkItem(null)} /> : null}
      <LibraryViewer phone={phone} items={viewerList} me={person} currentId={view.file} onCurrentIdChange={(id) => update({ file: id })} onClose={closeViewer} actions={itemActions} />
      {sharing ? <LibraryShareDialog items={sharing} me={person} open onOpenChange={(open) => { if (!open) setSharing(null); }} /> : null}
      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent>
          <form onSubmit={(event) => {
            event.preventDefault();
            const target = renaming; if (!target) return;
            void actions.rename(target.id, renameText).then(() => { setRenaming(null); toast.success(i18n._({ id: "Renamed.", message: "Renamed." })); }).catch((error: unknown) => setRenameProblem(actions.reason(error)));
          }}>
            <DialogHeader><DialogTitle>{i18n._({ id: "Rename file", message: "Rename file" })}</DialogTitle><DialogDescription>{i18n._({ id: "Leave it empty to go back to the name Home chose.", message: "Leave it empty to go back to the name Home chose." })}</DialogDescription></DialogHeader>
            {renameProblem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={renameProblem} /> : null}
            <label htmlFor="library-rename" className="text-base font-medium">{i18n._({ id: "Name", message: "Name" })}</label>
            <Input id="library-rename" value={renameText} maxLength={1000} onChange={(event) => setRenameText(event.target.value)} />
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setRenaming(null)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button><Button type="submit">{i18n._({ id: "Save name", message: "Save name" })}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
