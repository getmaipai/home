// PARITY-BISECT-04 (docs/BACKLOG.md, dev.md's "PARITY-BISECT-03"
// finding: nine of twelve isolated fragments halve the reply on their
// own). Tests four candidate composition shapes for PREFIX-CLASS-01,
// plus a ceiling row, against a re-measured floor - all at a fixed
// seed per rep, shared across every arm and the floor
// (benchSampling.ts's __setSamplingSeedForBench, BENCH-01's own
// mechanism), since BISECT-03's own no-seed floor moved 736 to 574
// between rounds and an 0.8x bar cannot be read through that much
// variance.
//
// `bun run scripts/bench/parity-bisect4.ts` with MAIPAI_DATA_DIR
// (fresh, under the temp root), MAIPAI_LLAMA_SERVER_URL and
// MAIPAI_EMBED_URL set (setup.ts's own isolation, the one every live
// bench shares).
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { startBench, finishBench } from "./setup";
import { startCompleteStream, type LlmMessage, type LlmCompleteOptions } from "@/lib/llm";
import { getHouseholdSettingValue } from "@/lib/settings";
import { resolvePersona } from "@/lib/persona";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import { __setSamplingSeedForBench } from "@/lib/benchSampling";
import { buildStages4, QUESTION, BENCHMARKING_QUESTION, type Stage4 } from "./parity-bisect4-stages";

const REPS = Number(process.env.MAIPAI_BENCH_REPEATS ?? 5);
const SEEDS = Array.from({ length: REPS }, (_, i) => i + 1);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const hasHeadings = (text: string): boolean => /^#{1,6}\s/m.test(text);
const hasLists = (text: string): boolean => /^\s*[-*]\s|^\s*\d+\.\s/m.test(text);
const startsLowercase = (text: string): boolean => {
  const firstLetter = text.trim().match(/[A-Za-z]/);
  return firstLetter !== null && firstLetter[0] === firstLetter[0].toLowerCase() && firstLetter[0] !== firstLetter[0].toUpperCase();
};

interface RepResult {
  seed: number;
  predictedTokens: number | null;
  stopReason: string | null;
  lowercase: boolean;
  text: string;
}
interface StageResult {
  stage: string;
  reps: RepResult[];
  sampleText: string;
}

async function runOnce(messages: LlmMessage[], opts: LlmCompleteOptions): Promise<{ predictedTokens: number | null; stopReason: string | null; text: string }> {
  const started = await startCompleteStream("chat", messages, opts);
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

async function runStage(stage: Stage4): Promise<StageResult> {
  const reps: RepResult[] = [];
  let sampleText = "";
  try {
    for (let i = 0; i < REPS; i++) {
      const seed = SEEDS[i]!;
      __setSamplingSeedForBench(seed);
      const result = await runOnce(stage.messages, stage.opts);
      const lowercase = startsLowercase(result.text);
      reps.push({ seed, predictedTokens: result.predictedTokens, stopReason: result.stopReason, lowercase, text: result.text });
      if (i === 0) sampleText = result.text;
      console.log(`  [${stage.name}] seed=${seed}: predicted_tokens=${result.predictedTokens} stop_reason=${result.stopReason} lowercase=${lowercase}`);
    }
  } finally {
    __setSamplingSeedForBench(null);
  }
  return { stage: stage.name, reps, sampleText };
}

async function runQuestion(persona: ReturnType<typeof resolvePersona>, question: string, label: string): Promise<StageResult[]> {
  const stages = buildStages4(persona, question);
  const results: StageResult[] = [];
  for (const stage of stages) {
    console.log(`=== [${label}] ${stage.name} ===`);
    results.push(await runStage(stage));
  }
  return results;
}

function printTable(label: string, results: StageResult[]): void {
  const floorResult = results.find((r) => r.stage === "floor-bare-thinking-off")!;
  const floorTokens = floorResult.reps.map((r) => r.predictedTokens).filter((t): t is number => t !== null);
  const floorAvg = floorTokens.length > 0 ? floorTokens.reduce((a, b) => a + b, 0) / floorTokens.length : null;

  console.log(`\n=== TABLE: ${label} ===`);
  console.log("stage | predicted_tokens (by seed 1-5) | avg | vs floor | has_headings | has_lists | lowercase reps");
  for (const r of results) {
    const tokens = r.reps.map((rep) => rep.predictedTokens);
    const nums = tokens.filter((t): t is number => t !== null);
    const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    const ratio = avg !== null && floorAvg !== null ? avg / floorAvg : null;
    const headings = hasHeadings(r.sampleText);
    const lists = hasLists(r.sampleText);
    const lowercaseCount = r.reps.filter((rep) => rep.lowercase).length;
    console.log(`${r.stage} | ${tokens.join(",")} | ${avg?.toFixed(1) ?? "n/a"} | ${ratio !== null ? ratio.toFixed(2) + "x" : "n/a"} | ${headings} | ${lists} | ${lowercaseCount}/${r.reps.length}`);
  }
  console.log(`\nfloor (re-measured, same seeds 1-5): ${floorAvg?.toFixed(1) ?? "n/a"}`);
}

async function main() {
  await startBench();

  const persona = resolvePersona(getHouseholdSettingValue("persona.active_id"));

  const primary = await runQuestion(persona, QUESTION, "prompt-cache");
  const benchmarking = await runQuestion(persona, BENCHMARKING_QUESTION, "benchmarking-words");

  printTable("prompt-cache", primary);
  printTable("benchmarking-words", benchmarking);

  console.log("\n=== sample replies (seed 1 of each stage): prompt-cache ===");
  for (const r of primary) {
    console.log(`\n--- ${r.stage} ---\n${r.sampleText}`);
  }

  // Every rep's full text for the benchmarking question, not just seed
  // 1: whether the reply reads "why do you need it" as the person
  // asking or as MaiPai itself is a manual read per rep, not a regex
  // (the org rule on reviewing eval failures manually), so the full
  // transcript is printed for every seed of every arm.
  console.log("\n=== full replies, every seed: benchmarking-words ===");
  for (const r of benchmarking) {
    for (const rep of r.reps) {
      console.log(`\n--- [benchmarking-words] ${r.stage} seed=${rep.seed} ---\n${rep.text}`);
    }
  }

  const executed = primary.reduce((n, r) => n + r.reps.length, 0) + benchmarking.reduce((n, r) => n + r.reps.length, 0);
  finishBench({ executed, engine: `chat ${getEngineStatus().kind} at ${sanitizeEngineUrl(process.env.MAIPAI_LLAMA_SERVER_URL)}` });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
