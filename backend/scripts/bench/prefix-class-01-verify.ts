// PREFIX-CLASS-01's own final verification (dev.md "The written prompt
// on tier 1, decided", the coordinator's own design record, 2026-09-23).
// This chain went through several rounds before landing here - PARITY-
// BISECT-04's own arm e, a role move (reverted, no effect), a wording
// swap (ruled out), a plan-line comparison (neither arm cleared the
// bar) - and the record's own reading of all of it: every added
// instruction sentence in the written prompt cost length, dose-
// dependent, regardless of role, wording or the plan line specifically.
// The written-adult prompt on tier 1 is the ceiling's own shape:
// identity plus the three surviving suffix sentences, no persona
// voice, no policy prose, no reanchor, no plan line - and the volatile
// message is a memory match only, omitted entirely when there is
// nothing to say.
//
// This script now calls contextToMessages() itself and measures its
// real, unmodified output directly - no more hand transformation
// needed, since messages.ts implements the final design natively.
// Real five-tool block, thinking off, same five seeds, both questions.
//
// `bun run scripts/bench/prefix-class-01-verify.ts` with MAIPAI_DATA_DIR
// (fresh, under the temp root), MAIPAI_LLAMA_SERVER_URL and
// MAIPAI_EMBED_URL set (setup.ts's own isolation, the one every live
// bench shares).
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { startBench, finishBench } from "./setup";
import { startCompleteStream, type LlmMessage } from "@/lib/llm";
import { getHouseholdSettingValue } from "@/lib/settings";
import { resolvePersona } from "@/lib/persona";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import { __setSamplingSeedForBench } from "@/lib/benchSampling";
import { resolveTurnBudget } from "@/lib/turnMachine/budget";
import { contextToMessages } from "@/lib/turnMachine/messages";
import { planFor, type PlanInput } from "@/lib/register";
import { fallbackSignal } from "@/lib/turnSignal";
import { loadManifestOnly } from "@/lib/plugins";
import type { ToolSpec } from "@/lib/llm";

const REPS = Number(process.env.MAIPAI_BENCH_REPEATS ?? 5);
const SEEDS = Array.from({ length: REPS }, (_, i) => i + 1);
const QUESTION = "how does a prompt cache make a language model faster and why does that matter";
const BENCHMARKING_QUESTION = "what is technical benchmarking and why do you need it";

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const hasHeadings = (text: string): boolean => /^#{1,6}\s/m.test(text);
const hasLists = (text: string): boolean => /^\s*[-*]\s|^\s*\d+\.\s/m.test(text);
const startsLowercase = (text: string): boolean => {
  const firstLetter = text.trim().match(/[A-Za-z]/);
  return firstLetter !== null && firstLetter[0] === firstLetter[0].toLowerCase() && firstLetter[0] !== firstLetter[0].toUpperCase();
};

// Same real tool block every arm e/f measurement used (productionTools()
// in parity-bisect4-stages.ts) - a real turn always offers it.
const RESIDENT_BUDGET = resolveTurnBudget("qwen3-8b-instruct-q4-k-m");
function productionTools(): ToolSpec[] {
  const tools = RESIDENT_BUDGET.tools_offered
    .slice()
    .sort()
    .map((id) => {
      const loaded = loadManifestOnly(id);
      if (!loaded.ok) throw new Error(`productionTools(): manifest for "${id}" failed to load`);
      return { id, description: loaded.value.description, args: loaded.value.args };
    });
  if (tools.length !== RESIDENT_BUDGET.tools_offered.length) throw new Error("productionTools(): tool count mismatch");
  return tools;
}

interface RepResult { seed: number; predictedTokens: number | null; stopReason: string | null; lowercase: boolean; text: string }

async function runOnce(messages: LlmMessage[], withTools: boolean): Promise<{ predictedTokens: number | null; stopReason: string | null; text: string }> {
  const started = await startCompleteStream("chat", messages, { temperature: 0.8, thinking: false, tools: withTools ? productionTools() : undefined });
  if (!started.ok) return { predictedTokens: null, stopReason: `FAILED: ${started.code}`, text: "" };
  let raw = "";
  for (;;) {
    const step = await started.tokens.next();
    if (step.done) break;
    raw += step.value;
  }
  const predictedTokens = finite(started.stats.usage?.completion_tokens) ?? finite(started.stats.timings?.predicted_n);
  return { predictedTokens, stopReason: started.stats.stopReason ?? null, text: raw };
}

// The real message list a written-adult turn actually sends - built by
// contextToMessages() itself (turnMachine/messages.ts), the one real
// producer, never a hand-assembled array. No context items, no window:
// the smallest real call, matching every prior bisect round's own
// single-turn shape. With no memory match, this is now two messages
// (the stable message, the question) - the final design's own point.
function realMessages(persona: ReturnType<typeof resolvePersona>, question: string): LlmMessage[] {
  const signal = fallbackSignal(question, "adult");
  const planInput: PlanInput = {
    signal,
    surface: "chat",
    surfaceClass: "written",
    brevity: false,
    evidence: { choices: 0, sources: 0, deliverable: false },
    companion: { directness: "diplomatic", engagement: "balanced", vocabulary: "advanced" },
    band: "adult",
    deferred: false,
    disclosureWithheld: false,
  };
  const plan = planFor(planInput);
  return contextToMessages([], question, persona, plan, signal, "written");
}

async function runQuestion(persona: ReturnType<typeof resolvePersona>, question: string, label: string): Promise<RepResult[]> {
  const reps: RepResult[] = [];
  try {
    for (let i = 0; i < REPS; i++) {
      const seed = SEEDS[i]!;
      __setSamplingSeedForBench(seed);
      const result = await runOnce(realMessages(persona, question), true);
      const lowercase = startsLowercase(result.text);
      reps.push({ seed, predictedTokens: result.predictedTokens, stopReason: result.stopReason, lowercase, text: result.text });
      console.log(`  [${label}] seed=${seed}: predicted_tokens=${result.predictedTokens} stop_reason=${result.stopReason} lowercase=${lowercase}`);
    }
  } finally {
    __setSamplingSeedForBench(null);
  }
  return reps;
}

async function runFloor(question: string, label: string): Promise<RepResult[]> {
  const reps: RepResult[] = [];
  try {
    for (let i = 0; i < REPS; i++) {
      const seed = SEEDS[i]!;
      __setSamplingSeedForBench(seed);
      // The floor is bare: no system message, no tools - the same
      // definition every PARITY-BISECT-0N floor used (PARITY-BISECT-01's
      // own control), so this ratio reads against the identical
      // yardstick, not a tool-contaminated one.
      const result = await runOnce([{ role: "user", content: question }], false);
      reps.push({ seed, predictedTokens: result.predictedTokens, stopReason: result.stopReason, lowercase: false, text: result.text });
      console.log(`  [${label}] seed=${seed}: predicted_tokens=${result.predictedTokens} stop_reason=${result.stopReason}`);
    }
  } finally {
    __setSamplingSeedForBench(null);
  }
  return reps;
}

function avg(reps: RepResult[]): number | null {
  const nums = reps.map((r) => r.predictedTokens).filter((t): t is number => t !== null);
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

async function main() {
  await startBench();
  const persona = resolvePersona(getHouseholdSettingValue("persona.active_id"));
  const sampleMessages = realMessages(persona, QUESTION);
  console.log(`real message list: ${sampleMessages.length} messages (no memory match), roles: ${sampleMessages.map((m) => m.role).join(", ")}`);

  const floorPromptCache = await runFloor(QUESTION, "floor-prompt-cache");
  const floorBenchmarking = await runFloor(BENCHMARKING_QUESTION, "floor-benchmarking-words");
  const floorPcAvg = avg(floorPromptCache);
  const floorBwAvg = avg(floorBenchmarking);

  const shippedPromptCache = await runQuestion(persona, QUESTION, "shipped-prompt-cache");
  const shippedBenchmarking = await runQuestion(persona, BENCHMARKING_QUESTION, "shipped-benchmarking-words");

  const shippedPcAvg = avg(shippedPromptCache);
  const shippedBwAvg = avg(shippedBenchmarking);
  const pcRatio = floorPcAvg && shippedPcAvg ? shippedPcAvg / floorPcAvg : null;
  const bwRatio = floorBwAvg && shippedBwAvg ? shippedBwAvg / floorBwAvg : null;

  console.log("\n=== TABLE: the written adult prompt on tier 1, decided (ceiling's shape, real contextToMessages, real tools, thinking off) ===");
  console.log("question | floor avg | shipped avg | ratio | headings | lists | lowercase");
  console.log(`prompt-cache | ${floorPcAvg?.toFixed(1)} | ${shippedPcAvg?.toFixed(1)} | ${pcRatio?.toFixed(2)}x | ${hasHeadings(shippedPromptCache[0]!.text)} | ${hasLists(shippedPromptCache[0]!.text)} | ${shippedPromptCache.filter((r) => r.lowercase).length}/5`);
  console.log(`benchmarking-words | ${floorBwAvg?.toFixed(1)} | ${shippedBwAvg?.toFixed(1)} | ${bwRatio?.toFixed(2)}x | ${hasHeadings(shippedBenchmarking[0]!.text)} | ${hasLists(shippedBenchmarking[0]!.text)} | ${shippedBenchmarking.filter((r) => r.lowercase).length}/5`);

  // The self-reference count: every benchmarking-words reply, in full,
  // read by hand - the org rule on reviewing eval failures manually.
  console.log("\n=== benchmarking-words: every reply, full text (for the self-reference count) ===");
  for (const rep of shippedBenchmarking) {
    console.log(`\n--- seed=${rep.seed} ---\n${rep.text}`);
  }

  console.log("\n--- prompt-cache sample (seed 1) ---");
  console.log(shippedPromptCache[0]!.text);

  const executed = floorPromptCache.length + floorBenchmarking.length + shippedPromptCache.length + shippedBenchmarking.length;
  finishBench({ executed, engine: `chat ${getEngineStatus().kind} at ${sanitizeEngineUrl(process.env.MAIPAI_LLAMA_SERVER_URL)}` });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
