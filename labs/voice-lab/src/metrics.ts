import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const metricNames = new Set([
  "t_check", "t_transcript", "t_turn_model", "t_commit", "t_llm_first_token",
  "t_first_phrase_ready", "t_voice_first_audio", "t_first_frame_sent",
  "t_first_audio_scheduled", "t_first_audio_played", "t_duck", "t_local_duck",
  "t_stop_sent", "t_tool_start", "t_tool_end", "t_first_audio_after_tool",
  "draft_head_start_ms", "duration_ms", "chunks", "tool_rounds", "rtt_ms",
  "underruns", "output_latency_ms", "prompt_tokens", "cached_tokens",
  "ok", "failure", "draft", "early_start", "commit_reason", "backchannel",
]);

export type TurnMetrics = Record<string, number | string | boolean | undefined>;

export function safeMetricRecord(value: TurnMetrics): TurnMetrics {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => metricNames.has(key) && item !== undefined && (typeof item === "number" || typeof item === "string" || typeof item === "boolean")));
}

export function appendMetrics(path: string, value: TurnMetrics) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(safeMetricRecord(value)) + "\n");
}
