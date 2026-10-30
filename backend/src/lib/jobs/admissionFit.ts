import { appliedProfile, askLine, liveFit, type FitResult, type MemoryNow } from "./liveFit";
import type { Category, CellState, Hardware, ProfileRow, Tier } from "./profileTable";

export interface ProfileSource {
  table: readonly ProfileRow[];
  hw: Hardware;
  pins: Partial<Record<Category, CellState>>;
  priorityWeight: Partial<Record<Category, number>>;
  lowerWithoutAsking: Partial<Record<Category, boolean>>;
}
export interface BudgetNow { freeMemoryBytes: number; loaded: { class: string; peakBytes: number; pinned: boolean }[] }
let source: ProfileSource | (() => ProfileSource | null) | null = null;
/** A function is read at every admission, so a change on the Performance page applies to the next job. */
export function setProfileSource(next: ProfileSource | (() => ProfileSource | null) | null): void { source = next; }
export function getProfileSource(): ProfileSource | null {
  if (typeof source !== "function") return source;
  try { return source(); } catch { return null; }
}

export function memoryNowFromBudget(b: BudgetNow): MemoryNow {
  // GB uses decimal units: 1 GB = 1e9 bytes.
  return {
    freeGb: b.freeMemoryBytes / 1e9,
    evictableGb: b.loaded.filter((item) => (item.class === "warm" || item.class === "burst") && !item.pinned).reduce((sum, item) => sum + item.peakBytes, 0) / 1e9,
  };
}

export async function fitForAdmission(job: { jobClass: "picture" | "video" | "other"; category?: string; tier: Tier }, readBudget: () => Promise<BudgetNow>): Promise<FitResult | null> {
  const configured = getProfileSource();
  if (!configured || job.tier === "standard") return null;
  const lead: Category = job.jobClass === "picture" ? "picture" : job.jobClass === "video" ? "video" : job.category === "music" ? "music" : "tools";
  const row = configured.table.find((item) => item.lead === lead && item.tier === job.tier);
  if (!row) return null;
  try {
    const memory = memoryNowFromBudget(await readBudget());
    return liveFit({ row, table: configured.table, hw: configured.hw, memory: { ...memory, freeGb: Math.min(memory.freeGb, configured.hw.budgetGb) }, pins: configured.pins, priorityWeight: configured.priorityWeight, pickedTier: job.tier, lowerWithoutAsking: configured.lowerWithoutAsking });
  } catch { return null; }
}

export function admissionFitProfile(fit: FitResult) { return appliedProfile(fit); }
export function admissionFitAskLine(fit: FitResult, audience: "adult" | "child" = "adult"): string | null { return askLine(fit, audience); }
