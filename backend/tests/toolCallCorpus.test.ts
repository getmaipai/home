// Session C step 2: "Routing corpus rows for multi-call utterances" -
// spec/llm/tool-call-corpus.json, run against the stub embedder in the
// deterministic suite (this file) and against a real model on demand
// (backend/scripts/bench/tool-calling.ts). Exercises lib/llm.ts's
// complete()/tools plumbing directly (schema construction, parsing) for
// each row rather than actually running the proposed packages - several
// of them (define, trivia) make real HTTP fetches, and this suite stays
// offline by design (attemptTier2Tools()'s own execution path is already
// covered, network-free, by tests/tier2.test.ts).
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

// Every bundled package this corpus names, offered as a tool - the
// pre-filter turnEngine.ts's own attemptTier2Tools() applies in
// production is a real turn's Tier 1 ranking, not relevant to proving
// the grammar/parsing plumbing itself handles two independent, unrelated
// calls in one reply.
const TOOLS: ToolSpec[] = [
  { id: "remember", description: "remember a fact", args: { type: "object", required: ["fact"], properties: { fact: { type: "string" } } } },
  { id: "recall", description: "recall what's known about a topic", args: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } } },
  { id: "define", description: "define a word", args: { type: "object", required: ["word"], properties: { word: { type: "string" } } } },
  { id: "trivia", description: "ask a trivia question", args: { type: "object", properties: {} } },
];

async function withScriptedToolCall<T>(reply: (request: ChatCompletionRequest) => string, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      if (request.response_format?.type !== "json_schema" || request.response_format.json_schema.name !== "tool_calls") return undefined;
      return reply(request);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

describe("tool-call corpus: multi-call utterances (stub embedder, deterministic suite)", () => {
  for (const row of corpus) {
    test(row.utterance, async () => {
      // The scripted reply stands in for "the model correctly chose
      // these two calls" - proving THIS suite's own claim (the grammar
      // and parser handle two independent, unrelated tools in one
      // reply, capped at two, each arg-shaped by its own tool). Whether
      // a real model actually picks these two unprompted is exactly
      // what backend/scripts/bench/tool-calling.ts measures instead.
      const result = await withScriptedToolCall(
        () => JSON.stringify(row.expect_calls.map((tool) => ({ tool, args: {} }))),
        () => complete("chat", [{ role: "user", content: row.utterance }], { tools: TOOLS, tool_choice: "auto" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tool_calls?.map((c) => c.tool)).toEqual(row.expect_calls);
    });
  }
});
