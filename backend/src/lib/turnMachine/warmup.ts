// The engine warm-up prompt (FAST-01): the system prefix and tools block the
// one turn path sends first, so the primed cache is the one a real turn
// reuses. Replaces the retired turn engine's own prefix and tool set
// (THIN-7D, rule 12).
import { toToolDefinition, type ToolSpec } from "@/lib/llm";
import type { WarmupPrompt } from "@/lib/llmSupervisor";
import { buildStablePrefix } from "@/lib/turnShared";
import { resolveTurnBudget } from "@/lib/turnMachine/budget";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";

export function turnWarmupPrompt(): WarmupPrompt {
  const tools = resolveTurnBudget(undefined, "adult")
    .tools_offered.slice()
    .sort()
    .map(toolSpecFor)
    .filter((t): t is ToolSpec => t !== null);
  return { system: buildStablePrefix(), tools: tools.map(toToolDefinition) };
}
