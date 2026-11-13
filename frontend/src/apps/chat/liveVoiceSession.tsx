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
import type { SpeculationIds } from "@/apps/chat/useChatVoiceTurnState";
import type { SpeculativeOutcome, SttTimingExtras } from "@/lib/voice/sttContract";
import { TalkOverController, type Overlap } from "@/lib/voice/talkOver";
import { renderAckClips, type AckClipHandle, type AckClipPool } from "@/lib/voice/ackClip";
import { createVoiceTrace, type VoiceTrace } from "@/lib/voice/voiceTrace";

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
  /** STT-SMARTTURN-01: when set, a turn may begin privately on the edge partial (the first partial after the voice stops) for the
   * conversation `getConversationId` names; the final transcript confirms it on an exact match through `pendingRef`, else it is discarded. */
  speculation?: { getConversationId: () => string | undefined; pendingRef: { current: SpeculationIds | null };
    /** TALK-OVER-01: set when the acknowledgement clip played for the turn being confirmed, so the adapter skips the run's own cue. */
    ackClipPlayedRef?: { current: boolean };
    /** The voice the reply will use (the scheduler's `voice`), so the clips are rendered in it (rule 14). */
    getVoice?: () => string | undefined;
    /** Test seam: the clip renderer. */
    renderClips?: typeof renderAckClips;
  };
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
  onVoiceTiming?: (timing: { sttMs: number; firstPlaybackMs?: number; phase?: "final" | "playback"; speculative?: SpeculativeOutcome; talkOver?: Pick<SttTimingExtras, "talk_over_level" | "early_release_ms" | "overlap_ms" | "decision" | "edge_partials" | "clip_started_ms" | "clip_ended_ms" | "clip_completed" | "echo_drops" | "talk_over_reason" | "pool_size"> }) => void;
  voiceTimingSocketRef?: { current: SttSocket | null };
  /** VOICE-TRACE-01: an owner's live trace for the next N utterances of this call (event names and numbers only; off when 0). */
  traceUtterances?: number;
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

/** ECHO-GUARD-01: the transcript is Home's own voice coming back through the microphone when its words are the words Home just said:
 * two or more words as one exact run of what was spoken, or three or more words of which at least 60 percent appear in order in what
 * was spoken (DUPLEX-02's numbers). A one-word transcript is never judged here ("no", "stop" after Home said them still stop her). */
/** Words that always count as the person, however recently Home said them: a child's "no" or "stop" after Home said "no" must still stop her. */
const STOP_WORDS: ReadonlySet<string> = new Set(["no", "stop", "wait", "hey", "hold", "pause", "quiet", "enough", "shush", "shh"]);
export function isOwnEcho(transcript: string, spoken: readonly string[]): boolean {
  const words = normalizedTranscript(transcript).split(" ").filter(Boolean);
  if (words.length === 0 || spoken.length === 0) return false;
  // One word: an echo only when Home just said that very word and it is not a stop word (the microphone hears fragments of her reply:
  // "boiled", "minutes").
  if (words.length === 1) return !STOP_WORDS.has(words[0]!) && spoken.includes(words[0]!);
  if (words.some((word) => STOP_WORDS.has(word)) && words.length < 3) return false;
  // Two words: both hers, in any order (the recognizer reorders and clips words of a reply heard back).
  if (words.length < 3) return words.every((word) => spoken.includes(word));
  let matched = 0; let cursor = 0;
  for (const word of words) { const at = spoken.indexOf(word, cursor); if (at >= 0) { matched += 1; cursor = at + 1; } }
  return matched / words.length >= 0.6;
}
/** Counts only (rule 6a): echoes of Home's own voice that were dropped. */
export const echoCounters = { dropped: 0 };

function normalizedTranscript(text: string): string {
  return text.toLowerCase().replace(/[-\u2010-\u2015]/g, " ").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function useLiveVoiceSession({ composer, open, onOpenChange, onProblem, idleCloseMs = null, turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, activeTurnRef, speculation, cancelRun, voiceBargeIn = false, isSpeaking, speakingEndedAt, speechFailed = 0, retryDelays = [0, 1500], installationNotice = false, createSocket = createSttSocket, startCapture = startMicCapture, onVoiceTiming, voiceTimingSocketRef, traceUtterances = 0 }: LiveVoiceSessionProps) {
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
  // STT-SMARTTURN-01: the held run begun on the edge partial, and whether the next partial is that edge partial (the first after the voice stopped).
  const speculationRef = useRef<(SpeculationIds & { text: string }) | null>(null);
  const edgePartialPendingRef = useRef(false);
  const discardSpeculation = () => {
    const held = speculationRef.current;
    speculationRef.current = null;
    edgePartialPendingRef.current = false;
    if (held) void api.discardTurn(held.turnId).catch(() => undefined);
  };
  // What the speculative start did on the turn in progress, for the voice timing record (counts only): `armed` until a held run
  // starts, `off` when the hub refused it, then `confirmed` or `discarded` at the final.
  const speculativeOutcomeRef = useRef<SpeculativeOutcome>("armed");
  const edgeSeenRef = useRef(false);
  // The hub said "Speculative start is off." once: no more start requests this session (each would be a refused request, and a
  // burst of them hit the turn budget: ten edge partials in two seconds gave 429s on the dev hub, 2026-11-12).
  const speculationOffRef = useRef(false);
  // One start request in flight at a time, carrying the text it was sent with; a newer edge partial with other words replaces it.
  const speculationInFlightRef = useRef<string | null>(null);
  const latestEdgeTextRef = useRef<string | null>(null);
  const refusedThisUtteranceRef = useRef(false);
  // TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 2): the acknowledgement clip and its protected overlap window. The hub
  // grants the level per session (`ready.talk_over`, adults only); the clips are rendered once in the reply's voice; one clip plays
  // per utterance, on the edge partial that starts a held run when the hub's end-of-turn score fires at the level in force.
  const talkOverRef = useRef<TalkOverController | null>(null);
  const ackPoolRef = useRef<AckClipPool | null>(null);
  const ackRenderRef = useRef<AbortController | null>(null);
  const overlapRef = useRef<(Overlap & { conversationId: string; text: string; clip: AckClipHandle; level: "gentle" | "natural" }) | null>(null);
  const overlapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTalkOverRef = useRef<Pick<SttTimingExtras, "talk_over_level" | "early_release_ms" | "overlap_ms" | "decision" | "edge_partials" | "clip_started_ms" | "clip_ended_ms" | "clip_completed"> | undefined>(undefined);
  // How many edge partials the hub marked in the utterance in progress (a real voice pauses more than a clean recording).
  const edgeCountRef = useRef(0);
  // One clip per utterance (Jesse's rule, 2026-11-12), reset when a new utterance begins.
  const clipPlayedThisUtteranceRef = useRef(false);
  const clearOverlapTimer = () => { if (overlapTimerRef.current) clearTimeout(overlapTimerRef.current); overlapTimerRef.current = null; };
  /** The one decision at the window's end (design item 4): the person went on, so the held ANSWER is dropped, silently. The clip is
   * never touched (Jesse's rule, 2026-11-12: once started it always plays to its end); only the held run's release is decided here. */
  const decideOverlap = () => {
    const overlap = overlapRef.current; const control = talkOverRef.current;
    if (!overlap || !control) return;
    const decision = control.decide(overlap.conversationId, overlap, performance.now());
    trace("window_decide", { decision, resumed: overlap.resumedAt !== null, more_words: overlap.moreWords });
    if (decision !== "continued") return;
    const held = speculationRef.current;
    if (held && held.text === overlap.text) { speculationRef.current = null; void api.discardTurn(held.turnId).catch(() => undefined); speculativeOutcomeRef.current = "discarded"; }
  };
  const playAckClip = (conversationId: string, text: string, end: { level: "none" | "gentle" | "natural" } | undefined) => {
    const control = talkOverRef.current; const pool = ackPoolRef.current;
    if (!control || !pool || overlapRef.current || clipPlayedThisUtteranceRef.current || !end || !control.shouldPlay(conversationId, end.level)) return;
    // The edge is stable by the hub's rule (0.2 s of silence with no voice in between before it is marked), so this is the one clip.
    const clip = pool.play(performance.now());
    if (!clip) return;
    clipPlayedThisUtteranceRef.current = true;
    clipPlayedAtRef.current = Date.now();
    const overlap = control.open(conversationId, clip.startedAt, clip.durationMs);
    overlapRef.current = { ...overlap, conversationId, text, clip, level: control.state(conversationId).level as "gentle" | "natural" };
    clearOverlapTimer();
    overlapTimerRef.current = setTimeout(() => { overlapTimerRef.current = null; decideOverlap(); }, Math.max(0, overlap.windowEndsAt - performance.now()));
  };
  const closeOverlap = (finalText: string | null, finalAt: number, sttMs: number | null) => {
    const overlap = overlapRef.current; const control = talkOverRef.current;
    overlapRef.current = null; clearOverlapTimer();
    if (!overlap || !control) { lastTalkOverRef.current = undefined; return; }
    if (finalText !== null && finalText === overlap.text) control.confirm(overlap);
    // A final with other words after a clip was a wrong start; the clip itself is never touched (it plays to its end whatever happens).
    else if (finalText !== null) control.continuedAtFinal(overlap.conversationId, overlap);
    // The clip's start and end relative to the end of speech: the hub's timing message says how long after the last voiced sample the
    // final came. A correct start is always positive (the hub marks the edge after 0.2 s of silence plus the transcription); a large
    // negative value is a wrong start in a mid-sentence pause that long before the person finished.
    const speechEndAt = sttMs !== null ? finalAt - sttMs : null;
    const clip = overlap.clip;
    const endedAt = clip.endedAt ?? (clip.ended ? null : clip.startedAt + clip.durationMs);
    lastTalkOverRef.current = { talk_over_level: overlap.level, overlap_ms: overlap.windowMs, decision: overlap.decision, ...(speechEndAt !== null ? { early_release_ms: Math.round(clip.startedAt - speechEndAt), clip_started_ms: Math.round(clip.startedAt - speechEndAt), ...(endedAt !== null ? { clip_ended_ms: Math.round(endedAt - speechEndAt) } : {}) } : {}), clip_completed: clip.ended ? clip.completed : true };
    if (overlap.decision === "confirmed" && speculation?.ackClipPlayedRef) speculation.ackClipPlayedRef.current = true;
  };
  const startSpeculation = (text: string, unfinished = false, end?: { level: "none" | "gentle" | "natural" }) => {
    if (!speculation || !text) return;
    if (speculationOffRef.current) { speculativeOutcomeRef.current = "off"; return; }
    if (refusedThisUtteranceRef.current) return;
    // Every silent reason is labelled, so a live timing record names why no held run started (2026-11-12: eight live turns all read
    // "armed" and nothing said which gate it was).
    if (text.split(/\s+/).length > 40) { speculativeOutcomeRef.current = "too_long"; return; }
    const conversationId = speculation.getConversationId();
    if (!conversationId) { speculativeOutcomeRef.current = "no_conversation"; return; }
    latestEdgeTextRef.current = text;
    // A plainly unfinished fragment ("what is a", "I want to, uh") is not worth a model run; the next edge partial may be.
    if (unfinished) { if (speculativeOutcomeRef.current === "armed") speculativeOutcomeRef.current = "unfinished"; return; }
    const held = speculationRef.current;
    if (held && held.text === text) return;
    if (held) { speculationRef.current = null; void api.discardTurn(held.turnId).catch(() => undefined); }
    if (overlapRef.current && overlapRef.current.text !== text) talkOverRef.current?.noteMoreWords(overlapRef.current);
    if (speculationInFlightRef.current !== null) return; // reconciled against latestEdgeTextRef when it lands
    speculationInFlightRef.current = text;
    playAckClip(conversationId, text, end);
    const epoch = reactionEpochRef.current;
    trace("speculate", { words: text.split(/\s+/).length });
    void api.speculateTurn(text, conversationId).then((ids) => {
      speculationInFlightRef.current = null;
      // The final already went out, a new utterance began or the session changed meanwhile (the epoch moved), or another held run
      // took the slot: a run that no longer matches anything is dropped at once. The partial handler marks speech as active for
      // every partial, the edge partial included, so that flag must not be read here: it discarded every held run in the browser
      // (found 2026-11-12 on the live hub: every spoken turn still waited the whole silence timer).
      if (epoch !== reactionEpochRef.current || speculationRef.current) { void api.discardTurn(ids.turn_id).catch(() => undefined); return; }
      speculationRef.current = { turnId: ids.turn_id, resumeToken: ids.resume_token, conversationId: ids.conversation_id, text };
      speculativeOutcomeRef.current = "started";
      // A later edge partial with other words arrived while this one was in flight: it is the better guess.
      const latest = latestEdgeTextRef.current;
      if (latest !== null && latest !== text) startSpeculation(latest);
    }).catch((error: unknown) => {
      speculationInFlightRef.current = null;
      if (epoch !== reactionEpochRef.current) return;
      const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : undefined;
      // Read only to recognise the hub's "speculative start is off" answer; it is never shown to the person.
      const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
      trace(status === 400 ? "speculate_refused" : "speculate_failed", { status: typeof status === "number" ? status : 0 });
      if (status === 400 && message.startsWith("Speculative start is off")) { speculationOffRef.current = true; speculativeOutcomeRef.current = "off"; return; }
      refusedThisUtteranceRef.current = true;
      speculativeOutcomeRef.current = status === 400 ? "refused" : "request_failed";
    });
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
  const setCurrentMode = (next: VoiceMode) => { if (modeRef.current !== next) traceRef.current?.note("mode", { mode: next }); modeRef.current = next; setMode(next); };
  const isReplySpeaking = () => modeRef.current === "speaking" || isSpeakingRef.current;
  // VOICE-TRACE-01: the owner's live trace (names and numbers, never words), one timeline per utterance, posted to the hub.
  const traceRef = useRef<VoiceTrace | null>(null);
  const trace = (event: Parameters<VoiceTrace["note"]>[0], extra?: Record<string, unknown>) => traceRef.current?.note(event, extra);
  // The grant's reason and the pool size, reported on the next timing message so the record itself says why no clip could play.
  const talkOverReasonRef = useRef<SttTimingExtras["talk_over_reason"]>("unknown");
  const poolSizeRef = useRef(0);
  // ECHO-GUARD-01: Home's own reply, heard back through the microphone, must not pause or stop her, start a held run, or become a turn.
  // Seen in a traced run (2026-11-12): 372 ms into a reply the hub heard the reply itself, a two-word partial of Home's words paused her
  // (the "blip"), the echo's final cancelled the turn and went out as the next question, and the next reply did the same.
  const lastSpeakingEndedAtRef = useRef(0);
  const echoDropsRef = useRef(0);
  const ECHO_TAIL_MS = 1500;
  // The acknowledgement clip's own words, heard back: part of Home's voice for a few seconds after it played.
  const clipWordsRef = useRef<string[]>([]);
  // The clips as whole normalized phrases ("mm hm", "okay"), for the trailing-echo strip below.
  const clipPhrasesRef = useRef<string[]>([]);
  const clipPlayedAtRef = useRef(0);
  const CLIP_ECHO_MS = 4000;
  const homeVoiceWords = () => {
    const scheduler = turnSchedulerRef.current;
    const replyWords = scheduler && typeof scheduler.recentlySpokenWords === "function" && (isReplySpeaking() || Date.now() - lastSpeakingEndedAtRef.current <= ECHO_TAIL_MS) ? scheduler.recentlySpokenWords() : [];
    const clipWords = Date.now() - clipPlayedAtRef.current <= CLIP_ECHO_MS ? clipWordsRef.current : [];
    return [...replyWords, ...clipWords];
  };
  const isOwnVoice = (text: string) => { const spoken = homeVoiceWords(); return spoken.length > 0 && isOwnEcho(text, spoken); };
  const traceSessionStart = (handle: MicCaptureHandle | null) => {
    trace("session_open", { bargein: voiceBargeIn, trace_left: traceRef.current?.utterancesLeft ?? 0 });
    const s = handle?.settings;
    if (s) trace("mic_settings", { aec: s.echoCancellation ?? "unknown", ns: s.noiseSuppression ?? "unknown", agc: s.autoGainControl ?? "unknown", rate: s.sampleRate ?? 0, channels: s.channelCount ?? 0 });
    try {
      const context = turnSchedulerRef.current ? undefined : undefined;
      void context;
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
        void navigator.mediaDevices.enumerateDevices().then((devices) => {
          const outputs = devices.filter((d) => d.kind === "audiooutput");
          const inputs = devices.filter((d) => d.kind === "audioinput");
          // Device labels are never recorded: only how many and whether any label names headphones or a headset.
          const headset = outputs.some((d) => /head|ear|airpod|buds/i.test(d.label)) || inputs.some((d) => /head|ear|airpod|buds/i.test(d.label));
          trace("output", { outputs: outputs.length, inputs: inputs.length, headset_named: headset, sink_api: typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function" });
        }).catch(() => undefined);
      }
    } catch { /* diagnostics only */ }
  };
  /** The clip's echo can land inside the person's own utterance (speakers, no headset): the final then ends with the clip's words. Those
   * trailing words are Home's, not the person's: dropped before the held run is matched and before the words are sent. */
  const withoutTrailingClipEcho = (text: string) => {
    if (Date.now() - clipPlayedAtRef.current > CLIP_ECHO_MS || clipPhrasesRef.current.length === 0) return text;
    let out = text.trim();
    for (let round = 0; round < 3; round++) {
      const tokens = out.split(/\s+/);
      // A phrase may span one token ("Okay.") or more ("Mm-hm." is "mm hm" once normalized, but "mm hm" could also arrive as two tokens).
      const phrase = clipPhrasesRef.current.find((candidate) => { const n = candidate.split(" ").length; for (let k = 1; k <= Math.min(n, tokens.length - 1); k++) { if (normalizedTranscript(tokens.slice(-k).join(" ")) === candidate) return true; } return false; });
      if (!phrase) break;
      let k = 1; while (k < tokens.length && normalizedTranscript(tokens.slice(-k).join(" ")) !== phrase) k++;
      out = tokens.slice(0, -k).join(" ").replace(/[,;:]+$/, "").trim();
    }
    return out;
  };
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
    let sttMsForNextTurn: number | null = null;
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
            // TALK-OVER-01: the hub's grant for this session (absent for a minor, a robot device or when the setting is off).
            if (traceUtterances && traceUtterances > 0 && !traceRef.current) traceRef.current = createVoiceTrace(traceUtterances);
            trace("ready", { granted: Boolean("talk_over" in message && message.talk_over), reason: ("talk_over_reason" in message && message.talk_over_reason) || (speculation ? "granted" : "no_speculation") });
            if ("talk_over" in message && message.talk_over && speculation) {
              const grant = message.talk_over;
              talkOverReasonRef.current = "granted";
              trace("grant", { level: grant.level, window_ms: grant.window_ms, clips: grant.clips.length });
              talkOverRef.current = new TalkOverController(grant);
              ackRenderRef.current?.abort();
              const render = new AbortController(); ackRenderRef.current = render;
              clipWordsRef.current = grant.clips.flatMap((clip) => normalizedTranscript(clip).split(" ").filter(Boolean));
              clipPhrasesRef.current = grant.clips.map((clip) => normalizedTranscript(clip)).filter(Boolean);
              void (speculation.renderClips ?? renderAckClips)(grant.clips, speculation.getVoice?.(), { signal: render.signal, onTrace: (event, extra) => trace(event, extra) }).then((pool) => { if (!render.signal.aborted) { ackPoolRef.current = pool; poolSizeRef.current = pool.size; trace("pool", { size: pool.size }); } }).catch(() => { trace("pool", { size: 0, failed: true }); });
            } else { talkOverRef.current = null; ackPoolRef.current = null; talkOverReasonRef.current = "talk_over_reason" in message && message.talk_over_reason ? message.talk_over_reason : "unknown"; }
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
                traceSessionStart(handle);
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
            trace("reply_pause");
            break;
          case "reply_resume":
            // The sound was not speech: carry on from the same spot.
            trace("reply_resume", { paused: overlapPausedRef.current });
            if (overlapPausedRef.current) {
              if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
              overlapPauseTimerRef.current = null;
              restoreVoice();
              overlapPausedRef.current = false;
            }
            break;
          case "timing":
            sttMsForNextTurn = message.speech_end_to_final_ms;
            trace("timing", { stt_ms: message.speech_end_to_final_ms, silence_ms: message.silence_wait_ms });
            break;
          case "partial":
            // STT-SMARTTURN-01: the edge partial (the hub marks the one it transcribed at its first silent frame with `edge: true`; the
            // `vad speaking: false` event only comes at finalize, after it) may begin a held run. The armed flag stays for a partial
            // that follows a vad-false from an older hub.
            trace("edge" in message && message.edge === true ? "edge" : "partial", { words: message.v.trim().split(/\s+/).filter(Boolean).length, mode: modeRef.current, speaking: isReplySpeaking(), ...("end" in message && message.end ? { level: message.end.level, score: message.end.score, unfinished: message.end.unfinished } : {}) });
            if ("edge" in message && message.edge === true) { edgeSeenRef.current = true; edgeCountRef.current += 1; }
            if (("edge" in message && message.edge === true) || (edgePartialPendingRef.current && !activeSpeechRef.current)) {
              // The clip's own echo at the end of the words is Home's, not the person's (see withoutTrailingClipEcho): the held run keeps matching.
              const edgeText = withoutTrailingClipEcho(message.v.trim());
              if (isOwnVoice(edgeText)) { trace("echo_partial", { words: edgeText.split(/\s+/).length, edge: true }); if (speculativeOutcomeRef.current === "armed") speculativeOutcomeRef.current = "echo"; }
              else if (modeRef.current === "listening" && !isReplySpeaking() && !mutedRef.current) startSpeculation(edgeText, "end" in message && message.end?.unfinished === true, "end" in message ? message.end : undefined);
              // The session was not listening (the last reply still thinking or speaking, or the mic muted): labelled, so a live record names it.
              else if (speculativeOutcomeRef.current === "armed") speculativeOutcomeRef.current = mutedRef.current ? "muted" : isReplySpeaking() ? "busy_speaking" : modeRef.current === "thinking" ? "busy_thinking" : modeRef.current === "connecting" ? "busy_connecting" : "busy_speaking";
            }
            else if (overlapRef.current && message.v.trim().split(/\s+/).length > overlapRef.current.text.split(/\s+/).length) talkOverRef.current?.noteMoreWords(overlapRef.current);
            edgePartialPendingRef.current = false;
            activeSpeechRef.current = true;
            lastPartialRef.current = message.v;
            setIdleActivity((value) => value + 1);
            if (voiceBargeIn && !mutedRef.current && isReplySpeaking() && Date.now() - speakingStartedAtRef.current >= BARGE_IN_ARM_DELAY_MS) {
              // A partial is only a guess at what is being said, so it never cancels the reply (a cancel cannot be undone, and a wrong guess
              // from background TV or a cough left Home silent). The reply stays paused; the final transcript decides. Real-looking
              // words just stop the pause from timing out into a resume.
              const heard = normalizedTranscript(message.v);
              const ownVoice = Boolean(heard) && isOwnVoice(message.v);
              if (ownVoice) trace("echo_partial", { words: heard.split(" ").length });
              if (heard && !isReaction(heard, message.v) && !ownVoice) {
                overlapTranscriptRef.current = true;
                // Two real words are speech, not noise: pause now rather than wait out the confirm window.
                if (heard.split(" ").length >= 2) {
                  if (duckTimerRef.current) { clearTimeout(duckTimerRef.current); duckTimerRef.current = null; }
                  trace("pause", { words: heard.split(" ").length });
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
            trace(message.speaking ? ("resumed" in message && message.resumed === true ? "vad_resumed" : "vad_on") : "vad_off", { mode: modeRef.current, speaking: isReplySpeaking() });
            if (message.speaking && "resumed" in message && message.resumed === true) {
              // TALK-OVER-01: the person's voice came back inside the same utterance (after an edge partial). It is not a new utterance, so
              // it must not cancel the in-flight reaction or held run (doing so bumped the epoch and dropped the speculative start): it only
              // tells the overlap window the person went on. The next edge partial, or the final, settles the held run.
              if (overlapRef.current) talkOverRef.current?.noteResumed(overlapRef.current, performance.now());
              break;
            }
            if (message.speaking) {
              refusedThisUtteranceRef.current = false; latestEdgeTextRef.current = null; clipPlayedThisUtteranceRef.current = false;
              cancelReaction();
              discardSpeculation(); // STT-SMARTTURN-01: a new utterance means the held run's words were not the final ones
              activeSpeechRef.current = true;
              setIdleActivity((value) => value + 1);
              // ECHO-GUARD-01 (2026-11-12): a sound with no words never pauses her any more. The pause that fired 850 ms into any sound while
              // she spoke was the "blip" the owner heard: the microphone hears her own reply, that sound lasts as long as the reply, and
              // the pause came before any transcript could say whose voice it was. Her words in a partial (two real words that are not
              // her own) pause her; the final decides the rest (Jesse, 2026-10-30: she pauses only once the sound is clearly speech).
              if (voiceBargeIn && !mutedRef.current && isReplySpeaking()) overlapTranscriptRef.current = false;
            } else {
              activeSpeechRef.current = false;
              edgePartialPendingRef.current = true; // STT-SMARTTURN-01: the next partial is the edge partial
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
            const text = withoutTrailingClipEcho(message.v.trim());
            const normalized = normalizedTranscript(text);
            trace("final", { words: text.split(/\s+/).filter(Boolean).length, stripped: text.length !== message.v.trim().length, mode: modeRef.current, speaking: isReplySpeaking() });
            // VOICE-QUICK-02: the microphone can hear Home's own reaction. A transcript that is just that reaction, right after it played, is her voice, not the person's.
            if (normalized && lastReactionTextRef.current && Date.now() - lastReactionAtRef.current < 4000 && normalized === normalizedTranscript(lastReactionTextRef.current)) {
              lastReactionTextRef.current = "";
              break;
            }
            // ECHO-GUARD-01: a final that is Home's own voice, while she speaks or just after, is dropped: she carries on, nothing is sent.
            if (normalized && isOwnVoice(text)) {
              echoCounters.dropped++; echoDropsRef.current += 1;
              trace("echo_final", { words: normalized.split(" ").length });
              traceRef.current?.endUtterance();
              closeOverlap(null, performance.now(), null);
              if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
              overlapPauseTimerRef.current = null;
              if (falseInterruptionTimerRef.current) clearTimeout(falseInterruptionTimerRef.current);
              falseInterruptionTimerRef.current = null;
              if (overlapPausedRef.current) restoreVoice();
              overlapPausedRef.current = false;
              discardSpeculation();
              if (speculativeOutcomeRef.current === "armed" || speculativeOutcomeRef.current === "echo") speculativeOutcomeRef.current = "armed";
              break;
            }
            if (voiceBargeIn && isReplySpeaking() && !mutedRef.current) {
              if (overlapPauseTimerRef.current) clearTimeout(overlapPauseTimerRef.current);
              overlapPauseTimerRef.current = null;
              if (falseInterruptionTimerRef.current) clearTimeout(falseInterruptionTimerRef.current);
              falseInterruptionTimerRef.current = null;
              if (!normalized || isReaction(normalized, text)) {
                // Only noise or a bare reaction: carry on speaking.
                trace("reaction", { words: normalized ? normalized.split(" ").length : 0, paused: overlapPausedRef.current });
                if (normalized) duplexCounters.reactionResumes++;
                if (overlapPausedRef.current) restoreVoice();
                overlapPausedRef.current = false;
                break;
              }
              overlapTranscriptRef.current = true;
              duplexCounters.interruptions++;
              trace("interrupt", { words: normalized.split(" ").length, played_ms: Math.round(turnSchedulerRef.current?.playedMs?.() ?? 0) });
              interrupt("voice");
            } else if (voiceBargeIn && modeRef.current === "thinking" && !mutedRef.current) {
              trace("interrupt", { words: normalized.split(" ").length, thinking: true });
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
            const sttMs = sttMsForNextTurn;
            sttMsForNextTurn = null;
            // TALK-OVER-01: the final settles the overlap (a match confirms the clip; anything else was a wrong start).
            closeOverlap(text, performance.now(), sttMs);
            // STT-SMARTTURN-01: an exact trimmed match confirms the held run through this one send; anything else discards it first.
            let speculative: SpeculativeOutcome = speculativeOutcomeRef.current;
            if (speculation) {
              const held = speculationRef.current;
              speculationRef.current = null;
              edgePartialPendingRef.current = false;
              if (held && held.text === text) { speculation.pendingRef.current = { turnId: held.turnId, resumeToken: held.resumeToken, conversationId: held.conversationId }; speculative = "confirmed"; trace("confirm"); }
              else if (held) { void api.discardTurn(held.turnId).catch(() => undefined); speculative = "discarded"; trace("discard", { at_final: true }); }
              else if (speculative === "started") speculative = "discarded";
              else if (speculationInFlightRef.current !== null) speculative = "late_start";
              else if (speculative === "armed" && !edgeSeenRef.current) speculative = "no_edge";
            }
            edgeSeenRef.current = false;
            speculativeOutcomeRef.current = speculationOffRef.current ? "off" : "armed";
            latestEdgeTextRef.current = null;
            refusedThisUtteranceRef.current = false;
            const edgePartials = edgeCountRef.current; edgeCountRef.current = 0;
            const echoDrops = echoDropsRef.current; echoDropsRef.current = 0;
            trace("turn_send", { words: text.split(/\s+/).filter(Boolean).length, speculative, edges: edgePartials, echo_drops: echoDrops });
            traceRef.current?.endUtterance();
            onVoiceTiming?.({ sttMs: sttMs !== null && Number.isFinite(sttMs) && sttMs >= 0 ? sttMs : 0, phase: "final", ...(speculation ? { speculative } : {}), talkOver: { ...lastTalkOverRef.current, edge_partials: edgePartials, ...(echoDrops > 0 ? { echo_drops: echoDrops } : {}), talk_over_reason: talkOverReasonRef.current, pool_size: poolSizeRef.current } });
            lastTalkOverRef.current = undefined;
            pendingSpeechRef.current = true;
            composer.setText(text);
            void Promise.resolve(composer.send());
            break;
          }
          case "no_speech":
            trace("no_speech");
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
    if (voiceTimingSocketRef) voiceTimingSocketRef.current = socket;

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
      if (voiceTimingSocketRef?.current === socket) voiceTimingSocketRef.current = null;
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
    // VOICE-TRACE-01: the current reply's audio events ride on the same trace; the scheduler is the one the adapter made for this reply.
    const scheduler = turnSchedulerRef.current;
    if (scheduler && traceRef.current && !scheduler.onTrace) scheduler.onTrace = (event, extra) => trace(event, extra);
    trace("mode", { mode: isSpeaking ? "speaking" : modeRef.current, speaking: isSpeaking });
    if (isSpeaking) {
      const wasSpeaking = modeRef.current === "speaking";
      modeRef.current = "speaking";
      if (!wasSpeaking) speakingStartedAtRef.current = Date.now();
      setMode("speaking");
      const timer = setInterval(() => setAmplitude(turnSchedulerRef.current?.readLevel() ?? 0), 60);
      return () => clearInterval(timer);
    }
    lastSpeakingEndedAtRef.current = Date.now();
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
    if (!open) { turnSchedulerRef.current?.stop(); cancelReaction(); discardSpeculation(); closeOverlap(null, performance.now(), null); ackPoolRef.current?.stopAll(); ackRenderRef.current?.abort(); traceRef.current?.close(); traceRef.current = null; }
    return () => {
      liveVoiceActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelReaction/discardSpeculation/closeOverlap close over stable refs; `open` is the real trigger.
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
