import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { CommandPaletteDialog } from "@maipai/ui/src/elements/command-palette";
import { ConversationMap } from "@maipai/ui/src/elements/conversation-map";
import { ConversationSearch, type SearchHit } from "@maipai/ui/src/elements/conversation-search";
import { messagesForSearch, useScrollToMessage, useVisibleMessageIds } from "@maipai/ui/src/elements/thread.aui";
import { ChatExtrasContext } from "@/apps/chat/ChatThread";
import { buildChatCommands, type ChatCommandAction } from "@/apps/chat/chatCommands";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { useIncognitoContext } from "@/shell/incognitoContext";
import { setPendingChatFolder } from "@/apps/chat/chatThreadListAdapter";

const StableConversationMap = memo(ConversationMap);

export function ChatThreadExtras() {
  const context = useContext(ChatExtrasContext);
  if (!context) throw new Error("ChatThreadExtras must render inside ChatThread");
  const { rootRef, canUseIncognito, focusChatSearch, toggleSidebar, openSettings } = context;
  const aui = useAui();
  const messages = useAuiState((state) => state.thread.messages);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const visibleIds = useVisibleMessageIds();
  const scrollToMessage = useScrollToMessage();
  const { setOn, on: incognitoOn } = useIncognitoContext();
  const availability = useContext(ChatAvailabilityContext);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [activeCommand, setActiveCommand] = useState("");
  const searchable = useMemo(() => messagesForSearch(messages), [messages]);
  const mapKey = searchable.map((message) => `${message.id}:${message.role}:${message.text.slice(0, 40)}`).join("\u0000");
  const mapEntriesRef = useRef<{ key: string; entries: Array<{ id: string; title: string }> }>({ key: "", entries: [] });
  if (mapEntriesRef.current.key !== mapKey) {
    mapEntriesRef.current = {
      key: mapKey,
      entries: searchable.map((message) => ({
        id: message.id,
        title: `${message.role === "user" ? "You" : "Assistant"}: ${message.text.slice(0, 40)}`,
      })),
    };
  }
  const entries = mapEntriesRef.current.entries;
  const hits = useMemo<SearchHit[]>(() => {
    const term = query.trim();
    if (!term) return [];
    const lowered = term.toLocaleLowerCase();
    return searchable.flatMap((message, index) => {
      const start = message.text.toLocaleLowerCase().indexOf(lowered);
      if (start < 0) return [];
      return [{
        id: message.id,
        before: message.text.slice(Math.max(0, start - 45), start),
        match: message.text.slice(start, start + term.length),
        after: message.text.slice(start + term.length, start + term.length + 70),
        position: searchable.length <= 1 ? 50 : (index / (searchable.length - 1)) * 100,
      }];
    });
  }, [query, searchable]);
  const actions = useMemo<ChatCommandAction>(() => ({
    // PROJECTS-01b: a plain new chat is never inside a project.
    newChat: () => {
      setPendingChatFolder(null);
      void aui.threads.switchToNewThread();
    },
    focusComposer: () => document.querySelector<HTMLElement>('[aria-label="Message input"]')?.focus(),
    stopReply: () => aui.thread.cancelRun(),
    openPalette: () => setPaletteOpen(true),
    toggleSidebar,
    focusChatSearch,
    toggleIncognito: () => setOn(!incognitoOn),
    openSettings: () => openSettings?.(),
    scrollToLatest: () => {
      const viewport = rootRef.current?.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
      viewport?.scrollTo?.({ top: viewport.scrollHeight, behavior: "smooth" });
    },
  }), [aui, focusChatSearch, incognitoOn, openSettings, rootRef, setOn, toggleSidebar]);
  const commands = useMemo(() => buildChatCommands(actions, {
    isRunning,
    canUseIncognito,
    canSearchChats: threadIds.length > 0 && Boolean(document.querySelector('[aria-label="Search chats"], [aria-label="Show conversations"], [aria-label="Show threads"]')),
    canToggleSidebar: Boolean(document.querySelector('[aria-label="Show conversations"], [aria-label="Hide conversations"], [aria-label="Show threads"], [aria-label="Hide threads"]')),
    available: availability !== "unavailable",
    canOpenSettings: Boolean(openSettings),
    paletteOpen,
  }), [actions, availability, canUseIncognito, isRunning, openSettings, paletteOpen, threadIds.length]);
  const runCommand = useCallback((id: string) => {
    const command = commands.find((candidate) => candidate.id === id);
    setPaletteOpen(false);
    setPaletteQuery("");
    if (id === "focus-composer") {
      window.setTimeout(() => command?.onRun(), 0);
      return;
    }
    command?.onRun();
  }, [commands]);
  const stepSearch = useCallback((delta: number) => {
    if (hits.length === 0) return;
    setActiveIndex((index) => (index + delta + hits.length) % hits.length);
  }, [hits.length]);

  useEffect(() => {
    if (!searchOpen) return;
    rootRef.current?.querySelector<HTMLInputElement>('[aria-label="Find in conversation"]')?.focus();
  }, [rootRef, searchOpen]);

  useEffect(() => {
    if (searchOpen && hits.length > 0) scrollToMessage(hits[Math.min(activeIndex, hits.length - 1)]!.id);
  }, [activeIndex, hits, searchOpen, scrollToMessage]);

  // Search is fixed over the thread. Reserve its measured height in the
  // viewport's content and scrollport so scrollIntoView leaves the selected
  // message below the entire search card (including its match preview).
  useLayoutEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
    const content = viewport?.firstElementChild as HTMLElement | null | undefined;
    const search = rootRef.current?.querySelector<HTMLElement>('[data-slot="conversation-search"]');
    if (!viewport || !content || !search) return;

    const inset = Math.max(16, search.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top + 12);
    const previousPadding = content.style.paddingTop;
    const previousScrollPadding = viewport.style.scrollPaddingTop;
    const basePadding = Number.parseFloat(getComputedStyle(content).paddingTop) || 0;
    content.style.paddingTop = `${basePadding + inset}px`;
    viewport.style.scrollPaddingTop = `${inset}px`;
    return () => {
      content.style.paddingTop = previousPadding;
      viewport.style.scrollPaddingTop = previousScrollPadding;
    };
  }, [activeIndex, hits, rootRef, searchOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node) || !root.contains(target)) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === "f" && searchable.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        return;
      }
      if (command && key === "k") {
        event.preventDefault();
        event.stopPropagation();
        setPaletteOpen(true);
        setActiveCommand(commands[0]?.id ?? "");
        return;
      }
      if (searchOpen && key === "escape") {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(false);
        return;
      }
      if (searchOpen && key === "enter") {
        event.preventDefault();
        stepSearch(event.shiftKey ? -1 : 1);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [commands, paletteOpen, rootRef, searchable.length, searchOpen, stepSearch]);

  const paletteCommands = useMemo(() => commands.map((command) => ({
    id: command.id,
    label: command.name,
    group: command.group,
    keys: command.shortcut ? [command.shortcut] : [],
  })), [commands]);

  return (
    <>
      {entries.length >= 8 && (
        <StableConversationMap
          entries={entries}
          activeId={visibleIds[0]}
          visibleIds={visibleIds}
          onSelect={scrollToMessage}
          className="hidden lg:flex"
        />
      )}
      {searchOpen && searchable.length > 0 && (
        <div className="fixed inset-x-0 top-20 z-30 flex justify-center px-4">
          <ConversationSearch
            query={query}
            hits={hits}
            activeIndex={activeIndex}
            onQueryChange={(next) => { setQuery(next); setActiveIndex(0); }}
            onStep={stepSearch}
          />
        </div>
      )}
      {paletteOpen && (
        <CommandPaletteDialog
          open
          onOpenChange={(open) => { if (!open) { setPaletteOpen(false); setPaletteQuery(""); } }}
          title="Chat commands"
          size="lg"
          commands={paletteCommands}
          query={paletteQuery}
          activeId={activeCommand || paletteCommands[0]?.id || ""}
          onQueryChange={setPaletteQuery}
          onActiveChange={setActiveCommand}
          onRun={runCommand}
        />
      )}
    </>
  );
}
