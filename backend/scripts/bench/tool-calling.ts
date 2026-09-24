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
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
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
import { withTimeout } from "@maipai/core/src/withTimeout";
import { getEngineStatus, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { loadManifestOnly } from "@/lib/plugins";
import { embedUtterance, utteranceShape } from "@/lib/routing";
import { SPEC_DIR } from "@/lib/specDir";
import { buildPromptParts, commandOpeners, loadAllManifests, ordinaryToolIds, routeSemantic, selectOfferedTools } from "@/lib/turnEngine";
import { CATALOG } from "@/lib/modelCatalog";
import type { PersonRow } from "@/types";

interface ToolCallCorpusRow {
  utterance: string;
  expect_calls: string[];
  target?: "computed";
}

const corpus: ToolCallCorpusRow[] = JSON.parse(
  readFileSync(join(SPEC_DIR, "llm", "tool-call-corpus.json"), "utf-8"),
);

// The bundled packages the corpus names, loaded from their own real
// manifests rather than hand-copied here - a code review (2026-09-07)
// caught this file's own hardcoded descriptions had drifted from what a
// real turn actually offers (e.g. recall's real description is "Tells
// you what it remembers about something you ask," not the paraphrase
// "recall what's known about a topic" this used to say), which this
// file's own header comment already promised not to do. SIGNAL-02 added
// math/convert/almanac-time/almanac-date so the corpus's six computed
// rows have their expected tool on offer in the fixed pass too.
const TOOLS: ToolSpec[] = ["remember", "recall", "define", "trivia", "math", "convert", "almanac-time", "almanac-date"].map((id) => {
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

// PHRASE-02: the five "inverse-miss" world-question rows ARCH-MEASURE-01
// added ad hoc for its own routed pass at `auto` (never committed here -
// data-scratch/arch-measure/tc_8b_inverse.log has the original run: 19
// of 50 fitting, 0 of 50 false calls, the baseline this file's own
// `requiredPass()` below is gated against). Kept as the same five rows
// rather than a fresh pick, so the two numbers are actually comparable.
const INVERSE_MISS_ROWS: ToolCallCorpusRow[] = [
  { utterance: "who is the president of chile", expect_calls: ["websearch"] },
  { utterance: "did chatgpt 6 luna come out", expect_calls: ["websearch"] },
  { utterance: "what did Apple announce this week", expect_calls: ["websearch"] },
  { utterance: "who won the Seattle Mariners game yesterday", expect_calls: ["websearch"] },
  { utterance: "is the new iPhone out yet", expect_calls: ["websearch"] },
];

// PHRASE-02, the coordinator's own follow-up (CHAT-RICH-01): measures
// `write_document`'s own effect once it joins `modelCatalog.ts`'s
// `tools_offered` - two plain questions it must never fire on, beside
// the one row it should. Not landed (dev.md "PHRASE-02: gated closed on
// today's own numbers" - `write_document` regressed three existing
// corpus rows, reported to the coordinator rather than kept), so the
// first row reads 0/REPEATS on every run until that follow-up lands:
// `budgetOfferedTools()` builds its set from the shipped budget, which
// does not offer `write_document` today, so it can never be called.
// Expected, not a new failure - kept here so the next attempt measures
// against the same three rows.
const WRITE_DOCUMENT_ROWS: ToolCallCorpusRow[] = [
  { utterance: "write me a document about the history of pizza", expect_calls: ["write_document"] },
  { utterance: "what's your favorite color", expect_calls: [] },
  { utterance: "how do airplanes stay in the air", expect_calls: [] },
];

/** PHRASE-02: the budget's one fixed, sorted tools block - the exact
 * set `nodes/model.ts`'s own `offeredToolsFor()` builds from the 8B's
 * catalog entry, loaded here from the real manifests the same way
 * (never a hand-copied list, the same reason `TOOLS` above already
 * loads from the manifests instead of hardcoding descriptions). */
function budgetOfferedTools(): ToolSpec[] {
  const entry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m");
  if (!entry?.turn_budget) throw new Error("qwen3-8b-instruct-q4-k-m has no turn_budget in modelCatalog.ts");
  return entry.turn_budget.tools_offered
    .slice()
    .sort()
    .map((id) => {
      const loaded = loadManifestOnly(id);
      if (!loaded.ok) throw new Error(`budget tool ${id} failed to load: ${loaded.error}`);
      return { id, description: loaded.value.description, args: loaded.value.args };
    });
}

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

// A real gap found live while measuring PHRASE-02's own required pass
// (2026-09-24): `complete()` has no request timeout of its own
// (ARCH-MEASURE-01's own "A real gap found and fixed this session" -
// that fix never actually landed in this file, only in that session's
// own scratch run), and a request against the household's shared,
// one-slot engine can sit blocked indefinitely with zero CPU progress
// instead of failing - reproduced live just now (29+ minutes, no
// progress, no other real household turn in hub.log at the time).
// Every pass below now races each `complete()` call against 60s, the
// same bound and the same reused helper ARCH-MEASURE-01 named
// (`@maipai/core/src/withTimeout`, never a bench-local reimplementation);
// a timeout reads exactly like any other `ok:false` failure to a
// caller, so "no reply" in this file's own output covers both.
// This only bounds THIS SCRIPT's own wait - `complete()` takes no
// `signal` (only `startCompleteStream()` does, llm.ts's own streaming
// path), so a timed-out request keeps running against the engine's one
// slot after this function moves on, and the next iteration's request
// can queue behind it. A real fix needs `signal` threaded into
// `complete()`/`chatComplete()` itself, out of scope for a bench-only
// PHRASE-02 cleanup; this is a bound on the bench's own wall time, not
// a cancellation.
const COMPLETE_TIMEOUT_MS = 60_000;
async function completeWithTimeout(...args: Parameters<typeof complete>): ReturnType<typeof complete> {
  try {
    return await withTimeout(complete(...args), COMPLETE_TIMEOUT_MS, () => new Error("bench request timed out"));
  } catch {
    return { ok: false, status: 503, code: "unavailable", error: `bench request timed out after ${COMPLETE_TIMEOUT_MS / 1000}s (a starved shared engine slot, not a model result)` };
  }
}

const requestedRepeats = Number(process.env.MAIPAI_BENCH_REPEATS ?? 5);
const REPEATS = Number.isFinite(requestedRepeats) && requestedRepeats > 0 ? requestedRepeats : 5;

// PHRASE-02's own gate wants 50 repeats over the five inverse-miss rows
// (matching ARCH-MEASURE-01's own baseline run), independent of REPEATS
// above so a quick REPEATS override elsewhere never silently shrinks
// the one pass whose number is actually gated.
const requestedRequiredRepeats = Number(process.env.MAIPAI_BENCH_REQUIRED_REPEATS ?? 10);
const REQUIRED_REPEATS = Number.isFinite(requestedRequiredRepeats) && requestedRequiredRepeats > 0 ? requestedRequiredRepeats : 10;

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  // Warm the engine before reporting which one is active - the same
  // reason memory-eval.ts's/routing.ts's own benches do this first.
  await complete("chat", [{ role: "user", content: "hello" }]);
  const status = getEngineStatus();
  console.log(`Chat engine: ${status.kind}, model ${status.modelId ?? "n/a"}`);
  const engine = `chat ${status.kind} at ${sanitizeEngineUrl(process.env.MAIPAI_LLAMA_SERVER_URL)}`; // before the reset below
  console.log(`Running ${corpus.length} tool-call-corpus rows, ${REPEATS} repeats each...\n`);

  let falseCallAttempts = 0; // every repeat of a negative row (expect_calls: [])
  let falseCalls = 0; // how many of those actually called something anyway

  for (const row of corpus) {
    const isNegative = row.expect_calls.length === 0;
    let rowPass = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const result = await completeWithTimeout("chat", [{ role: "user", content: row.utterance }], { tools: TOOLS, tool_choice: "auto" });
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
  const requiredExecuted = await requiredPass();
  const budgetExecuted = await budgetOfferedPass();
  return { executed: corpus.length * REPEATS + routedExecuted + requiredExecuted + budgetExecuted, engine };
}

/** ROUTE-01: the production path's numbers (see the header). */
async function routedPass(): Promise<number> {
  const actor = createBenchPerson();
  const loaded = loadAllManifests();
  const alwaysOffer = new Set(loaded.filter((l) => l.manifest.routing?.always_offer).map((l) => l.id));
  const openers = commandOpeners(loaded);
  // ROUTE-02: the ordinary set from a FIXED usage fixture (an empty
  // household: always-offer plus the default order), never this
  // machine's routing stats, so the bench's offered sets do not drift
  // with whatever the household has been asking.
  const ordinary = ordinaryToolIds(loaded, { byPlugin: [] });
  console.log(`Ordinary tool set (fixture: empty household): [${ordinary.join(", ")}]`);
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
    const tools = selectOfferedTools(ranked, shape, ordinary);
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
      const result = await completeWithTimeout("chat", messages, { tools, tool_choice: "auto" });
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

/** PHRASE-02's own gate, kept for the next attempt (not current
 * behavior - `nodes/model.ts`'s forced branches were reverted to
 * `[websearch]` alone/`[websearch, answer_from_this_conversation]`
 * after this gate failed live; dev.md "PHRASE-02: gated closed on
 * today's own numbers"). Measures the hypothetical: forced
 * (`tool_choice: "required"`) over the budget's full fixed sorted
 * tools block instead of `[websearch]` alone. Every row here is
 * positive (a world question with no search verb, all expecting
 * `["websearch"]`), so "fitting" is a clean single `websearch` call and
 * "false call" is anything else the forced choice picked instead - the
 * new failure mode broadening the forced set can introduce, where the
 * old one-tool shape had no other tool to pick. Compare the two totals
 * this prints against ARCH-MEASURE-01's own 19/50 fitting, 0/50 false
 * (`data-scratch/arch-measure/tc_8b_inverse.log`, `auto` over
 * `[recall, remember, websearch]`); per `docs/BACKLOG.md`'s own gate,
 * worse on either number means the forced retry keeps `[websearch]`
 * alone and only PHRASE-01's continuation stands - which is exactly
 * what happened (dev.md has the numbers). */
async function requiredPass(): Promise<number> {
  const tools = budgetOfferedTools();
  console.log(`\nRequired pass: ${INVERSE_MISS_ROWS.length} inverse-miss rows, ${REQUIRED_REPEATS} repeats each, tool_choice="required" over the full budget set [${tools.map((t) => t.id).join(", ")}]...\n`);
  let fitting = 0;
  let attempts = 0;
  let falseCalls = 0;
  let executed = 0;
  for (const row of INVERSE_MISS_ROWS) {
    let rowFit = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < REQUIRED_REPEATS; i++) {
      const result = await completeWithTimeout("chat", [{ role: "user", content: row.utterance }], { tools, tool_choice: "required" });
      attempts++;
      if (!result.ok) {
        falseCalls++;
        outcomes.push("no reply");
        continue;
      }
      executed++;
      const calls = result.value.tool_calls ?? [];
      const gotIds = calls.map((c) => c.tool).sort();
      // Sorted on both sides, matching budgetOfferedPass()'s own
      // comparison below - every INVERSE_MISS_ROWS entry expects exactly
      // one tool today so this never differs in practice, but a future
      // multi-tool row would otherwise fail on declared order alone.
      const wantIds = [...row.expect_calls].sort();
      if (JSON.stringify(gotIds) === JSON.stringify(wantIds)) {
        fitting++;
        rowFit++;
      } else {
        falseCalls++;
      }
      outcomes.push(gotIds.length === 0 ? "[]" : `[${gotIds.join(", ")}]`);
    }
    console.log(`${rowFit}/${REQUIRED_REPEATS}  "${row.utterance}" -> expected [websearch], got: ${outcomes.join(" | ")}`);
  }
  console.log(`\nRequired pass, fitting (clean websearch call): ${fitting}/${attempts}`);
  console.log(`Required pass, false calls (anything else the forced choice picked): ${falseCalls}/${attempts}`);
  console.log(`Baseline to beat (ARCH-MEASURE-01, tc_8b_inverse.log, auto over [recall, remember, websearch]): 19/50 fitting, 0/50 false.`);
  return executed;
}

/** PHRASE-02's coordinator follow-up (CHAT-RICH-01), kept for the next
 * attempt (not current behavior - `write_document` is not in
 * `modelCatalog.ts`'s shipped `tools_offered` today, so its own row
 * below reads 0/REPEATS until that lands; dev.md has the numbers this
 * measured when it briefly was). Measures `write_document`'s own effect
 * on tool choice as a number, never assumed, once it does join the
 * offered set. The full corpus rides along so a regression on an
 * EXISTING row (the added tenth candidate changing what the model picks
 * on a row that used to be clean) shows up here too, not just on the
 * three new rows - which is exactly what it found (dev.md again). */
async function budgetOfferedPass(): Promise<number> {
  const tools = budgetOfferedTools();
  const rows = [...corpus, ...WRITE_DOCUMENT_ROWS];
  console.log(`\nBudget-offered pass: ${rows.length} rows (${corpus.length} corpus + ${WRITE_DOCUMENT_ROWS.length} write_document), ${REPEATS} repeats each, tool_choice="auto" over the full budget set [${tools.map((t) => t.id).join(", ")}]...\n`);
  let falseCallAttempts = 0;
  let falseCalls = 0;
  let executed = 0;
  for (const row of rows) {
    const isNegative = row.expect_calls.length === 0;
    let rowPass = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const result = await completeWithTimeout("chat", [{ role: "user", content: row.utterance }], { tools, tool_choice: "auto" });
      if (!result.ok) {
        outcomes.push("no reply");
        continue;
      }
      executed++;
      const calls = result.value.tool_calls ?? [];
      const gotIds = calls.map((c) => c.tool).sort();
      const wantIds = [...row.expect_calls].sort();
      if (JSON.stringify(gotIds) === JSON.stringify(wantIds)) rowPass++;
      if (isNegative) {
        falseCallAttempts++;
        if (calls.length > 0) falseCalls++;
      }
      outcomes.push(gotIds.length === 0 ? "[]" : `[${gotIds.join(", ")}]`);
    }
    console.log(`${rowPass}/${REPEATS}  "${row.utterance}" -> expected [${row.expect_calls.join(", ")}], got: ${outcomes.join(" | ")}`);
  }
  console.log(`\nBudget-offered pass, false calls on negative rows: ${falseCalls}/${falseCallAttempts}`);
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
