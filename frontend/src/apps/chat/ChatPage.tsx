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
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import { brainBlockReason, useEngineHealth } from "@/apps/chat/useEngineHealth";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import { createSttSocket } from "@/lib/voice/sttSocket";
import { ChatActorContext } from "@/apps/chat/chatMemoryActions";
import { cn, FOCUS_RING } from "@/kit/utils";
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

export function ChatPage({ person }: ChatPageProps) {
  // Home's prompt box and the search palette's "Ask MaiPai" row both
  // navigate here with `state: { initialText }` (step 6) - read once,
  // not kept reactive to `location.state` changing later, since a
  // second navigation to /chat (the nav link, "Chat" in the palette)
  // should land on a plain empty composer, not replay a stale prompt.
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
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
        onCrisisResources: setBanner,
        turnSchedulerRef,
        onSpeakingChange: (value) => { setIsSpeaking(value); if (value) setSpeechError(false); },
        onReplyState: (state) => { setReply(state); if (state === "waiting") setSpeechError(false); },
        onSpeechError: () => setSpeechError(true),
      }),
    [aui],
  );

    return useLocalRuntime(chatModelAdapter, { adapters: { suggestion: suggestionAdapter, dictation: dictationAdapter } });
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
      <AssistantRuntimeProvider runtime={runtime}>
        <SttAutoSend sendRef={sttAutoSendRef} />
        <Page title="Chat" hideTitle>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label={threadsOpen ? "Hide threads" : "Show threads"} aria-expanded={threadsOpen} aria-controls="chat-threads" onClick={() => setThreadsOpen((open) => !open)}>
                <HistoryIcon className="size-4" />
              </Button>
              <h2 className="text-base font-semibold">Chat</h2>
              <ThreadListNew aria-label="New chat" className="size-9 justify-center p-0" labelClassName="sr-only" />
            </div>
            <SensesDock health={health} reply={reply} speaking={isSpeaking} speechError={speechError} ears={ears} earError={earError}>
              <WakeWordToggle onStatusChange={onEarStatus} onWakeDetected={() => setBanner("MaiPai heard its wake word. It can't act on it yet - that's coming soon.")} />
            </SensesDock>
          </div>
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
                      <TooltipIconButton tooltip={thinking ? "Chat options: thinking on" : "Chat options"} className={cn("size-9 rounded-full", thinking && "bg-primary text-primary-foreground")}><OptionsIcon className="size-4" /></TooltipIconButton>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content side="top" align="start" sideOffset={8} className="z-50 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg">
                        <Button type="button" variant="ghost" onClick={() => setThinking((value) => !value)} aria-pressed={thinking}>
                          <BrainIcon />Think longer{thinking ? " (on)" : ""}
                        </Button>
                        <p className="px-3 pb-2 text-xs text-muted-foreground">For your next message only.</p>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>

                  {isSpeaking ? <TooltipIconButton tooltip="Stop speaking" className="size-9 rounded-full" onClick={() => { turnSchedulerRef.current?.stop(); setIsSpeaking(false); }}><VolumeXIcon className="size-4" /></TooltipIconButton> : null}
                </>}
              />
            </div>
          </div>
        </Page>
      </AssistantRuntimeProvider>
    </ChatActorContext.Provider>
  );
}
