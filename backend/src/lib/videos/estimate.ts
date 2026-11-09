// VIDEO-ESTIMATE-01: "about N min" before a clip is made, from this home's own finished clips (never anyone else's numbers).
// A clip's time here is created-to-last-update of a finished job, so it includes waiting in the line; the note says so. Too few
// clips of the same level and length means no estimate: a made-up number is worse than none.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";

export type VideoEstimate = { minutes: number | null; samples: number; note: string };
export const ESTIMATE_MIN_SAMPLES = 3;

export function medianMinutes(secondsList: number[]): number | null {
  if (secondsList.length < ESTIMATE_MIN_SAMPLES) return null;
  const sorted = [...secondsList].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.max(1, Math.round(median / 60));
}

/** Finished clips in this home at the same level and within one second of the same length, newest 40. */
export function estimateVideoMinutes(input: { tier: "standard" | "boost" | "max"; seconds: number }): VideoEstimate {
  const rows = db.select().from(videoJobs).where(and(eq(videoJobs.state, "done"))).orderBy(desc(videoJobs.updatedAt)).limit(200).all();
  const times: number[] = [];
  for (const row of rows) {
    let request: { seconds?: number; tier?: string };
    try { request = JSON.parse(row.request) as typeof request; } catch { continue; }
    if ((request.tier ?? "standard") !== input.tier || Math.abs((request.seconds ?? 0) - input.seconds) > 1) continue;
    const spent = (Date.parse(row.updatedAt) - Date.parse(row.createdAt)) / 1000;
    if (Number.isFinite(spent) && spent > 5 && spent < 3 * 3600) times.push(spent);
    if (times.length >= 40) break;
  }
  const minutes = medianMinutes(times);
  return { minutes, samples: times.length, note: minutes === null ? "No estimate yet. It appears after a few clips like this have been made here." : "From clips like this made here. It includes time waiting in line." };
}
