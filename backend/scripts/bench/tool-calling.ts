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
//
// ROUTE-01 (docs/dev/session-a.md, getmaipai/home#80): a second, ROUTED
// pass follows the fixed one. The fixed pass hands the model the same
// four tools on a bare prompt whatever the row says, so it never saw
// routing and could not say what removing the Tier 2 floor costs. The
// routed pass builds each row's offered set the way prepareTurn() does
// (routeSemantic() over the real bundled manifests, then
// selectOfferedTools() with the row's own shape) and sends the real
// prompt shape (buildPromptParts() for a bench person, no history), so
// its numbers are the production path's. A call is false there when the
// tool is neither expected nor an always-offer package; an always-offer
// call on a negative row (websearch on the Stephen King row) is printed
// as a lookup call, the designed behavior of always-offer, not a routing
// false call. The two #77 phrasings ride along as extra positive rows.
//
// Usage: bun run scripts/bench/tool-calling.ts
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { finishBench, startBench } from "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { complete, type LlmMessage, type ToolSpec } from "@/lib/llm";
import { getEngineStatus, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { loadManifestOnly } from "@/lib/plugins";
import { embedUtterance, utteranceShape } from "@/lib/routing";
import { buildPromptParts, commandOpeners, loadAllManifests, routeSemantic, selectOfferedTools } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";

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
// ROUTE-01's own two rows (getmaipai/home#77's exact phrasings): Tier 0
// patterns catch them in runTurn() since 147cd28, so the routed pass
// measures them through the model path directly, which is the point.
const ROUTE01_ROWS: ToolCallCorpusRow[] = [
  { utterance: "the plumber's number is 555 9876 extension 12, please remember it", expect_calls: ["remember"] },
  { utterance: "Friday is pizza night, please remember", expect_calls: ["remember"] },
];

const benchPersonId = newPersonId();
function createBenchPerson(): PersonRow {
  const nowIso = new Date().toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, 'owner', ?, 'bench', 0, ?, ?, ?)",
    )
    .run(benchPersonId, "Bench Household", randomSuffix(12), nowIso, nowIso, nextHlc());
  const actor = db.select().from(people).where(eq(people.id, benchPersonId)).get();
  if (!actor) throw new Error("failed to create the bench person row");
  return actor as PersonRow;
}
function cleanup(): void {
  sqlite.query("DELETE FROM people WHERE id = ?").run(benchPersonId); // this bench's own row, in its own disposable database
}

const requestedRepeats = Number(process.env.MAIPAI_BENCH_REPEATS ?? 5);
const REPEATS = Number.isFinite(requestedRepeats) && requestedRepeats > 0 ? requestedRepeats : 5;

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  // Warm the engine before reporting which one is active - the same
  // reason memory-eval.ts's/routing.ts's own benches do this first.
  await complete("chat", [{ role: "user", content: "hello" }]);
  const status = getEngineStatus();
  console.log(`Chat engine: ${status.kind}, model ${status.modelId ?? "n/a"}`);
  const engine = `chat ${status.kind} at ${process.env.MAIPAI_LLAMA_SERVER_URL}`; // before the reset below
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

  const routedExecuted = await routedPass();
  return { executed: corpus.length * REPEATS + routedExecuted, engine };
}

/** ROUTE-01: the production path's numbers (see the header). */
async function routedPass(): Promise<number> {
  const actor = createBenchPerson();
  const loaded = loadAllManifests();
  const alwaysOffer = new Set(loaded.filter((l) => l.manifest.routing?.always_offer).map((l) => l.id));
  const openers = commandOpeners(loaded);
  const rows = [...corpus, ...ROUTE01_ROWS];
  console.log(`\nRouted pass: ${rows.length} rows (${corpus.length} corpus + ${ROUTE01_ROWS.length} from #77), ${REPEATS} repeats each, offered set from routeSemantic + selectOfferedTools, real prompt shape...\n`);
  let falseCallAttempts = 0;
  let falseCalls = 0;
  let lookupCalls = 0;
  let executed = 0;
  for (const row of rows) {
    const isNegative = row.expect_calls.length === 0;
    const vector = await embedUtterance(row.utterance);
    const { winner, ranked } = await routeSemantic(row.utterance, actor, loaded, vector);
    const shape = utteranceShape(row.utterance, openers);
    const tools = selectOfferedTools(ranked, shape);
    const parts = buildPromptParts(actor, row.utterance, [], loaded);
    const messages: LlmMessage[] = [
      { role: "system", content: parts.stablePrefix },
      { role: "system", content: parts.context },
      { role: "user", content: row.utterance },
    ];
    const top = ranked[0] ? `${ranked[0].id}:${ranked[0].score.toFixed(3)}` : "none";
    const runnerUp = ranked[1] ? `${ranked[1].id}:${ranked[1].score.toFixed(3)}` : "none";
    let rowPass = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const result = await complete("chat", messages, { tools, tool_choice: "auto" });
      if (!result.ok) {
        outcomes.push("no reply");
        continue;
      }
      executed++;
      const calls = result.value.tool_calls ?? [];
      const gotIds = calls.map((c) => c.tool).sort();
      const routedIds = gotIds.filter((id) => !alwaysOffer.has(id));
      const lookupIds = gotIds.filter((id) => alwaysOffer.has(id));
      const wantIds = [...row.expect_calls].sort();
      if (JSON.stringify(routedIds) === JSON.stringify(wantIds)) rowPass++;
      if (isNegative) {
        falseCallAttempts++;
        if (routedIds.length > 0) falseCalls++;
        if (lookupIds.length > 0) lookupCalls++;
      }
      outcomes.push(gotIds.length === 0 ? "[]" : `[${gotIds.join(", ")}]`);
    }
    console.log(
      `${rowPass}/${REPEATS}  "${row.utterance}" -> expected [${row.expect_calls.join(", ")}], shape=${shape} tier1=${winner?.id ?? "none"} top=${top} runner_up=${runnerUp} offered=[${tools.map((t) => t.id).join(", ")}], got: ${outcomes.join(" | ")}`,
    );
  }
  console.log(`\nRouted pass, false calls on negative rows (outside always-offer): ${falseCalls}/${falseCallAttempts}`);
  console.log(`Routed pass, lookup calls on negative rows (always-offer, the designed behavior): ${lookupCalls}/${falseCallAttempts}`);
  return executed;
}

let summary = { executed: 0, engine: "not run" };
try {
  summary = await main();
} finally {
  cleanup();
  __resetLlmSupervisorForTests();
  __resetEmbedSupervisorForTests();
}
finishBench(summary);
