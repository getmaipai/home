import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useAui, useAuiState } from "@assistant-ui/react";
import { ThreadListItems, ThreadListNew, ThreadListRoot } from "@maipai/ui/src/elements/thread-list.aui";
import { ThreadSearch, type SearchableThread } from "@maipai/ui/src/elements/thread-search";
import { Button } from "@maipai/ui/src/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { getIcon } from "@maipai/ui/src/icons";
import { type ChatColumnControl } from "@/apps/chat/chatColumnControl";
import { useChatProjects } from "@/apps/chat/chatProjects";
import { setPendingChatFolder } from "@/apps/chat/chatThreadListAdapter";
import type { Roster } from "@/lib/api";
import { readRailCollapsePreference, writeRailCollapsePreference } from "@/next/railCollapsePreference";

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

const ColumnCloseIcon = getIcon("panel-left-close");
const ColumnOpenIcon = getIcon("panel-left-open");
const NewChatIcon = getIcon("pencil");
const SearchIcon = getIcon("search");
const CloseIcon = getIcon("x");
const ChatSettingsIcon = getIcon("settings");
const PinIcon = getIcon("pin");

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
function skipTooltipOnQuietFocus(event: FocusEvent<HTMLElement>): void {
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

/** The one hide/show control. It sits at the top of the open column and,
 * while the column is hidden, at the left edge of the conversation header. */
export function ChatColumnToggle({ collapsed, onToggle, buttonRef, pin = false }: { collapsed: boolean; onToggle: () => void; buttonRef: RefObject<HTMLButtonElement | null>; pin?: boolean }) {
  // In the hover peek the control pins the column open (docks it again).
  const label = pin ? "Keep conversations open" : collapsed ? "Show conversations" : "Hide conversations";
  const Icon = pin ? PinIcon : collapsed ? ColumnOpenIcon : ColumnCloseIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild onFocus={skipTooltipOnQuietFocus}>
        <Button
          ref={buttonRef}
          variant="ghost"
          size="icon-sm"
          data-slot="chat-column-toggle"
          aria-label={label}
          aria-expanded={pin ? undefined : !collapsed}
          aria-controls={pin ? undefined : CHAT_COLUMN_ID}
          aria-keyshortcuts="Meta+B Control+B"
          onClick={onToggle}
        >
          <Icon className="size-4.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} {pin ? null : <span className="ms-1 opacity-60">{chatColumnShortcutLabel()}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function useSearchableThreads(): SearchableThread[] {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = today.getTime() - 86_400_000;
    const byId = new Map(threadItems.map((item) => [item.id, item]));
    return threadIds.flatMap((id): SearchableThread[] => {
      const item = byId.get(id);
      if (!item || item.status === "archived") return [];
      const time = item.lastMessageAt?.getTime();
      const group = time === undefined || time >= today.getTime() ? "Today" : time >= yesterday ? "Yesterday" : "Earlier";
      return [{ id, title: item.title || "New Chat", group, pinned: Boolean(item.custom?.pinned) }];
    });
  }, [threadIds, threadItems]);
}

/** The column's contents, shared by the desktop column and the phone
 * sheet: a header row (the app's name, thread search, the hide control),
 * New chat as a quiet row, then the history (Pinned, Projects, Recents). */
export function ChatHistoryPanel({
  state,
  person,
  temporary,
  onNewThread,
  newChatDisabled,
  pinnable,
  toggle,
  variant,
}: {
  state: ChatColumnState;
  person: Roster;
  /** Incognito: no projects (a temporary chat never joins one). */
  temporary: boolean;
  onNewThread: () => void;
  newChatDisabled: boolean;
  pinnable: boolean;
  toggle?: ReactNode;
  variant: "column" | "sheet";
}) {
  const aui = useAui();
  // PROJECTS-01b: the person's projects in the kit thread list.
  const projects = useChatProjects({ person, temporary, onNewChatStarted: onNewThread });
  const { search, setSearch, searchOpen, setSearchOpen, searchFocusKey } = state;
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  const isLoading = useAuiState((s) => s.threads.isLoading);
  // Nothing to search (a person with no chats asked for search): never
  // leave a search open that would appear later, unfocused.
  useEffect(() => {
    if (searchOpen && !isLoading && !hasThreads) setSearchOpen(false);
  }, [searchOpen, isLoading, hasThreads, setSearchOpen]);
  const searchableThreads = useSearchableThreads();
  const searchRowRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [scrolled, setScrolled] = useState(false);

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

  return (
    <ThreadListRoot data-slot="chat-column-panel" data-variant={variant} className="flex h-full min-h-0 flex-col gap-0">
      <div data-slot="chat-column-top" data-scrolled={scrolled || undefined} className="shrink-0">
        {searchOpen && hasThreads ? (
          <div ref={searchRowRef} data-slot="chat-column-header" className="flex items-center gap-1">
            <ThreadSearch
              threads={searchableThreads}
              query={search}
              activeId={aui.threadListItem().getState().id ?? ""}
              onQueryChange={setSearch}
              onSelect={(id) => void aui.threads.switchToThread(id)}
              inputOnly
              aria-label="Search chats"
              className="min-w-0 flex-1"
              onKeyDown={onSearchKeyDown}
              onBlur={onSearchBlur}
            />
            <Button variant="ghost" size="icon-sm" data-slot="chat-column-icon" aria-label="Close search" onClick={() => closeSearch(true)}>
              <CloseIcon className="size-4" />
            </Button>
            {toggle}
          </div>
        ) : (
          <div data-slot="chat-column-header" className="flex items-center gap-1">
            <span data-slot="chat-column-title" className="min-w-0 flex-1 truncate">Chat</span>
            <Tooltip>
              <TooltipTrigger asChild onFocus={skipTooltipOnQuietFocus}>
                <Button asChild variant="ghost" size="icon-sm" data-slot="chat-column-icon">
                  <Link to={CHAT_SETTINGS_PATH} aria-label="Chat settings">
                    <ChatSettingsIcon className="size-4.5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Chat settings</TooltipContent>
            </Tooltip>
            {hasThreads ? (
              <Tooltip>
                <TooltipTrigger asChild onFocus={skipTooltipOnQuietFocus}>
                  <Button
                    ref={searchButtonRef}
                    variant="ghost"
                    size="icon-sm"
                    data-slot="chat-column-icon"
                    aria-label="Search chats"
                    onClick={() => {
                      setSearchOpen(true);
                      state.setSearchFocusKey((key) => key + 1);
                    }}
                  >
                    <SearchIcon className="size-4.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Search chats</TooltipContent>
              </Tooltip>
            ) : null}
            {toggle}
          </div>
        )}
        <nav aria-label="Chat" data-slot="chat-column-nav" className="flex flex-col">
          <ThreadListNew
            onClick={() => {
              // A plain new chat is never inside a project.
              setPendingChatFolder(null);
              onNewThread();
            }}
            disabled={newChatDisabled}
          >
            <NewChatIcon data-slot="aui_thread-list-new-icon" className="size-4.5 shrink-0" />
            <span data-slot="aui_thread-list-new-label">New chat</span>
          </ThreadListNew>
        </nav>
      </div>
      <div
        data-slot="chat-column-list"
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        <ThreadListItems searchQuery={hasThreads ? search : ""} pinnable={pinnable} projects={projects} />
        {!isLoading && !hasThreads ? (
          <p data-slot="chat-column-empty">Your chats will show up here.</p>
        ) : null}
      </div>
    </ThreadListRoot>
  );
}
