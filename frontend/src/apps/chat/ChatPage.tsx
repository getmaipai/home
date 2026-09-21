import { SensesDock, type SenseItem } from "@maipai/ui/src/blocks/chat/SensesDock";
import { ChildBand } from "@maipai/ui/src/blocks/chat/ChildBand";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AssistantRuntimeProvider, useAui, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Button } from "@maipai/ui/src/ui/button";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@maipai/ui/src/ui/sheet";
import { usePhoneMode } from "@maipai/ui/src/blocks/phone/PhoneMode";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { Thread } from "@/apps/chat/thread.aui";
import { ThreadList, ThreadListNew, type ThreadListActions } from "@maipai/ui/src/assistant-ui/thread-list.aui";
import * as Popover from "@radix-ui/react-popover";
import { TooltipIconButton } from "@maipai/ui/src/assistant-ui/tooltip-icon-button";
import { api, isOwnerOrAdminRole, type PersonRosterEntry } from "@/lib/api";
import { useWakeWord } from "@/apps/chat/useWakeWord";
import { getIcon } from "@maipai/ui/src/icons";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createLocalImageAttachmentAdapter } from "@/apps/chat/localImageAttachmentAdapter";
import { CURRENT_LOCAL_VISION_CAPABILITY } from "@/apps/chat/visionCapability";
import { ChatChildBandContext, ChatFeedbackOpenContext, ChatFeedbackOpenSetterContext, createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import { brainBlockReason, ChatBrainBadContext, useEngineHealth } from "@/apps/chat/useEngineHealth";
import { canViewChatDetails, useChatDisclosure } from "@/apps/chat/useChatDisclosure";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import { createSttSocket } from "@/lib/voice/sttSocket";
import { ChatActorContext } from "@/apps/chat/chatMemoryActions";
import { useMemoryStatusPoll } from "@/apps/chat/chatMemoryState";
import { consumeSupersedes } from "@/apps/chat/chatEditSupersedes";
import { consumeContinuation } from "@/apps/chat/chatContinue";
import { cn } from "@maipai/ui/src/utils";
import { ChatDocumentOpenContext, ChatDocumentPane } from "@/apps/chat/chatDocumentPane";
import { ChatTurnStatsVisibleContext } from "@/apps/chat/chatTurnStats";
import type { Roster } from "@/lib/api";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

// `DictationAdapter.Session` has no reference to the composer runtime
// (sttDictationAdapter.ts's own comment) - `useAui()` is only valid
// inside `AssistantRuntimeProvider`'s own subtree, which the adapter
// (created before that provider even renders) never is, so this small
// component is the one place that actually calls `aui.composer.send()`,
// the documented way (`@assistant-ui/store`'s own `useAui()` doc
// example) to submit from outside a primitive's own click handler. A
// plain ref, not an EventTarget/CustomEvent pair (a code review,
// 2026-09-06, found that more machinery than one callback needs): this
// component sets the ref to a real sender once mounted, and
// `onFinalReady` (sttDictationAdapter.ts's dep) just calls it.
function SttAutoSend({ sendRef }: { sendRef: MutableRefObject<(() => void) | null> }) {
  const aui = useAui();
  useEffect(() => {
    sendRef.current = () => aui.composer.send();
    return () => {
      sendRef.current = null;
    };
  }, [sendRef, aui]);
  return null;
}

const HistoryIcon = getIcon("history");
const BrainIcon = getIcon("brain");
const VolumeXIcon = getIcon("volume-x");
const OptionsIcon = getIcon("sliders-horizontal");

interface ChatPageProps {
  person: Roster;
}

type ChatConversationMode = "chat" | "research" | "temporary";

/** The thread list plus, for an owner or admin with more than one
 * household member, the picker that switches whose list it shows -
 * ConversationsPage's own admin-oversight function, restored (HOME-UI-
 * 02e). Rendered twice (the desktop column, the phone/tablet sheet) so
 * this is its own component rather than repeated inline JSX. */
function ChatThreadListPanel({
  person,
  canViewOthers,
  people,
  viewingPersonId,
  onViewingPersonChange,
  actions,
  onSearchQueryChange,
}: {
  person: Roster;
  canViewOthers: boolean;
  people: PersonRosterEntry[] | undefined;
  viewingPersonId: string | undefined;
  onViewingPersonChange: (personId: string | undefined) => void;
  actions: ThreadListActions | undefined;
  onSearchQueryChange: (query: string) => void;
}) {
  const others = people?.filter((p) => p.id !== person.id) ?? [];
  const viewingSelf = viewingPersonId === undefined || viewingPersonId === person.id;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {canViewOthers && others.length > 0 && (
        <Select
          aria-label="Whose chats"
          value={viewingPersonId ?? person.id}
          onValueChange={(value) => onViewingPersonChange(value === person.id ? undefined : value)}
          options={[person.id, ...others.map((p) => p.id)]}
          getLabel={(id) => (id === person.id ? "You" : (others.find((p) => p.id === id)?.display_name ?? id))}
        />
      )}
      {/* pinnable unconditional (not gated on viewingSelf, unlike
          actions below): Home's own adapter always implements
          updateCustom, and the backend's own PATCH route already
          enforces the same canAccessPerson() check pinning would need -
          an admin looking at a child's own list can pin their threads
          the same way ConversationsPage's own retired page let them.
          newChatEnabled={viewingSelf}: the kit's own adapter has no
          per-target `initialize()`, so a "New chat" clicked while
          viewing someone else would create the conversation under the
          viewer instead and splice into what the screen still labels
          as the other person's list. key={viewingPersonId ?? "self"}
          (a code review, critical): without it, the kit's own multi-
          select state (selectMode/selected) is plain useState inside
          `ThreadList` with nothing to reset it on a person switch - a
          selection begun on the admin's own list would survive the
          switch, could gain a child's thread too, and "Delete selected"
          would submit a mixed id list the backend's own per-id
          `canAccessPerson` check actually allows, silently deleting the
          child's conversation while the screen only ever showed "You"
          at the moment of the click. Changing `key` forces React to
          fully unmount and remount `ThreadList` on every switch,
          resetting all of its own internal state, not just the parts
          this file happens to know about. */}
      <ThreadList
        key={viewingPersonId ?? "self"}
        actions={actions}
        pinnable
        newChatEnabled={viewingSelf}
        onSearchQueryChange={onSearchQueryChange}
      />
    </div>
  );
}

export function ChatPage({ person }: ChatPageProps) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [documentTurnId, setDocumentTurnId] = useState<string | null>(null);
  const [conversationMode, setConversationMode] = useState<ChatConversationMode>("chat");
  const conversationModeRef = useRef<ChatConversationMode>("chat");
  conversationModeRef.current = conversationMode;
  const canViewTurnStats = canViewChatDetails(person.role);
  const canViewTemporaryMode = person.role === "owner" || person.role === "admin" || person.role === "adult";
  // `null` is the loading state, not permission to show telemetry. A fresh
  // reply can arrive before this request settles, so the projection below
  // must stay false until the persisted preference explicitly says true.
  // Shared with the header's own model picker (AppShell.tsx) - one fetch
  // of the same setting, not two independently drifting ones.
  const [turnStatsVisible, setTurnStatsVisible] = useChatDisclosure(person);
  // Home's prompt box and the search palette's "Ask MaiPai" row both
  // navigate here with `state: { initialText }` (step 6) - read once,
  // not kept reactive to `location.state` changing later, since a
  // second navigation to /chat (the nav link, "Chat" in the palette)
  // should land on a plain empty composer, not replay a stale prompt.
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const conversationId = searchParams.get("conversation");
  useEffect(() => {
    setConversationMode("chat");
    if (!conversationId) return;
    api.conversation(conversationId).then((conversation) => {
      setConversationMode(conversation.mode);
    }).catch(() => {});
  }, [conversationId]);

  const toggleTemporaryMode = () => {
    if (!canViewTemporaryMode) return;
    if (!conversationId) {
      void api.createConversation("temporary").then((conversation) => {
        setConversationMode(conversation.mode);
        setSearchParams({ conversation: conversation.id });
      }).catch(() => setBanner("Temporary chat could not be started. Try again."));
      return;
    }
    const next: ChatConversationMode = conversationMode === "temporary" ? "chat" : "temporary";
    const previous = conversationMode;
    setConversationMode(next);
    void api.setConversationMode(conversationId, next).catch(() => setConversationMode(previous));
  };
  // CHAT-20: the same conversation id the runtime below uses as its own
  // `threadId` - polling follows whichever conversation is actually open,
  // stopping on its own (chatMemoryState.ts's own cleanup) the moment the
  // person switches threads, navigates away, or nothing is pending.
  useMemoryStatusPoll(searchParams.get("conversation") ?? undefined);
  const initialText =
    typeof (location.state as { initialText?: unknown } | null)?.initialText === "string"
      ? (location.state as { initialText: string }).initialText
      : undefined;

  // Off by default (Jesse, 2026-09-04: "thinking mode off by default with
  // the ability to enable in chats when needed"): a per-message opt-in,
  // not a standing setting, since most turns don't need the extra
  // latency. Read via a ref (thinkingRef) inside the adapter, which is
  // created once (useMemo below) rather than recreated on every toggle.
  const [thinking, setThinking] = useState(false);
  const thinkingRef = useRef(false);
  thinkingRef.current = thinking;

  // 4.3: "offer, never block" - a crisis-resources banner rides alongside
  // the reply; also doubles as the wake-word demo banner below, the same
  // single banner slot the pre-assistant-ui version used.
  const [banner, setBanner] = useState<string | null>(null);

  // The live reply's own sentence-by-sentence speech (chatModelAdapter.ts):
  // owned here, not inside the adapter, so a manual "Listen" replay
  // (chatListenStore.ts) can stop it the moment a household member clicks
  // Listen on an earlier message mid-reply.
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);

  // Jesse, 2026-09-06: the composer's own Send/Stop toggle only tracks
  // text generation - text almost always finishes streaming before its
  // speech has finished playing, so the button flips back to "Send"
  // while the reply is still being read aloud, with nothing on screen
  // able to stop it. This tracks that window (chatModelAdapter.ts's
  // onSpeakingChange, wired to the scheduler's onFirstAudio/onEnded) so
  // a dedicated control can cover it.
  const [isSpeaking, setIsSpeaking] = useState(false);
  // `?list=1` (the `/conversations` redirect - owner ruling,
  // "Navigation, corrected," 2026-09-20: "Conversations live inside
  // Chat... a sheet from the header's list icon on the phone") opens
  // the thread sheet on arrival, phone width only - the persistent
  // desktop column is already always visible. `phone &&` here, not
  // just on the Sheet's own `open` prop below: a `threadsOpen=true`
  // with no phone-width Sheet actually open left the header's own
  // toggle button (`aria-expanded="true" aria-controls="chat-
  // threads"`) pointing at an id Radix never mounts while `open` is
  // false, an `aria-valid-attr-value` violation found live once
  // desktop/tablet stopped hanging on the aria-hidden bug below and
  // could reach this next one. `useBreakpoint()` (usePhoneMode's own
  // source) reads `window.innerWidth` synchronously on first render,
  // so `phone` is already correct the instant this initializer runs,
  // same as the URL search params are.
  const phone = usePhoneMode();
  const [threadsOpen, setThreadsOpen] = useState(() => phone && new URLSearchParams(window.location.search).get("list") === "1");
  // A code review caught this as reachable, not just theoretical:
  // `phone` is a live breakpoint (`usePhoneMode()`) that can flip
  // mid-session on a real resize/rotation, but nothing reset
  // `threadsOpen` when it did - the toggle button's own aria-expanded/
  // aria-label/aria-controls read raw `threadsOpen` while the Sheet's
  // `open` prop read `phone && threadsOpen`, so a resize while the
  // sheet was open left the button announcing "Hide threads,"
  // `aria-expanded="true"`, and `aria-controls` pointing at a sheet
  // Radix had already stopped mounting. One derived value, read
  // everywhere below, so the two can't drift apart again.
  const sheetOpen = phone && threadsOpen;
  const [speechError, setSpeechError] = useState(false);
  const wakeWord = useWakeWord({ onWakeDetected: () => setBanner("MaiPai heard its wake word. It can't act on it yet - that's coming soon.") });

  // Single source for the model's lifecycle state (the composer's
  // ready-to-send gate below, and the header's own model picker in
  // AppShell.tsx, both read this so they can never again disagree the
  // way an old status pill and an always-enabled Send button just did,
  // Jesse, 2026-09-06: "Starting…" shown while chat still accepted
  // prompts). A failed or slow reply's own recovery UI lives on the turn
  // itself now (thread.aui.tsx's MessageError/indicator), not a second
  // status surface here (spec.md "Empty, loading, error").
  // HOME-UI-02e: restoring ConversationsPage's own admin oversight -
  // `viewingPersonId` undefined means "my own list," the same
  // convention the retired page used (`viewing` state there). Declared
  // ahead of `composerDisabledReason`/`composerDisabledRef` below: the
  // STT auto-send path reads that ref directly, bypassing the rendered
  // composer's own `disabled` prop entirely, so `viewingSelf` has to be
  // known before that ref's first assignment, not computed later and
  // left stale for voice turns the same way a code review already
  // found once for the engine-health reason (2026-09-06, the "Starting…
  // shown while chat still accepted prompts" bug this whole ref exists
  // to close).
  const [viewingPersonId, setViewingPersonId] = useState<string | undefined>(undefined);
  const viewingSelf = viewingPersonId === undefined || viewingPersonId === person.id;
  // `getConversationId()`'s own `api.resumeConversation` rejects any
  // conversation whose `personId` isn't the actor's
  // (conversationHistory.ts) - opening one of a child's real
  // conversations and replying used to fail with an opaque error
  // instead of being prevented (a code review). Not layered onto
  // `brainBad`/`ChatBrainBadContext` below - that context means "the
  // engine is unhealthy," a different concept a person viewing someone
  // else's list shouldn't see conflated with.
  const viewingOthersComposerReason = viewingSelf ? undefined : "Viewing someone else's chats - switch back to “You” to reply.";

  const health = useEngineHealth();
  const composerDisabledReason = brainBlockReason(health?.brain);
  // One definition of "bad" for both consumers: `brainBlockReason`'s own
  // set (starting/stopped - a turn sent while healthy that fails after
  // the engine drops into either mid-flight failed for the engine's own
  // reason, not some other cause) plus "unreachable" (the health check
  // itself failing, not a state `brainBlockReason` gates the composer
  // on). A separately-hand-picked list here previously left "starting"
  // out, so a turn that failed exactly as the engine dropped into
  // "starting" mid-flight got no "Open AI models" recovery link even
  // though `brainBlockReason`'s own comment already covers exactly this
  // failure mode.
  const brainBad = composerDisabledReason !== undefined || health?.brain === "unreachable";
  // spec.md "The senses dock and the model picker": listening, speaking,
  // vision (when on - Home has no live camera vision in chat yet, so
  // that sense is simply never included) as status icons, teal/
  // secondary/red for active/idle/refused.
  const senses: SenseItem[] = [
    {
      kind: "listening",
      state: wakeWord.status === "listening" ? "active" : wakeWord.status === "error" ? "refused" : "idle",
      label: wakeWord.status === "listening" ? 'Listening for "hey jarvis"' : wakeWord.status === "error" ? (wakeWord.error ?? "Microphone unavailable") : wakeWord.status === "starting" ? "Starting the microphone" : "Wake word is off",
    },
    {
      kind: "speaking",
      state: speechError ? "refused" : isSpeaking ? "active" : "idle",
      label: speechError ? "Speech didn't play. Your text reply is still here." : isSpeaking ? "Speaking" : "Not speaking",
    },
  ];
  // Read inside `onFinalReady` below (dictationAdapter is `useMemo`'d
  // once, same reason `thinkingRef` exists): dictation's auto-send calls
  // `aui.composer.send()` straight through the assistant-ui runtime,
  // bypassing the rendered composer's `disabled` textarea/button
  // entirely - a code review, 2026-09-06, caught that a wake-word or
  // mic-button turn still went out while the model was starting, the
  // exact bug this whole gate exists to close, just through voice
  // instead of the keyboard.
  const composerDisabledRef = useRef<string | undefined>(undefined);
  composerDisabledRef.current = composerDisabledReason ?? viewingOthersComposerReason;

  const suggestionAdapter = useMemo(() => createChatSuggestionAdapter(initialText), [initialText]);
  const imageAttachmentAdapter = useMemo(
    () => createLocalImageAttachmentAdapter({ capability: () => CURRENT_LOCAL_VISION_CAPABILITY }),
    [],
  );
  // Set by `SttAutoSend` once it mounts inside `AssistantRuntimeProvider`
  // (below); `onFinalReady` below just calls whatever's there.
  const sttAutoSendRef = useRef<(() => void) | null>(null);
  const dictationAdapter = useMemo(
    () =>
      createSttDictationAdapter({
        createSocket: createSttSocket,
        turnSchedulerRef,
        // The transcript itself already landed in the composer
        // (speech.notify() above, in sttDictationAdapter.ts) - skipping
        // the send here just leaves it sitting there, same as typed text,
        // for the household member to send once the model's ready.
        onFinalReady: () => {
          if (composerDisabledRef.current === undefined) sttAutoSendRef.current?.();
        },
      }),
    [],
  );
  // Multi-select, clear-all, and server-side search - the rest of
  // ConversationsPage's own admin-oversight restoration (design doc's
  // "Conversations live inside Chat"); `viewingPersonId`/`viewingSelf`
  // themselves are declared above, ahead of `composerDisabledReason`.
  // Re-creating the adapter on either change is the documented way to
  // make `useRemoteThreadListRuntime` reload (its own
  // `RemoteThreadListOptions.adapter` doc comment: "the adapter
  // reference should remain stable across renders. Replacing it reloads
  // the list").
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const canViewOthers = isOwnerOrAdminRole(person.role);
  // staleTime matches the sibling admin-gated pattern (useHubStatus.ts's
  // own `hardware` query) - the roster barely changes, so a return trip
  // to Chat shouldn't refetch it every time.
  const peopleQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people(), staleTime: 5 * 60 * 1000, enabled: canViewOthers });
  const threadListAdapter = useMemo(
    () => createChatThreadListAdapter(person.display_name, { personId: viewingSelf ? undefined : viewingPersonId, query: threadSearchQuery.trim() || undefined }),
    [person.display_name, viewingSelf, viewingPersonId, threadSearchQuery],
  );
  // Only offered for the actor's own list, matching the retired page's
  // own gating: `api.clearConversations()` only ever deletes the
  // actor's own conversations regardless of who's being viewed
  // (conversationHistory.ts's own `clearConversations`), so offering it
  // while viewing someone else would silently do nothing useful - hiding
  // it here is the honest UI for what the endpoint actually does, not
  // just belt-and-suspenders.
  const threadListActions: ThreadListActions | undefined = viewingSelf
    ? {
        batchDelete: async (remoteIds) => { await api.batchDeleteConversations(remoteIds); },
        clearAll: async () => { await api.clearConversations(); },
      }
    : undefined;

  // A named, `use`-prefixed function, not an inline arrow: `useRemoteThreadListRuntime`
  // calls `runtimeHook` from inside its own render (assistant-ui's documented
  // pattern for this option), so this genuinely is a hook call by the rules
  // themselves - naming it this way is what lets react-hooks/rules-of-hooks
  // recognize that instead of flagging a bare arrow function calling a hook.
  function useChatRuntimeHook() {
    const aui = useAui();
    const chatModelAdapter = useMemo(
    () =>
      createChatModelAdapter({
        getConversationId: async () => {
          const { remoteId } = await aui.threadListItem().initialize();
          await api.resumeConversation(remoteId);
          return remoteId;
        },
        consumeThinking: () => {
          const value = thinkingRef.current;
          thinkingRef.current = false;
          setThinking(false);
          return value;
        },
        consumeSupersedes,
        consumeContinuation,
        onCrisisResources: setBanner,
        turnSchedulerRef,
        onSpeakingChange: (value) => { setIsSpeaking(value); if (value) setSpeechError(false); },
        onReplyState: (state) => { if (state === "waiting") setSpeechError(false); },
        onSpeechError: () => setSpeechError(true),
        onResearchDocument: (turnId) => {
          if (conversationModeRef.current === "research") setDocumentTurnId(turnId);
        },
      }),
    [aui],
  );

    return useLocalRuntime(chatModelAdapter, { adapters: { attachments: imageAttachmentAdapter, suggestion: suggestionAdapter, dictation: dictationAdapter, feedback: createChatFeedbackAdapter() } });
  }

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatRuntimeHook,
    adapter: threadListAdapter,
    threadId: searchParams.get("conversation") ?? undefined,
    onThreadIdChange: (id) => {
      setSearchParams(id ? { conversation: id } : {}, { replace: true });
      setThreadsOpen(false);
    },
  });

  // One element, rendered at both the desktop aside and the phone/tablet
  // Sheet's own content below - a code review caught the two call sites
  // being copy-pasted with identical props (nothing differs between
  // them); reusing the same element reference at two different tree
  // positions is a normal React pattern, not a "rendered twice" bug -
  // each gets its own component instance from its own parent position.
  const threadListPanel = (
    <ChatThreadListPanel
      person={person}
      canViewOthers={canViewOthers}
      people={peopleQuery.data}
      viewingPersonId={viewingPersonId}
      onViewingPersonChange={setViewingPersonId}
      actions={threadListActions}
      onSearchQueryChange={setThreadSearchQuery}
    />
  );

  return (
    // SensesDock's own Tooltip needs an ancestor TooltipProvider - the
    // real app already gets one from Shell.tsx's own SidebarProvider,
    // but ChatPage is tested standalone (ChatPage.test.tsx), so this
    // page carries its own rather than depending on that ancestor.
    <TooltipProvider>
    <ChatActorContext.Provider value={person.id}>
      <ChatChildBandContext.Provider value={person.role === "child"}>
        <ChatBrainBadContext.Provider value={brainBad}>
        <ChatTurnStatsVisibleContext.Provider value={canViewTurnStats && turnStatsVisible === true}>
        <ChatFeedbackOpenContext.Provider value={feedbackOpen}>
          <ChatFeedbackOpenSetterContext.Provider value={setFeedbackOpen}>
            <ChatDocumentOpenContext.Provider value={setDocumentTurnId}>
              <AssistantRuntimeProvider runtime={runtime}>
                <SttAutoSend sendRef={sttAutoSendRef} />
                <Page title="Chat" hideTitle>
                  {/* Keep the chat controls in normal flow above the thread.
                      The opaque, non-shrinking header is deliberately not a
                      layer over the viewport, so a bottom-anchored reply's
                      action row cannot paint through it at short heights. */}
                  <div data-slot="aui_chat-header" className="relative z-20 shrink-0 border-b border-border/60 bg-background px-4 py-2">
                    <div className="flex items-center justify-between gap-3">
            {/* overflow-x-auto: found live at 390px - the history
                toggle, "Chat," Research/Temporary/Details (each only
                rendered when its own condition allows it) and "New
                chat" together are wider than a phone screen with
                nothing to shrink further without losing a real
                control; scrolling keeps every one of them reachable
                instead of clipping the row (the screenshot pipeline's
                own per-panel overflow check, HOME-UI-02d, is what
                caught this - a real, pre-existing gap the page-level
                check before it never saw). */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {/* Phone and tablet (spec.md "Layout"; `lg:` not `sm:` -
                  tokens.css's own --breakpoint-lg note: the kit's 960px
                  default reopens a squeeze at tablet width, the same
                  reason SettingsPage's own rail uses `lg:flex` and not
                  `sm:flex`): desktop's own thread list is the persistent
                  column below, never toggled. */}
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={sheetOpen ? "Hide threads" : "Show threads"} aria-expanded={sheetOpen} aria-controls="chat-threads" onClick={() => setThreadsOpen((open) => !open)}>
                <HistoryIcon className="size-4" />
              </Button>
              <h2 className="text-base font-semibold">Chat</h2>
              {conversationMode !== "temporary" ? <Button type="button" variant={conversationMode === "research" ? "secondary" : "ghost"} size="sm" aria-pressed={conversationMode === "research"} aria-label={conversationMode === "research" ? "Turn off research mode" : "Turn on research mode"} disabled={!conversationId} onClick={() => {
                if (!conversationId) return;
                const next = conversationMode === "research" ? "chat" : "research";
                const previous = conversationMode;
                setConversationMode(next);
                void api.setConversationMode(conversationId, next).catch(() => setConversationMode(previous));
              }}>Research</Button> : null}
              {canViewTemporaryMode ? <Button type="button" variant={conversationMode === "temporary" ? "secondary" : "ghost"} size="sm" aria-pressed={conversationMode === "temporary"} aria-label={conversationMode === "temporary" ? "Turn off temporary chat" : conversationId ? "Turn on temporary chat" : "Start temporary chat"} onClick={toggleTemporaryMode}>Temporary</Button> : null}
              {canViewTurnStats ? <Button type="button" variant={turnStatsVisible === true ? "secondary" : "ghost"} size="sm" aria-pressed={turnStatsVisible === true} aria-label="Show advanced reply stats" onClick={() => {
                const next = turnStatsVisible !== true;
                setTurnStatsVisible(next);
                void api.setSetting(`person:${person.id}`, "ui.show_turn_stats", next).catch(() => {});
              }}>Details</Button> : null}
              {/* `relative before:-inset-1.5`: the touch-target floor
                  (docs/UI.md, BACKLOG.md lane 8 item 1, 2026-09-13) - a
                  `size="icon-lg"` prop alone loses this component's own
                  baked-in `h-8` in the className merge order, so the
                  hit-area extension has to ride along with the `size-9`
                  override in this component's own className, the one
                  place guaranteed to win. `lg:hidden`: desktop's thread
                  list is the persistent column (spec.md "Layout", "'New
                  chat' is the one primary action, pinned at the top of
                  the column") - this header shortcut exists only where
                  the list starts hidden inside the sheet (phone and
                  tablet - `lg:`, not `sm:`, see the toggle button above). */}
              {/* viewingSelf-gated (a code review): this header shortcut
                  is a second, standalone `<ThreadListNew>` outside the
                  kit's own `<ThreadList>` toolbar, so `newChatEnabled`
                  on that component never reaches it - the same
                  cross-person-splice gap `newChatEnabled` exists to
                  close, reachable through this second entry point until
                  it's gated the same way here directly. */}
              {viewingSelf && <ThreadListNew aria-label="New chat" className="relative lg:hidden size-9 justify-center p-0 before:absolute before:-inset-1.5 before:content-['']" labelClassName="sr-only" />}
            </div>
            {/* spec.md "The senses dock and the model picker": the model
                picker is not a chat control - it lives in the header
                picker slot (AppShell.tsx's own headerActions, gated to
                this route and Developer disclosure), not here. */}
            <SensesDock senses={senses} wakeWordLabel="Wake word" wakeWordEnabled={wakeWord.enabled} onWakeWordChange={() => wakeWord.toggle()} />
                    </div>
                  </div>
                  {person.role === "child" ? <ChildBand personName={person.display_name} /> : null}
                  {conversationMode === "temporary" ? <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[var(--muted)] px-3 py-2 text-base" role="status">Temporary chat is not saved to normal history or memory. Reloading will not bring these messages back.</div> : null}
                  {banner ? <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[var(--muted)] px-3 py-2 text-base">{banner}</div> : null}
                  <div className="relative flex min-h-0 flex-1">
            {/* Desktop: a persistent 280px column under the shell's rail
                (spec.md "Layout"), never toggled - `threadsOpen` only
                drives the phone/tablet sheet below. `lg:flex`, matching
                the toggle button's own `lg:hidden` above and
                SettingsPage's rail: at `sm:` (640px) tablet's 820px
                already qualified as "desktop", leaving too little room
                beside this column and the shell's own rail for the
                composer - the touch-target-floor violation on the
                Message input textarea at 820px, found live in the full
                screenshot matrix. */}
            <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-e border-border/60 bg-background p-2 lg:flex">
              {threadListPanel}
            </aside>
            <Sheet open={sheetOpen} onOpenChange={setThreadsOpen}>
              <SheetContent id="chat-threads" side="left" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-2 lg:hidden">
                <SheetHeader className="sr-only">
                  <SheetTitle>Conversations</SheetTitle>
                  <SheetDescription>Your chat threads</SheetDescription>
                </SheetHeader>
                {threadListPanel}
              </SheetContent>
            </Sheet>
            <div className="min-h-0 min-w-0 flex-1">
              <Thread composerDisabled={composerDisabledReason !== undefined || viewingOthersComposerReason !== undefined} composerDisabledReason={composerDisabledReason ?? viewingOthersComposerReason}
                composerToolbar={<>
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <TooltipIconButton tooltip={thinking ? "Chat options: thinking on" : "Chat options"} className={cn("relative size-9 rounded-full before:absolute before:-inset-1.5 before:content-['']", thinking && "bg-primary text-primary-foreground")}><OptionsIcon className="size-4" /></TooltipIconButton>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content side="top" align="start" sideOffset={8} className="z-50 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg">
                        <Button type="button" variant="ghost" onClick={() => setThinking((value) => !value)} aria-pressed={thinking}>
                          <BrainIcon />Think longer{thinking ? " (on)" : ""}
                        </Button>
                        {/* text-base, not text-xs: the type floor (docs/UI.md), lane 7 item 3. */}
                        <p className="px-3 pb-2 text-base text-muted-foreground">For your next message only.</p>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>

                  {isSpeaking ? <TooltipIconButton tooltip="Stop speaking" className="relative size-9 rounded-full before:absolute before:-inset-1.5 before:content-['']" onClick={() => { turnSchedulerRef.current?.stop(); setIsSpeaking(false); }}><VolumeXIcon className="size-4" /></TooltipIconButton> : null}
                </>}
              />
            </div>
                    <ChatDocumentPane turnId={documentTurnId} onClose={() => setDocumentTurnId(null)} />
                  </div>
                </Page>
              </AssistantRuntimeProvider>
            </ChatDocumentOpenContext.Provider>
          </ChatFeedbackOpenSetterContext.Provider>
        </ChatFeedbackOpenContext.Provider>
        </ChatTurnStatsVisibleContext.Provider>
        </ChatBrainBadContext.Provider>
      </ChatChildBandContext.Provider>
    </ChatActorContext.Provider>
    </TooltipProvider>
  );
}
