import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const metricNames = new Set([
  "t_check", "t_transcript", "t_turn_model", "t_commit", "t_llm_first_token",
  "t_first_phrase_ready", "t_voice_first_audio", "t_first_frame_sent",
  "t_first_audio_scheduled", "t_first_audio_played", "t_duck", "t_local_duck",
  "t_stop_sent", "t_tool_start", "t_tool_end", "t_first_audio_after_tool",
  "draft_head_start_ms", "duration_ms", "chunks", "tool_rounds", "rtt_ms",
  "underruns", "output_latency_ms", "prompt_tokens", "cached_tokens",
  "t_llm_request", "t_local_stop", "prompt_tokens_read", "prompt_tokens_reused", "prompt_ms", "llm_wait_ms", "voice_wait_ms", "load1", "gpu_util", "gpu_other_jobs",
  "dropped_late_frames", "page_underruns", "page_gate_ms", "page_audio_s", "page_voice_speed", "stream_draft", "sounds",
  "at", "ok", "failure", "draft", "early_start", "commit_reason", "backchannel",
]);

export type TurnMetrics = Record<string, number | string | boolean | undefined>;

export function safeMetricRecord(value: TurnMetrics): TurnMetrics {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => metricNames.has(key) && item !== undefined && (typeof item === "number" || typeof item === "string" || typeof item === "boolean")));
}

export function appendMetrics(path: string, value: TurnMetrics) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(safeMetricRecord({ at: new Date().toISOString(), ...value })) + "\n"); // wall-clock stamp so a turn can be matched to a ready run and a GPU log line
}
