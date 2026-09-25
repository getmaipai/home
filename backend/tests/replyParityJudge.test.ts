import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { judgeReplyParity } from "@/lib/replyParityJudge";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

// A full-suite run (`bash scripts/check.sh`) found this file's own
// calls failing three different ways depending on run order:
// resetDb() is what every other file that calls complete() calls in
// its own beforeEach (llm.test.ts, conversationBench.test.ts) - its
// absence here let an earlier test file's own `engines.stack.url`
// household setting (a real DB row, never cleared by
// __resetLlmSupervisorForTests()) survive into this file's own run,
// routing every completion through a stale Stack client instead of
// this file's own scripted stub.
beforeEach(() => {
  resetDb();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** Same shape as personaJudge.test.ts's own withScriptedJudge. */
async function withScriptedJudge<T>(reply: (request: ChatCompletionRequest) => unknown, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: reply });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    await stub.stop();
  }
}

describe("judgeReplyParity()", () => {
  test("an empty batch is a trivial pass, no model call needed", async () => {
    const result = await judgeReplyParity([]);
    expect(result).toEqual({ ok: true, verdicts: [] });
  });

  test("a scripted judge reply with one missing point renders that point in the row", async () => {
    const result = await withScriptedJudge(
      () => ({
        verdicts: [{ index: 0, carries_points: false, missing_points: ["the boiling point in Fahrenheit"] }],
      }),
      () => judgeReplyParity([{ question: "what's the boiling point of water in fahrenheit", bareReply: "212°F (100°C).", pathReply: "Water boils at 100°C." }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts).toEqual([{ index: 0, carries_points: false, missing_points: ["the boiling point in Fahrenheit"] }]);
  });

  test("carries_points true with no missing points", async () => {
    const result = await withScriptedJudge(
      () => ({ verdicts: [{ index: 0, carries_points: true, missing_points: [] }] }),
      () => judgeReplyParity([{ question: "q", bareReply: "a", pathReply: "a, structured" }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts[0]!.carries_points).toBe(true);
    expect(result.verdicts[0]!.missing_points).toEqual([]);
  });

  test("a malformed judge reply (no verdicts array) fails cleanly rather than throwing", async () => {
    const result = await withScriptedJudge(
      () => ({ something_else: true }),
      () => judgeReplyParity([{ question: "q", bareReply: "a", pathReply: "b" }]),
    );
    expect(result.ok).toBe(false);
  });

  test("a judge reply that isn't valid JSON fails cleanly", async () => {
    const result = await withScriptedJudge(
      () => "not json at all",
      () => judgeReplyParity([{ question: "q", bareReply: "a", pathReply: "b" }]),
    );
    expect(result.ok).toBe(false);
  });

  test("drops a duplicate index (keeping the last one) and an out-of-range index", async () => {
    const result = await withScriptedJudge(
      () => ({
        verdicts: [
          { index: 0, carries_points: false, missing_points: ["x"] },
          { index: 0, carries_points: true, missing_points: [] },
          { index: 5, carries_points: true, missing_points: [] },
        ],
      }),
      () =>
        judgeReplyParity([
          { question: "a", bareReply: "b", pathReply: "c" },
          { question: "d", bareReply: "e", pathReply: "f" },
        ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts.length).toBe(1);
    expect(result.verdicts[0]!.carries_points).toBe(true);
  });
});
