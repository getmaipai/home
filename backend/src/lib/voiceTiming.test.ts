import { beforeEach, expect, test } from "bun:test";
import { beginVoiceTiming, beginVoiceTimingFor, markVoiceTiming, recordPrewarmTiming, voicePrewarmRecords, voiceTimingRecords, VoiceTimingMessageSchema } from "./voiceTiming";

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
  expect(voiceTimingRecords(1)[0]).toEqual({ turn_id: "turn-123", stt_ms: 240, turn_start_ms: 1000, first_token_ms: 80, first_sentence_ms: 120, first_audio_ms: 210, first_playback_ms: 340 });
});

test("prewarm records are counts only and bounded to 200", () => {
  for (let i = 0; i < 205; i++) recordPrewarmTiming(`actor-${i}`, i % 2 ? "done" : "aborted", i, 100, 70);
  const rows = voicePrewarmRecords();
  expect(rows).toHaveLength(200);
  expect(rows[0]).toMatchObject({ outcome: "done", prompt_n: 100, cache_n: 70, elapsed_ms: 5 });
  expect(Object.keys(rows[0]!).sort()).toEqual(["actor_hash", "cache_n", "elapsed_ms", "outcome", "prompt_n"].sort());
  expect(rows[0]!.actor_hash).toHaveLength(12);
});

test("the timing message schema accepts new optional stamps and old clients", () => {
  expect(VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240 }).success).toBe(true);
  expect(VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240, head_ms: 100, offer_ms: 250, emit_ms: 275, ctx_enqueue: "suspended", ctx_emit: "running" }).success).toBe(true);
  expect(VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240, unexpected: true }).success).toBe(false);
});
