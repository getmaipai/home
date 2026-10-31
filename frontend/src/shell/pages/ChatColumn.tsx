import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import { dateGroupLabel, startOfLocalDay } from "@maipai/ui/src/elements/thread-list.aui";
import type { SearchableThread } from "@maipai/ui/src/elements/thread-search";
import { type ChatColumnControl } from "@/apps/chat/chatColumnControl";
import { readRailCollapsePreference, writeRailCollapsePreference } from "@/shell/railCollapsePreference";

// COLUMN-01 (owner, 2026-10-06: "the show/hide column is quirky, layout is
// busy, buttons are ugly"): the chat history column, rebuilt calm and
// ChatGPT-shaped. One hide/show control and quiet 36px rows.

export const CHAT_COLUMN_ID = "chat-rail";
/** Below this width the column starts hidden (a default, never a lock). */
export const CHAT_COLUMN_AUTO_COLLAPSE_MAX_WIDTH = 1024;

/** Where "Chat settings" goes: Settings, Me tab, Chat section. */
export const CHAT_SETTINGS_PATH = "/settings/chat";

// The shared sidebar owns focus behavior for its collapse and search controls.

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
  const [search, setSearch] = useState("");
  const setCollapsedPreference = useCallback((next: boolean) => {
    collapsedRef.current = next;
    setCollapsed(next);
    writeRailCollapsePreference(next);
  }, []);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  // Focus inside the column when Cmd/Ctrl+B hides it: the column goes inert, so focus moves to the header's show control.
  const focusShowAfterHide = useRef(false);
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    const previous = wasCollapsed.current;
    wasCollapsed.current = collapsed;
    if (!isDesktop || previous === collapsed) return;
    if (collapsed) {
      if (!focusShowAfterHide.current) return;
      focusShowAfterHide.current = false;
      document.querySelector<HTMLElement>('[data-slot="section-sidebar-show"]')?.focus({ preventScroll: true });
      return;
    }
    // Showing from the header's control: its button leaves with the change, so focus goes back to the column's own hide control.
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>('[data-slot="section-sidebar-toggle"]')?.focus({ preventScroll: true });
  }, [collapsed, isDesktop]);

  const control = useMemo<ChatColumnControl>(() => ({
    toggle: () => {
      if (isDesktop) {
        focusShowAfterHide.current = !collapsedRef.current && Boolean(document.querySelector('[data-slot="chat-rail"]')?.contains(document.activeElement));
        setCollapsedPreference(!collapsedRef.current);
      } else setSheetOpen(true);
    },
    openSearch: () => {
      if (isDesktop) setCollapsedPreference(false);
      else setSheetOpen(true);
    },
  }), [isDesktop, setCollapsedPreference]);

  return {
    collapsed,
    sheetOpen,
    setSheetOpen,
    search,
    setSearch,
    setCollapsedPreference,
    control,
  };
}

