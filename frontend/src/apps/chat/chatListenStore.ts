import { create } from "zustand";
import { api } from "@/lib/api";
import { StreamingWavPlayer } from "@/lib/streamingWavPlayer";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";

// The manual "Listen" replay (spec/voice/, 2026-09-04): "I don't think
// chat works with voice on the web for me to test" - a per-message button,
// not autoplay (Jesse, same session, after trying an auto-playing version:
// "again, I dont want auto play"). A Zustand store, not component state:
// only one message's Listen button can ever be loading/playing at a time
// (one shared player), and with each message now its own ActionBar
// component (chatActionBar.tsx) instead of one ChatPage-wide render, a
// plain useState here would only be visible to whichever button set it.
interface ChatListenState {
  loadingId: string | null;
  playingId: string | null;
  errorId: string | null;
  play(messageId: string, text: string): void;
}

// Module-scope, not store state: neither needs to trigger a re-render on
// its own (the store's loadingId/playingId/errorId fields are what
// components read), and requestId in particular exists purely to guard
// against a stale async callback - identical role to the ref this
// replaced in the pre-assistant-ui ChatPage.tsx.
let player: StreamingWavPlayer | null = null;
let requestId = 0;
// A code review (2026-09-05) found that superseding a request only ever
// stopped the PLAYER (the AudioContext) - the earlier click's own
// /api/tts fetch and its reader.read() loop kept running in the
// background, unbounded, until it finished or the 185s timeout fired,
// even though nothing in the UI cared about the result anymore. Aborting
// it here actually cancels that fetch, not just its side effects.
let abortController: AbortController | null = null;

export function stopListening(): void {
  player?.stop();
  abortController?.abort();
}

export const useChatListenStore = create<ChatListenState>((set) => ({
  loadingId: null,
  playingId: null,
  errorId: null,
  play(messageId, text) {
    const thisRequest = ++requestId;
    player?.stop();
    abortController?.abort();
    const thisAbortController = new AbortController();
    abortController = thisAbortController;
    set({ errorId: null, loadingId: messageId, playingId: null });

    // Created synchronously, before the network fetch below: an
    // AudioContext only counts as unlocked by this click's real user
    // gesture if it exists before the call stack returns, not after an
    // awaited fetch (streamingWavPlayer.ts's own constructor comment;
    // flagged by a code review, 2026-09-04, against a previous <audio>-
    // element version, which created its element only after the fetch
    // resolved).
    const nextPlayer = new StreamingWavPlayer();
    player = nextPlayer;
    nextPlayer.onFirstAudio = () => {
      if (thisRequest !== requestId) return;
      set({ loadingId: null, playingId: messageId });
    };
    nextPlayer.onEnded = () => {
      if (thisRequest !== requestId) return;
      // Both fields, not just playingId: a code review (2026-09-04) found
      // a reply whose synthesized audio has zero playable frames never
      // calls onFirstAudio at all (StreamingWavPlayer.finish() fires
      // onEnded directly in that case), so loadingId was left set to this
      // message forever - the button stuck on "Loading…", disabled, with
      // no way to retry short of a reload.
      set((state) => ({
        loadingId: state.loadingId === messageId ? null : state.loadingId,
        playingId: state.playingId === messageId ? null : state.playingId,
      }));
    };

    void (async () => {
      try {
        // The message's own DISPLAYED text stays exactly as shown - only
        // what's sent to TTS is normalized (numbers, times, dates read the
        // way a person says them; Jesse, 2026-09-04: "if you have the voice
        // say ten O four, you still display 10:04").
        const response = await api.streamSpeech(normalizeForSpeech(text), thisAbortController.signal);
        if (thisRequest !== requestId) {
          nextPlayer.stop();
          return;
        }
        const reader = response.body!.getReader();
        // Streams chunks straight into the player as they arrive, rather
        // than waiting for the whole reply (2026-09-04, Jesse: "make sure
        // you are streaming responses as you get [them] instead of
        // generating the entire wav and then just playing that").
        for (;;) {
          const { done, value } = await reader.read();
          if (thisRequest !== requestId) {
            nextPlayer.stop();
            return;
          }
          if (done) break;
          if (value) nextPlayer.addChunk(value);
        }
        nextPlayer.finish();
      } catch {
        if (thisRequest !== requestId) return;
        set({ errorId: messageId, loadingId: null, playingId: null });
        nextPlayer.stop();
      }
    })();
  },
}));
