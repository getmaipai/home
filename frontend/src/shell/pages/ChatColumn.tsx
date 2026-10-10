import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import { dateGroupLabel, startOfLocalDay } from "@maipai/ui/src/elements/thread-list.aui";
import type { SearchableThread } from "@maipai/ui/src/elements/thread-search";
import { type ChatColumnControl } from "@/apps/chat/chatColumnControl";
import { readRailCollapsePreference, writeRailCollapsePreference } from "@/shell/railCollapsePreference";

// COLUMN-01 (owner, 2026-10-06: "the show/hide column is quirky, layout is
// busy, buttons are ugly"): the chat history column, rebuilt calm and
// ChatGPT-shaped. One hide/show control, a hover peek (COLUMN-02) that overlays, a width transition
// whose content never re-wraps, and quiet 36px rows.

export const CHAT_COLUMN_ID = "chat-rail";
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

// Focus this page moves on a person's behalf (handing focus between the two
// toggles, back to the search button) must not pop a tooltip open: a
// tooltip belongs to a pointer resting on a control or a person tabbing
// to it. The focus event fires synchronously inside `.focus()`, so the
// trigger's own onFocus can tell the two apart and skip Radix's open.
const quietFocusTargets = new WeakSet<Element>();
export function focusQuietly(element: HTMLElement | null | undefined): void {
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
export function canTakeFocus(element: Element | null | undefined): boolean {
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

type ChatThreadListState = ReturnType<AssistantRuntime["threads"]["getState"]>;

export function useChatThreadListState(runtime: AssistantRuntime): ChatThreadListState {
  const threads = runtime.threads;
  const subscribe = useCallback((notify: () => void) => threads.subscribe(notify), [threads]);
  const getSnapshot = useCallback(() => threads.getState(), [threads]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Use the kit's date grouping so search and the sidebar share the same buckets. */
export function searchableThreadsFor(state: ChatThreadListState, temporary: boolean): SearchableThread[] {
  const startOfToday = startOfLocalDay(new Date());
  return state.threadIds.flatMap((id): SearchableThread[] => {
    const item = state.threadItems[id];
    if (!item || item.status === "archived") return [];
    return [{
      id,
      title: item.title || "New Chat",
      group: dateGroupLabel(item.lastMessageAt, startOfToday),
      pinned: !temporary && Boolean(item.custom?.pinned),
    }];
  });
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
    peekTimerRef.current = window.setTimeout(() => {
      peekTimerRef.current = null;
      // Pinned open in the meantime (a click on the control): nothing to peek.
      if (collapsedRef.current) setPeek(true);
    }, PEEK_OPEN_DELAY_MS);
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
      if (document.querySelector('[data-slot="chat-rail"][data-state="peek"] [aria-expanded="true"][aria-haspopup]')) { schedulePeekClose(); return; }
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
      if (document.querySelector('[data-slot="chat-rail"][data-state="peek"] [aria-expanded="true"][aria-haspopup]')) return;
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
  /** CHAT-SIDEBAR-PEEK-01: the same peek, opened from the conversation
   * header's show control while the column is hidden. Resting the pointer
   * on it, or tabbing to it, opens the overlay; leaving it closes after the
   * grace (moving into the peek cancels that, see `peekColumnHandlers`).
   * Touch has no hover, and focus that arrives from a click or from this
   * page handing focus back (Escape, pin) never opens it. A click still
   * pins, through `toggleFromButton`. */
  const pointerFocusRef = useRef(false);
  const peekToggleHandlers = {
    onPointerEnter: (event: { pointerType: string }) => { if (event.pointerType !== "touch") schedulePeekOpen(); },
    onPointerLeave: (event: { pointerType: string }) => { if (event.pointerType !== "touch") schedulePeekClose(); },
    onPointerDown: () => { pointerFocusRef.current = true; },
    // Mouse focus lands between press and release; a browser that does not
    // focus a clicked button (Safari) must not leave the flag set.
    onPointerUp: () => { pointerFocusRef.current = false; },
    // The peek is the answer to pointing at this control, and its own pin
    // control carries the tooltip: a default-prevented move keeps Radix's
    // tooltip from opening over the peek's first rows.
    onPointerMove: (event: { pointerType: string; preventDefault: () => void }) => { if (event.pointerType !== "touch") event.preventDefault(); },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const fromPointer = pointerFocusRef.current;
      pointerFocusRef.current = false;
      if (fromPointer || event.isDefaultPrevented()) return;
      event.preventDefault();
      schedulePeekOpen();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      pointerFocusRef.current = false;
      const column = document.getElementById(CHAT_COLUMN_ID);
      if (column && event.relatedTarget instanceof Node && column.contains(event.relatedTarget)) return;
      schedulePeekClose();
    },
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
    peekToggleHandlers,
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
