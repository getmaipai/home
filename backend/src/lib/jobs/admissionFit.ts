import { appliedProfile, askLine, liveFit, type FitResult, type MemoryNow } from "./liveFit";
import { closableApps, closeForJob, realHelper, type CloseHelper, type CloseSettings } from "./closeApps";
import type { Category, CellState, Hardware, ProfileRow, Tier } from "./profileTable";

export interface ProfileSource {
  table: readonly ProfileRow[];
  hw: Hardware;
  pins: Partial<Record<Category, CellState>>;
  priorityWeight: Partial<Record<Category, number>>;
  lowerWithoutAsking: Partial<Record<Category, boolean>>;
  close?: CloseSettings;
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

const kindWords = (lead: Category) => lead === "picture" ? "picture" : lead === "video" ? "video" : lead === "music" ? "song" : "job";

const rank = { run: 3, ask: 2, queue: 1, refuse: 0 } as const;

export async function fitForAdmission(job: { id?: string; jobClass: "picture" | "video" | "other"; category?: string; tier: Tier }, readBudget: () => Promise<BudgetNow>, helper: CloseHelper = realHelper): Promise<FitResult | null> {
  const configured = getProfileSource();
  if (!configured || job.tier === "standard") return null;
  const lead: Category = job.jobClass === "picture" ? "picture" : job.jobClass === "video" ? "video" : job.category === "music" ? "music" : "tools";
  const row = configured.table.find((item) => item.lead === lead && item.tier === job.tier);
  if (!row) return null;
  try {
    const fitWith = (memory: MemoryNow) => liveFit({ row, table: configured.table, hw: configured.hw, memory: { ...memory, freeGb: Math.min(memory.freeGb, configured.hw.budgetGb) }, pins: configured.pins, priorityWeight: configured.priorityWeight, pickedTier: job.tier, lowerWithoutAsking: configured.lowerWithoutAsking });
    const memory = memoryNowFromBudget(await readBudget());
    const plain = fitWith(memory);
    const clean = plain.outcome === "run" && plain.lowered.length === 0 && !plain.belowPick;
    const close = configured.close;
    if (clean || !job.id || !close || close.mode !== "automatic") return plain;
    // MEM-SPACE-10: before chat or another category is lowered, quit the listed apps that would cover the shortfall. Nothing is closed unless closing helps.
    const listing = await helper.list();
    if (!listing.installed) return plain;
    const closableGb = closableApps(listing.apps, close, Date.now()).reduce((sum, app) => sum + app.bytes, 0) / 1e9;
    if (closableGb <= 0) return plain;
    const hypothetical = fitWith({ ...memory, evictableGb: memory.evictableGb + closableGb });
    const better = rank[hypothetical.outcome] > rank[plain.outcome] || (hypothetical.outcome === plain.outcome && (hypothetical.lowered.length < plain.lowered.length || (plain.belowPick && !hypothetical.belowPick)));
    if (!better) return plain;
    const shortfallGb = hypothetical.needGb - Math.min(memory.freeGb, configured.hw.budgetGb) - memory.evictableGb;
    const result = await closeForJob(job.id, kindWords(lead), shortfallGb, close, helper);
    if (result.closedApps === 0) return plain;
    const after = fitWith(memoryNowFromBudget(await readBudget()));
    return { ...after, steps: [...after.steps, "closed apps"], closed: { apps: result.closedApps, bytes: result.closedBytes } };
  } catch { return null; }
}

export function admissionFitProfile(fit: FitResult) { return appliedProfile(fit); }
export function admissionFitAskLine(fit: FitResult, audience: "adult" | "child" = "adult"): string | null { return askLine(fit, audience); }
