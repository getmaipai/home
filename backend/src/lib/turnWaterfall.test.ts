import { describe, expect, test } from "bun:test";
import { medianOffsets, offsetsOf } from "@/lib/turnWaterfall";
import type { TurnStats } from "@/wire";

const stats = {
  total_time_ms: 900,
  nodes: [{ node: "context", impl: "x", version: "1", startMs: 100, endMs: 160, outcome: { ok: true } }],
  generations: [{ request_sent_ms: 170, prompt_ms: 80, first_delta_ms: 300 }],
} as unknown as TurnStats;

describe("turn waterfall", () => {
  test("offsets come from existing stats and the voice record", () => {
    expect(offsetsOf(stats, { first_sentence_ms: 500, first_audio_ms: 650 })).toEqual({ context_end_ms: 60, prefill_end_ms: 250, first_token_ms: 300, first_sentence_ms: 500, first_audio_ms: 650, total_ms: 900 });
  });
  test("an unmeasured stage is null, not zero", () => {
    expect(offsetsOf({ total_time_ms: null } as unknown as TurnStats).first_audio_ms).toBeNull();
  });
  test("the result holds numbers only: no text, no id, no date", () => {
    const o = offsetsOf({ ...stats, nodes: [...(stats.nodes as object[]), { node: "model", impl: "SECRET-TEXT", version: "1", startMs: 0, endMs: 1, outcome: { ok: true } }] } as unknown as TurnStats, { first_sentence_ms: 1, first_audio_ms: 2 });
    for (const v of Object.values(o)) expect(v === null || typeof v === "number").toBe(true);
    expect(Object.keys(o).sort()).toEqual(["context_end_ms", "first_audio_ms", "first_sentence_ms", "first_token_ms", "prefill_end_ms", "total_ms"]);
    expect(JSON.stringify(medianOffsets([o]))).not.toMatch(/SECRET|id|at"/);
  });
});
