import { describe, expect, test, afterEach } from "bun:test";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { judgePersonaConsistency } from "@/lib/personaJudge";
import { DEFAULT_PERSONA, PERSONAS } from "@/lib/persona";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** Same shape as memoryJudge.test.ts's own withScriptedJudge: points the
 * chat backend at a fresh stub scripted to answer this one call's
 * response_format, distinguished by the schema name since a normal
 * turn-generation call never sets one. */
async function withScriptedJudge<T>(reply: (request: ChatCompletionRequest) => unknown, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: reply });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

const buddy = PERSONAS.find((p) => p.id === "buddy") ?? DEFAULT_PERSONA;

describe("judgePersonaConsistency()", () => {
  test("an empty transcript is a trivial pass, no model call needed", async () => {
    const result = await judgePersonaConsistency(buddy, []);
    expect(result).toEqual({ ok: true, verdicts: [], score: 0 });
  });

  test("parses a scripted verdict array into a score", async () => {
    const result = await withScriptedJudge(
      () => ({
        verdicts: [
          { index: 0, matches_persona: true, reason: "casual and curious, matches Buddy" },
          { index: 1, matches_persona: false, reason: "formal, reads like the Tutor instead" },
        ],
      }),
      () =>
        judgePersonaConsistency(buddy, [
          { user: "hey!", reply: "Hey! How's it going?" },
          { user: "what's up", reply: "One's inquiry is met with careful consideration." },
        ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts.length).toBe(2);
    expect(result.score).toBe(0.5);
  });

  test("a malformed judge reply (no verdicts array) fails cleanly rather than throwing", async () => {
    const result = await withScriptedJudge(
      () => ({ something_else: true }),
      () => judgePersonaConsistency(buddy, [{ user: "hi", reply: "hey" }]),
    );
    expect(result.ok).toBe(false);
  });

  test("a judge reply that isn't valid JSON fails cleanly", async () => {
    const result = await withScriptedJudge(
      () => "not json at all",
      () => judgePersonaConsistency(buddy, [{ user: "hi", reply: "hey" }]),
    );
    expect(result.ok).toBe(false);
  });

  test("skips a malformed individual verdict rather than failing the whole batch, but still scores against the FULL transcript, not just the verdicts that parsed", async () => {
    const result = await withScriptedJudge(
      () => ({
        verdicts: [
          { index: 0, matches_persona: true, reason: "fine" },
          { index: 1 }, // missing matches_persona - dropped, not fatal
        ],
      }),
      () =>
        judgePersonaConsistency(buddy, [
          { user: "a", reply: "b" },
          { user: "c", reply: "d" },
        ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts.length).toBe(1);
    // A code review (2026-09-06) found the first cut scored 1/1 here
    // (matches / surviving-verdicts), silently shrinking the
    // denominator every time a verdict is dropped - the real bug behind
    // the real run's own "buddy 5/9" number (9 verdicts for a 10-turn
    // transcript). The missing verdict for exchange 1 counts as a
    // non-match against the real transcript length (2), not as excluded.
    expect(result.score).toBe(0.5);
  });

  test("drops a duplicate index (keeping the last one) and an out-of-range index, rather than corrupting the denominator", async () => {
    const result = await withScriptedJudge(
      () => ({
        verdicts: [
          { index: 0, matches_persona: false, reason: "first pass, wrong" },
          { index: 0, matches_persona: true, reason: "corrected" },
          { index: 5, matches_persona: true, reason: "out of range for a 2-exchange transcript" },
        ],
      }),
      () =>
        judgePersonaConsistency(buddy, [
          { user: "a", reply: "b" },
          { user: "c", reply: "d" },
        ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts.length).toBe(1);
    expect(result.verdicts[0]!.matches_persona).toBe(true);
    expect(result.score).toBe(0.5); // 1 match / 2 real exchanges, exchange 1 never judged
  });
});
