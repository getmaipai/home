import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useAssistantDataUI, useAssistantToolUI, useAui, useAuiState } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { DATA_BINDINGS, MODEL_SELECTOR_SLOT, THREAD_SLOTS, TOOL_BINDINGS, type DataBinding, type ToolBinding } from "@/apps/chat/elementBindings";
import { ChatConnectionBanner } from "@/apps/chat/chatConnectionBanner";
import { ChatThreadExtras } from "@/apps/chat/ChatThreadExtras";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";

export type ChatExtrasContextValue = {
  rootRef: RefObject<HTMLDivElement | null>;
  canUseIncognito: boolean;
  focusChatSearch: () => void;
  toggleSidebar: () => void;
  openSettings?: () => void;
};

export const ChatExtrasContext = createContext<ChatExtrasContextValue | null>(null);

// SHARED-THREAD-01: the one thread composition. The chat page and the /dev/ui
// showcase both render this and nothing else for the thread; which Element
// renders what lives in elementBindings.ts. A page passes behaviour props (the
// runtime comes from the AssistantRuntimeProvider around this), never its own
// slot components. Chat-only wiring (providers for the artifact canvas,
// sources panel, ...) wraps this in the page; the contexts default safely.

function ElementBinding({ binding }: { binding: ToolBinding }) {
  useAssistantToolUI({ toolName: binding.toolName, render: binding.render, display: "standalone" });
  return null;
}

function DataElementBinding({ binding }: { binding: DataBinding }) {
  useAssistantDataUI({ name: binding.name, render: binding.render });
  return null;
}

/** getmaipai/home#206: the longest Send waits for a saved chat to open. */
const OPENING_HOLD_MS = 15_000;

export function ChatThread({ temporary, onEditSend, modelPickerAllowed = true, canUseIncognito = false, onOpenSettings, openingConversationId }: {
  /** Incognito: the kit's temporary-thread styling. */
  temporary?: boolean;
  /** Called with the superseded turn id when an edited message is sent. */
  onEditSend?: (messageId: string, turnId?: string) => void;
  /** Gate for the composer's model selector (it also hides itself under two models). */
  modelPickerAllowed?: boolean;
  /** The signed-in person can use Incognito. */
  canUseIncognito?: boolean;
  /** Open the app's Settings route. */
  onOpenSettings?: () => void;
  /** The saved chat the page is opening (its id from the address). Until
   * the thread list has switched to it, Send waits (getmaipai/home#206). */
  openingConversationId?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const focusChatSearch = useCallback(() => {
    const focus = () => document.querySelector<HTMLInputElement>('[aria-label="Search chats"]')?.focus();
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search chats"]');
    if (search?.getClientRects().length) {
      search.focus();
      return;
    }
    document.querySelector<HTMLButtonElement>('[aria-label="Show conversations"], [aria-label="Show threads"]')?.click();
    window.setTimeout(focus, 100);
  }, []);
  const toggleSidebar = useCallback(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Show conversations"], [aria-label="Hide conversations"], [aria-label="Show threads"], [aria-label="Hide threads"]')?.click();
  }, []);
  // CHAT-CALM-ERRORS-01d (design section 7): while the engine is down or
  // starting, the person can keep typing but Send waits for `ready`.
  const engineHeld = useContext(ChatAvailabilityContext) !== "ready";
  // getmaipai/home#206: while a saved chat is still opening (a slow hub
  // answering for its details), the composer belongs to a blank placeholder
  // thread; a message sent there vanished when the saved chat replaced it.
  // Send waits while that blank placeholder stands in for the chat in the
  // address (never while another saved chat is showing), and at most
  // OPENING_HOLD_MS, so a switch that fails some other way never holds it
  // for good; the typed text moves into the opened chat.
  const mainRemoteId = useAuiState((s) => s.threadListItem.remoteId);
  const mainIsPlaceholder = useAuiState((s) => s.threadListItem.status === "new");
  const placeholderForSavedChat = openingConversationId !== undefined && mainIsPlaceholder && mainRemoteId !== openingConversationId;
  // Keyed by the chat being opened, so opening another chat starts afresh.
  const openingKey = placeholderForSavedChat ? openingConversationId : undefined;
  const [openingTimedOut, setOpeningTimedOut] = useState(false);
  useEffect(() => {
    setOpeningTimedOut(false);
    if (openingKey === undefined) return;
    const timer = setTimeout(() => setOpeningTimedOut(true), OPENING_HOLD_MS);
    return () => clearTimeout(timer);
  }, [openingKey]);
  const opening = openingKey !== undefined && !openingTimedOut;
  const sendHeld = engineHeld || opening;
  // Text typed while the placeholder stands in for the chat (even past the
  // cap) moves into the opened chat's composer, so nothing typed is lost in
  // the switch. Only what changed during the open moves: a draft that was
  // already in the box beforehand stays where it was typed.
  const aui = useAui();
  const composerText = useAuiState((s) => s.composer.text);
  const carry = useRef<{ before: string; latest: string } | null>(null);
  useEffect(() => {
    if (openingKey === undefined) return;
    const text = aui.composer().getState().text;
    carry.current = { before: text, latest: text };
  }, [openingKey, aui]);
  useEffect(() => {
    if (openingKey !== undefined && carry.current) carry.current.latest = composerText;
  }, [openingKey, composerText]);
  useEffect(() => {
    if (openingKey !== undefined) return;
    const typed = carry.current;
    carry.current = null;
    if (!typed || !typed.latest || typed.latest === typed.before) return;
    if (!aui.composer().getState().text) aui.composer().setText(typed.latest);
  }, [openingKey, aui]);
  const extraContext = useMemo(() => ({ rootRef, canUseIncognito, focusChatSearch, toggleSidebar, openSettings: onOpenSettings }), [canUseIncognito, focusChatSearch, onOpenSettings, toggleSidebar]);
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("input, button, a, textarea, select, [contenteditable='true']")) return;
        rootRef.current?.focus();
      }}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {TOOL_BINDINGS.map((binding) => <ElementBinding key={binding.toolName} binding={binding} />)}
      {DATA_BINDINGS.map((binding) => <DataElementBinding key={binding.name} binding={binding} />)}
      <div className="flex justify-center">
        <ChatConnectionBanner />
      </div>
      <ChatExtrasContext.Provider value={extraContext}>
        <Thread
          temporary={temporary}
          scrollToBottomOffset={56}
          components={{
            ...THREAD_SLOTS,
            onEditSend,
            sendHeld,
            ThreadViewportExtra: ChatThreadExtras,
            viewport: {
              turnAnchor: "bottom",
              autoScroll: true,
              scrollToBottomOnRunStart: true,
              scrollToBottomOnInitialize: true,
              scrollToBottomOnThreadSwitch: true,
            },
            ComposerExtra: modelPickerAllowed ? MODEL_SELECTOR_SLOT : undefined,
          }}
        />
      </ChatExtrasContext.Provider>
    </div>
  );
}
