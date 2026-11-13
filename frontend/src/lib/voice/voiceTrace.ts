// VOICE-TRACE-01 (2026-11-12): an owner's live trace of the voice client, for reading a real room's sequence off the owner's own
// machine. Off by default; `?voicetrace=10` on the chat page turns it on for the next 10 utterances of that call (owner or admin
// only; the hub refuses anyone else). What it records is event NAMES from the fixed list below and numbers (milliseconds, word
// counts, durations, booleans): never audio, never a transcript, never a word. Each utterance's timeline is posted to the hub,
// which keeps the last few in `local-app/voice-trace.json` beside the voice timing record.
import { api } from "@/lib/api";

/** The whole vocabulary. A name outside this list is dropped before it is recorded. */
export const VOICE_TRACE_EVENTS = [
  // session
  "session_open", "mic_settings", "mic_echo", "mic_gate", "output", "ready", "grant", "pool", "mode",
  // the hub's listening events
  "vad_on", "vad_resumed", "vad_off", "reply_pause", "reply_resume", "partial", "edge", "final", "timing", "no_speech",
  // decisions
  "echo_partial", "echo_final", "pause", "resume", "interrupt", "reaction", "speculate", "speculate_refused", "speculate_failed", "confirm", "discard", "clip_play", "clip_end", "window_decide", "turn_send",
  // the reply's audio
  "audio_start", "audio_stop", "audio_suspend", "audio_resume", "audio_ended",
] as const;
export type VoiceTraceEvent = typeof VOICE_TRACE_EVENTS[number];
const EVENT_SET: ReadonlySet<string> = new Set(VOICE_TRACE_EVENTS);

/** Numbers, booleans and short enum-like strings only; a string value longer than 24 characters is dropped (it could be text). */
export type TraceValue = number | boolean | string;
export interface TraceEntry { t: number; e: VoiceTraceEvent; [key: string]: TraceValue }

export interface VoiceTraceUpload { session: string; utterance: number; events: TraceEntry[] }

const MAX_VALUE_STRING = 24;
const MAX_EVENTS_PER_UTTERANCE = 400;

export interface VoiceTrace {
  readonly enabled: boolean;
  /** Record one event. Extra fields are kept only when they are numbers, booleans or short strings. */
  note(event: VoiceTraceEvent | string, extra?: Record<string, unknown>): void;
  /** The utterance ended (its final arrived, or no speech): post what was recorded and start the next timeline, until N are done. */
  endUtterance(): void;
  /** The call closed: post whatever is pending. */
  close(): void;
  readonly utterancesLeft: number;
}

export function createVoiceTrace(utterances: number, post: (upload: VoiceTraceUpload) => Promise<unknown> = (upload) => api.postVoiceTrace(upload), now: () => number = () => performance.now()): VoiceTrace {
  const session = Math.random().toString(36).slice(2, 10);
  const startedAt = now();
  let left = Math.max(0, Math.floor(utterances));
  let index = 0;
  let events: TraceEntry[] = [];
  const clean = (extra?: Record<string, unknown>): Record<string, TraceValue> => {
    const out: Record<string, TraceValue> = {};
    if (!extra) return out;
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.round(value * 10) / 10;
      else if (typeof value === "boolean") out[key] = value;
      else if (typeof value === "string" && value.length <= MAX_VALUE_STRING && /^[a-z0-9_.:-]*$/i.test(value)) out[key] = value;
    }
    return out;
  };
  const flush = () => {
    if (events.length === 0) return;
    const upload: VoiceTraceUpload = { session, utterance: index, events };
    events = [];
    index += 1;
    void post(upload).catch(() => undefined);
  };
  return {
    get enabled() { return left > 0; },
    get utterancesLeft() { return left; },
    note(event, extra) {
      if (left <= 0 || !EVENT_SET.has(event) || events.length >= MAX_EVENTS_PER_UTTERANCE) return;
      events.push({ t: Math.round(now() - startedAt), e: event as VoiceTraceEvent, ...clean(extra) });
    },
    endUtterance() {
      if (left <= 0) return;
      flush();
      left -= 1;
    },
    close() { if (left > 0) { flush(); left = 0; } },
  };
}

/** The flag on the chat page: `?voicetrace=10` (a number of utterances, 1 to 50; a bare `?voicetrace` means 10). */
export function voiceTraceUtterancesFromSearch(search: string): number {
  const params = new URLSearchParams(search);
  if (!params.has("voicetrace")) return 0;
  const raw = params.get("voicetrace");
  const n = raw === null || raw === "" ? 10 : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(50, Math.floor(n));
}
