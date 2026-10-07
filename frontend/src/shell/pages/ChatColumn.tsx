import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useThreadListGroups } from "@maipai/ui/src/elements/thread-list.aui";
import { ThreadListSidebar } from "@maipai/ui/src/elements/thread-list-sidebar.aui";
import { ThreadSearch, type SearchableThread } from "@maipai/ui/src/elements/thread-search";
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { type ChatColumnControl } from "@/apps/chat/chatColumnControl";
import { useChatProjects } from "@/apps/chat/chatProjects";
import { setPendingChatFolder } from "@/apps/chat/chatThreadListAdapter";
import type { Roster } from "@/lib/api";
import { readRailCollapsePreference, writeRailCollapsePreference } from "@/shell/railCollapsePreference";

// COLUMN-01 (owner, 2026-10-06: "the show/hide column is quirky, layout is
// busy, buttons are ugly"): the chat history column, rebuilt calm and
// ChatGPT-shaped. One hide/show control, a hover peek (COLUMN-02) that overlays, a width transition
// whose content never re-wraps, and quiet 36px rows.

export const CHAT_COLUMN_ID = "next-chat-rail";
/** Below this width the column starts hidden (a default, never a lock). */
export const CHAT_COLUMN_AUTO_COLLAPSE_MAX_WIDTH = 1024;

/** COLUMN-02: the hidden column's hover peek. The pointer must rest on the
 * thin zone at the workspace's left edge this long before it opens (so
 * passing across does nothing); it closes this long after the pointer
 * leaves the zone and the peek. */
export const PEEK_OPEN_DELAY_MS = 120;
export const PEEK_CLOSE_GRACE_MS = 150;
/** Where "Chat settings" goes: Settings, Me tab, Chat section. */
export const CHAT_SETTINGS_PATH = "/settings?tab=me&section=chat";

const SearchIcon = getIcon("search");
const CloseIcon = getIcon("x");
const ChatSettingsIcon = getIcon("settings");

// Focus this page moves on a person's behalf (handing focus between the two
// toggles, back to the search button) must not pop a tooltip open: a
// tooltip belongs to a pointer resting on a control or a person tabbing
// to it. The focus event fires synchronously inside `.focus()`, so the
// trigger's own onFocus can tell the two apart and skip Radix's open.
const quietFocusTargets = new WeakSet<Element>();
function focusQuietly(element: HTMLElement | null | undefined): void {
  if (!element) return;
  quietFocusTargets.add(element);
  // preventScroll: the column is clipped while it animates, and focusing
  // a clipped node would scroll its box and break the slide.
  element.focus({ preventScroll: true });
  quietFocusTargets.delete(element);
}
export function skipTooltipOnQuietFocus(event: FocusEvent<HTMLElement>): void {
  if (quietFocusTargets.has(event.currentTarget)) event.preventDefault();
}

// The panel exists twice below lg (the hidden desktop column and the phone
// sheet), and both share one search state. Only a copy a person can see,
// and inside the open dialog when there is one (the dialog would pull
// focus straight back from anything outside it), may take focus.
function canTakeFocus(element: Element | null | undefined): boolean {
  if (!element || element.getClientRects().length === 0) return false;
  const openDialog = document.querySelector('[role="dialog"][data-state="open"]');
  return !openDialog || openDialog.contains(element);
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

export function chatColumnShortcutLabel(): string {
  return isMacPlatform() ? "⌘B" : "Ctrl+B";
}

/** The desktop column's open or hidden state, remembered per browser, and
 * the phone sheet's open state. */
export function useChatColumn({ isDesktop }: { isDesktop: boolean }) {
  const [collapsed, setCollapsed] = useState(() => {
    const stored = readRailCollapsePreference();
    if (stored !== null) return stored;
    return typeof window !== "undefined" && window.matchMedia(`(max-width: ${CHAT_COLUMN_AUTO_COLLAPSE_MAX_WIDTH}px)`).matches;
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const peekTimerRef = useRef<number | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusKey, setSearchFocusKey] = useState(0);
  // Set when search closes from inside the field, so the panel hands focus
  // back to the search icon once it is on screen again.
  const restoreSearchFocusRef = useRef(false);
  const closeSearch = useCallback((restoreFocus: boolean) => {
    restoreSearchFocusRef.current = restoreFocus;
    setSearch("");
    setSearchOpen(false);
  }, []);
  const columnToggleRef = useRef<HTMLButtonElement>(null);
  const headerToggleRef = useRef<HTMLButtonElement>(null);
  const focusAfterRef = useRef<"column" | "header" | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const setColumnCollapsed = useCallback((next: boolean, fromToggle: boolean) => {
    if (next === collapsedRef.current) return;
    // A column that is about to go inert must not keep focus: hand it to
    // the header's toggle. Opening from a toggle hands focus to the
    // column's own toggle, so Enter, Enter round-trips.
    const column = document.getElementById(CHAT_COLUMN_ID);
    const focusInside = Boolean(column && document.activeElement && column.contains(document.activeElement));
    focusAfterRef.current = next ? (fromToggle || focusInside ? "header" : null) : fromToggle ? "column" : null;
    collapsedRef.current = next;
    setCollapsed(next);
    writeRailCollapsePreference(next);
  }, []);

  useEffect(() => {
    const target = focusAfterRef.current;
    if (!target) return;
    focusAfterRef.current = null;
    focusQuietly((target === "header" ? headerToggleRef : columnToggleRef).current);
  }, [collapsed]);

  const clearPeekTimer = useCallback(() => {
    if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
    peekTimerRef.current = null;
  }, []);
  /** Pointer rested on the edge zone: open after a short delay. */
  const schedulePeekOpen = useCallback(() => {
    clearPeekTimer();
    peekTimerRef.current = window.setTimeout(() => { peekTimerRef.current = null; setPeek(true); }, PEEK_OPEN_DELAY_MS);
  }, [clearPeekTimer]);
  const closePeek = useCallback((restoreFocus = false) => {
    clearPeekTimer();
    setPeek(false);
    // Only a keyboard or click close hands focus back; a pointer drifting
    // away never moves focus.
    if (restoreFocus) focusAfterRef.current = "header";
  }, [clearPeekTimer]);
  /** Pointer left the zone or the peek: close after the grace, unless a
   * row's menu is open (its popup lives outside the peek). */
  const schedulePeekClose = useCallback(() => {
    clearPeekTimer();
    peekTimerRef.current = window.setTimeout(() => {
      peekTimerRef.current = null;
      // A row menu is open: look again shortly, so the peek still closes
      // once the menu is gone and the pointer is still outside.
      if (document.querySelector('[data-slot="next-chat-rail"][data-state="peek"] [aria-expanded="true"][aria-haspopup]')) { schedulePeekClose(); return; }
      closePeek();
    }, PEEK_CLOSE_GRACE_MS);
  }, [clearPeekTimer, closePeek]);
  // The peek only exists while the column is hidden on a desktop screen.
  useEffect(() => {
    if (!collapsed || !isDesktop) { clearPeekTimer(); setPeek(false); }
  }, [collapsed, isDesktop, clearPeekTimer]);
  useEffect(() => clearPeekTimer, [clearPeekTimer]);
  useEffect(() => {
    if (!peek) return;
    // Not `defaultPrevented`: an open tooltip's own Escape handler (capture
    // phase) marks the key handled before this runs. The one Escape that is
    // not ours is the thread search clearing a typed query.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.target instanceof HTMLInputElement && event.target.value !== "") return;
      // An open row menu takes this Escape first.
      if (document.querySelector('[data-slot="next-chat-rail"][data-state="peek"] [aria-expanded="true"][aria-haspopup]')) return;
      closePeek(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [peek, closePeek]);
  // Focus the peek's close hands back (the header's show control) once the
  // peek has unmounted.
  useEffect(() => {
    if (peek || focusAfterRef.current !== "header" || !collapsedRef.current) return;
    focusAfterRef.current = null;
    focusQuietly(headerToggleRef.current);
  }, [peek]);
  /** The pin control inside the peek: dock the column again. */
  const pinPeek = useCallback(() => {
    clearPeekTimer();
    setPeek(false);
    setColumnCollapsed(false, true);
  }, [clearPeekTimer, setColumnCollapsed]);

  /** Pointer handlers for the hover zone and for the column node while it is
   * peeking (plain props, spread by the page: no extra component). */
  const peekZoneHandlers = {
    onPointerEnter: (event: { pointerType: string }) => { if (event.pointerType !== "touch") schedulePeekOpen(); },
    onPointerLeave: clearPeekTimer,
  };
  const peekColumnHandlers = {
    onPointerEnter: clearPeekTimer,
    onPointerLeave: (event: { pointerType: string }) => { if (event.pointerType !== "touch") schedulePeekClose(); },
    // A click that navigates (a row, New chat, a link) closes the peek.
    onClick: (event: { target: EventTarget }) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-slot="aui_thread-list-item-trigger"], [data-slot="aui_thread-list-new"], a[href]')) closePeek(true);
    },
  };

  const toggleFromButton = useCallback(() => setColumnCollapsed(!collapsedRef.current, true), [setColumnCollapsed]);

  const control = useMemo<ChatColumnControl>(() => ({
    toggle: () => {
      if (isDesktop) setColumnCollapsed(!collapsedRef.current, false);
      else setSheetOpen((open) => !open);
    },
    openSearch: () => {
      if (isDesktop) setColumnCollapsed(false, false);
      else setSheetOpen(true);
      setSearchOpen(true);
      setSearchFocusKey((key) => key + 1);
    },
  }), [isDesktop, setColumnCollapsed]);

  return {
    collapsed,
    peek,
    peekZoneHandlers,
    peekColumnHandlers,
    closePeek,
    pinPeek,
    sheetOpen,
    setSheetOpen,
    search,
    setSearch,
    searchOpen,
    setSearchOpen,
    searchFocusKey,
    setSearchFocusKey,
    restoreSearchFocusRef,
    closeSearch,
    columnToggleRef,
    headerToggleRef,
    toggleFromButton,
    control,
  };
}

export type ChatColumnState = ReturnType<typeof useChatColumn>;

/** Host data and controls wired directly into the shipped history sidebar. */
export function ChatColumnContent({
  state,
  person,
  temporary,
  onNewThread,
  newChatDisabled,
  pinnable,
  collapsed = false,
  peek = false,
  mobile = false,
  toggle,
}: {
  state: ChatColumnState;
  person: Roster;
  /** Incognito: no projects (a temporary chat never joins one). */
  temporary: boolean;
  onNewThread: () => void;
  newChatDisabled: boolean;
  pinnable: boolean;
  collapsed?: boolean;
  peek?: boolean;
  mobile?: boolean;
  toggle?: ReactNode;
}) {
  const aui = useAui();
  // PROJECTS-01b: the person's projects in the kit thread list.
  const { projects, settingsDialog } = useChatProjects({ person, temporary, onNewChatStarted: onNewThread });
  const { search, setSearch, searchOpen, setSearchOpen, searchFocusKey } = state;
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  const isLoading = useAuiState((s) => s.threads.isLoading);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  // Nothing to search (a person with no chats asked for search): never
  // leave a search open that would appear later, unfocused.
  useEffect(() => {
    if (searchOpen && !isLoading && !hasThreads) setSearchOpen(false);
  }, [searchOpen, isLoading, hasThreads, setSearchOpen]);
  const { threadIds, groups, filteredIndices, looseIndices } = useThreadListGroups("", { pinnable: pinnable && !temporary });
  const searchableThreads = useMemo(() => {
    const byId = new Map(threadItems.map((item) => [item.id, item]));
    const orderedIndices = groups
      ? groups.flatMap((group) => group.indices)
      : filteredIndices.length > 0 ? filteredIndices : looseIndices;
    return orderedIndices.flatMap((index): SearchableThread[] => {
      const id = threadIds[index];
      const item = id ? byId.get(id) : undefined;
      if (!id || !item || item.status === "archived") return [];
      const group = groups?.find((entry) => entry.indices.includes(index))?.label ?? "Today";
      return [{ id, title: item.title || "New Chat", group, pinned: !temporary && Boolean(item.custom?.pinned) }];
    });
  }, [filteredIndices, groups, looseIndices, temporary, threadIds, threadItems]);
  const searchRowRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const content = document.querySelectorAll<HTMLElement>(`[data-slot="next-chat-rail"] [data-slot="aui_thread-list-sidebar-content"]`);
    const update = (event: Event) => setScrolled((event.currentTarget as HTMLElement).scrollTop > 0);
    content.forEach((node) => node.addEventListener("scroll", update, { passive: true }));
    return () => content.forEach((node) => node.removeEventListener("scroll", update));
  }, []);

  // Focus the field when search opens (from the icon or the command
  // palette), but only in the instance a person can see.
  useEffect(() => {
    if (!searchOpen) return;
    const row = searchRowRef.current;
    if (!row) return;
    const focusField = () => {
      if (!canTakeFocus(row)) return;
      if (!row.contains(document.activeElement)) row.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    };
    focusField();
    // Opened from the command palette, the palette's dialog hands focus
    // back to whatever opened it once it has closed (a timer after its
    // unmount); take it back once, so the person lands in the field.
    const retry = window.setTimeout(focusField, 150);
    return () => window.clearTimeout(retry);
  }, [searchOpen, searchFocusKey]);

  // Closing search from the field (Escape, the close button) hands focus
  // back to the search icon once it is back on screen.
  const { restoreSearchFocusRef } = state;
  useEffect(() => {
    if (searchOpen || !restoreSearchFocusRef.current || !canTakeFocus(searchButtonRef.current)) return;
    restoreSearchFocusRef.current = false;
    focusQuietly(searchButtonRef.current);
  }, [searchOpen, restoreSearchFocusRef]);

  const closeSearch = state.closeSearch;

  const onSearchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The kit's field clears a non-empty query on Escape (and marks the
    // event handled); an Escape on an empty field closes it.
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      closeSearch(true);
    }
  };

  const onSearchBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (search !== "") return;
    // Focus moving within this row, or to the other copy of the panel (the
    // phone sheet and the desktop column share one search), keeps it open.
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-slot="chat-column-header"]')) return;
    setSearchOpen(false);
  };

  const collapsedState = collapsed ? (peek ? "peek" : "closed") : "open";
  const searchButton = hasThreads && !searchOpen ? (
    <TooltipIconButton
      ref={searchButtonRef}
      tooltip="Search chats"
      data-slot="chat-column-icon"
      aria-label="Search chats"
      onFocus={skipTooltipOnQuietFocus}
      onClick={() => {
        setSearchOpen(true);
        state.setSearchFocusKey((key) => key + 1);
      }}
    ><SearchIcon className="size-4.5" /></TooltipIconButton>
  ) : null;
  const columnToggle = toggle;
  const header = (
    <div data-slot="chat-column-top" data-scrolled={scrolled || undefined}>
        {searchOpen && hasThreads ? (
          <div ref={searchRowRef} data-slot="chat-column-header" className={`flex h-9 w-full items-center gap-1 ps-0.5 ${mobile ? "pe-10" : ""}`}>
            <div className="min-w-0 flex-1">
            <ThreadSearch
              threads={searchableThreads}
              query={search}
              activeId={aui.threadListItem().getState().id ?? ""}
              onQueryChange={setSearch}
              onSelect={(id) => void aui.threads.switchToThread(id)}
              inputOnly
              density="compact"
              aria-label="Search chats"
              onKeyDown={onSearchKeyDown}
              onBlur={onSearchBlur}
            />
            </div>
            <TooltipIconButton tooltip="Close search" data-slot="chat-column-icon" aria-label="Close search" onClick={() => closeSearch(true)}><CloseIcon className="size-4" /></TooltipIconButton>
            {toggle}
          </div>
        ) : (
          <div data-slot="chat-column-header" className={`flex h-9 w-full items-center gap-1 ps-0.5 ${mobile ? "pe-10" : ""}`}>
            <span data-slot="chat-column-title" className="min-w-0 flex-1 truncate">Chat</span>
            <TooltipIconButton tooltip="Chat settings" data-slot="chat-column-icon" asChild><Link to={CHAT_SETTINGS_PATH} aria-label="Chat settings"><ChatSettingsIcon className="size-4.5" /></Link></TooltipIconButton>
            {searchButton}
            {columnToggle}
          </div>
        )}
    </div>
  );
  return <>
    <ThreadListSidebar
      id={mobile ? undefined : CHAT_COLUMN_ID}
      data-slot="next-chat-rail"
      data-state={collapsedState}
      data-variant={mobile ? "sheet" : "column"}
      aria-label="Conversations"
      role="region"
      variant="compact"
      header={header}
      // The shipped provider root is fixed for page level use. This host
      // embeds it in the in-flow Chat column, so constrain it to the host.
      // eslint-disable-next-line shadcn/no-inline-styles -- ThreadListSidebar forwards style to its fixed SidebarProvider root; layout geometry is required for the embedded column.
      style={{ position: "relative", inset: "auto", width: "100%", height: "100%" } as React.CSSProperties}
      projects={projects}
      pinnable={pinnable}
      temporary={temporary}
      newChatDisabled={newChatDisabled}
      onNewChat={() => { setPendingChatFolder(null); onNewThread(); }}
      searchQuery={hasThreads ? search : ""}
      searchable={false}
      emptyState={!isLoading ? <p className="px-2.5 py-2 text-sm text-muted-foreground">Your chats will show up here.</p> : undefined}
      collapsed={collapsed}
      peek={peek}
      onPeekZonePointerEnter={state.peekZoneHandlers.onPointerEnter}
      onPeekZonePointerLeave={state.peekZoneHandlers.onPointerLeave}
      onPeekPointerEnter={state.peekColumnHandlers.onPointerEnter}
      onPeekPointerLeave={state.peekColumnHandlers.onPointerLeave}
      onPeekNavigate={() => state.closePeek(true)}
    />
    {settingsDialog}
  </>;
}
