// The engine warm-up prompt (FAST-01): the system prefix and tools block the
// one turn path sends first, so the primed cache is the one a real turn
// reuses. Replaces the retired turn engine's own prefix and tool set
// (THIN-7D, rule 12).
import { toToolDefinition, type ToolSpec } from "@/lib/llm";
import type { WarmupPrompt } from "@/lib/llmSupervisor";
import { buildStablePrefix } from "@/lib/turnShared";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { db } from "@/db";
import { people } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { NO_RECORD_BUDGET, resolveTurnBudgetBase, withTurnToolGates } from "@/lib/turnMachine/budget";
import { budgetWithTurnToolGates } from "@/lib/turnMachine/toolGates";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";

export async function turnWarmupPrompt(surfaceClass: "written" | "spoken" = "written"): Promise<WarmupPrompt> {
  const { system, specs } = await warmupParts(surfaceClass);
  return { system, tools: specs.map(toToolDefinition) };
}

/** The same prompt as ToolSpec objects, for the request the prefix prewarm sends (lib/prefixPrewarm.ts). */
export async function turnWarmupRequest(surfaceClass: "written" | "spoken"): Promise<{ system: string; tools: ToolSpec[] }> {
  const { system, specs } = await warmupParts(surfaceClass);
  return { system, tools: specs };
}

async function warmupParts(surfaceClass: "written" | "spoken"): Promise<{ system: string; specs: ToolSpec[] }> {
  const system = buildStablePrefix(DEFAULT_PERSONA, surfaceClass);
  let budget = NO_RECORD_BUDGET;
  try {
    const baseBudget = resolveTurnBudgetBase(undefined, "adult");
    const primaryAdult = db.select().from(people).where(and(eq(people.role, "owner"), isNull(people.deletedAt))).get();
    budget = primaryAdult
      ? (await budgetWithTurnToolGates({
        budget: baseBudget,
        actor: primaryAdult,
        band: "adult",
        surface: "chat",
        surfaceClass,
        spoken: surfaceClass === "spoken",
        temporary: false,
        bare: false,
        ephemeral: false,
        text: "hi",
        musicEditAvailable: () => false,
      })).budget
      : withTurnToolGates(baseBudget, false);
  } catch {
    // A warm-up gate failure must never block startup or offer a conditional tool.
    try {
      budget = withTurnToolGates(resolveTurnBudgetBase(undefined, "adult"), false);
    } catch {
      budget = NO_RECORD_BUDGET;
    }
  }
  const tools = budget.tools_offered.slice().sort().map((id) => toolSpecFor(id)).filter((t): t is ToolSpec => t !== null);
  return { system, specs: tools };
}
