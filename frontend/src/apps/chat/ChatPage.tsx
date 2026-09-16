import { SensesDock, type ReplyState, type EarState } from "./SensesDock";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { AssistantRuntimeProvider, useAui, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { Page } from "@/kit/primitives/Page";
import { Button } from "@/kit/ui/button";
import { Thread } from "@/kit/assistant-ui/thread.aui";
import { ThreadList, ThreadListNew } from "@/kit/assistant-ui/thread-list.aui";
import * as Popover from "@radix-ui/react-popover";
import { TooltipIconButton } from "@/kit/assistant-ui/tooltip-icon-button";
import { api } from "@/lib/api";
import { WakeWordToggle } from "@/apps/chat/WakeWordToggle";
import { getIcon } from "@/kit/icons";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createLocalImageAttachmentAdapter } from "@/apps/chat/localImageAttachmentAdapter";
import { CURRENT_LOCAL_VISION_CAPABILITY } from "@/apps/chat/visionCapability";
import { ChatChildBandContext, ChatFeedbackOpenContext, ChatFeedbackOpenSetterContext, createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import { brainBlockReason, useEngineHealth } from "@/apps/chat/useEngineHealth";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import { createSttSocket } from "@/lib/voice/sttSocket";
import { ChatActorContext } from "@/apps/chat/chatMemoryActions";
import { useMemoryStatusPoll } from "@/apps/chat/chatMemoryState";
import { consumeSupersedes } from "@/apps/chat/chatEditSupersedes";
import { consumeContinuation } from "@/apps/chat/chatContinue";
import { cn, FOCUS_RING } from "@/kit/utils";
import { ChatDocumentOpenContext, ChatDocumentPane } from "@/apps/chat/chatDocumentPane";
import { ChatTurnStatsVisibleContext } from "@/apps/chat/chatTurnStats";
import { ChatModelPicker } from "@/apps/chat/ChatModelPicker";
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
  const canViewTurnStats = person.role === "owner" || person.role === "admin" || person.role === "adult";
  const canViewTemporaryMode = person.role === "owner" || person.role === "admin" || person.role === "adult";
  const [turnStatsVisible, setTurnStatsVisible] = useState(false);
  useEffect(() => {
    setTurnStatsVisible(false);
    if (!canViewTurnStats) return;
    api.settingsValues(`person:${person.id}`).then((values) => {
      const setting = values.find((value) => value.key === "ui.show_turn_stats");
      setTurnStatsVisible(setting?.value === true);
    }).catch(() => {});
  }, [canViewTurnStats, person.id]);
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
  const [reply, setReply] = useState<ReplyState>("idle");
  const [speechError, setSpeechError] = useState(false);
  const [ears, setEars] = useState<EarState>("idle");
  const [earError, setEarError] = useState<string | null>(null);
  const onEarStatus = useCallback((state: EarState, error: string | null) => { setEars(state); setEarError(error); }, []);

  // Single source for the model's lifecycle state (SensesDock's pill and
  // the composer's ready-to-send gate below both read this, so they can
  // never again disagree the way the pill and an always-enabled Send
  // button just did (Jesse, 2026-09-06: "Starting…" shown while chat
  // still accepted prompts).
  const health = useEngineHealth();
  const composerDisabledReason = brainBlockReason(health?.brain);
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
        onReplyState: (state) => { setReply(state); if (state === "waiting") setSpeechError(false); },
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
    <ChatActorContext.Provider value={person.id}>
      <ChatChildBandContext.Provider value={person.role === "child"}>
        <ChatTurnStatsVisibleContext.Provider value={canViewTurnStats && turnStatsVisible}>
        <ChatFeedbackOpenContext.Provider value={feedbackOpen}>
          <ChatFeedbackOpenSetterContext.Provider value={setFeedbackOpen}>
            <ChatDocumentOpenContext.Provider value={setDocumentTurnId}>
              <AssistantRuntimeProvider runtime={runtime}>
                <SttAutoSend sendRef={sttAutoSendRef} />
                <Page title="Chat" hideTitle>
                  <div className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label={threadsOpen ? "Hide threads" : "Show threads"} aria-expanded={threadsOpen} aria-controls="chat-threads" onClick={() => setThreadsOpen((open) => !open)}>
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
              {canViewTurnStats ? <Button type="button" variant={turnStatsVisible ? "secondary" : "ghost"} size="sm" aria-pressed={turnStatsVisible} aria-label="Show advanced reply stats" onClick={() => {
                const next = !turnStatsVisible;
                setTurnStatsVisible(next);
                void api.setSetting(`person:${person.id}`, "ui.show_turn_stats", next).catch(() => {});
              }}>Details</Button> : null}
              {/* `relative before:-inset-1.5`: the touch-target floor
                  (docs/UI.md, BACKLOG.md lane 8 item 1, 2026-09-13) - a
                  `size="icon-lg"` prop alone loses this component's own
                  baked-in `h-8` in the className merge order, so the
                  hit-area extension has to ride along with the `size-9`
                  override in this component's own className, the one
                  place guaranteed to win. */}
              <ThreadListNew aria-label="New chat" className="relative size-9 justify-center p-0 before:absolute before:-inset-1.5 before:content-['']" labelClassName="sr-only" />
            </div>
            <div className="flex min-w-0 items-center gap-1">
            <ChatModelPicker person={person} health={health} />
            <SensesDock health={health} reply={reply} speaking={isSpeaking} speechError={speechError} ears={ears} earError={earError}>
              <WakeWordToggle onStatusChange={onEarStatus} onWakeDetected={() => setBanner("MaiPai heard its wake word. It can't act on it yet - that's coming soon.")} />
            </SensesDock>
            </div>
                  </div>
                  {conversationMode === "temporary" ? <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[var(--muted)] px-3 py-2 text-base" role="status">Temporary chat is not saved to normal history or memory. Reloading will not bring these messages back.</div> : null}
                  {banner ? <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[var(--muted)] px-3 py-2 text-base">{banner}</div> : null}
                  <div className="relative flex min-h-0 flex-1">
            <aside id="chat-threads" hidden={!threadsOpen}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard-scrollable conversation navigation.
              tabIndex={0}
              className={cn("absolute inset-y-0 start-0 z-20 w-full shrink-0 overflow-y-auto border-e border-border/60 bg-background p-2 sm:static sm:w-60", !threadsOpen && "hidden", FOCUS_RING)}>
              <ThreadList />
            </aside>
            <div className="min-w-0 flex-1">
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
      </ChatChildBandContext.Provider>
    </ChatActorContext.Provider>
  );
}
