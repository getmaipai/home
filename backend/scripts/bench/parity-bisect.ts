// PARITY-BISECT-01 (docs/BACKLOG.md): U4b-2's own seven reply-floor
// layers are each individually verified correct on the reconstructed
// prompt, and the new path's reply to a typed adult written question
// still comes back short and flat against the bare model's own answer
// to the identical question. Since the prose is right, something
// structural in the new path's own request shape is the suspect. This
// bisects it: starting from a bare call (both thinking settings, since
// Qwen3's template defaults to thinking on while the new path sends it
// off) and adding the new path's own components one at a time
// (parity-bisect-stages.ts's buildStages(), the pure half this file
// runs live), three reps each, reading predicted tokens and stop_reason
// per rep - never a prose impression of the reply - to find which
// addition drops the length below half of the bare-at-thinking-off
// floor.
//
// `bun run scripts/bench/parity-bisect.ts` with MAIPAI_DATA_DIR (fresh,
// under the temp root), MAIPAI_LLAMA_SERVER_URL and MAIPAI_EMBED_URL
// set (setup.ts's own isolation, the one every live bench shares).
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { startBench, finishBench } from "./setup";
import { startCompleteStream, type LlmMessage, type ToolSpec, type LlmCompleteOptions } from "@/lib/llm";
import { loadManifestOnly } from "@/lib/plugins";
import { getHouseholdSettingValue } from "@/lib/settings";
import { resolvePersona } from "@/lib/persona";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { surfaceClassOf } from "@/lib/surfaceClass";
import { planFor } from "@/lib/register";
import { CATALOG } from "@/lib/modelCatalog";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import { buildStages, hasHeadings, hasLists, type Stage } from "./parity-bisect-stages";

const REPS = Number(process.env.MAIPAI_BENCH_REPEATS ?? 3);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

interface RepResult {
  predictedTokens: number | null;
  stopReason: string | null;
  toolCalled: boolean;
}
interface StageResult {
  stage: string;
  reps: RepResult[];
  sampleText: string;
}

async function runOnce(messages: LlmMessage[], opts: LlmCompleteOptions): Promise<RepResult & { text: string }> {
  const started = await startCompleteStream("chat", messages, opts);
  if (!started.ok) return { predictedTokens: null, stopReason: `FAILED: ${started.code}`, toolCalled: false, text: "" };
  let raw = "";
  let toolCalled = false;
  for (;;) {
    const step = await started.tokens.next();
    if (step.done) {
      toolCalled = !!step.value && step.value.length > 0;
      break;
    }
    raw += step.value;
  }
  const predictedTokens = finite(started.stats.usage?.completion_tokens) ?? finite(started.stats.timings?.predicted_n);
  return { predictedTokens, stopReason: started.stats.stopReason ?? null, toolCalled, text: raw };
}

async function runStage(stage: Stage): Promise<StageResult> {
  const reps: RepResult[] = [];
  let sampleText = "";
  for (let i = 0; i < REPS; i++) {
    const result = await runOnce(stage.messages, stage.opts);
    reps.push({ predictedTokens: result.predictedTokens, stopReason: result.stopReason, toolCalled: result.toolCalled });
    if (i === 0) sampleText = result.text;
    console.log(`  [${stage.name}] rep ${i + 1}: predicted_tokens=${result.predictedTokens} stop_reason=${result.stopReason} tool_called=${result.toolCalled}`);
  }
  return { stage: stage.name, reps, sampleText };
}

async function main() {
  await startBench();

  const persona = resolvePersona(getHouseholdSettingValue("persona.active_id"));
  const signal = classifyTurnSignal({ text: "how does a prompt cache make a language model faster and why does that matter", ageBand: "adult" });
  const surfaceClass = surfaceClassOf("chat", false);
  const planBasis = {
    signal,
    surface: "chat" as const,
    surfaceClass,
    brevity: false,
    companion: { directness: "direct" as const, engagement: persona.engagement, complexity: persona.complexity },
    band: "adult" as const,
    deferred: false,
    disclosureWithheld: false,
  };
  const plan = planFor({ ...planBasis, evidence: { choices: 0, sources: 0, deliverable: false } });

  const catalogEntry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m" && m.role === "chat");
  if (!catalogEntry?.turn_budget) throw new Error("qwen3-8b-instruct-q4-k-m has no turn_budget in the catalog");
  const budget = catalogEntry.turn_budget;
  const TOOLS: ToolSpec[] = budget.tools_offered
    .slice()
    .sort()
    .map((id) => {
      const loaded = loadManifestOnly(id);
      if (!loaded.ok) throw new Error(`bundled package ${id} failed to load: ${loaded.error}`);
      return { id, description: loaded.value.description, args: loaded.value.args };
    });

  const stages = buildStages(persona, plan, signal, TOOLS);
  const results: StageResult[] = [];
  for (const stage of stages) {
    console.log(`=== ${stage.name} ===`);
    const result = await runStage(stage);
    results.push(result);
    if (stage.name === "0b-bare-thinking-off") {
      const floorTokens = result.reps.map((r) => r.predictedTokens).filter((t): t is number => t !== null);
      if (floorTokens.length === 0) {
        // A scripted/stub engine (the CHAT-22 smoke test) reports no
        // usage/timings at all, so this is expected there - the bench
        // still counts every rep it ran; only the token-count table
        // below degrades to "n/a". A live engine always reports usage,
        // so on a real run this line itself is the finding.
        console.log("NOTE: the floor row (bare, thinking off) produced no usable token counts - the table's ratios will read n/a. Expected against a scripted engine; a live run should never see this.");
      }
      const onlyThinkingOnComplete = results[0]!.reps.every((r) => r.stopReason !== "stop") && result.reps.every((r) => r.stopReason !== "stop");
      if (onlyThinkingOnComplete) {
        console.log('\nCAPABILITY FINDING: only the thinking-on bare call completed with stop_reason "stop"; the thinking-off bare call did not. This 8B may not write a complete structured answer to this question with thinking off at all - a budget/per-class question, not a prompt one.\n');
      }
    }
  }

  const floorTokens = results.find((r) => r.stage === "0b-bare-thinking-off")!.reps.map((r) => r.predictedTokens).filter((t): t is number => t !== null);
  const floorAvg = floorTokens.length > 0 ? floorTokens.reduce((a, b) => a + b, 0) / floorTokens.length : null;

  console.log("\n=== TABLE ===");
  console.log("stage | predicted_tokens (reps) | avg | vs floor | has_headings | has_lists");
  const collapsed: string[] = [];
  for (const r of results) {
    const tokens = r.reps.map((rep) => rep.predictedTokens);
    const nums = tokens.filter((t): t is number => t !== null);
    const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    const ratio = avg !== null && floorAvg !== null ? avg / floorAvg : null;
    const headings = hasHeadings(r.sampleText);
    const lists = hasLists(r.sampleText);
    console.log(`${r.stage} | ${tokens.join(",")} | ${avg?.toFixed(1) ?? "n/a"} | ${ratio !== null ? ratio.toFixed(2) + "x" : "n/a"} | ${headings} | ${lists}`);
    if (r.stage !== "0a-bare-thinking-on" && r.stage !== "0b-bare-thinking-off" && ratio !== null && ratio < 0.5) collapsed.push(r.stage);
  }
  console.log(`\nfloor (bare, thinking off) average predicted_tokens: ${floorAvg !== null ? floorAvg.toFixed(1) : "n/a"}`);
  console.log(collapsed.length > 0 ? `COLLAPSE: ${collapsed.join(", ")} drop predicted tokens below half the floor.` : "No stage dropped below half the floor on average.");

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
