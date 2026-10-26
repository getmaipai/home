import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useAssistantDataUI, useAssistantToolUI, useAui, useAuiState, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Thread, type ThreadComponents } from "@maipai/ui/src/elements/thread.aui";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { setPendingChatFolder } from "@/apps/chat/chatThreadListAdapter";
import { AdminToolFallback, DATA_BINDINGS, MODEL_TRAILING_SLOT, THREAD_SLOTS, TOOL_BINDINGS, type DataBinding, type ToolBinding } from "@/apps/chat/elementBindings";
import { ChatConnectionBanner } from "@/apps/chat/chatConnectionBanner";
import { ChatThreadExtras } from "@/apps/chat/ChatThreadExtras";
import { ChatAvailabilityContext, engineDownReason } from "@/apps/chat/useChatAvailability";
import { useComposerFocus } from "@/apps/chat/useComposerFocus";
import { ChatColumnControlContext } from "@/apps/chat/chatColumnControl";
import { AdminContext, ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";
import { useStatusApps } from "@/shell/useStatusApps";
import { isSearchLimitedChat } from "@/shell/statusApps";
import { messageForTurn } from "./chatTurnDeepLinkModel";
import "@/apps/chat/chatOriginHighlight.css";

type OriginHighlightStyle = CSSProperties & {
  "--origin-left": string;
  "--origin-top": string;
  "--origin-width": string;
  "--origin-height": string;
};

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
  useAssistantToolUI({ toolName: binding.toolName, render: binding.render, display: binding.display ?? "standalone" });
  return null;
}

function DataElementBinding({ binding }: { binding: DataBinding }) {
  useAssistantDataUI({ name: binding.name, render: binding.render });
  return null;
}

const BoundToolFallbackGuard: ToolCallMessagePartComponent = (props) => {
  const admin = useContext(AdminContext);
  const band = useContext(ChatAgeBandContext);
  if (!admin && (band === "child" || band === "teen" || band === "adult")) return null;
  return <AdminToolFallback {...props} />;
};

/** getmaipai/home#206: the longest Send waits for a saved chat to open. */
const OPENING_HOLD_MS = 15_000;

export function ChatThread({ temporary, onEditSend, thinkingModeVisible = false, canUseIncognito = false, onOpenSettings, openingConversationId, originConversationId, originTurnId, originMessageRole = "assistant", pageSlots, projectFolderId, focusKey }: {
  /** Incognito: the kit's temporary-thread styling. */
  temporary?: boolean;
  /** Called with the superseded turn id when an edited message is sent. */
  onEditSend?: (messageId: string, turnId?: string) => void;
  /** Gate for the composer's thinking mode control. */
  thinkingModeVisible?: boolean;
  /** The signed-in person can use Incognito. */
  canUseIncognito?: boolean;
  /** Open the app's Settings route. */
  onOpenSettings?: () => void;
  /** The saved chat the page is opening (its id from the address). Until
   * the thread list has switched to it, Send waits (getmaipai/home#206). */
  openingConversationId?: string;
  /** Optional Library deep link destination. */
  originConversationId?: string;
  originTurnId?: string;
  originMessageRole?: "user" | "assistant";
  /** Project-home content supplied through the shipped Thread page slots. */
  pageSlots?: Pick<ThreadComponents, "Welcome" | "WelcomeContent" | "BelowComposer" | "BelowComposerContent" | "emptyLayout" | "composerDensity" | "composerPlaceholder">;
  /** Route scope to start a fresh conversation in this project. */
  projectFolderId?: string;
  /** Changes each time the person arrives on Chat (the rail's Chat, New chat); the composer takes focus on each. */
  focusKey?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useComposerFocus(rootRef, focusKey);
  // COLUMN-01: the history column owns these (ChatColumn.tsx); the page
  // provides them, and a ChatThread shown outside the chat page has none.
  const chatColumn = useContext(ChatColumnControlContext);
  const focusChatSearch = useCallback(() => chatColumn?.openSearch(), [chatColumn]);
  const toggleSidebar = useCallback(() => chatColumn?.toggle(), [chatColumn]);
  // CHAT-CALM-ERRORS-01d (design section 7): while the engine is down or
  // starting, the person can keep typing but Send waits for `ready`.
  // ENGINE-DOWN-UI-01: the same state also holds every other engine-dependent
  // control, through the kit Thread's one `engineDown` prop.
  const engineDown = engineDownReason(useContext(ChatAvailabilityContext));
  const originMessages = useAuiState((s) => s.thread.messages);
  const originIsLoading = useAuiState((s) => s.thread.isLoading);
  const originRemoteId = useAuiState((s) => s.threadListItem.remoteId);
  const [originMissing, setOriginMissing] = useState(false);
  const [originHighlight, setOriginHighlight] = useState<OriginHighlightStyle | null>(null);
  const handledOrigin = useRef<string | null>(null);
  const statusApps = useStatusApps().data;
  const searchDown = Array.isArray(statusApps) && statusApps.some(isSearchLimitedChat);
  const householdSettings = useQuery({
    queryKey: ["settings-values", "household"],
    queryFn: () => api.settingsValues("household"),
  });
  const webSearchOff = Array.isArray(householdSettings.data)
    && householdSettings.data.some((setting) => setting.key === "search.source_mode.web" && setting.value === "offline");
  useEffect(() => {
    if (!originConversationId || !originTurnId || originRemoteId !== originConversationId || originIsLoading) return;
    const key = `${originConversationId}:${originTurnId}`;
    if (handledOrigin.current === key) return;
    setOriginMissing(false);
    const messageId = messageForTurn(originMessages.map((message) => ({
      id: message.id,
      role: message.role,
      turnId: typeof message.metadata?.custom?.turnId === "string" ? message.metadata.custom.turnId : undefined,
    })), originTurnId, originMessageRole);
    if (!messageId) {
      setOriginMissing(true);
      handledOrigin.current = key;
      return;
    }
    let highlightTimer = 0;
    let removeScrollTracking = () => {};
    const openTimer = window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLElement>("[data-message-id]")].find((element) => element.dataset.messageId === messageId);
      if (!target) return;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const updateHighlight = () => {
        const rect = target.getBoundingClientRect();
        setOriginHighlight({ "--origin-left": `${rect.left}px`, "--origin-top": `${rect.top}px`, "--origin-width": `${rect.width}px`, "--origin-height": `${rect.height}px` });
      };
      const trackScroll = () => updateHighlight();
      document.addEventListener("scroll", trackScroll, true);
      removeScrollTracking = () => document.removeEventListener("scroll", trackScroll, true);
      target.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "center" });
      highlightTimer = window.setTimeout(() => {
        updateHighlight();
        highlightTimer = window.setTimeout(() => { removeScrollTracking(); setOriginHighlight(null); }, reduced ? 700 : 1800);
      }, reduced ? 0 : 350);
      handledOrigin.current = key;
    }, 0);
    return () => { window.clearTimeout(openTimer); window.clearTimeout(highlightTimer); removeScrollTracking(); };
  }, [originConversationId, originIsLoading, originMessageRole, originMessages, originRemoteId, originTurnId]);
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
  const sendHeld = opening;
  // Text typed while the placeholder stands in for the chat (even past the
  // cap) moves into the opened chat's composer, so nothing typed is lost in
  // the switch. Only what changed during the open moves: a draft that was
  // already in the box beforehand stays where it was typed.
  const aui = useAui();
  useEffect(() => {
    if (!projectFolderId) return;
    let active = true;
    void Promise.resolve(aui.threads().switchToNewThread()).then(() => {
      if (!active) return;
      return aui.threads().reload().then(() => {
        if (active) setPendingChatFolder({ threadId: aui.threads().getState().mainThreadId, folderId: projectFolderId });
      });
    });
    return () => { active = false; };
  }, [aui, projectFolderId]);
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
      className="relative flex min-h-0 flex-1 flex-col outline-none"
    >
      {TOOL_BINDINGS.map((binding) => <ElementBinding key={binding.toolName} binding={binding} />)}
      {DATA_BINDINGS.map((binding) => <DataElementBinding key={binding.name} binding={binding} />)}
      <div className="flex justify-center">
        <ChatConnectionBanner />
      </div>
      {webSearchOff ? (
        <Alert role="status">
          <AlertTitle>Web search is off</AlertTitle>
          <AlertDescription>Web search is turned off for this home. An owner can turn it on in Settings under Search.</AlertDescription>
        </Alert>
      ) : searchDown ? (
        <Alert role="status">
          <AlertTitle>Web search is unavailable</AlertTitle>
          <AlertDescription>Home could not reach web search. An owner can check Settings under Search, then Repairs if it still does not work.</AlertDescription>
        </Alert>
      ) : null}
      <ChatExtrasContext.Provider value={extraContext}>
        {originMissing ? <p role="status" className="px-4 py-2 text-sm text-muted-foreground">That message is no longer available. This chat is open at the end.</p> : null}
        {originHighlight ? <div data-origin-highlight aria-hidden="true" className="pointer-events-none z-50 rounded-lg border-2 border-primary bg-primary/10 motion-reduce:transition-none" style={{ "--origin-left": originHighlight["--origin-left"], "--origin-top": originHighlight["--origin-top"], "--origin-width": originHighlight["--origin-width"], "--origin-height": originHighlight["--origin-height"] } as CSSProperties} /> : null}
        <Thread
          tourId="chat.thread"
          composerTourId="chat.composer"
          sendButtonTourId="chat.send"
          temporary={temporary}
          scrollToBottomOffset={56}
          components={{
            ...THREAD_SLOTS,
            ToolFallback: BoundToolFallbackGuard,
            composerNoticeLayout: "truncate",
            // CHAT-COMPOSER-SLOT-01: the notice line is always there, empty or not.
            composerNoticeReserve: true,
            onEditSend,
            sendHeld,
            engineDown,
            speakerMarker: {
              joinedLabel: (name) => `${name} joined for one question`,
              fallbackPoster: (speaker) => speaker.look
                ? api.companionLookImage(speaker.companion_id, speaker.look)
                : undefined,
            },
            // CHAT-ACTION-ROW-01: copy, listen, rate, refresh and more sit under every reply, as in ChatGPT, not only the last.
            assistantActionBarAutohide: "never",
            ThreadViewportExtra: ChatThreadExtras,
            viewport: {
              turnAnchor: "bottom",
              autoScroll: true,
              scrollToBottomOnRunStart: true,
              scrollToBottomOnInitialize: true,
              scrollToBottomOnThreadSwitch: true,
            },
            ...(thinkingModeVisible ? { ComposerExtraEnd: MODEL_TRAILING_SLOT } : {}),
            ...pageSlots,
          }}
        />
      </ChatExtrasContext.Provider>
    </div>
  );
}
