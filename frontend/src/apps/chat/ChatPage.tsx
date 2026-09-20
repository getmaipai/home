import { SensesDock, type SenseItem } from "@maipai/ui/src/blocks/chat/SensesDock";
import { ChildBand } from "@maipai/ui/src/blocks/chat/ChildBand";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { AssistantRuntimeProvider, useAui, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Button } from "@maipai/ui/src/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@maipai/ui/src/ui/sheet";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { Thread } from "@/apps/chat/thread.aui";
import { ThreadList, ThreadListNew } from "@maipai/ui/src/assistant-ui/thread-list.aui";
import * as Popover from "@radix-ui/react-popover";
import { TooltipIconButton } from "@maipai/ui/src/assistant-ui/tooltip-icon-button";
import { api } from "@/lib/api";
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
  const [threadsOpen, setThreadsOpen] = useState(false);
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
  composerDisabledRef.current = composerDisabledReason;

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
  const threadListAdapter = useMemo(() => createChatThreadListAdapter(person.display_name), [person.display_name]);

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
            <div className="flex items-center gap-1">
              {/* Phone and tablet (spec.md "Layout"; `lg:` not `sm:` -
                  tokens.css's own --breakpoint-lg note: the kit's 960px
                  default reopens a squeeze at tablet width, the same
                  reason SettingsPage's own rail uses `lg:flex` and not
                  `sm:flex`): desktop's own thread list is the persistent
                  column below, never toggled. */}
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={threadsOpen ? "Hide threads" : "Show threads"} aria-expanded={threadsOpen} aria-controls="chat-threads" onClick={() => setThreadsOpen((open) => !open)}>
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
              <ThreadListNew aria-label="New chat" className="relative lg:hidden size-9 justify-center p-0 before:absolute before:-inset-1.5 before:content-['']" labelClassName="sr-only" />
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
              <ThreadList />
            </aside>
            <Sheet open={threadsOpen} onOpenChange={setThreadsOpen}>
              <SheetContent id="chat-threads" side="left" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-2 lg:hidden">
                <SheetHeader className="sr-only">
                  <SheetTitle>Conversations</SheetTitle>
                  <SheetDescription>Your chat threads</SheetDescription>
                </SheetHeader>
                <ThreadList />
              </SheetContent>
            </Sheet>
            <div className="min-h-0 min-w-0 flex-1">
              <Thread composerDisabled={composerDisabledReason !== undefined} composerDisabledReason={composerDisabledReason}
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
