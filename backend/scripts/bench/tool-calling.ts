// Tool-calling bench (session-c-brain-and-voice.md step 2): "Bench:
// Qwen3-4B-Instruct-2507 and Gemma 4 E4B on the corpus, numbers
// recorded." backend/tests/toolCallCorpus.test.ts proves the grammar/
// parsing plumbing against the stub embedder; this is the same corpus
// (spec/llm/tool-call-corpus.json) against a REAL model, so the model's
// OWN choice of which tool(s) to call, unprompted, is what's actually
// measured - the thing a scripted reply can't prove. Point
// MAIPAI_LLAMA_SERVER_URL/MAIPAI_LLAMA_SERVER_BIN+MAIPAI_CHAT_MODEL_PATH
// at a real llama-server serving the model under test before running
// this (docs/dev/session-c.md's step 0 note has the exact variables).
//
// Usage: bun run scripts/bench/tool-calling.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { complete, type ToolSpec } from "@/lib/llm";
import { getEngineStatus, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";

interface ToolCallCorpusRow {
  utterance: string;
  expect_calls: string[];
}

const corpus: ToolCallCorpusRow[] = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "..", "spec", "llm", "tool-call-corpus.json"), "utf-8"),
);

// The same four bundled packages the corpus names - real descriptions
// and args schemas, not paraphrased, since the whole point is testing
// the model against what it would actually be offered in a real turn.
const TOOLS: ToolSpec[] = [
  { id: "remember", description: "remember a fact", args: { type: "object", required: ["fact"], properties: { fact: { type: "string", minLength: 1 } } } },
  { id: "recall", description: "recall what's known about a topic", args: { type: "object", required: ["topic"], properties: { topic: { type: "string", minLength: 1 } } } },
  { id: "define", description: "define a word", args: { type: "object", required: ["word"], properties: { word: { type: "string", minLength: 1 } } } },
  { id: "trivia", description: "ask a trivia question", args: { type: "object", properties: {} } },
];

async function main() {
  // Warm the engine before reporting which one is active - the same
  // reason memory-eval.ts's/routing.ts's own benches do this first.
  await complete("chat", [{ role: "user", content: "hello" }]);
  const status = getEngineStatus();
  console.log(`Chat engine: ${status.kind}, model ${status.modelId ?? "n/a"}`);
  console.log(`Running ${corpus.length} tool-call-corpus rows...\n`);

  let pass = 0;
  for (const row of corpus) {
    const result = await complete("chat", [{ role: "user", content: row.utterance }], { tools: TOOLS, tool_choice: "auto" });
    const calls = result.ok ? result.value.tool_calls : undefined;
    const gotIds = calls?.map((c) => c.tool).sort();
    const wantIds = [...row.expect_calls].sort();
    const ok = calls !== undefined && JSON.stringify(gotIds) === JSON.stringify(wantIds);
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"}  "${row.utterance}" -> expected [${row.expect_calls.join(", ")}], got ${calls === undefined ? "PARSE FAILURE" : `[${(gotIds ?? []).join(", ")}]`}`);
  }
  console.log(`\n${pass}/${corpus.length} passed`);
}

try {
  await main();
} finally {
  __resetLlmSupervisorForTests();
}
