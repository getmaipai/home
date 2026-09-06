import { useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { Page } from "@/kit/primitives/Page";
import { Button } from "@/kit/ui/button";
import { Thread } from "@/kit/assistant-ui/thread.aui";
import { ThreadList } from "@/kit/assistant-ui/thread-list.aui";
import { WakeWordToggle } from "@/apps/chat/WakeWordToggle";
import { getIcon } from "@/kit/icons";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import { ChatActorContext } from "@/apps/chat/chatMemoryActions";
import type { Roster } from "@/lib/api";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

const BrainIcon = getIcon("brain");
const VolumeXIcon = getIcon("volume-x");

interface ChatPageProps {
  person: Roster;
}

// The real Chat page (spec/ui/pages/chat.json), hand-built against
// @assistant-ui/react (docs/plans/session-b-ui.md step 4) rather than
// executed by a generic UiNode interpreter (none exists yet, home/docs/
// dev.md documents that as a deferred slice). The streaming/TTS/think-
// tag logic itself lives in chatModelAdapter.ts, ported unchanged from
// the pre-assistant-ui version; this file wires that adapter, the
// (mocked, pending Session A) thread-list adapter, and the composer-area
// controls that have no equivalent in the framework (wake word, "think
// longer").
export function ChatPage({ person }: ChatPageProps) {
  // Home's prompt box and the search palette's "Ask MaiPai" row both
  // navigate here with `state: { initialText }` (step 6) - read once,
  // not kept reactive to `location.state` changing later, since a
  // second navigation to /chat (the nav link, "Chat" in the palette)
  // should land on a plain empty composer, not replay a stale prompt.
  const location = useLocation();
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

  const chatModelAdapter = useMemo(
    () =>
      createChatModelAdapter({
        consumeThinking: () => {
          const value = thinkingRef.current;
          thinkingRef.current = false;
          setThinking(false);
          return value;
        },
        onCrisisResources: setBanner,
        turnSchedulerRef,
        onSpeakingChange: setIsSpeaking,
      }),
    [],
  );
  const suggestionAdapter = useMemo(() => createChatSuggestionAdapter(initialText), [initialText]);
  const threadListAdapter = useMemo(() => createChatThreadListAdapter(person.display_name), [person.display_name]);

  // A named, `use`-prefixed function, not an inline arrow: `useRemoteThreadListRuntime`
  // calls `runtimeHook` from inside its own render (assistant-ui's documented
  // pattern for this option), so this genuinely is a hook call by the rules
  // themselves - naming it this way is what lets react-hooks/rules-of-hooks
  // recognize that instead of flagging a bare arrow function calling a hook.
  function useChatRuntimeHook() {
    return useLocalRuntime(chatModelAdapter, { adapters: { suggestion: suggestionAdapter } });
  }

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatRuntimeHook,
    adapter: threadListAdapter,
  });

  return (
    <ChatActorContext.Provider value={person.id}>
      <AssistantRuntimeProvider runtime={runtime}>
        <Page title="Chat">
          {banner ? (
            <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[var(--muted)] px-3 py-2 text-base">{banner}</div>
          ) : null}
          <div className="flex min-h-0 flex-1">
            {/* Threads (step 4): mocked to one conversation until Session
                A's per-thread routes land (chatThreadListAdapter.ts) -
                hidden below lg since there is, today, nothing to switch
                between. */}
            <aside className="hidden w-64 shrink-0 overflow-y-auto border-e border-border p-2 lg:block">
              <ThreadList />
            </aside>
            <div className="min-w-0 flex-1">
              <Thread
                composerToolbar={
                  // Per-turn behavior toggles, not page chrome - moved off
                  // the header (Jesse, 2026-09-06: "its placement / location
                  // is also odd") to sit right above the composer they
                  // actually affect, the same way a modern chat app's mode
                  // switches live next to the input, not floating above the
                  // whole conversation.
                  <>
                    {/* Phase 1 of the wake-word plan (docs/dev.md, 2026-09-04):
                        "infrastructure proof, no custom model yet" - fires on
                        openWakeWord's stock "hey jarvis" phrase, not a MaiPai-trained
                        one. No auto-send/auto-listen wiring yet: STT doesn't exist
                        anywhere in this codebase, so a real detection only shows a
                        banner proving the mechanism. */}
                    <WakeWordToggle
                      onWakeDetected={(event) =>
                        setBanner(
                          `Wake word heard: "${event.modelId}" (demo only - MaiPai isn't listening for real commands yet)`,
                        )
                      }
                    />
                    {/* Covers the gap the composer's own Send/Stop toggle
                        can't: text generation finishing doesn't mean the
                        reply is done being SPOKEN. Only shown while that's
                        actually true, so it never sits there as dead
                        chrome the rest of the time. */}
                    {isSpeaking ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          turnSchedulerRef.current?.stop();
                          setIsSpeaking(false);
                        }}
                        className="rounded-full"
                      >
                        <VolumeXIcon />
                        Stop speaking
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant={thinking ? "default" : "outline"}
                      onClick={() => setThinking((v) => !v)}
                      aria-pressed={thinking}
                      className="rounded-full"
                    >
                      <BrainIcon />
                      {thinking ? "Thinking on for next message" : "Think longer"}
                    </Button>
                  </>
                }
              />
            </div>
          </div>
        </Page>
      </AssistantRuntimeProvider>
    </ChatActorContext.Provider>
  );
}
