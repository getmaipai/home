// VOICE-TRACE-01 (2026-11-12): the hub side of an owner's live voice trace. The client posts one timeline per utterance (event
// names from a fixed list and numbers only: never audio, never a transcript, never a word); the hub keeps the last few in
// `local-app/voice-trace.json` beside the voice timing record, so the real sequence from the owner's room can be read from the
// record folder. Owner or admin only (the route checks); counts only (rule 6a).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { dataDir } from "./paths";

export const VOICE_TRACE_EVENTS = [
  "session_open", "mic_settings", "mic_echo", "mic_gate", "output", "ready", "grant", "pool", "mode",
  "vad_on", "vad_resumed", "vad_off", "reply_pause", "reply_resume", "partial", "edge", "final", "timing", "no_speech",
  "echo_partial", "echo_final", "pause", "resume", "interrupt", "reaction", "speculate", "speculate_refused", "speculate_failed", "confirm", "discard", "clip_play", "clip_end", "window_decide", "turn_send",
  "audio_start", "audio_stop", "audio_suspend", "audio_resume", "audio_ended",
] as const;

/** Every extra field is a number, a boolean or a short token (letters, digits, `_ . : -`, at most 24 characters): no free text can get in. */
const TraceValue = z.union([z.number().finite(), z.boolean(), z.string().max(24).regex(/^[a-z0-9_.:-]*$/i)]);
export const TraceEntrySchema = z.object({ t: z.number().finite().nonnegative(), e: z.enum(VOICE_TRACE_EVENTS) }).catchall(TraceValue);
export const VoiceTraceUploadSchema = z.object({
  session: z.string().regex(/^[a-z0-9]{4,16}$/),
  utterance: z.number().int().nonnegative().max(1000),
  events: z.array(TraceEntrySchema).max(400),
}).strict();
export type VoiceTraceUpload = z.infer<typeof VoiceTraceUploadSchema>;

export interface StoredVoiceTrace extends VoiceTraceUpload { received_at: string; actor_role: string }

const CAPACITY = 20;
const storePath = join(dataDir, "local-app", "voice-trace.json");
let traces: StoredVoiceTrace[] | null = null;

function load(): StoredVoiceTrace[] {
  if (traces) return traces;
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8"));
    const rows = parsed && typeof parsed === "object" && Array.isArray((parsed as { traces?: unknown }).traces) ? (parsed as { traces: unknown[] }).traces : [];
    traces = rows.filter((row): row is StoredVoiceTrace => Boolean(row) && typeof row === "object" && typeof (row as StoredVoiceTrace).session === "string").slice(-CAPACITY);
  } catch { traces = []; }
  return traces;
}

function persist(): void {
  try {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    const temp = `${storePath}.tmp`;
    writeFileSync(temp, JSON.stringify({ traces: load() }, null, 1), { mode: 0o644 });
    renameSync(temp, storePath);
  } catch { /* the trace is a diagnostic; losing one never affects the call */ }
}

/** Keep one utterance's timeline (the newest CAPACITY are kept). The upload was validated by the route. */
export function storeVoiceTrace(upload: VoiceTraceUpload, actorRole: string): StoredVoiceTrace {
  const row: StoredVoiceTrace = { ...upload, received_at: new Date().toISOString(), actor_role: actorRole };
  const rows = load();
  rows.push(row);
  while (rows.length > CAPACITY) rows.shift();
  persist();
  return row;
}

export function voiceTraces(): readonly StoredVoiceTrace[] { return load(); }

/** One line per event, for `bun run voice:latency --trace` and the report. */
export function formatVoiceTrace(trace: StoredVoiceTrace): string {
  const lines = trace.events.map((event) => { const { t, e, ...rest } = event; const extra = Object.entries(rest).map(([key, value]) => `${key}=${String(value)}`).join(" "); return `${String(t).padStart(7)} ${e}${extra ? ` ${extra}` : ""}`; });
  return [`session ${trace.session} utterance ${trace.utterance} (${trace.received_at}, ${trace.actor_role})`, ...lines].join("\n");
}

export function __resetVoiceTraceForTests(): void { traces = null; try { rmSync(storePath, { force: true }); } catch { /* no file */ } }
