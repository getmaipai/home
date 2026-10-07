"use client";

// VOICE-LIVE-02 (docs/plans/hardware-tiers-2026-09-23.md section 1;
// BACKLOG.md's own row). Press the waveform and talk: this hook manages
// the live voice session behind the shipped `VoiceConversation` Element - opens the
// same real STT session dictation already uses (sttSocket.ts,
// mic-capture.ts), sends the final transcript as a real turn with
// `spoken: true` through the SAME composer send path a typed message
// uses (`runtime.thread.composer.setText()` + `.send()`, so the transcript lands in
// the thread exactly like any other message - no second message-
// creation path), and lets chatModelAdapter.ts's own already-built
// sentence-by-sentence TTS pipeline (SentenceSpeechScheduler,
// `speakReplies`) speak the reply as it streams - never a second speech
// pipeline built here. The Element's own rings read a local
// AnalyserNode level (audioLevelMeter.ts), on the mic's stream while
// listening and the scheduler's own playback bus while speaking -
// nothing computed here is sent anywhere (the owner's ruling,
// 2026-09-23).
//
// The loop is driven by `listenGeneration`, bumped once at open and
// again every time speaking ends: one effect (re)connects and listens
// whenever it changes, a second effect watches `isSpeaking` (relayed
// from chatModelAdapter.ts's own onSpeakingChange, since a live
// SentenceSpeechScheduler's start/end events happen inside
// useChatRuntime, not here) and bumps the generation once a reply
// finishes speaking - the whole state machine is a value the mount
// effect reacts to, never a manually chained callback tree.
import { useEffect, useRef, useState } from "react";
import type { VoiceMode } from "@maipai/ui/src/elements/voice-conversation";
import { createSttSocket, type SttSocket, type SttSocketHandlers } from "@/lib/voice/sttSocket";
import { startMicCapture, type MicCaptureHandle } from "@/lib/voice/mic-capture";
import { createLevelMeter, type LevelMeter } from "@/lib/voice/audioLevelMeter";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

export interface LiveVoiceSessionProps {
  composer: { setText: (text: string) => void; send: () => void };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turnSchedulerRef: { current: SentenceSpeechScheduler | null };
  liveVoiceActiveRef: { current: boolean };
  pendingSpeechRef: { current: boolean };
  /** sttDictationAdapter.ts's own established shape: `createSttSocket`
   * (the default, real `WS /api/stt/stream`) or `createMockSttSocket`
   * with a fixture in a test - this file never knows or cares which. */
  createSocket?: (handlers: SttSocketHandlers) => SttSocket;
  /** Test-only: `startMicCapture` opens a real microphone, which a unit
   * test can't do - injectable the same way, defaulting to the real
   * implementation. */
  startCapture?: typeof startMicCapture;
  /** chatModelAdapter.ts's own onSpeakingChange, relayed through
   * useChatRuntime as real state - the only way this hook (a
   * sibling of that runtime hook) learns the live
   * scheduler's own start/end. */
  isSpeaking: boolean;
  /** A code review caught this: `isSpeaking` alone misses a reply that
   * never spoke at all (empty, or every sentence's TTS synthesis
   * failed) - onFirstAudio never fires, so the "speaking ended" call
   * arrives with `isSpeaking` already false, a same-value React update
   * that never re-runs the effect below. Bumped by useChatRuntime
   * on every "false" call regardless of the previous value - depended
   * on instead of `isSpeaking` alone so "speaking is over" is never
   * missed. */
  speakingEndedAt: number;
}

export function useLiveVoiceSession({ composer, open, onOpenChange, turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, isSpeaking, speakingEndedAt, createSocket = createSttSocket, startCapture = startMicCapture }: LiveVoiceSessionProps) {
  const [mode, setMode] = useState<VoiceMode>("connecting");
  const [amplitude, setAmplitude] = useState(0);
  const [muted, setMuted] = useState(false);
  const [listenGeneration, setListenGeneration] = useState(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  // Reset all local display state the moment the overlay opens, so a
  // second call never shows the previous one's mode.
  useEffect(() => {
    if (!open) return;
    setMode("connecting");
    setAmplitude(0);
    setListenGeneration(0);
  }, [open]);

  // Listens once per `listenGeneration` - (re)connects the STT socket,
  // starts the mic, and on a real "final" transcript sends the turn.
  // Cleanup here is what mic-capture.ts's own `stop()` and the socket's
  // own `close()` are for: it runs both on a real teardown (the overlay
  // closing) and between generations (the previous session's own
  // handlers must never fire again once a new one starts).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let micHandle: MicCaptureHandle | null = null;
    let levelMeter: LevelMeter | null = null;
    // A polling interval, not requestAnimationFrame: this value only
    // ever feeds a slow-changing ring, never a paint-synced animation,
    // and rAF's own real-browser 60Hz throttle doesn't exist the same
    // way in every test environment - a tight, un-throttled recursive
    // rAF loop was found starving happy-dom's own event loop in a test,
    // silently blocking the mock socket's own setTimeout-based fixture
    // delivery forever.
    let levelTimer: ReturnType<typeof setInterval> | undefined;

    setMode("connecting");
    const socket = createSocket({
      onMessage(message) {
        if (cancelled) return;
        // DICT-01 (found live, 2026-09-23): the real wire contract uses
        // short keys, `t` and `v`, never `type`/`text` - this file's own
        // first draft was written against the same wrong guessed shape
        // dictation's own bug was, caught here before ever shipping
        // rather than live.
        switch (message.t) {
          case "ready":
            setMode("listening");
            void startCapture({
              onFrame: (frame) => {
                if (!mutedRef.current) socket.sendAudio(frame);
              },
              onSource: (context, source) => {
                levelMeter?.stop();
                levelMeter = createLevelMeter(context, source);
                clearInterval(levelTimer);
                levelTimer = setInterval(() => setAmplitude(levelMeter?.read() ?? 0), 60);
              },
            })
              .then((handle) => {
                if (cancelled) {
                  handle.stop();
                  return;
                }
                micHandle = handle;
              })
              .catch(() => {
                if (!cancelled) onOpenChange(false);
              });
            break;
          case "partial":
            // Not shown: a partial can revise itself several times a
            // second (interim ASR hypotheses) - the listening ring's
            // own movement (the level meter) is already the "it's
            // hearing you" signal while this is live.
            break;
          case "final": {
            const text = message.v.trim();
            micHandle?.stop();
            micHandle = null;
            levelMeter?.stop();
            levelMeter = null;
            clearInterval(levelTimer);
            setAmplitude(0);
            if (!text) {
              // Nothing usable - listen again rather than send an empty
              // turn.
              setListenGeneration((g) => g + 1);
              break;
            }
            setMode("thinking");
            pendingSpeechRef.current = true;
            composer.setText(text);
            void Promise.resolve(composer.send());
            break;
          }
          case "no_speech":
            micHandle?.stop();
            micHandle = null;
            levelMeter?.stop();
            levelMeter = null;
            clearInterval(levelTimer);
            setAmplitude(0);
            setListenGeneration((g) => g + 1);
            break;
          // A real server-side STT failure (the spec's own `{ t: "error",
          // v: string }`) - distinct from a dropped socket (onError
          // below): the session is still connected, but nothing further
          // will transcribe correctly, so this ends the call the same
          // way a connection-level failure does rather than looping on a
          // broken session.
          case "error":
            micHandle?.stop();
            levelMeter?.stop();
            clearInterval(levelTimer);
            onOpenChange(false);
            break;
        }
      },
      onError() {
        if (!cancelled) onOpenChange(false);
      },
    });

    return () => {
      cancelled = true;
      clearInterval(levelTimer);
      micHandle?.stop();
      levelMeter?.stop();
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- aui/onOpenChange/pendingSpeechRef are stable refs/client accessors; listenGeneration is the deliberate re-run trigger.
  }, [open, listenGeneration]);

  // The speaking half of the loop: chatModelAdapter.ts's own scheduler
  // fires this through useChatRuntime's state. Its own onEnded also
  // fires when NOTHING was ever scheduled at all (an empty reply, or
  // every sentence's synthesis failed) - checked against "thinking" too,
  // not only "speaking", so that case still resumes listening instead of
  // leaving the session stuck.
  useEffect(() => {
    if (!open) return;
    if (isSpeaking) {
      setMode("speaking");
      const timer = setInterval(() => setAmplitude(turnSchedulerRef.current?.readLevel() ?? 0), 60);
      return () => clearInterval(timer);
    }
    setMode((current) => {
      if (current !== "speaking" && current !== "thinking") return current;
      setAmplitude(0);
      setListenGeneration((g) => g + 1);
      return "listening";
    });
    return undefined;
  }, [isSpeaking, speakingEndedAt, open, turnSchedulerRef]);

  // Arms/disarms the "this send speaks" flag chatModelAdapter.ts reads
  // (speakReplies) for the whole time the overlay is open, and tears
  // down anything still running the moment it closes (End the call, or
  // an unmount) - a stop from here must be immediate, the same
  // guarantee VOICE-01's future barge-in will build on.
  useEffect(() => {
    liveVoiceActiveRef.current = open;
    if (!open) turnSchedulerRef.current?.stop();
    return () => {
      liveVoiceActiveRef.current = false;
    };
  }, [open, liveVoiceActiveRef, turnSchedulerRef]);

  return {
    mode,
    amplitude,
    muted,
    onToggleMute: () => setMuted((value) => !value),
    onEnd: () => onOpenChange(false),
  };
}
