// PARITY-BISECT-03 (docs/BACKLOG.md, dev.md's "BISECT-02 ruling" (3)):
// PARITY-BISECT-02 found STABLE_SYSTEM_SUFFIX collapses length/
// structure and FORMALITY_FRAGMENT_WRITTEN collapses the register, but
// removing only the suffix from the complete prefix did not undo the
// length collapse - one more fragment among the complexity dial, the
// written engagement, the filler line, the information policy or
// WRITTEN_POLICY is independently sufficient on its own. This isolates
// each of those six, and STABLE_SYSTEM_SUFFIX's own six sentences, one
// at a time on the identity-line-alone base (parity-bisect3-stages.ts's
// buildStages3(), the pure half this file runs live) - never stacked,
// so a fragment that only collapses in combination is told apart from
// one that collapses alone.
//
// `bun run scripts/bench/parity-bisect3.ts` with MAIPAI_DATA_DIR
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
import { buildStages3, type Stage3 } from "./parity-bisect3-stages";

const REPS = Number(process.env.MAIPAI_BENCH_REPEATS ?? 3);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const hasHeadings = (text: string): boolean => /^#{1,6}\s/m.test(text);
const hasLists = (text: string): boolean => /^\s*[-*]\s|^\s*\d+\.\s/m.test(text);
const startsLowercase = (text: string): boolean => {
  const firstLetter = text.trim().match(/[A-Za-z]/);
  return firstLetter !== null && firstLetter[0] === firstLetter[0].toLowerCase() && firstLetter[0] !== firstLetter[0].toUpperCase();
};

// PARITY-BISECT-01's own measured floor (dev.md, this same question,
// bare call, thinking off, no system message at all): average 736.3
// predicted tokens. Reused here as the fixed reference point, same as
// BISECT-02.
const REFERENCE_FLOOR_AVG = 736.3;

interface RepResult {
  predictedTokens: number | null;
  stopReason: string | null;
  lowercase: boolean;
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

async function runStage(stage: Stage3): Promise<StageResult> {
  const reps: RepResult[] = [];
  let sampleText = "";
  for (let i = 0; i < REPS; i++) {
    const result = await runOnce(stage.messages, stage.opts);
    const lowercase = startsLowercase(result.text);
    reps.push({ predictedTokens: result.predictedTokens, stopReason: result.stopReason, lowercase });
    if (i === 0) sampleText = result.text;
    console.log(`  [${stage.name}] rep ${i + 1}: predicted_tokens=${result.predictedTokens} stop_reason=${result.stopReason} lowercase=${lowercase}`);
  }
  return { stage: stage.name, reps, sampleText };
}

async function main() {
  await startBench();

  const persona = resolvePersona(getHouseholdSettingValue("persona.active_id"));
  const stages = buildStages3(persona);
  const results: StageResult[] = [];
  for (const stage of stages) {
    console.log(`=== ${stage.name} ===`);
    results.push(await runStage(stage));
  }

  console.log("\n=== TABLE ===");
  console.log("stage | predicted_tokens (reps) | avg | vs floor | has_headings | has_lists | lowercase reps");
  const halved: string[] = [];
  for (const r of results) {
    const tokens = r.reps.map((rep) => rep.predictedTokens);
    const nums = tokens.filter((t): t is number => t !== null);
    const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    const ratio = avg !== null ? avg / REFERENCE_FLOOR_AVG : null;
    const headings = hasHeadings(r.sampleText);
    const lists = hasLists(r.sampleText);
    const lowercaseCount = r.reps.filter((rep) => rep.lowercase).length;
    console.log(`${r.stage} | ${tokens.join(",")} | ${avg?.toFixed(1) ?? "n/a"} | ${ratio !== null ? ratio.toFixed(2) + "x" : "n/a"} | ${headings} | ${lists} | ${lowercaseCount}/${r.reps.length}`);
    if (r.stage !== "baseline-identity-alone" && ratio !== null && ratio < 0.5) halved.push(r.stage);
  }
  console.log(`\nreference floor (PARITY-BISECT-01, bare thinking off): ${REFERENCE_FLOOR_AVG.toFixed(1)}`);
  console.log(halved.length > 0 ? `HALVED ALONE: ${halved.join(", ")}` : "No fragment or sentence halved the floor alone.");

  console.log("\n=== sample replies (rep 1 of each stage) ===");
  for (const r of results) {
    console.log(`\n--- ${r.stage} ---\n${r.sampleText}`);
  }

  finishBench({ executed: results.reduce((n, r) => n + r.reps.length, 0), engine: `chat ${getEngineStatus().kind} at ${sanitizeEngineUrl(process.env.MAIPAI_LLAMA_SERVER_URL)}` });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
