import type { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { describeFitPlan } from "@/lib/fitPanel";

export type FitSummaryItem = {
  name: string;
  wording: { verdict: "yes" | "slow" | "no" | "unknown"; headline: string; detail: string };
  plan: StackFitPlan | null;
};

export function summarizeFits(
  items: FitSummaryItem[],
  computer: { memoryGb: number | null; usableGb: number | null },
): string {
  const lines = ["What my computer can run"];
  if (computer.usableGb !== null) lines.push(`Memory for models: ${computer.usableGb} GB`);
  lines.push("");
  for (const item of items) {
    const needed = item.plan && describeFitPlan(item.plan).rows.find((row) => row.label === "Memory it needs")?.value;
    lines.push(`${item.name}: ${item.wording.headline}${needed && needed !== "Not known yet" ? ` (needs ${needed})` : ""}`);
  }
  lines.push("", "Checked with MaiPai Home.");
  return lines.join("\n");
}
