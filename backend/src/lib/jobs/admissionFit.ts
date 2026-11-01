import { appliedProfile, askLevels, askLine, liveFit, type FitResult, type MemoryNow } from "./liveFit";
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
/** `freeMemoryBytes` is the Stack's own reading of what is available now (free plus reclaimable cache, so what other programs hold is already out of it).
 * `measured` says the loaded item's footprint was read from its process, not guessed by the ledger. `readingDegraded` says the Stack could not read memory. */
export interface BudgetNow { freeMemoryBytes: number; loaded: { class: string; peakBytes: number; pinned: boolean; measured?: boolean }[]; marginBytes?: number; readingDegraded?: boolean }
/** MAX-LIVE-01: a job that just did not fit needs this much more room (GB) before it is told it fits, so a reading at the edge does not flap. */
export const FIT_HYSTERESIS_GB = 1;
const notCleanLastTime = new Set<string>();
export function resetFitHysteresisForTests(): void { notCleanLastTime.clear(); }
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
    evictableGb: b.loaded.filter((item) => (item.class === "warm" || item.class === "burst") && !item.pinned && item.measured === true).reduce((sum, item) => sum + item.peakBytes, 0) / 1e9,
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
  // MAX-LIVE-02: the Stack lists a tier's peak only once it is measured, and none exists for a Max pick an admin chose by hand (video Max, 2026-11-01). Without a figure the row needs an unknown amount, so Home would hold the job as "no room" for good; it gives no opinion and the Stack's governor (real memory, Max window, Reduced chat) decides.
  if (job.tier === "max" && configured.hw.peakGb[lead]?.max === undefined) return null;
  try {
    // The room is what is really available now: the Stack's reading, less the working margin it keeps back (and the hysteresis band for a job that did not fit last time), never more than the model budget.
    let marginGb = configured.hw.marginGb;
    let band = job.id && notCleanLastTime.has(job.id) ? FIT_HYSTERESIS_GB : 0;
    const usableFree = (freeGb: number) => Math.max(0, Math.min(freeGb - marginGb - band, configured.hw.budgetGb));
    const fitWith = (memory: MemoryNow) => liveFit({ row, table: configured.table, hw: configured.hw, memory: { ...memory, freeGb: usableFree(memory.freeGb) }, pins: configured.pins, priorityWeight: configured.priorityWeight, pickedTier: job.tier, lowerWithoutAsking: configured.lowerWithoutAsking });
    const remember = (result: FitResult): FitResult => { if (job.id) { if (result.outcome === "run" && result.lowered.length === 0 && !result.belowPick) notCleanLastTime.delete(job.id); else { notCleanLastTime.add(job.id); while (notCleanLastTime.size > 500) notCleanLastTime.delete(notCleanLastTime.values().next().value!); } } return result; };
    const budget = await readBudget();
    if (budget.readingDegraded) return null; // no live reading: Home gives no opinion and the Stack's governor decides
    if (budget.marginBytes !== undefined) marginGb = budget.marginBytes / 1e9;
    const memory = memoryNowFromBudget(budget);
    const plain = fitWith(memory);
    const clean = plain.outcome === "run" && plain.lowered.length === 0 && !plain.belowPick;
    const close = configured.close;
    if (clean || !job.id || !close || close.mode !== "automatic") return remember(plain);
    // MEM-SPACE-10: before chat or another category is lowered, quit the listed apps that would cover the shortfall. Nothing is closed unless closing helps.
    const listing = await helper.list();
    if (!listing.installed) return remember(plain);
    const closableGb = closableApps(listing.apps, close, Date.now()).reduce((sum, app) => sum + app.bytes, 0) / 1e9;
    if (closableGb <= 0) return remember(plain);
    const hypothetical = fitWith({ ...memory, evictableGb: memory.evictableGb + closableGb });
    const better = rank[hypothetical.outcome] > rank[plain.outcome] || (hypothetical.outcome === plain.outcome && (hypothetical.lowered.length < plain.lowered.length || (plain.belowPick && !hypothetical.belowPick)));
    // Only close for a job that will start: a job that waits for an answer or for room never costs the Mac's user an app.
    if (!better || hypothetical.outcome !== "run") return remember(plain);
    const shortfallGb = hypothetical.needGb - usableFree(memory.freeGb) - memory.evictableGb;
    const result = await closeForJob(job.id, kindWords(lead), shortfallGb, close, helper);
    if (result.closedApps === 0) return remember(plain);
    const after = fitWith(memoryNowFromBudget(await readBudget()));
    return remember({ ...after, steps: [...after.steps, "closed apps"], closed: { apps: result.closedApps, bytes: result.closedBytes } });
  } catch { return null; }
}

export function admissionFitProfile(fit: FitResult) { return appliedProfile(fit); }
export function admissionFitAskLevels(fit: FitResult): { picked: string; actual: string } { return askLevels(fit); }
export function admissionFitAskLine(fit: FitResult, audience: "adult" | "child" = "adult"): string | null { return askLine(fit, audience); }
