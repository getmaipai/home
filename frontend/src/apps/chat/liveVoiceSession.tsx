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
// Child and teen calls retain the original `listenGeneration` loop;
// adult calls keep their socket live between turns. One effect handles
// connection setup, and a second watches `isSpeaking` (relayed
// from chatModelAdapter.ts's own onSpeakingChange, since a live
// SentenceSpeechScheduler's start/end events happen inside
// useChatRuntime, not here) and bumps the generation once a reply
// finishes speaking - the whole state machine is a value the mount
// effect reacts to, never a manually chained callback tree.
import { useEffect, useRef, useState } from "react";
import { msSinceWakeCue, playWakeCue } from "@/lib/voice/wakeCue";
import { playCallSound } from "@/lib/voice/callSounds";
import type { VoiceMode } from "@maipai/ui/src/elements/voice-conversation";
import { createSttSocket, type SttSocket, type SttSocketHandlers } from "@/lib/voice/sttSocket";
import { MicCaptureError, startMicCapture, type MicCaptureHandle } from "@/lib/voice/mic-capture";
import { createLevelMeter, type LevelMeter } from "@/lib/voice/audioLevelMeter";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { api } from "@/lib/api";

export interface LiveVoiceSessionProps {
  composer: { setText: (text: string) => void; send: () => void };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProblem?: (kind: "listening_lost" | "listening_engine" | "speaking_failed" | "microphone_blocked" | "microphone_insecure" | "microphone_setup" | "microphone_missing" | "microphone_busy") => void;
  /** Optional quiet timeout for wake-opened sessions; null keeps a
   * person-opened voice session active until they end it. */
  idleCloseMs?: number | null;
  turnSchedulerRef: { current: SentenceSpeechScheduler | null };
  liveVoiceActiveRef: { current: boolean };
  pendingSpeechRef: { current: boolean };
  activeTurnRef: { current: { turnId: string; heardVisibleEnd: () => number } | null };
  cancelRun: () => void;
  voiceBargeIn?: boolean;
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
  /** Incremented for each scheduler fetch/body failure. */
  speechFailed?: number;
  /** Injectable retry waits keep the reconnect tests quick. */
  retryDelays?: [number, number];
  installationNotice?: boolean;
}

export const WAKE_SESSION_IDLE_CLOSE_MS = 8000;
export const BARGE_IN_ARM_DELAY_MS = 400;
export const DUPLEX_PAUSE_AFTER_MS = 150;
export const DUPLEX_FALSE_INTERRUPTION_MS = 1200;
/** VOICE-QUICK-02: a reaction while the person is still talking. It needs a real stretch of speech first (words), a pause that
 * lasted this long, and this long since the last one; it is also left out some of the time so it never sounds mechanical. */
/** Jesse, 2026-10-30: the voice must not fade or stop at the first sound (it fades into silence and any breath or room noise cut her sentences short). It plays on at full volume and
 * pauses only once the sound is clearly speech: it lasted this long, or a partial transcript has real words in it. */
export const DUPLEX_CONFIRM_MS = 700;
export const REACTION_MIN_WORDS = 8;
export const REACTION_PAUSE_MS = 400;
export const REACTION_MIN_GAP_MS = 8000;
export const REACTION_CHANCE = 0.4;
// rule: duplexReaction (docs/design/full-duplex-voice-2026-10-24.md)
// A reaction is one of these whole phrases, matched exactly after normalising, and nothing else: "mm-hm", "oh wow", "no way".
// Benchmarks (Full-Duplex-Bench v1.5) and shipped agents (LiveKit, Retell) treat these as "keep talking", not as a new turn. Anything
// not in the list, including every phrase with "no" or "not" except "no way", is a real interruption. The words of a reaction are
// dropped: never stored, never sent. Only the counts below are kept.
export const REACTION_PHRASES: ReadonlySet<string> = new Set([
  "m", "mm", "mhm", "mm hm", "mmhm", "mmhmm", "hm", "hmm", "uh huh", "yeah", "yep", "yes", "okay", "ok", "right", "oh", "ohh", "ah", "ooh", "aw",
  "wow", "oh wow", "whoa", "oh whoa", "no way", "i see", "oh i see", "got it", "really", "oh really", "seriously", "cool", "oh cool",
  "nice", "oh nice", "great", "awesome", "amazing", "wild", "crazy", "interesting", "true", "exactly", "sure", "haha", "ha", "lol",
  "yikes", "geez", "jeez", "oh my", "oh my god", "oh my gosh", "oh okay", "oh ok", "ah okay",
]);
/** Counts only, never text (rule 6a): how often a reaction kept Home talking and how often a real interruption stopped it. */
export const duplexCounters = { reactionResumes: 0, interruptions: 0 };

// Words that only ever react ("oh", "yeah", "nice", "wow"): up to four of them together are a reaction too ("oh yeah", "uh, nice", "yeah
// right"). Nothing that stops, refuses or asks is in this set: no "no", "not", "stop", "wait", "but", question words or names.
// rule: duplexReaction (docs/design/full-duplex-voice-2026-10-24.md) - FROZEN as of 2026-10-25: a further miss is a label for the end-of-turn
// model's backchannel class (DUPLEX-02), never another entry here.
const POSITIVE_REACTION_WORDS: ReadonlySet<string> = new Set([
  "m", "mm", "mhm", "hm", "hmm", "uh", "yeah", "yep", "yes", "okay", "ok", "right", "oh", "ohh", "ah", "ooh", "aw", "wow", "whoa", "really",
  "seriously", "cool", "nice", "great", "awesome", "amazing", "wild", "crazy", "interesting", "true", "exactly", "sure", "haha", "ha", "lol",
  "yikes", "geez", "jeez", "my", "god", "gosh", "see", "so", "good", "fun", "funny",
]);

// A drawn-out sound ("mmm", "hmmm", "woooow", "yeahhh") is the same reaction: a run of three or more of one letter counts as one. A
// reaction word said as a question ("really?", "seriously?") is a real question: the transcript's own question mark decides, since
// the person is asking Home to confirm and carry on, not just nodding.
function isReaction(normalized: string, rawText: string): boolean {
  if (rawText.trim().endsWith("?")) return false;
  const collapsed = normalized.replace(/(\p{L})\1{2,}/gu, "$1");
  if (REACTION_PHRASES.has(collapsed)) return true;
  const words = collapsed.split(" ").filter(Boolean);
  return words.length > 0 && words.length <= 4 && words.every((word) => POSITIVE_REACTION_WORDS.has(word));
}

function normalizedTranscript(text: string): string {
  return text.toLowerCase().replace(/[-\u2010-\u2015]/g, " ").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function useLiveVoiceSession({ composer, open, onOpenChange, onProblem, idleCloseMs = null, turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, activeTurnRef, cancelRun, voiceBargeIn = false, isSpeaking, speakingEndedAt, speechFailed = 0, retryDelays = [0, 1500], installationNotice = false, createSocket = createSttSocket, startCapture = startMicCapture }: LiveVoiceSessionProps) {
  const [mode, setMode] = useState<VoiceMode>("connecting");
  const [amplitude, setAmplitude] = useState(0);
  const [muted, setMuted] = useState(false);
  const [listenGeneration, setListenGeneration] = useState(0);
  const [idleActivity, setIdleActivity] = useState(0);
  const modeRef = useRef<VoiceMode>("connecting");
  const speakingStartedAtRef = useRef(0);
  const isSpeakingRef = useRef(isSpeaking);
  const activeSpeechRef = useRef(false);
  // VOICE-QUICK-02: reactions in the person's pauses.
  const lastPartialRef = useRef("");
  const lastReactionAtRef = useRef(0);
  const lastReactionTextRef = useRef("");
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionEpochRef = useRef(0);
  const reactionSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const interruptedTurnRef = useRef<string | null>(null);
  const overlapPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const falseInterruptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlapPausedRef = useRef(false);
  const overlapTranscriptRef = useRef(false);
  const mutedRef = useRef(false);
  const duckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yieldVoice = () => {
    const scheduler = turnSchedulerRef.current;
    if (!scheduler) return;
    overlapPausedRef.current = true;
    if (duckTimerRef.current) clearTimeout(duckTimerRef.current);
    duckTimerRef.current = setTimeout(() => { duckTimerRef.current = null; turnSchedulerRef.current?.pause(); }, DUPLEX_CONFIRM_MS);
  };
  const restoreVoice = () => {
    if (duckTimerRef.current) clearTimeout(duckTimerRef.current);
    duckTimerRef.current = null;
    turnSchedulerRef.current?.resume();
  };
  const cancelReaction = () => {
    reactionEpochRef.current += 1;
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = null;
    reactionSchedulerRef.current?.stop();
    reactionSchedulerRef.current = null;
  };
  const retryCountRef = useRef(0);
  const speechFailureShownRef = useRef(false);
  const lastSpeechFailedRef = useRef(speechFailed);
  mutedRef.current = muted;
  isSpeakingRef.current = isSpeaking;
  const setCurrentMode = (next: VoiceMode) => { modeRef.current = next; setMode(next); };
  const isReplySpeaking = () => modeRef.current === "speaking" || isSpeakingRef.current;
  const interrupt = (_reason: "voice" | "tap") => {
    if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
    if (falseInterruptionTimerRef.current) clearTimeout(falseInterruptionTimerRef.current);
    overlapPauseTimerRef.current = null;
    falseInterruptionTimerRef.current = null;
    overlapPausedRef.current = false;
    const active = activeTurnRef.current;
    if (active && interruptedTurnRef.current !== active.turnId) {
      interruptedTurnRef.current = active.turnId;
      const heard = active.heardVisibleEnd();
      void api.cancelTurn(active.turnId, heard).catch(() => {});
    }
    turnSchedulerRef.current?.stop();
    cancelRun();
    if (!voiceBargeIn) setListenGeneration((value) => value + 1);
    setCurrentMode("listening");
    setAmplitude(0);
  };

  // Reset all local display state the moment the overlay opens, so a
  // second call never shows the previous one's mode.
  // VOICE-SOUNDS-01: a bright sound when the call starts, a soft different one when it ends; a wake cue that just played stands in for either.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open === wasOpenRef.current) return;
    wasOpenRef.current = open;
    if (msSinceWakeCue() > 3000) playCallSound(open ? "start" : "end");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setCurrentMode("connecting");
    setAmplitude(0);
    setListenGeneration(0);
    // VOICE-PREWARM-01: put this person's prompt prefix back in the engine's cache before they speak. Best effort.
    void api.prewarmTurn().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) {
      speechFailureShownRef.current = false;
      lastSpeechFailedRef.current = speechFailed;
      retryCountRef.current = 0;
      return;
    }
    if (speechFailed > lastSpeechFailedRef.current) {
      lastSpeechFailedRef.current = speechFailed;
      if (!speechFailureShownRef.current) {
        speechFailureShownRef.current = true;
        onProblem?.("speaking_failed");
      }
    }
  }, [open, speechFailed, onProblem]);

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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let connectionFailureHandled = false;
    let terminalServerError = false;
    if (modeRef.current === "listening" || modeRef.current === "connecting") setCurrentMode("connecting");
    // Full-duplex: while a reply plays, report how much has played every 250 ms so the server knows to pause it on the first voiced frame.
    let playedTimer: ReturnType<typeof setInterval> | undefined;
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
            retryCountRef.current = 0;
            if (voiceBargeIn && !playedTimer) {
              playedTimer = setInterval(() => {
                const scheduler = turnSchedulerRef.current;
                if (scheduler && isReplySpeaking()) socket.sendPlayed?.(activeTurnRef.current?.turnId ?? "reply", scheduler.playedMs());
              }, 250);
            }
            if (modeRef.current === "listening" || modeRef.current === "connecting") setCurrentMode("listening");
            if (voiceBargeIn || (!isSpeakingRef.current && modeRef.current !== "thinking" && modeRef.current !== "speaking")) void startCapture({
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
              .catch((error: unknown) => {
                if (!cancelled) {
                  const kind = error instanceof MicCaptureError ? error.kind : "setup";
                  onProblem?.(kind === "denied" ? "microphone_blocked" : kind === "insecure" ? "microphone_insecure" : kind === "not_found" ? "microphone_missing" : kind === "in_use" ? "microphone_busy" : "microphone_setup");
                  onOpenChange(false);
                }
              });
            break;
          case "reply_pause":
            // The server heard the first voiced frame while a reply plays. That is too early to stop her: a breath or room noise would cut her
            // sentence short. The voice session decides from how long the sound lasts and from the words in the partial transcript.
            break;
          case "reply_resume":
            // The sound was not speech: carry on from the same spot.
            if (overlapPausedRef.current) {
              if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
              overlapPauseTimerRef.current = null;
              restoreVoice();
              overlapPausedRef.current = false;
            }
            break;
          case "partial":
            activeSpeechRef.current = true;
            lastPartialRef.current = message.v;
            setIdleActivity((value) => value + 1);
            if (voiceBargeIn && !mutedRef.current && isReplySpeaking() && Date.now() - speakingStartedAtRef.current >= BARGE_IN_ARM_DELAY_MS) {
              // A partial is only a guess at what is being said, so it never cancels the reply (a cancel cannot be undone, and a wrong guess
              // from background TV or a cough left Home silent). The reply stays paused; the final transcript decides. Real-looking
              // words just stop the pause from timing out into a resume.
              const heard = normalizedTranscript(message.v);
              if (heard && !isReaction(heard, message.v)) {
                overlapTranscriptRef.current = true;
                // Two real words are speech, not noise: pause now rather than wait out the confirm window.
                if (heard.split(" ").length >= 2) {
                  if (duckTimerRef.current) { clearTimeout(duckTimerRef.current); duckTimerRef.current = null; }
                  turnSchedulerRef.current?.pause();
                  overlapPausedRef.current = true;
                }
              }
            }
            // Not shown: a partial can revise itself several times a
            // second (interim ASR hypotheses) - the listening ring's
            // own movement (the level meter) is already the "it's
            // hearing you" signal while this is live.
            break;
          case "vad":
            if (message.speaking) {
              cancelReaction();
              activeSpeechRef.current = true;
              setIdleActivity((value) => value + 1);
              const elapsed = Date.now() - speakingStartedAtRef.current;
              if (voiceBargeIn && !mutedRef.current && isReplySpeaking() && !overlapPauseTimerRef.current && !overlapPausedRef.current) {
                overlapTranscriptRef.current = false;
                overlapPauseTimerRef.current = setTimeout(() => {
                  overlapPauseTimerRef.current = null;
                  if (isReplySpeaking() && activeSpeechRef.current) {
                    yieldVoice();
                  }
                }, Math.max(0, BARGE_IN_ARM_DELAY_MS - elapsed) + DUPLEX_PAUSE_AFTER_MS);
              }
            } else {
              activeSpeechRef.current = false;
              // VOICE-QUICK-02: a pause in the middle of what the person is saying may get a short, fitting reaction from the small model.
              const said = lastPartialRef.current.trim();
              if (open && !mutedRef.current && modeRef.current === "listening" && !isReplySpeaking() && said.split(/\s+/).length >= REACTION_MIN_WORDS
                && Date.now() - lastReactionAtRef.current >= REACTION_MIN_GAP_MS && Math.random() < REACTION_CHANCE) {
                cancelReaction();
                const epoch = reactionEpochRef.current;
                reactionTimerRef.current = setTimeout(() => {
                  reactionTimerRef.current = null;
                  if (activeSpeechRef.current) return;
                  void api.reactTurn(said).then(({ text }) => {
                    if (!text || epoch !== reactionEpochRef.current || activeSpeechRef.current || modeRef.current !== "listening") return;
                    lastReactionAtRef.current = Date.now();
                    lastReactionTextRef.current = text;
                    const reaction = new SentenceSpeechScheduler();
                    reactionSchedulerRef.current = reaction;
                    reaction.enqueueSentence(text);
                  }).catch(() => undefined);
                }, REACTION_PAUSE_MS);
              }
              if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
              overlapPauseTimerRef.current = null;
              if (overlapPausedRef.current && !overlapTranscriptRef.current) {
                if (falseInterruptionTimerRef.current) clearTimeout(falseInterruptionTimerRef.current);
                falseInterruptionTimerRef.current = setTimeout(() => {
                  falseInterruptionTimerRef.current = null;
                  if (overlapPausedRef.current) restoreVoice();
                  overlapPausedRef.current = false;
                }, DUPLEX_FALSE_INTERRUPTION_MS);
              }
            }
            break;
          case "final": {
            if (duckTimerRef.current) { clearTimeout(duckTimerRef.current); duckTimerRef.current = null; }
            cancelReaction();
            lastPartialRef.current = "";
            activeSpeechRef.current = false;
            setIdleActivity((value) => value + 1);
            const text = message.v.trim();
            const normalized = normalizedTranscript(text);
            // VOICE-QUICK-02: the microphone can hear Home's own reaction. A transcript that is just that reaction, right after it played, is her voice, not the person's.
            if (normalized && lastReactionTextRef.current && Date.now() - lastReactionAtRef.current < 4000 && normalized === normalizedTranscript(lastReactionTextRef.current)) {
              lastReactionTextRef.current = "";
              break;
            }
            if (voiceBargeIn && isReplySpeaking() && !mutedRef.current) {
              if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
              overlapPauseTimerRef.current = null;
              if (falseInterruptionTimerRef.current) clearTimeout(falseInterruptionTimerRef.current);
              falseInterruptionTimerRef.current = null;
              if (!normalized || isReaction(normalized, text)) {
                // Only noise or a bare reaction: carry on speaking.
                if (normalized) duplexCounters.reactionResumes++;
                if (overlapPausedRef.current) restoreVoice();
                overlapPausedRef.current = false;
                break;
              }
              overlapTranscriptRef.current = true;
              duplexCounters.interruptions++;
              interrupt("voice");
            } else if (voiceBargeIn && modeRef.current === "thinking" && !mutedRef.current) {
              interrupt("voice");
            }
            if (!voiceBargeIn) {
              micHandle?.stop();
              micHandle = null;
              levelMeter?.stop();
              levelMeter = null;
              clearInterval(levelTimer);
              setAmplitude(0);
            }
            if (!text) {
              // Nothing usable - listen again rather than send an empty
              // turn.
              if (!voiceBargeIn) setListenGeneration((g) => g + 1);
              break;
            }
            setCurrentMode("thinking");
            pendingSpeechRef.current = true;
            composer.setText(text);
            void Promise.resolve(composer.send());
            break;
          }
          case "no_speech":
            activeSpeechRef.current = false;
            micHandle?.stop();
            micHandle = null;
            levelMeter?.stop();
            levelMeter = null;
            clearInterval(levelTimer);
            setAmplitude(0);
            setCurrentMode("listening");
            setListenGeneration((g) => g + 1);
            break;
          // A real server-side STT failure (the spec's own `{ t: "error",
          // v: string }`) - distinct from a dropped socket (onError
          // below): the session is still connected, but nothing further
          // will transcribe correctly, so this ends the call the same
          // way a connection-level failure does rather than looping on a
          // broken session.
          case "error":
            terminalServerError = true;
            setCurrentMode("connecting");
            micHandle?.stop();
            levelMeter?.stop();
            clearInterval(levelTimer);
            if (!installationNotice) onProblem?.("listening_engine");
            onOpenChange(false);
            break;
        }
      },
      onError() {
        if (cancelled || connectionFailureHandled || terminalServerError) return;
        connectionFailureHandled = true;
        if (modeRef.current === "listening" || modeRef.current === "connecting") setCurrentMode("connecting");
        micHandle?.stop();
        levelMeter?.stop();
        clearInterval(levelTimer);
        if (retryCountRef.current < 2) {
          const delay = retryDelays[retryCountRef.current];
          retryCountRef.current += 1;
          retryTimer = setTimeout(() => { if (!cancelled) setListenGeneration((generation) => generation + 1); }, delay);
        } else {
          onProblem?.("listening_lost");
          onOpenChange(false);
        }
      },
    });

    return () => {
      cancelled = true;
      if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
      if (falseInterruptionTimerRef.current) clearTimeout(falseInterruptionTimerRef.current);
      clearTimeout(retryTimer);
      clearInterval(levelTimer);
      if (playedTimer) clearInterval(playedTimer);
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
      const wasSpeaking = modeRef.current === "speaking";
      modeRef.current = "speaking";
      if (!wasSpeaking) speakingStartedAtRef.current = Date.now();
      setMode("speaking");
      const timer = setInterval(() => setAmplitude(turnSchedulerRef.current?.readLevel() ?? 0), 60);
      return () => clearInterval(timer);
    }
    setMode((current) => {
      if (current !== "speaking" && current !== "thinking") return current;
      setAmplitude(0);
      if (!voiceBargeIn) setListenGeneration((g) => g + 1);
      modeRef.current = "listening";
      return "listening";
    });
    return undefined;
  }, [isSpeaking, speakingEndedAt, open, turnSchedulerRef, voiceBargeIn]);

  useEffect(() => {
    if (!open || mode !== "listening" || activeSpeechRef.current || typeof idleCloseMs !== "number") return;
    // Read the speech flag again when the timer fires: a stalled event loop can run this callback before React has
    // re-rendered from the speech message that set it, which closed a call whose person was already talking.
    const timer = setTimeout(() => { if (modeRef.current === "listening" && !activeSpeechRef.current) { playWakeCue("closed"); onOpenChange(false); } }, idleCloseMs);
    return () => clearTimeout(timer);
  }, [open, mode, idleCloseMs, idleActivity, onOpenChange]);

  // Arms/disarms the "this send speaks" flag chatModelAdapter.ts reads
  // (speakReplies) for the whole time the overlay is open, and tears
  // down anything still running the moment it closes (End the call, or
  // an unmount) - a stop from here must be immediate, the same
  // guarantee VOICE-01's future barge-in will build on.
  useEffect(() => {
    liveVoiceActiveRef.current = open;
    if (!open) { turnSchedulerRef.current?.stop(); cancelReaction(); }
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
    onInterrupt: () => interrupt("tap"),
  };
}
