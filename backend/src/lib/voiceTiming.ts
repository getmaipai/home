/** Counts-only timings for recent spoken turns. No utterance or reply content is accepted here. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { cpus, loadavg } from "node:os";
import { z } from "zod";
import { dataDir } from "./paths";

export interface VoiceTimingRecord {
  turn_id: string;
  stt_ms: number | null;
  turn_start_ms: number | null;
  first_token_ms: number | null;
  first_sentence_ms: number | null;
  first_audio_ms: number | null;
  first_playback_ms: number | null;
  cue_playback_ms?: number | null;
  prompt_n?: number | null;
  cache_n?: number | null;
  /** CONVO-PREWARM-03: whether the turn's first request extended the conversation's last cache warm; null when no warm was sent. */
  prewarm_hit?: boolean | null;
  /** A conversation warm was still in flight when this turn began (it is aborted, but the engine may still be reading its prompt): the
   * likely cause when a warm turn's first token is slow. */
  prewarm_in_flight?: boolean;
  time_to_first_token_ms?: number | null;
  context_node_ms?: number | null;
  /** Machine load at turn start (1 minute load average divided by core count, times 100) so a slow turn can be read against how busy the Mac was. */
  load_pct?: number | null;
  context_embed_ms?: number | null;
  context_count_ms?: number | null;
  context_count_calls?: number | null;
  context_window_ms?: number | null;
  context_shadows_ms?: number | null;
  /** Time spent in tool nodes (search, lookups) and how many model rounds ran: a turn with a tool call answers only after its tool and a second model round. */
  tool_ms?: number | null;
  model_rounds?: number | null;
  speech_enqueue_ms?: number | null;
  speech_head_ms?: number | null;
  tts_prep_ms?: number | null;
  tts_resolve_ms?: number | null;
  tts_stack_ms?: number | null;
  speech_offer_ms?: number | null;
  speech_emit_ms?: number | null;
  audio_state_enqueue?: string | null;
  audio_state_emit?: string | null;
  /** STT-SMARTTURN-01: what the speculative start did on this turn (see SPECULATIVE_OUTCOMES): `started` and `confirmed` are the
   * hub's own marks; the client labels every other case in its timing report, one per silent reason, so a live record names the cause. */
  speculative?: SpeculativeOutcome | null;
  /** TALK-OVER-01: the "Talk before I finish" level in force for the turn, and the acknowledgement clip's start relative to the end
   * of speech (negative is before), the protected window used, what was decided at its end, and the hard-stop latency. */
  talk_over_level?: "off" | "gentle" | "natural" | null;
  early_release_ms?: number | null;
  overlap_ms?: number | null;
  decision?: TalkOverDecision | null;
  yield_ms?: number | null;
  /** How many edge partials the hub marked in the utterance (a real voice pauses more than a clean recording). */
  edge_partials?: number | null;
  /** The acknowledgement clip's start and end against the end of speech (negative: before the person finished, a wrong start in a
   * pause), and whether it played to its natural end (false only when the call closed under it: nothing else ever stops a clip). */
  clip_started_ms?: number | null;
  clip_ended_ms?: number | null;
  clip_completed?: boolean | null;
  /** ECHO-GUARD-01: final transcripts that were Home's own voice (heard back through the microphone) and were dropped before this turn. */
  echo_drops?: number | null;
  /** Why the session got no "Talk before I finish" grant (`setting_off`, `speculative_off`, `robot`, `not_adult`), `granted` when it did, and
   * how many acknowledgement clips the client had ready (0 means none could play). */
  talk_over_reason?: string | null;
  pool_size?: number | null;
}

export type SpeculativeOutcome = typeof SPECULATIVE_OUTCOMES[number];
export type TalkOverDecision = "none" | "confirmed" | "continued";
/** `armed`: the client could start one and the final came first (no edge partial reached it); `no_conversation`: the voice chat had no
 * conversation id yet; `too_long`: over 40 words; `refused`: the hub said no; `request_failed`: the start request failed; `off`: the client
 * had no speculation at all (the setting or surface). The hub itself marks `started` and `confirmed`. */
export const SPECULATIVE_OUTCOMES = ["off", "armed", "no_conversation", "too_long", "no_edge", "unfinished", "late_start", "busy_thinking", "busy_speaking", "busy_connecting", "muted", "echo", "refused", "request_failed", "started", "confirmed", "discarded"] as const;

export const TALK_OVER_DECISIONS = ["none", "confirmed", "continued"] as const;

export interface PrewarmTimingRecord { actor_hash: string; outcome: "done" | "aborted" | "failed"; reason?: "engine_busy" | "engine_error" | "timeout" | "other"; prompt_n?: number; cache_n?: number; elapsed_ms: number }
type VoiceTimingStage = "stt_ms" | "turn_start_ms" | "first_token_ms" | "first_sentence_ms" | "first_audio_ms" | "first_playback_ms";
export const VoiceTimingMessageSchema = z.object({ t: z.literal("timing"), turn_id: z.string(), stt_ms: z.number().finite().nonnegative(), first_playback_ms: z.number().finite().nonnegative().optional(), first_sentence_ms: z.number().finite().nonnegative().optional(), cue_playback_ms: z.number().finite().nonnegative().optional(), head_ms: z.number().finite().nonnegative().optional(), offer_ms: z.number().finite().nonnegative().optional(), emit_ms: z.number().finite().nonnegative().optional(), ctx_enqueue: z.string().max(20).optional(), ctx_emit: z.string().max(20).optional(),
  // STT-SMARTTURN-01 and TALK-OVER-01: counts and labels only. The server's own `confirmed` mark (set at the confirmation) is never overwritten by a client label.
  speculative: z.enum(SPECULATIVE_OUTCOMES).optional(), talk_over_level: z.enum(["off", "gentle", "natural"]).optional(), early_release_ms: z.number().finite().min(-60_000).max(60_000).optional(), overlap_ms: z.number().finite().nonnegative().max(60_000).optional(), decision: z.enum(TALK_OVER_DECISIONS).optional(), yield_ms: z.number().finite().nonnegative().max(60_000).optional(),
  edge_partials: z.number().int().nonnegative().max(1000).optional(), clip_started_ms: z.number().finite().min(-60_000).max(60_000).optional(), clip_ended_ms: z.number().finite().min(-60_000).max(60_000).optional(), clip_completed: z.boolean().optional(), echo_drops: z.number().int().nonnegative().max(1000).optional(), talk_over_reason: z.enum(["granted", "setting_off", "speculative_off", "robot", "not_adult", "unknown"]).optional(), pool_size: z.number().int().nonnegative().max(100).optional() }).strict();

/** The speculative start's outcome and the talk-over labels, from the client's timing message or the server's own confirmation. */
export function setVoiceOutcome(record: VoiceTimingRecord | undefined, fields: { speculative?: SpeculativeOutcome; talk_over_level?: VoiceTimingRecord["talk_over_level"]; early_release_ms?: number; overlap_ms?: number; decision?: TalkOverDecision; yield_ms?: number; edge_partials?: number; clip_started_ms?: number; clip_ended_ms?: number; clip_completed?: boolean; echo_drops?: number; talk_over_reason?: string; pool_size?: number }): void {
  if (!record) return;
  if (fields.speculative !== undefined && record.speculative !== "confirmed") record.speculative = fields.speculative;
  if (fields.talk_over_level !== undefined) record.talk_over_level = fields.talk_over_level;
  if (fields.talk_over_reason !== undefined) record.talk_over_reason = fields.talk_over_reason;
  for (const key of ["early_release_ms", "overlap_ms", "yield_ms", "edge_partials", "clip_started_ms", "clip_ended_ms", "echo_drops", "pool_size"] as const) { const value = fields[key]; if (value !== undefined && Number.isFinite(value)) record[key] = Math.round(value); }
  if (fields.decision !== undefined) record.decision = fields.decision;
  if (fields.clip_completed !== undefined) record.clip_completed = fields.clip_completed;
  persist();
}

const CAPACITY = 200;
const storePath = join(dataDir, "local-app", "voice-timing.json");
let records: VoiceTimingRecord[] = loadRecords();
let prewarms: PrewarmTimingRecord[] = loadPrewarms();
let nextId = 1;

function loadRecords(): VoiceTimingRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records) ? (parsed as { records: unknown[] }).records : []);
    return rows.filter((row): row is VoiceTimingRecord => Boolean(row) && typeof row === "object" && typeof (row as VoiceTimingRecord).turn_id === "string").slice(-CAPACITY);
  } catch { return []; }
}

function loadPrewarms(): PrewarmTimingRecord[] {
  try { const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8")); return parsed && typeof parsed === "object" && Array.isArray((parsed as { prewarms?: unknown }).prewarms) ? (parsed as { prewarms: PrewarmTimingRecord[] }).prewarms.slice(-CAPACITY) : []; } catch { return []; }
}

function persist(): void {
  try {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    const temp = `${storePath}.tmp`;
    // Counts only (no text, no audio, no ids of people), so the report command can read it without the hub's account; the folder above is 0700 only where the hub makes it.
    writeFileSync(temp, JSON.stringify({ records, prewarms }), { mode: 0o644 });
    renameSync(temp, storePath);
  } catch { /* timing is best effort and never affects the turn */ }
}

export function recordPrewarmTiming(actorId: string, outcome: PrewarmTimingRecord["outcome"], elapsedMs: number, promptN?: number, cacheN?: number, reason?: PrewarmTimingRecord["reason"]): void {
  const row: PrewarmTimingRecord = { actor_hash: createHash("sha256").update(actorId).digest("hex").slice(0, 12), outcome, elapsed_ms: Math.round(Math.max(0, elapsedMs)), ...(reason ? { reason } : {}), ...(Number.isFinite(promptN) ? { prompt_n: promptN } : {}), ...(Number.isFinite(cacheN) ? { cache_n: cacheN } : {}) };
  prewarms.push(row); if (prewarms.length > CAPACITY) prewarms.shift(); persist();
}
export function voicePrewarmRecords(limit = CAPACITY): readonly PrewarmTimingRecord[] { try { const parsed = JSON.parse(readFileSync(storePath, "utf8")) as { prewarms?: PrewarmTimingRecord[] }; if (Array.isArray(parsed.prewarms)) prewarms = parsed.prewarms.slice(-CAPACITY); } catch {} return prewarms.slice(-Math.max(0, Math.min(CAPACITY, Math.floor(limit)))); }

export function beginVoiceTiming(): VoiceTimingRecord {
  const record: VoiceTimingRecord = { turn_id: `voice-${nextId++}`, stt_ms: null, turn_start_ms: null, first_token_ms: null, first_sentence_ms: null, first_audio_ms: null, first_playback_ms: null };
  records.push(record);
  if (records.length > CAPACITY) records.shift();
  persist();
  return record;
}

export function attachSpeechTiming(turnId: string, stamps: { enqueue_ms?: number; head_ms?: number; offer_ms?: number; emit_ms?: number; ctx_enqueue?: string; ctx_emit?: string }): void {
  const record = findVoiceTiming(turnId); if (!record) return;
  for (const [key, value] of Object.entries({ speech_enqueue_ms: stamps.enqueue_ms, speech_head_ms: stamps.head_ms, speech_offer_ms: stamps.offer_ms, speech_emit_ms: stamps.emit_ms, audio_state_enqueue: stamps.ctx_enqueue, audio_state_emit: stamps.ctx_emit })) {
    if (value !== undefined && (typeof value === "string" || Number.isFinite(value))) (record as unknown as Record<string, unknown>)[key] = typeof value === "number" ? Math.round(value) : value;
  }
  persist();
}

export function beginVoiceTimingFor(turnId: string, sttMs: number | null, startedAtMs = Date.now()): VoiceTimingRecord {
  const record: VoiceTimingRecord = { turn_id: turnId, stt_ms: null, turn_start_ms: null, first_token_ms: null, first_sentence_ms: null, first_audio_ms: null, first_playback_ms: null };
  markVoiceTiming(record, "stt_ms", sttMs ?? -1);
  markVoiceTiming(record, "turn_start_ms", startedAtMs);
  try { record.load_pct = Math.round(((loadavg()[0] ?? 0) / Math.max(1, cpus().length)) * 100); } catch { /* the load stamp is optional */ }
  records.push(record);
  if (records.length > CAPACITY) records.shift();
  persist();
  return record;
}

export function markVoiceTiming(record: VoiceTimingRecord | undefined, stage: VoiceTimingStage, elapsedMs: number): void {
  if (record && record[stage] === null && Number.isFinite(elapsedMs) && elapsedMs >= 0) { record[stage] = Math.round(elapsedMs); persist(); }
}

/** Record the first request's three TTS stages once, with durations only. */
export function markVoiceTtsSteps(record: VoiceTimingRecord | undefined, fields: { tts_prep_ms: number; tts_resolve_ms: number; tts_stack_ms: number }): void {
  if (!record || record.tts_prep_ms !== undefined || !Object.values(fields).every((value) => Number.isFinite(value) && value >= 0)) return;
  record.tts_prep_ms = Math.round(fields.tts_prep_ms);
  record.tts_resolve_ms = Math.round(fields.tts_resolve_ms);
  record.tts_stack_ms = Math.round(fields.tts_stack_ms);
  persist();
}

export function setVoiceTiming(record: VoiceTimingRecord | undefined, stage: VoiceTimingStage, elapsedMs: number): void {
  if (record && Number.isFinite(elapsedMs) && elapsedMs >= 0 && (record[stage] === null || stage === "first_sentence_ms" || stage === "first_playback_ms")) { record[stage] = Math.round(elapsedMs); persist(); }
}

export function setCuePlaybackTiming(record: VoiceTimingRecord | undefined, elapsedMs: number): void {
  if (record && Number.isFinite(elapsedMs) && elapsedMs >= 0) { record.cue_playback_ms = Math.round(elapsedMs); persist(); }
}

export function attachTurnStats(turnId: string, stats: { prompt_tokens?: number | null; cache_reuse_tokens?: number | null; prewarm_hit?: boolean | null; time_to_first_token_ms?: number | null; nodes?: Array<{ node: string; startMs: number; endMs: number; stages?: { embed_ms?: number; count_ms?: number; count_calls?: number; window_ms?: number; shadows_ms?: number } }> }): void {
  const record = findVoiceTiming(turnId); if (!record) return;
  const context = stats.nodes?.find((node) => node.node === "context");
  Object.assign(record, { prompt_n: stats.prompt_tokens ?? null, cache_n: stats.cache_reuse_tokens ?? null, prewarm_hit: stats.prewarm_hit ?? null, time_to_first_token_ms: stats.time_to_first_token_ms ?? null, context_node_ms: context ? Math.max(0, context.endMs - context.startMs) : null, context_embed_ms: context?.stages?.embed_ms ?? null, context_count_ms: context?.stages?.count_ms ?? null, context_count_calls: context?.stages?.count_calls ?? null, context_window_ms: context?.stages?.window_ms ?? null, context_shadows_ms: context?.stages?.shadows_ms ?? null, tool_ms: stats.nodes ? Math.round(stats.nodes.filter((node) => node.node === "tool").reduce((sum, node) => sum + Math.max(0, node.endMs - node.startMs), 0)) : null, model_rounds: stats.nodes ? stats.nodes.filter((node) => node.node === "model").length : null });
  persist();
}

export function findVoiceTiming(turnId: string): VoiceTimingRecord | undefined {
  return records.find((record) => record.turn_id === turnId);
}

export function voiceTimingRecords(limit = CAPACITY): readonly VoiceTimingRecord[] {
  records = loadRecords();
  return records.slice(-Math.max(0, Math.min(CAPACITY, Math.floor(limit))));
}

export function voiceTimingReport(limit = 50): string {
  const rows = voiceTimingRecords(limit);
  const median = (values: number[]) => {
    if (!values.length) return "n/a";
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return String(Math.round(values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2));
  };
  const p90 = (values: number[]) => {
    if (!values.length) return "n/a";
    values.sort((a, b) => a - b);
    return String(values[Math.ceil(values.length * 0.9) - 1]);
  };
  const stages = ["stt_ms", "turn_start_ms", "first_token_ms", "first_sentence_ms", "first_audio_ms", "first_playback_ms"] as const;
  const prewarmRows = voicePrewarmRecords(limit);
  const promptDeltas = rows.flatMap((r) => r.prompt_n != null && r.cache_n != null ? [r.prompt_n - r.cache_n] : []);
  const cueValues = rows.flatMap((r) => r.cue_playback_ms == null ? [] : [r.cue_playback_ms]);
  const ctxRows = rows.filter((r) => r.audio_state_enqueue !== undefined);
  const notRunning = ctxRows.filter((r) => r.audio_state_enqueue !== "running" || (r.audio_state_emit !== undefined && r.audio_state_emit !== "running")).length;
  const answerRows = rows.filter((r) => r.cue_playback_ms == null || r.first_sentence_ms !== null || r.first_playback_ms !== null);
  // Turns that ran a tool (search, lookups) answer after the tool and a second model round, so they are reported apart.
  const withTool = rows.filter((r) => (r.tool_ms ?? 0) > 0 || (r.model_rounds ?? 1) > 1);
  const withoutTool = rows.filter((r) => r.tool_ms !== undefined && r.tool_ms !== null && (r.tool_ms ?? 0) === 0 && (r.model_rounds ?? 1) <= 1);
  const firstPlay = (list: typeof rows) => median(list.flatMap((r) => r.first_playback_ms === null || r.first_playback_ms === undefined ? [] : [r.first_playback_ms]));
  const contextStageReport = (["context_embed_ms", "context_count_ms", "context_count_calls", "context_window_ms", "context_shadows_ms"] as const).map((stage) => `${stage}: ${median(rows.flatMap((r) => r[stage] == null ? [] : [r[stage]!]))}${stage === "context_count_calls" ? " median" : " ms median"}`);
  const toolReport = [`turns with a tool call: ${withTool.length}, first playback median ${firstPlay(withTool)} ms`, `turns without a tool call: ${withoutTool.length}, first playback median ${firstPlay(withoutTool)} ms`, `tool time median on tool turns: ${median(withTool.flatMap((r) => r.tool_ms === null || r.tool_ms === undefined ? [] : [r.tool_ms]))} ms`];
  // The headline number: from the moment the person stops talking (final transcript wait stt_ms plus the time from the final to the first sound of the REAL answer). Cloud and other builders measure from the end of speech, so this one compares fairly.
  const stopFor2 = (list: readonly VoiceTimingRecord[]) => list.flatMap((r) => typeof r.stt_ms === "number" && typeof r.first_playback_ms === "number" ? [r.stt_ms + r.first_playback_ms] : []);
  const stopToSound = stopFor2(rows);
  const stopToCue = rows.flatMap((r) => typeof r.stt_ms === "number" && typeof r.cue_playback_ms === "number" ? [r.stt_ms + r.cue_playback_ms] : []);
  const stopReport = [`FIRST SOUND AFTER YOU STOP TALKING (real answer): median ${median([...stopToSound])} ms, p90 ${p90(stopToSound)} ms, ${stopToSound.length} turns (target 1300 ms)`, `first sound after you stop talking, filler cue only: median ${median([...stopToCue])} ms, ${stopToCue.length} turns`];
  // STT-SMARTTURN-01: whether the speculative start fired, per turn, so a record that looks like "the silence timer sits in series" can be read against it.
  const speculativeCount = (outcome: SpeculativeOutcome) => rows.filter((r) => r.speculative === outcome).length;
  const speculativeReport = [`speculative start: ${SPECULATIVE_OUTCOMES.map((outcome) => `${outcome} ${speculativeCount(outcome)}`).join(", ")}, no mark ${rows.filter((r) => r.speculative == null).length}`, `first sound after you stop, speculative start confirmed: median ${median(stopFor2(rows.filter((r) => r.speculative === "confirmed")))} ms; not confirmed: median ${median(stopFor2(rows.filter((r) => r.speculative !== "confirmed")))} ms`];
  const warmInFlight = rows.filter((r) => r.prewarm_in_flight === true);
  const contentionReport = [`turns that began while a conversation warm was still in flight: ${warmInFlight.length} (first token median ${median(warmInFlight.flatMap((r) => r.time_to_first_token_ms == null ? [] : [r.time_to_first_token_ms]))} ms) vs ${rows.filter((r) => r.prewarm_in_flight === false).length} that did not (median ${median(rows.flatMap((r) => r.prewarm_in_flight === false && r.time_to_first_token_ms != null ? [r.time_to_first_token_ms] : []))} ms)`];
  // TALK-OVER-01: the acknowledgement clip's timing, the window decisions and the hard-stop latency.
  const talkRows = rows.filter((r) => typeof r.early_release_ms === "number");
  const clipRows = rows.filter((r) => typeof r.clip_completed === "boolean");
  const edgeRows = rows.flatMap((r) => r.edge_partials == null ? [] : [r.edge_partials]);
  const talkReport = [`edge partials per utterance: median ${median([...edgeRows])}, max ${edgeRows.length ? Math.max(...edgeRows) : "n/a"} (${edgeRows.length} turns)`, `Home's own voice heard back and dropped: ${rows.reduce((n, r) => n + (r.echo_drops ?? 0), 0)} finals over ${rows.length} turns`, `talk before I finish grant: ${["granted", "setting_off", "speculative_off", "robot", "not_adult"].map((reason) => `${reason} ${rows.filter((r) => r.talk_over_reason === reason).length}`).join(", ")}; clips ready median ${median(rows.flatMap((r) => r.pool_size == null ? [] : [r.pool_size]))}`, `clips: ${clipRows.length} played, ${clipRows.filter((r) => r.clip_completed === true).length} played to the end, ${clipRows.filter((r) => r.clip_completed === false).length} stopped by the call closing; start vs end of speech median ${median(clipRows.flatMap((r) => r.clip_started_ms == null ? [] : [r.clip_started_ms]))} ms, end median ${median(clipRows.flatMap((r) => r.clip_ended_ms == null ? [] : [r.clip_ended_ms]))} ms`, `talk before I finish: clips played ${talkRows.length} (gentle ${talkRows.filter((r) => r.talk_over_level === "gentle").length}, natural ${talkRows.filter((r) => r.talk_over_level === "natural").length}), early release vs end of speech median ${median(talkRows.map((r) => r.early_release_ms as number))} ms, continued (wrong starts) ${rows.filter((r) => r.decision === "continued").length}, confirmed ${rows.filter((r) => r.decision === "confirmed").length}, overlap window median ${median(talkRows.flatMap((r) => r.overlap_ms == null ? [] : [r.overlap_ms]))} ms, hard stop median ${median(rows.flatMap((r) => r.yield_ms == null ? [] : [r.yield_ms]))} ms`];
  // Idle versus busy machine: the same headline split at 70 percent load, so a quiet baseline and a normal development day are read apart.
  const loaded = (r: typeof rows[number]) => typeof r.load_pct === "number" && r.load_pct >= 70;
  const withLoad = rows.filter((r) => typeof r.load_pct === "number");
  const stopFor = stopFor2;
  const loadReport = [`machine load at turn start (percent of cores) median: ${median(withLoad.map((r) => r.load_pct as number))}, turns with a load stamp: ${withLoad.length}`, `first sound after you stop, load under 70 percent: median ${median([...stopFor(withLoad.filter((r) => !loaded(r)))])} ms (${stopFor(withLoad.filter((r) => !loaded(r))).length} turns)`, `first sound after you stop, load 70 percent or more: median ${median([...stopFor(withLoad.filter(loaded))])} ms (${stopFor(withLoad.filter(loaded)).length} turns)`];
  return [...stopReport, ...speculativeReport, ...contentionReport, ...talkReport, ...loadReport, `spoken turns: ${rows.length}`, `tts prep median: ${median(rows.flatMap((r) => r.tts_prep_ms == null ? [] : [r.tts_prep_ms]))} ms`, `tts resolve median: ${median(rows.flatMap((r) => r.tts_resolve_ms == null ? [] : [r.tts_resolve_ms]))} ms`, `tts stack median: ${median(rows.flatMap((r) => r.tts_stack_ms == null ? [] : [r.tts_stack_ms]))} ms`, `end to first playback median: ${median(rows.flatMap((r) => r.first_playback_ms === null ? [] : [r.first_playback_ms]))} ms`, `end to first playback p90: ${p90(rows.flatMap((r) => r.first_playback_ms === null ? [] : [r.first_playback_ms]))} ms`, `cue playback median: ${median(cueValues)} ms`, `turns with cue: ${rows.length ? `${Math.round(cueValues.length / rows.length * 100)}%` : "n/a"}`, `answer-only first_sentence_ms median: ${median(answerRows.flatMap((r) => r.first_sentence_ms === null ? [] : [r.first_sentence_ms]))} ms`, `answer-only first_playback_ms median: ${median(answerRows.flatMap((r) => r.first_playback_ms === null ? [] : [r.first_playback_ms]))} ms`, ...contextStageReport, ...stages.filter((stage) => stage !== "first_sentence_ms" && stage !== "first_playback_ms").map((stage) => `${stage}: ${median(rows.flatMap((r) => r[stage] === null ? [] : [r[stage]!]))} ms median`), `ttft (engine stats) median: ${median(rows.flatMap((r) => r.time_to_first_token_ms == null ? [] : [r.time_to_first_token_ms]))} ms`, `prompt_n minus cache_n median: ${median(promptDeltas)}`, `context node median: ${median(rows.flatMap((r) => r.context_node_ms == null ? [] : [r.context_node_ms]))} ms`, `speech head median: ${median(rows.flatMap((r) => r.speech_head_ms == null ? [] : [r.speech_head_ms]))} ms`, `speech offer median: ${median(rows.flatMap((r) => r.speech_offer_ms == null ? [] : [r.speech_offer_ms]))} ms`, `speech emit median: ${median(rows.flatMap((r) => r.speech_emit_ms == null ? [] : [r.speech_emit_ms]))} ms`, `audio context not running (enqueue or emit): ${ctxRows.length ? `${Math.round(notRunning / ctxRows.length * 100)}%` : "n/a"}`, `turns that extended their conversation warm: ${rows.filter((r) => r.prewarm_hit === true).length} of ${rows.filter((r) => typeof r.prewarm_hit === "boolean").length} warmed`, `prewarms done: ${prewarmRows.filter((r) => r.outcome === "done").length}`, `prewarms aborted: ${prewarmRows.filter((r) => r.outcome === "aborted").length}`, `prewarms failed: ${prewarmRows.filter((r) => r.outcome === "failed").length}`, ...(["engine_busy", "engine_error", "timeout", "other"] as const).map((reason) => `prewarm failure ${reason}: ${prewarmRows.filter((r) => r.outcome === "failed" && r.reason === reason).length}`), ...toolReport].join("\n");
}
