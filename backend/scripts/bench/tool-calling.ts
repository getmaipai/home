// Tool-calling bench (session-c-brain-and-voice.md step 2, Fix E's own
// native-tool-calling rewrite - docs/dev.md's "Chat reliability"):
// backend/tests/toolCallCorpus.test.ts proves the multi-call wire
// plumbing against the stub embedder (a scripted reply standing in for
// "the model correctly chose these tools"); this is the same corpus
// (spec/llm/tool-call-corpus.json) against a REAL model, so the model's
// OWN choice of which tool(s) to call, unprompted, is what's actually
// measured - the thing a scripted reply can't prove, including the
// negative rows (a real utterance that should call nothing at all -
// Fix E's own false-call-rate exit criterion: "if that rate is above 2
// percent, the fix is a better floor or better negatives in the corpus,
// never a return to the grammar"). Point MAIPAI_LLAMA_SERVER_URL/
// MAIPAI_LLAMA_SERVER_BIN+MAIPAI_CHAT_MODEL_PATH at a real llama-server
// serving the model under test before running this (docs/dev/
// session-c.md's step 0 note has the exact variables) - no code here
// changed for the native-tool-calling rewrite at all: complete()'s own
// `tools`/`tool_choice` surface stayed the same, only its internal
// mechanism did.
//
// Usage: bun run scripts/bench/tool-calling.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { complete, type ToolSpec } from "@/lib/llm";
import { getEngineStatus, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { loadManifestOnly } from "@/lib/plugins";

interface ToolCallCorpusRow {
  utterance: string;
  expect_calls: string[];
}

const corpus: ToolCallCorpusRow[] = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "..", "spec", "llm", "tool-call-corpus.json"), "utf-8"),
);

// The same four bundled packages the corpus names, loaded from their own
// real manifests rather than hand-copied here - a code review (2026-09-07)
// caught this file's own hardcoded descriptions had drifted from what a
// real turn actually offers (e.g. recall's real description is "Tells
// you what it remembers about something you ask," not the paraphrase
// "recall what's known about a topic" this used to say), which this
// file's own header comment already promised not to do.
const TOOLS: ToolSpec[] = ["remember", "recall", "define", "trivia"].map((id) => {
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) throw new Error(`bundled package ${id} failed to load: ${loaded.error}`);
  return { id, description: loaded.value.description, args: loaded.value.args };
});

// Fix E's own exit criterion (docs/dev.md): "the real false-call rate at
// the chat temperature over five repeats per corpus row" - a single pass
// says nothing about a small model's own run-to-run variance, and a
// negative row that happens to pass once is not the same claim as
// "reliably doesn't false-call this."
// A code review (2026-09-07) found an invalid override (empty string, a
// typo) silently became NaN here, which makes every `i < REPEATS` loop
// below false on its first check - zero repeats run for every row, and
// the false-call rate then reads "0/0 (0.0%)", a clean pass on this
// fix's own exit criterion for having tested nothing at all. Falls back
// to the real default instead of ever running with NaN.
const requestedRepeats = Number(process.env.MAIPAI_BENCH_REPEATS ?? 5);
const REPEATS = Number.isFinite(requestedRepeats) && requestedRepeats > 0 ? requestedRepeats : 5;

async function main() {
  // Warm the engine before reporting which one is active - the same
  // reason memory-eval.ts's/routing.ts's own benches do this first.
  await complete("chat", [{ role: "user", content: "hello" }]);
  const status = getEngineStatus();
  console.log(`Chat engine: ${status.kind}, model ${status.modelId ?? "n/a"}`);
  console.log(`Running ${corpus.length} tool-call-corpus rows, ${REPEATS} repeats each...\n`);

  let falseCallAttempts = 0; // every repeat of a negative row (expect_calls: [])
  let falseCalls = 0; // how many of those actually called something anyway

  for (const row of corpus) {
    const isNegative = row.expect_calls.length === 0;
    let rowPass = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const result = await complete("chat", [{ role: "user", content: row.utterance }], { tools: TOOLS, tool_choice: "auto" });
      const calls = result.ok ? result.value.tool_calls : undefined;
      const gotIds = calls?.map((c) => c.tool).sort();
      const wantIds = [...row.expect_calls].sort();
      const ok = calls !== undefined && JSON.stringify(gotIds) === JSON.stringify(wantIds);
      if (ok) rowPass++;
      if (isNegative) {
        falseCallAttempts++;
        if (calls !== undefined && calls.length > 0) falseCalls++;
      }
      outcomes.push(calls === undefined ? "no reply" : calls.length === 0 ? "[]" : `[${(gotIds ?? []).join(", ")}]`);
    }
    console.log(`${rowPass}/${REPEATS}  "${row.utterance}" -> expected [${row.expect_calls.join(", ")}], got: ${outcomes.join(" | ")}`);
  }

  const falseCallRate = falseCallAttempts > 0 ? (falseCalls / falseCallAttempts) * 100 : 0;
  console.log(`\nFalse-call rate on negative rows: ${falseCalls}/${falseCallAttempts} (${falseCallRate.toFixed(1)}%)`);
  if (falseCallAttempts > 0 && falseCallRate > 2) {
    console.log("Above Fix E's own 2% bar - needs a better floor or better negatives in the corpus, never a return to the grammar.");
  }
}

try {
  await main();
} finally {
  __resetLlmSupervisorForTests();
}
