import type { SpeechSynthesisAdapter } from "@assistant-ui/react";
import { api } from "@/lib/api";
import { StreamingWavPlayer } from "@/lib/streamingWavPlayer";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";

/** slice 5(e): the shipped ActionBarPrimitive.Speak/StopSpeaking (kit
 * commons ui-v0.5.23) wired to Home's own real speech route, POST
 * /api/tts - the same low-level pieces chatListenStore.ts's own "Listen"
 * replay already uses (StreamingWavPlayer, api.streamSpeech,
 * normalizeForSpeech), reused here rather than duplicated, but through
 * assistant-ui's own adapter/capability mechanism instead of a second,
 * hand-rolled button and store: once this is passed to useLocalRuntime's
 * `adapters.speech`, the runtime itself tracks which message is
 * currently speaking (`s.message.speech`), the same way `feedback`
 * already tracks submitted feedback, so the kit's own Speak/StopSpeaking
 * primitives just work without Home re-implementing that bookkeeping.
 * chatListenStore.ts/chatActionBar.tsx's own ListenButton stay exactly
 * as they are - the old (non-/next) chat's own composition, out of
 * scope until SHELL-09 retires it. */
export function createChatSpeechAdapter(): SpeechSynthesisAdapter {
  return {
    speak(text: string): SpeechSynthesisAdapter.Utterance {
      const abortController = new AbortController();
      const player = new StreamingWavPlayer();
      const subscribers = new Set<() => void>();
      // A plain `let` here gets over-narrowed by TypeScript's control-flow
      // analysis across the closures below (setStatus's own reassignment
      // isn't visible to a sibling closure's read) - an object property
      // read doesn't carry that same narrowing, the standard workaround.
      const state: { status: SpeechSynthesisAdapter.Status } = { status: { type: "starting" } };

      const setStatus = (next: SpeechSynthesisAdapter.Status) => {
        if (state.status.type === "ended") return;
        state.status = next;
        for (const callback of subscribers) callback();
      };

      player.onFirstAudio = () => setStatus({ type: "running" });
      player.onEnded = () => setStatus({ type: "ended", reason: "finished" });

      void (async () => {
        try {
          const response = await api.streamSpeech(normalizeForSpeech(text), abortController.signal);
          const reader = response.body!.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (state.status.type === "ended") {
              player.stop();
              return;
            }
            if (done) break;
            if (value) player.addChunk(value);
          }
          player.finish();
        } catch (err) {
          if (state.status.type === "ended") return;
          player.stop();
          setStatus({ type: "ended", reason: abortController.signal.aborted ? "cancelled" : "error", error: err });
        }
      })();

      return {
        get status() {
          return state.status;
        },
        cancel: () => {
          if (state.status.type === "ended") return;
          abortController.abort();
          player.stop();
          setStatus({ type: "ended", reason: "cancelled" });
        },
        subscribe: (callback) => {
          subscribers.add(callback);
          return () => {
            subscribers.delete(callback);
          };
        },
      };
    },
  };
}
