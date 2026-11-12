import { beforeEach, expect, test } from "bun:test";
import { attachTurnStats, beginVoiceTiming, beginVoiceTimingFor, markVoiceTiming, recordPrewarmTiming, setCuePlaybackTiming, voicePrewarmRecords, voiceTimingRecords, voiceTimingReport, VoiceTimingMessageSchema } from "./voiceTiming";
import { prewarmFailureReason } from "./prefixPrewarm";

beforeEach(() => {
  // The ring intentionally exposes only a read view; each test uses fresh module state via a unique tail record.
});

test("records ordered stage durations as counts only", () => {
  const record = beginVoiceTiming();
  const stages = ["stt_ms", "turn_start_ms", "first_token_ms", "first_sentence_ms", "first_audio_ms", "first_playback_ms"] as const;
  stages.forEach((stage, index) => markVoiceTiming(record, stage, (index + 1) * 10));
  const saved = voiceTimingRecords(1)[0]!;
  expect(Object.keys(saved).sort()).toEqual(["first_audio_ms", "first_playback_ms", "first_sentence_ms", "first_token_ms", "stt_ms", "turn_id", "turn_start_ms"].sort());
  expect(stages.map((stage) => saved[stage])).toEqual([10, 20, 30, 40, 50, 60]);
  expect(JSON.stringify(saved)).not.toContain("text");
});

test("ties an incoming spoken-turn measurement to its turn id without content", () => {
  const record = beginVoiceTimingFor("turn-123", 240, 1000);
  markVoiceTiming(record, "first_token_ms", 80);
  markVoiceTiming(record, "first_sentence_ms", 120);
  markVoiceTiming(record, "first_audio_ms", 210);
  markVoiceTiming(record, "first_playback_ms", 340);
  expect(voiceTimingRecords(1)[0]).toMatchObject({ turn_id: "turn-123", stt_ms: 240, turn_start_ms: 1000, first_token_ms: 80, first_sentence_ms: 120, first_audio_ms: 210, first_playback_ms: 340 });
});

test("attaches numeric engine stats and context duration by turn id, while old records remain readable", () => {
  const record = beginVoiceTimingFor("turn-stats", 100, 200);
  attachTurnStats("turn-stats", { prompt_tokens: 900, cache_reuse_tokens: 700, time_to_first_token_ms: 410, nodes: [{ node: "context", startMs: 20, endMs: 95 }] });
  setCuePlaybackTiming(record, 330);
  expect(voiceTimingRecords(1)[0]).toMatchObject({ prompt_n: 900, cache_n: 700, time_to_first_token_ms: 410, context_node_ms: 75, cue_playback_ms: 330 });
  expect(() => JSON.parse(JSON.stringify({ turn_id: "old", stt_ms: null, turn_start_ms: null, first_token_ms: null, first_sentence_ms: null, first_audio_ms: null, first_playback_ms: null }))).not.toThrow();
});

test("attaches context stage stamps and reports their medians while legacy rows omit them", () => {
  beginVoiceTimingFor("turn-stages", 10, 20);
  attachTurnStats("turn-stages", { nodes: [{ node: "context", startMs: 0, endMs: 80, stages: { embed_ms: 12, count_ms: 20, count_calls: 2, window_ms: 8, shadows_ms: 31 } }] });
  expect(voiceTimingRecords(1)[0]).toMatchObject({ context_embed_ms: 12, context_count_ms: 20, context_count_calls: 2, context_window_ms: 8, context_shadows_ms: 31 });
  expect(voiceTimingReport()).toContain("context_count_ms: 20 ms median");
  const legacy = { turn_id: "old-row", stt_ms: null, turn_start_ms: null, first_token_ms: null, first_sentence_ms: null, first_audio_ms: null, first_playback_ms: null };
  expect(() => JSON.parse(JSON.stringify(legacy))).not.toThrow();
});

test("tool time and model rounds are recorded from the node timings and reported apart", () => {
  beginVoiceTimingFor("turn-tool", 100, 200);
  attachTurnStats("turn-tool", { prompt_tokens: 4000, cache_reuse_tokens: 3000, time_to_first_token_ms: 3000, nodes: [{ node: "context", startMs: 0, endMs: 50 }, { node: "model", startMs: 50, endMs: 800 }, { node: "tool", startMs: 800, endMs: 3300 }, { node: "model", startMs: 3300, endMs: 4000 }] });
  expect(voiceTimingRecords(1)[0]).toMatchObject({ tool_ms: 2500, model_rounds: 2 });
  expect(voiceTimingReport()).toMatch(/turns with a tool call: 1,/);
  beginVoiceTimingFor("turn-plain", 100, 200);
  attachTurnStats("turn-plain", { prompt_tokens: 900, cache_reuse_tokens: 700, nodes: [{ node: "model", startMs: 0, endMs: 700 }, { node: "tool", startMs: 700, endMs: 700 }] });
  expect(voiceTimingRecords(1)[0]).toMatchObject({ tool_ms: 0, model_rounds: 1 });
  expect(voiceTimingReport()).toMatch(/turns without a tool call: [1-9]/);
});

test("the headline reads from the end of speech: stt wait plus time to the first answer sound", () => {
  const record = beginVoiceTimingFor("turn-stop", 100, 200);
  markVoiceTiming(record, "stt_ms", 750);
  markVoiceTiming(record, "first_playback_ms", 2000);
  expect(voiceTimingReport()).toContain("FIRST SOUND AFTER YOU STOP TALKING (real answer): median");
  expect(voiceTimingReport()).toMatch(/target 1300 ms/);
});

test("each turn is stamped with the machine load and the report splits busy from quiet turns", () => {
  const record = beginVoiceTimingFor("turn-load", 100, 200);
  expect(typeof record.load_pct === "number" || record.load_pct === undefined).toBe(true);
  markVoiceTiming(record, "stt_ms", 750);
  markVoiceTiming(record, "first_playback_ms", 2000);
  record.load_pct = 120;
  const quiet = beginVoiceTimingFor("turn-quiet", 100, 200);
  markVoiceTiming(quiet, "stt_ms", 750);
  markVoiceTiming(quiet, "first_playback_ms", 1500);
  quiet.load_pct = 20;
  const report = voiceTimingReport();
  expect(report).toMatch(/load under 70 percent: median \d+ ms/);
  expect(report).toMatch(/load 70 percent or more: median \d+ ms/);
});

test("prewarm records are counts only and bounded to 200", () => {
  for (let i = 0; i < 205; i++) recordPrewarmTiming(`actor-${i}`, i % 2 ? "done" : "aborted", i, 100, 70);
  const rows = voicePrewarmRecords();
  expect(rows).toHaveLength(200);
  expect(rows[0]).toMatchObject({ outcome: "done", prompt_n: 100, cache_n: 70, elapsed_ms: 5 });
  expect(Object.keys(rows[0]!).sort()).toEqual(["actor_hash", "cache_n", "elapsed_ms", "outcome", "prompt_n"].sort());
  expect(rows[0]!.actor_hash).toHaveLength(12);
});

test("prewarm failure classes stay short and report counts", () => {
  expect(prewarmFailureReason(new Error("engine busy"))).toBe("engine_busy");
  expect(prewarmFailureReason(new Error("request timed out"))).toBe("timeout");
  expect(prewarmFailureReason(new Error("engine disconnected"))).toBe("engine_error");
  expect(prewarmFailureReason(new Error("unclassified"))).toBe("other");
  recordPrewarmTiming("reason-test", "failed", 1, undefined, undefined, "engine_busy");
  expect(voiceTimingReport(1)).toContain("prewarm failure engine_busy: 1");
});

test("the timing message schema accepts new optional stamps and old clients", () => {
  expect(VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240 }).success).toBe(true);
  expect(VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240, head_ms: 100, offer_ms: 250, emit_ms: 275, ctx_enqueue: "suspended", ctx_emit: "running" }).success).toBe(true);
  expect(VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240, cue_playback_ms: 300 }).success).toBe(true);
  expect(VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240, unexpected: true }).success).toBe(false);
});
