// Fix E (docs/dev.md's "Chat reliability" - native tool calling, one
// round trip): "Routing corpus rows for multi-call utterances" -
// spec/llm/tool-call-corpus.json, run against the stub embedder in the
// deterministic suite (this file, the multi-call WIRE plumbing only -
// client.ts's own per-index tool_calls accumulation, already proven
// directly in tests/llm.test.ts, exercised here across the real
// corpus's own positive rows) and against a real model on demand
// (backend/scripts/bench/tool-calling.ts, which also measures the
// negative rows' real false-call rate - not testable against a scripted
// stub, since "the stub declines because I told it to" proves nothing
// about whether a real model would have called something anyway).
import { describe, expect, test, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { complete, type ToolSpec } from "@/lib/llm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

interface ToolCallCorpusRow {
  utterance: string;
  expect_calls: string[];
}

const corpus: ToolCallCorpusRow[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "spec", "llm", "tool-call-corpus.json"), "utf-8"));
// Only the positive (multi-call) rows: a negative row scripted to return
// no calls would trivially "pass" regardless of whether the wire
// plumbing under test works at all - see this file's own header for why
// those need a real model instead (scripts/bench/tool-calling.ts).
const positiveRows = corpus.filter((row) => row.expect_calls.length > 0);

// Every bundled package this corpus names, offered as a tool - the
// pre-filter turnEngine.ts's own prepareTurn() applies in production
// (TIER2_AMBIGUOUS_FLOOR, MAX_TIER2_TOOLS_OFFERED) is a real turn's Tier
// 1 ranking, not relevant to proving the wire plumbing itself handles
// two independent, unrelated calls in one reply.
const TOOLS: ToolSpec[] = [
  { id: "remember", description: "remember a fact", args: { type: "object", required: ["fact"], properties: { fact: { type: "string" } } } },
  { id: "recall", description: "recall what's known about a topic", args: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } } },
  { id: "define", description: "define a word", args: { type: "object", required: ["word"], properties: { word: { type: "string" } } } },
  { id: "trivia", description: "ask a trivia question", args: { type: "object", properties: {} } },
];

/** Fix E: points the chat backend at a fresh stub scripted to answer
 * with a real tool_calls reply (spec/llm/ts/stubServer.ts's own
 * scriptedToolCalls option), not the deleted grammar-based
 * scriptedChatReply/response_format keying. */
async function withScriptedToolCalls<T>(calls: string[], fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedToolCalls: (request: ChatCompletionRequest) =>
      request.tools && request.tools.length > 0
        ? calls.map((tool, i) => ({ id: `call-${i}`, type: "function" as const, function: { name: tool, arguments: "{}" } }))
        : undefined,
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

describe("tool-call corpus: multi-call utterances (stub embedder, deterministic suite)", () => {
  for (const row of positiveRows) {
    test(row.utterance, async () => {
      // The scripted reply stands in for "the model correctly chose
      // these calls" - proving THIS suite's own claim (client.ts's
      // per-index tool_calls accumulation correctly reconstructs two
      // independent, unrelated calls from one reply, in order). Whether
      // a real model actually picks these two unprompted is exactly
      // what scripts/bench/tool-calling.ts measures instead.
      const result = await withScriptedToolCalls(row.expect_calls, () =>
        complete("chat", [{ role: "user", content: row.utterance }], { tools: TOOLS, tool_choice: "auto" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tool_calls?.map((c) => c.tool)).toEqual(row.expect_calls);
    });
  }
});
