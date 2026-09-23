"use client";

// VOICE-LIVE-02 (docs/plans/hardware-tiers-2026-09-23.md section 1;
// BACKLOG.md's own row). Press the waveform and talk: this component
// drives the shipped `VoiceConversation` Element end to end - opens the
// same real STT session dictation already uses (sttSocket.ts,
// mic-capture.ts), sends the final transcript as a real turn with
// `spoken: true` through the SAME composer send path a typed message
// uses (`aui.composer.setText()` + `.send()`, so the transcript lands in
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
// useNextChatRuntime, not here) and bumps the generation once a reply
// finishes speaking - the whole state machine is a value the mount
// effect reacts to, never a manually chained callback tree.
import { useEffect, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { VoiceConversation, type VoiceMode, type VoiceTurn } from "@maipai/ui/src/elements/voice-conversation";
import { createSttSocket, type SttSocket, type SttSocketHandlers } from "@/lib/voice/sttSocket";
import { startMicCapture, type MicCaptureHandle } from "@/lib/voice/mic-capture";
import { createLevelMeter, type LevelMeter } from "@/lib/voice/audioLevelMeter";
import { messageText } from "@/apps/chat/chatMessageText";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

export interface LiveVoiceSessionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turnSchedulerRef: { current: SentenceSpeechScheduler | null };
  liveVoiceActiveRef: { current: boolean };
  spokenNextRef: { current: boolean };
  /** sttDictationAdapter.ts's own established shape: `createSttSocket`
   * (the default, real `WS /api/stt/stream`) or `createMockSttSocket`
   * with a fixture in a test - this file never knows or cares which. */
  createSocket?: (handlers: SttSocketHandlers) => SttSocket;
  /** Test-only: `startMicCapture` opens a real microphone, which a unit
   * test can't do - injectable the same way, defaulting to the real
   * implementation. */
  startCapture?: typeof startMicCapture;
  /** chatModelAdapter.ts's own onSpeakingChange, relayed through
   * useNextChatRuntime as real state - the only way this component (a
   * sibling of the runtime hook, not inside it) learns the live
   * scheduler's own start/end. */
  isSpeaking: boolean;
  /** A code review caught this: `isSpeaking` alone misses a reply that
   * never spoke at all (empty, or every sentence's TTS synthesis
   * failed) - onFirstAudio never fires, so the "speaking ended" call
   * arrives with `isSpeaking` already false, a same-value React update
   * that never re-runs the effect below. Bumped by useNextChatRuntime
   * on every "false" call regardless of the previous value - depended
   * on instead of `isSpeaking` alone so "speaking is over" is never
   * missed. */
  speakingEndedAt: number;
}

let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `voice-turn-${turnCounter}`;
}

export function LiveVoiceSession({ open, onOpenChange, turnSchedulerRef, liveVoiceActiveRef, spokenNextRef, isSpeaking, speakingEndedAt, createSocket = createSttSocket, startCapture = startMicCapture }: LiveVoiceSessionProps) {
  const aui = useAui();
  const messages = useAuiState((s) => s.thread.messages);
  const [mode, setMode] = useState<VoiceMode>("connecting");
  const [amplitude, setAmplitude] = useState(0);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<VoiceTurn[]>([]);
  const [listenGeneration, setListenGeneration] = useState(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const assistantTurnIdRef = useRef<string | null>(null);

  // The live thread's own last assistant message, mirrored into the
  // widget's own transcript while a reply is thinking/speaking - the
  // thread itself (not this state) is the real record; this is display
  // only, the same "printed for a person to read" role the Element's
  // own transcript prop already has.
  useEffect(() => {
    if (!open || assistantTurnIdRef.current === null) return;
    const last = messages.at(-1);
    if (!last || last.role !== "assistant") return;
    const text = messageText(last);
    const id = assistantTurnIdRef.current;
    setTranscript((prev) => prev.map((turn) => (turn.id === id ? { ...turn, text } : turn)));
  }, [messages, open]);

  // Reset all local display state the moment the overlay opens, so a
  // second call never shows the previous one's transcript or mode.
  useEffect(() => {
    if (!open) return;
    setMode("connecting");
    setAmplitude(0);
    setTranscript([]);
    assistantTurnIdRef.current = null;
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
        switch (message.type) {
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
            // second (interim ASR hypotheses), and the Element's own
            // transcript list is meant for settled turns - the
            // listening ring's own movement (the level meter) is
            // already the "it's hearing you" signal while this is live.
            break;
          case "final": {
            const text = message.text.trim();
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
            const assistantId = nextTurnId();
            assistantTurnIdRef.current = assistantId;
            setTranscript((prev) => [...prev, { id: nextTurnId(), role: "user", text }, { id: assistantId, role: "assistant", text: "" }]);
            spokenNextRef.current = true;
            aui.composer.setText(text);
            void Promise.resolve(aui.composer.send());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- aui/onOpenChange/spokenNextRef are stable refs/client accessors; listenGeneration is the deliberate re-run trigger.
  }, [open, listenGeneration]);

  // The speaking half of the loop: chatModelAdapter.ts's own scheduler
  // fires this through useNextChatRuntime's state. Its own onEnded also
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <VoiceConversation
        mode={mode}
        amplitude={amplitude}
        transcript={transcript}
        muted={muted}
        onToggleMute={() => setMuted((value) => !value)}
        onEnd={() => onOpenChange(false)}
      />
    </div>
  );
}
