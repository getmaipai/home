export type SkipMode = "skip" | "mark" | "off";
export type SkipRange = { startSec: number; endSec: number; kind: string; status?: string; id?: string; source?: string; confidence?: number; mode?: SkipMode; segmentIds?: string[] };
export type SkipPlan = { state: string; reason?: string | null; ranges: SkipRange[]; modes?: Record<string, SkipMode>; recordId?: string; sourceHash?: string };

export function applySkip(plan: SkipPlan | null | undefined, positionSec: number, toleranceSec = 0.35): SkipRange | null {
  if (!plan || plan.state !== "ready") return null;
  return plan.ranges.find((range) => (range.status === undefined || range.status === "auto" || range.status === "confirmed") && (range.mode ?? plan.modes?.[range.kind] ?? "skip") === "skip" && positionSec >= range.startSec - toleranceSec && positionSec < range.endSec) ?? null;
}

/** Convert between a cut timeline and the original source timeline. */
export function mapTime(positionSec: number, ranges: readonly Pick<SkipRange, "startSec" | "endSec">[], direction: "to-source" | "to-skipped" = "to-source"): number {
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec);
  if (direction === "to-source") {
    let source = positionSec;
    for (const range of sorted) { const length = range.endSec - range.startSec; if (source < range.startSec) break; if (source < range.endSec) return range.endSec; source += length; }
    return source;
  }
  let skipped = positionSec;
  for (const range of sorted) { if (positionSec < range.startSec) break; skipped -= Math.min(positionSec, range.endSec) - range.startSec; }
  return Math.max(0, skipped);
}

export function formatTimeSaved(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"} saved`;
}
