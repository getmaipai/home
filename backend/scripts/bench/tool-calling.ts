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
// The old path's routed and forced passes retired with it (THIN-7D); the
// budget-offered pass below is the one path's own tool offer.
//
// Usage: bun run scripts/bench/tool-calling.ts
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { finishBench, startBench } from "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { complete, type LlmMessage, type ToolSpec } from "@/lib/llm";
import { withTimeout } from "@maipai/core/src/withTimeout";
import { getEngineStatus, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { loadManifestOnly } from "@/lib/plugins";
import { START_PROJECT_TOOL_ID, startProjectToolSpec } from "@/lib/projects/tool";
import { SPEC_DIR } from "@/lib/specDir";
import { CATALOG } from "@/lib/modelCatalog";
import answerImageRows from "./datasets/answer-images.json";
import routeDataset from "./datasets/chat-ab-01.json";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { ContextItem } from "@/lib/turnMachine/contract";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { fallbackSignal } from "@/lib/turnSignal";
import { planFor, type PlanInput } from "@/lib/register";
import { countTokens } from "@/lib/tokenCount";
import { CHAT_SAMPLING } from "@/lib/llm";
import { mkdirSync, writeFileSync } from "node:fs";
import { scoreRun } from "./freshScore";
import { hashValue } from "./routeStats";

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
 * loads from the manifests instead of hardcoding descriptions).
 * `start_project` (PROJECT-START-01) is a virtual tool with no
 * backend/packages manifest on disk (lib/projects/tool.ts's own
 * header), the same shape `nodes/model.ts`'s own `toolSpecFor()`
 * special-cases - mirrored here for the identical reason. */
// ANSWER-IMG-05: MAIPAI_BENCH_OFFER=show_images offers a tool beside the
// shipped budget set, so a candidate's effect on the existing corpus is
// measured before it joins the catalog record (never a change to the record).
const EXTRA_OFFERED = (process.env.MAIPAI_BENCH_OFFER ?? "").split(",").map((id) => id.trim()).filter(Boolean);

function budgetOfferedTools(): ToolSpec[] {
  const entry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m");
  if (!entry?.turn_budget) throw new Error("qwen3-8b-instruct-q4-k-m has no turn_budget in modelCatalog.ts");
  return [...new Set([...(entry.turn_budget.tools_offered ?? []), ...EXTRA_OFFERED])]
    .slice()
    .sort()
    .map((id) => {
      if (id === START_PROJECT_TOOL_ID) return startProjectToolSpec();
      const loaded = loadManifestOnly(id);
      if (!loaded.ok) throw new Error(`budget tool ${id} failed to load: ${loaded.error}`);
      return { id, description: loaded.value.description, args: loaded.value.args };
    });
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

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  if (process.env.MAIPAI_BENCH_PASS === "route") return await routeDecisionPass();
  // Warm the engine before reporting which one is active - the same
  // reason memory-eval.ts's/routing.ts's own benches do this first.
  await complete("chat", [{ role: "user", content: "hello" }]);
  const status = getEngineStatus();
  console.log(`Chat engine: ${status.kind}, model ${status.modelId ?? "n/a"}`);
  const engine = `chat ${status.kind} at ${sanitizeEngineUrl(process.env.MAIPAI_LLAMA_SERVER_URL)}`; // before the reset below
  // VISION-02d: MAIPAI_BENCH_PASS=budget runs only the budget-offered pass,
  // the one a model's turn_budget.measured records (a long run on a busy
  // machine can then finish between memory-pressure stops).
  if (process.env.MAIPAI_BENCH_PASS === "budget") {
    const budgetOnly = await budgetOfferedPass();
    return { executed: budgetOnly, engine };
  }
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

  const budgetExecuted = await budgetOfferedPass();
  const imageExecuted = await answerImagesPass();
  return { executed: corpus.length * REPEATS + budgetExecuted + imageExecuted, engine };
}

interface RouteItem { id: string; prompt: string; kind: string; family?: string; split?: string; gold?: "must" | "must_not" | "may"; age_row?: string; acceptable_tools: string[]; expected_terms?: string[]; }
interface RouteResult {
  arm: string; model_id: string; sampling: string; thinking: string; websearch_schema: string; engine_build: string;
  id: string; item_id: string; family: string; split: string; gold: string; age_row: string; kind: string; rep: number; conversation_id: string; prompt: string;
  acceptable_tools: string[]; calls: string[]; arguments: Record<string, unknown>[]; first_round_calls: string[]; retry_calls: string[]; query_writer_calls: string[]; stage_codes: string[]; evidence: boolean;
  valid_query: boolean | null; mangled_query: boolean | null; false_search: boolean; elapsed_ms: number; token_count: number | null;
  token_count_fallback: string | null; decision_latency_ms: number; ttft_ms: number | null; first_answer_text_ms: number | null; first_answer_text: string | null; total_ms: number; error: string | null;
}

async function routeDecisionPass(): Promise<{ executed: number; engine: string }> {
  const modelId = process.env.MAIPAI_CHAT_MODEL_ID ?? process.env.MAIPAI_REPLAY_MODEL_ID;
  const catalog = CATALOG.find((m) => m.id === modelId) ?? CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m");
  if (!catalog?.turn_budget) throw new Error(`No catalog chat budget for ${modelId ?? "default model"}`);
  const group = (process.env.MAIPAI_BENCH_GROUP ?? "fresh+hardneg").split("+");
  const all = (routeDataset.fresh.items as RouteItem[]);
  const requestedSplit = process.env.MAIPAI_BENCH_SPLIT ?? "dev";
  if (!["dev", "calibration", "heldout"].includes(requestedSplit)) throw new Error("MAIPAI_BENCH_SPLIT must be dev, calibration or heldout");
  const items = all.filter((item) => (group.includes("fresh+hardneg") || group.includes(item.kind === "hard-negative" ? "hardneg" : "fresh")) && (item.split ?? "dev") === requestedSplit);
  if (requestedSplit === "heldout" && !items.length) throw new Error("held-out split contains no dataset items");
  const requested = Number(process.env.MAIPAI_BENCH_REPEATS ?? 5);
  const repeats = Number.isInteger(requested) && requested > 0 ? requested : 5;
  const sampling = process.env.MAIPAI_BENCH_SAMPLING ?? "chat";
  if (!["chat", "nodrx", "greedy"].includes(sampling)) throw new Error("MAIPAI_BENCH_SAMPLING must be chat, nodrx or greedy");
  const samplingParams = sampling === "chat" ? CHAT_SAMPLING : sampling === "nodrx" ? { temperature: 0.7, min_p: 0.05 } : { temperature: 0 };
  const thinking = process.env.MAIPAI_BENCH_THINKING === "on";
  const schema = process.env.MAIPAI_BENCH_WEBSEARCH_SCHEMA ?? "current";
  if (!["current", "query"].includes(schema)) throw new Error("MAIPAI_BENCH_WEBSEARCH_SCHEMA must be current or query");
  const offeredTools = catalog.turn_budget.tools_offered ?? [];
  const arm = process.env.MAIPAI_BENCH_ARM ?? (thinking ? "A1" : modelId?.includes("qwen3-vl") ? (sampling === "nodrx" ? "A2n" : "A2") : sampling === "nodrx" ? "A0n" : "A0");
  const { toolSpecFor } = await import("@/lib/turnMachine/nodes/model");
  const tools = offeredTools.slice().sort().map((id) => {
    const tool = toolSpecFor(id);
    if (!tool) throw new Error(`budget tool ${id} has no production tool spec`);
    if (id !== "websearch" || schema === "current") return tool;
    const args = structuredClone(tool.args) as Record<string, unknown>;
    const properties = args.properties as Record<string, Record<string, unknown>>;
    const expression = properties.expression;
    delete properties.read_page;
    if (expression) { properties.query = expression; delete properties.expression; }
    args.required = (args.required as string[]).map((key) => key === "expression" ? "query" : key);
    return { ...tool, args };
  });
  const outDir = process.env.MAIPAI_BENCH_OUT ?? join(process.cwd(), "data-scratch", "route-e1", arm);
  mkdirSync(outDir, { recursive: true });
  const results: RouteResult[] = [];
  const counts: number[] = [];
  const clock = `Thursday, October 8, 2026`;
  const engineStatus = getEngineStatus();
  const engineBuild = String((engineStatus as unknown as { build?: string }).build ?? "not reported by engine");
  const configurationHash = hashValue({ modelId: modelId ?? catalog.id, engineBuild, sampling, samplingParams, thinking, thinkingBudgetTokens: thinking ? catalog.turn_budget.thinking_budget_tokens_toggled : 0, websearchSchema: schema, tools, persona: DEFAULT_PERSONA, clock, promptBuilder: "contextToMessages", toolChoice: "auto" });
  const splitHash = hashValue(items.slice().sort((a,b)=>a.id.localeCompare(b.id)));
  const env = {
    date: new Date().toISOString(), arm, modelId, catalogModel: catalog.id, sampling, thinking: thinking ? "on (512 budget)" : "off", split: requestedSplit, configurationHash, splitHash,
    schema, websearchSchema: schema, repeats, group: group.join("+"), itemCount: items.length, offeredTools: tools.map((t) => t.id), samplingParams, thinkingBudgetTokens: thinking ? catalog.turn_budget.thinking_budget_tokens_toggled : 0,
    engine: engineStatus, engineBuild, engineUrl: sanitizeEngineUrl(process.env.MAIPAI_LLAMA_SERVER_URL),
    note: "One production-shaped first round per item/repeat; no search, retry, phrasing or query-writer call.",
  };
  for (const item of items) for (let rep = 1; rep <= repeats; rep++) {
    const conversationId = crypto.randomUUID();
    const signal = fallbackSignal(item.prompt, "adult", "identified_profile", "question");
    const plan = planFor({ signal, surface: "chat", surfaceClass: "written", brevity: false, evidence: { choices: 0, sources: 0, deliverable: false }, companion: { directness: "diplomatic", engagement: DEFAULT_PERSONA.engagement, vocabulary: DEFAULT_PERSONA.complexity }, band: "adult", deferred: false, disclosureWithheld: false });
    const context: ContextItem[] = [{ id: `clock-${conversationId}`, text: clock, source: "clock", subjects: [], disclosure: "child_ok" }];
    const messages = contextToMessages(context, item.prompt, DEFAULT_PERSONA, plan, signal, "written");
    const tokenCount = await countTokens(messages, { tools }).catch(() => null);
    if (tokenCount !== null) counts.push(tokenCount);
    const started = performance.now();
    const samplingOpts = sampling === "chat" ? {} : samplingParams;
    const result = await complete("chat", messages, { ...samplingOpts, ...(thinking ? { thinking: true } : { thinking: false }), tools, tool_choice: "auto", max_tokens: catalog.turn_budget.reply_ceiling_tokens + (thinking ? catalog.turn_budget.thinking_budget_tokens_toggled : 0) });
    const calls = result.ok ? (result.value.tool_calls ?? []) : [];
    const names = calls.map((c) => c.tool);
    const args = calls.map((c) => (c.args ?? {}) as Record<string, unknown>);
    const evidence = names.some((name) => item.acceptable_tools.includes(name));
    const search = calls.find((c) => c.tool === "websearch");
    const searchArgs = search?.args as Record<string, unknown> | undefined;
    const queryArg = searchArgs?.expression ?? searchArgs?.query;
    const query = typeof queryArg === "string" ? queryArg : null;
    const expected = item.expected_terms ?? [];
    const fused = expected.some((term) => term.includes(" ") && query !== null && query.toLowerCase().replace(/[^a-z0-9]+/g, " ").includes(term.toLowerCase().replace(/\s+/g, "")));
    const elapsed = performance.now() - started;
    const scored = scoreRun({ id: item.id, kind: item.kind, gold: item.gold, prompt: item.prompt, acceptable_tools: item.acceptable_tools, expected_terms: expected, calls: names, query, error: result.ok ? null : result.error, decisionOnly: true });
    const row: RouteResult = {
      arm, model_id: modelId ?? catalog.id, sampling, thinking: thinking ? "on (512 budget)" : "off", websearch_schema: schema,
      engine_build: engineBuild,
      id: item.id, item_id: item.id, family: item.family ?? item.id, split: item.split ?? "dev", gold: item.gold ?? (item.kind === "time-sensitive" ? "must" : "must_not"), age_row: item.age_row ?? "adult", kind: item.kind, rep, conversation_id: conversationId, prompt: item.prompt,
      acceptable_tools: item.acceptable_tools, calls: names, arguments: args, first_round_calls: names, retry_calls: [], query_writer_calls: [], stage_codes: scored.stage_codes, evidence,
      valid_query: query === null ? null : query.trim().length > 0 && (scored.stage_codes.includes("Q_OK") || scored.stage_codes.includes("Q_RESCUED")),
      mangled_query: query === null || expected.length === 0 ? null : fused,
      false_search: scored.stage_codes.includes("D_FALSE"),
      elapsed_ms: elapsed, decision_latency_ms: elapsed, ttft_ms: null, first_answer_text_ms: null, first_answer_text: null, total_ms: elapsed, token_count: tokenCount,
      token_count_fallback: tokenCount === null ? "countTokens returned null (engine endpoint unsupported/unavailable); no proxy estimate" : null,
      error: result.ok ? null : result.error,
    };
    results.push(row);
    console.log(`${item.id} rep ${rep}: acceptable evidence=${evidence}; calls=[${names.join(", ") || "none"}] ${row.elapsed_ms.toFixed(0)}ms`);
    writeFileSync(join(outDir, "results.json"), JSON.stringify({ arm, environment: { ...env, tokenCount: counts.length ? { minimum: Math.min(...counts), median: counts.slice().sort((a,b)=>a-b)[Math.floor(counts.length/2)] } : { fallback: "tokenCount returned null for every request" } }, results }, null, 2));
  }
  console.log(`\nWrote ${results.length} route rows to ${join(outDir, "results.json")}`);
  return { executed: results.length, engine: `${getEngineStatus().kind} at ${sanitizeEngineUrl(process.env.MAIPAI_LLAMA_SERVER_URL)}` };
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

/** ANSWER-IMG-05: section 13's single-turn adult rows
 * (datasets/answer-images.json, the one definition answer-images.ts also
 * reads) over the same budget set: a bare `complete()` without Home's system
 * prompt, so it isolates the tool block's own pull. A visual row passes when
 * `show_images` is among the calls (a search beside it is fine); any other
 * row passes when it is not. answer-images.ts measures the real turn path. */
async function answerImagesPass(): Promise<number> {
  const tools = budgetOfferedTools();
  if (!tools.some((t) => t.id === "show_images")) {
    console.log("\nAnswer-images rows skipped: show_images is not offered (set MAIPAI_BENCH_OFFER=show_images to measure it before it ships).");
    return 0;
  }
  const rows = (answerImageRows.rows as { id: string; label: string; person: string; text: string; setup?: string; spoken?: boolean }[])
    .filter((row) => row.person === "owner" && !row.setup && !row.spoken && (row.label === "V" || row.label === "N"));
  console.log(`\nAnswer-images pass: ${rows.length} rows, ${REPEATS} repeats each...\n`);
  let executed = 0, visualRuns = 0, visualCalls = 0, otherRuns = 0, otherCalls = 0;
  for (const row of rows) {
    const outcomes: string[] = [];
    let called = 0;
    for (let i = 0; i < REPEATS; i++) {
      const result = await completeWithTimeout("chat", [{ role: "user", content: row.text }], { tools, tool_choice: "auto" });
      if (!result.ok) { outcomes.push("no reply"); continue; }
      executed++;
      const ids = (result.value.tool_calls ?? []).map((c) => c.tool).sort();
      if (ids.includes("show_images")) called++;
      outcomes.push(ids.length === 0 ? "[]" : `[${ids.join(", ")}]`);
    }
    if (row.label === "V") { visualRuns += REPEATS; visualCalls += called; } else { otherRuns += REPEATS; otherCalls += called; }
    console.log(`${row.label} ${called}/${REPEATS} show_images  "${row.text}" -> ${outcomes.join(" | ")}`);
  }
  console.log(`\nAnswer-images pass: show_images on ${visualCalls}/${visualRuns} visual runs, ${otherCalls}/${otherRuns} non-visual runs`);
  return executed;
}

let summary = { executed: 0, engine: "not run" };
try {
  summary = await main();
} finally {
  __resetLlmSupervisorForTests();
}
finishBench(summary);
