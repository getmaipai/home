import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useAui, useAuiState } from "@assistant-ui/react";
import { ThreadListItems, ThreadListNew, ThreadListRoot } from "@maipai/ui/src/elements/thread-list.aui";
import { ThreadSearch, type SearchableThread } from "@maipai/ui/src/elements/thread-search";
import { Button } from "@maipai/ui/src/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { getIcon } from "@maipai/ui/src/icons";
import { type ChatColumnControl } from "@/apps/chat/chatColumnControl";
import { readRailCollapsePreference, writeRailCollapsePreference } from "@/next/railCollapsePreference";

// COLUMN-01 (owner, 2026-10-06: "the show/hide column is quirky, layout is
// busy, buttons are ugly"): the chat history column, rebuilt calm and
// ChatGPT-shaped. One hide/show control, no hover peek, a width transition
// whose content never re-wraps, and quiet 36px rows.

export const CHAT_COLUMN_ID = "next-chat-rail";
/** Below this width the column starts hidden (a default, never a lock). */
export const CHAT_COLUMN_AUTO_COLLAPSE_MAX_WIDTH = 1024;

/** Where "Chat settings" goes: Settings, Me tab, Chat section. */
export const CHAT_SETTINGS_PATH = "/settings?tab=me&section=chat";

const ColumnCloseIcon = getIcon("panel-left-close");
const ColumnOpenIcon = getIcon("panel-left-open");
const NewChatIcon = getIcon("pencil");
const SearchIcon = getIcon("search");
const CloseIcon = getIcon("x");
const CustomizeIcon = getIcon("sliders-horizontal");
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
export function ChatColumnToggle({ collapsed, onToggle, buttonRef }: { collapsed: boolean; onToggle: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const label = collapsed ? "Show conversations" : "Hide conversations";
  const Icon = collapsed ? ColumnOpenIcon : ColumnCloseIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild onFocus={skipTooltipOnQuietFocus}>
        <Button
          ref={buttonRef}
          variant="ghost"
          size="icon-sm"
          data-slot="chat-column-toggle"
          aria-label={label}
          aria-expanded={!collapsed}
          aria-controls={CHAT_COLUMN_ID}
          aria-keyshortcuts="Meta+B Control+B"
          onClick={onToggle}
        >
          <Icon className="size-4.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} <span className="ms-1 opacity-60">{chatColumnShortcutLabel()}</span>
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
 * New chat and Customize as quiet rows, then the history. */
export function ChatHistoryPanel({
  state,
  onNewThread,
  newChatDisabled,
  pinnable,
  toggle,
  variant,
}: {
  state: ChatColumnState;
  onNewThread: () => void;
  newChatDisabled: boolean;
  pinnable: boolean;
  toggle?: ReactNode;
  variant: "column" | "sheet";
}) {
  const aui = useAui();
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
          <ThreadListNew onClick={onNewThread} disabled={newChatDisabled}>
            <NewChatIcon data-slot="aui_thread-list-new-icon" className="size-4.5 shrink-0" />
            <span data-slot="aui_thread-list-new-label">New chat</span>
          </ThreadListNew>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" asChild data-slot="chat-column-link">
                <Link to="/settings?tab=me">
                  <CustomizeIcon className="size-4.5 shrink-0" />
                  <span>Customize</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Your companion, voice and look</TooltipContent>
          </Tooltip>
        </nav>
      </div>
      <div
        data-slot="chat-column-list"
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        <ThreadListItems searchQuery={hasThreads ? search : ""} pinnable={pinnable} />
        {!isLoading && !hasThreads ? (
          <p data-slot="chat-column-empty">Your chats will show up here.</p>
        ) : null}
      </div>
    </ThreadListRoot>
  );
}
