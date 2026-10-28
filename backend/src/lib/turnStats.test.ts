import { describe, expect, test } from "bun:test";
import { buildTurnStats, firstTokenFromGenerations, type GenerationInput } from "@/lib/turnStats";
import { emptyTimings } from "@/lib/turnContext";

const gen = (requestSentMs: number, firstDeltaMs: number | null): GenerationInput => ({ reason: "answer", thinking: false, maxTokens: 512, requestSentMs, firstDeltaMs, stats: null });

describe("first token time (2026-10-28: it was null on every live turn)", () => {
  test("is the last streaming generation's request time plus its first-delta wait", () => {
    expect(firstTokenFromGenerations([gen(100, 400), gen(2000, 350)])).toBe(2350);
  });
  test("skips a generation that never streamed and uses the earlier one", () => {
    expect(firstTokenFromGenerations([gen(100, 400), gen(2000, null)])).toBe(500);
  });
  test("is null when nothing streamed", () => {
    expect(firstTokenFromGenerations([])).toBeNull();
    expect(firstTokenFromGenerations([gen(100, null)])).toBeNull();
  });
  test("buildTurnStats fills time_to_first_token_ms when the stage timings carry none", () => {
    const stats = buildTurnStats([gen(300, 900)], emptyTimings(), 0, 5000, null, false);
    expect(stats.time_to_first_token_ms).toBe(1200);
  });
  test("an explicit stage timing still wins", () => {
    const stats = buildTurnStats([gen(300, 900)], { ...emptyTimings(), first_token_ms: 777 }, 0, 5000, null, false);
    expect(stats.time_to_first_token_ms).toBe(777);
  });
});
