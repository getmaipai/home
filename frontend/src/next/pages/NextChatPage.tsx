import { useMemo, useRef, useState } from "react";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

/** /next/chat: SHELL-02's first vertical slice (docs/plans/shell-on-
 * shadcndashboard-2026-09-21.md's own wiring table) - the Elements
 * thread and composer (ui/src/elements/thread.aui.tsx, self-contained:
 * composer, messages and reasoning all render from one mount), on
 * Home's existing streaming adapter (chatModelAdapter.ts), one real
 * turn end to end with the reply text and reasoning Elements
 * rendering. `consumeThinking: () => true` - this composer has no
 * "Think longer" toggle yet (that's real per-message UI, a follow-up
 * slice), and the acceptance this slice actually has to prove is that
 * a live reasoning Element renders; always requesting it here is the
 * only way this page can demonstrate that in ordinary use rather than
 * only in a test's own scripted `reasoning` event. `speakReplies:
 * false` - the plan's "Speaking a reply" row is its own follow-up
 * slice (the read-aloud Element), and this page has no "stop
 * speaking" control on screen yet for the adapter's own TTS to hand
 * one to.
 *
 * History, the thread list, attachments, suggestions, tools and
 * artifacts are each their own follow-up slice too (the wiring
 * table's remaining rows) - so no `useRemoteThreadListRuntime`, no
 * `getConversationId`: the backend starts a fresh conversation itself
 * when POST /api/turn/stream gets no `conversation_id`
 * (routes/turn.ts), handing its real id back on the first `turn_meta`
 * event same as always. */
function useNextChatRuntime() {
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const chatModelAdapter = useMemo(
    () =>
      createChatModelAdapter({
        consumeThinking: () => true,
        consumeSupersedes: () => undefined,
        onCrisisResources: setBanner,
        turnSchedulerRef,
        speakReplies: false,
      }),
    [],
  );
  const runtime = useLocalRuntime(chatModelAdapter);
  return { runtime, banner };
}

export function NextChatPage() {
  const { runtime, banner } = useNextChatRuntime();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-[calc(100vh-140px)] flex-col">
        {banner ? (
          <Alert className="mx-4 mb-2">
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        ) : null}
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
