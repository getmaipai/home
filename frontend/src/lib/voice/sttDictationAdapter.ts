import type { DictationAdapter } from "@assistant-ui/react";
import { startMicCapture, type MicCaptureHandle } from "@/lib/voice/mic-capture";
import type { SttSocket, SttSocketHandlers } from "@/lib/voice/sttSocket";
import type { SttServerMessage } from "@/lib/voice/sttContract";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

type SpeechResult = { transcript: string; isFinal?: boolean };

// The same Set-based subscribe/notify shape, once, rather than three
// near-identical copies (a code review, 2026-09-06) - `onSpeechStart`,
// `onSpeechEnd` and `onSpeech` each just add/remove/notify a callback
// set of their own type.
function createCallbackSet<T>() {
  const callbacks = new Set<(arg: T) => void>();
  return {
    subscribe(callback: (arg: T) => void) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    notify(arg: T) {
      for (const cb of callbacks) cb(arg);
    },
  };
}

export interface SttDictationDeps {
  /** `createSttSocket` once C's `WS /api/stt/stream` lands
   * (`sttSocket.ts`); `createMockSttSocket` with a fixture until then -
   * this file never knows or cares which. */
  createSocket: (handlers: SttSocketHandlers) => SttSocket;
  /** Barge-in (session-e-ui-and-docs.md step 4): the server's own VAD
   * saying the household member started speaking while an earlier reply
   * is still speaking stops it immediately, via the mechanism
   * `sentenceSpeechScheduler.stop()` already exists for (its own doc
   * comment names barge-in as the reason). A ref, not the scheduler
   * itself: ChatPage.tsx creates a fresh scheduler per turn, so this
   * adapter (created once) always reaches whichever one is current. */
  turnSchedulerRef: { current: SentenceSpeechScheduler | null };
  /** Called once a `final` message's transcript has already been pushed
   * into the composer via `onSpeech`, AND this session has already
   * finished - `DictationAdapter.Session` has no reference to the
   * composer runtime to call `send()` itself (ChatPage.tsx's
   * `SttAutoSend` is the component that does, via `useAui()`, the
   * documented way to reach it from inside the runtime tree). Order
   * matters here (see the `case "final"` comment below): calling this
   * before this session has finished lets `aui.composer.send()`
   * reentrantly cancel this same still-active session first. */
  onFinalReady: () => void;
  /** DICT-01 (Jesse: "the mic button must show the hub's own not-
   * installed state... never a dead button", the same rule
   * localImageAttachmentAdapter.ts's own capability check already
   * follows for vision). Read fresh on every `listen()` call, not
   * cached at adapter-creation time, since an install can finish while
   * the composer is already mounted. Defaults to `true` so a caller
   * that never wires this (every existing test) keeps today's
   * behavior. */
  sttInstalled?: () => boolean;
  /** Called instead of opening a socket at all when `sttInstalled()` is
   * false - the page owns how to show it (a toast, today), the adapter
   * only knows the socket has no assets to talk to. */
  onNotInstalled?: () => void;
}

// The composer's push-to-talk mic button (session-e-ui-and-docs.md step
// 4), wired as a real `DictationAdapter` rather than a hand-built button
// beside the composer: `thread.aui.tsx` already renders a fully styled
// Dictate/StopDictation/DictationTranscript UI, invisible today only
// because `thread.capabilities.dictation` was never true (no adapter
// configured) - this is that adapter, modeled on @assistant-ui/core's own
// `WebSpeechDictationAdapter` (browser SpeechRecognition) but backed by
// C's real STT contract instead of the Web Speech API, which has no
// concept of a MaiPai-trained wake word, a household's own STT engine
// choice, or server-side VAD.
export function createSttDictationAdapter(deps: SttDictationDeps): DictationAdapter {
  return {
    listen(): DictationAdapter.Session {
      const speechStart = createCallbackSet<void>();
      const speechEnd = createCallbackSet<SpeechResult>();
      const speech = createCallbackSet<SpeechResult>();
      let micHandle: MicCaptureHandle | null = null;
      let socket: SttSocket | null = null;
      let ended = false;

      const session: DictationAdapter.Session = {
        status: { type: "starting" },
        async stop() {
          finish("stopped");
        },
        cancel() {
          finish("cancelled");
        },
        onSpeechStart: speechStart.subscribe,
        onSpeechEnd: speechEnd.subscribe,
        onSpeech: speech.subscribe,
      };

      // DICT-01: assets missing is checked BEFORE any socket opens - a
      // household mic-permission prompt for a session already doomed to
      // fail would undercut "fails fast and honestly" the same way the
      // "wait for ready before starting the mic" rule above already
      // protects against, and the STT route itself never checks this
      // (routes/stt.ts's onOpen creates a session unconditionally).
      if (deps.sttInstalled?.() === false) {
        deps.onNotInstalled?.();
        session.status = { type: "ended", reason: "error" };
        return session;
      }

      function finish(reason: "stopped" | "cancelled" | "error", result?: SpeechResult): void {
        if (ended) return;
        ended = true;
        session.status = { type: "ended", reason };
        micHandle?.stop();
        socket?.close();
        speechEnd.notify(result ?? { transcript: "" });
      }

      // DICT-01: the real wire shape (SttWireEvent, sttContract.ts) uses
      // `t`/`v`, not `type`/`text` - this switch used to read a field no
      // server message ever carries, so it silently matched nothing and
      // mic capture never started (found via a headless-Chromium repro
      // with a fake mic device: the socket opened, "ready" arrived, and
      // nothing else ever happened - zero audio frames, empty composer,
      // no error, because nothing here ever ran).
      function onMessage(message: SttServerMessage): void {
        switch (message.t) {
          case "ready":
            session.status = { type: "running" };
            speechStart.notify();
            // Mic capture (and the browser's own permission prompt) only
            // starts once the server is actually ready for audio, not in
            // parallel with the socket connecting (a code review,
            // 2026-09-06: starting it unconditionally meant a household
            // member could see a mic-permission dialog for a session
            // already doomed to fail, undercutting "fails fast and
            // honestly" - the point of using the real socket instead of
            // a fixture in the first place).
            startMicCapture({ onFrame: (frame) => socket?.sendAudio(frame) })
              .then((handle) => {
                if (ended) {
                  handle.stop();
                  return;
                }
                micHandle = handle;
              })
              .catch(() => finish("error"));
            break;
          case "vad":
            // Barge-in: the household member started talking while an
            // earlier reply was still speaking. `.stop()` is idempotent
            // (no-ops once already stopped, or once a fresh turn's own
            // scheduler replaced this one) - safe to call on every
            // `speaking: true`, not just the first.
            if (message.speaking) deps.turnSchedulerRef.current?.stop();
            break;
          case "partial":
            speech.notify({ transcript: message.v, isFinal: false });
            break;
          case "final": {
            speech.notify({ transcript: message.v, isFinal: true });
            // finish() BEFORE onFinalReady(), not after - reentrancy,
            // not just tidiness. Verified against @assistant-ui/core's
            // own composer-runtime-core.js: aui.composer.send() (which
            // onFinalReady() reaches via ChatPage.tsx's SttAutoSend)
            // calls THIS session's own cancel() synchronously, in the
            // same tick, before returning. Calling onFinalReady() first
            // (as an earlier version did) let that reentrant cancel()
            // run finish("cancelled") first, so this call landed second
            // and no-opped behind `if (ended) return` - every real send
            // reported the session's end reason as "cancelled" instead
            // of "stopped" (a code review, 2026-09-06, verified this
            // live against the library source, not just in theory).
            const result = { transcript: message.v, isFinal: true };
            finish("stopped", result);
            deps.onFinalReady();
            break;
          }
          case "no_speech":
            finish("stopped");
            break;
          // The real spec has a case this file's old, hand-guessed
          // contract never declared: a structured server-side error
          // (a transcription failure, say). It used to fall through
          // this switch unhandled, the identical silent-no-op shape the
          // "ready" bug had - the session would just sit open forever
          // showing "listening" with nothing happening.
          case "error":
            finish("error");
            break;
        }
      }

      socket = deps.createSocket({
        onMessage,
        onError: () => finish("error"),
      });

      return session;
    },
  };
}
