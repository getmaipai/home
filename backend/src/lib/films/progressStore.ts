// VF-FILMPROGRESS-01: the light half (no heavy imports, so activity.ts and the runner can import it without a cycle): the progress column's reads and writes.
// A shot's state and percent are READ from its clip's own `video_jobs` record (the runner already polls it with getVideoJobFor); nothing here copies them.
// The one JSON column `film_runs.progress_json` keeps only what exists nowhere else: the shot-to-job link, a held reason, the failure words, later the repair note.
// A run made before the column existed has null there and loads as "no links": its shots show from the production's own clips and pictures.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns } from "@/db/schema";

export interface ShotProgressNote { job_id?: string; held_reason?: string; failure?: string; note?: string }
export type ShotProgressColumn = { shots: Record<string, ShotProgressNote> };

/** Reads the column; null, unreadable or a shape from the future is "no links", never an error. */
export function parseProgress(raw: string | null | undefined): ShotProgressColumn {
  if (!raw) return { shots: {} };
  try {
    const value = JSON.parse(raw) as { shots?: unknown };
    if (!value || typeof value !== "object" || !value.shots || typeof value.shots !== "object") return { shots: {} };
    const shots: Record<string, ShotProgressNote> = {};
    for (const [id, entry] of Object.entries(value.shots as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      shots[id] = {
        ...(typeof e.job_id === "string" ? { job_id: e.job_id } : {}),
        ...(typeof e.held_reason === "string" ? { held_reason: e.held_reason } : {}),
        ...(typeof e.failure === "string" ? { failure: e.failure } : {}),
        ...(typeof e.note === "string" ? { note: e.note } : {}),
      };
    }
    return { shots };
  } catch { return { shots: {} }; }
}

export function readProgress(runId: string): ShotProgressColumn {
  const row = db.select({ progressJson: filmRuns.progressJson }).from(filmRuns).where(eq(filmRuns.id, runId)).get();
  return parseProgress(row?.progressJson);
}

/** The running film (or the newest run) of a production, top level only: where the runner writes. */
function runIdOfProduction(productionId: string): string | null {
  const row = db.select({ id: filmRuns.id }).from(filmRuns).where(and(eq(filmRuns.productionId, productionId), isNull(filmRuns.parentId))).orderBy(desc(filmRuns.createdAt)).get();
  return row?.id ?? null;
}

/** Merge one shot's note into the column. `patch` keys set to undefined are removed. Counts and ids only; no words of a prompt are logged. */
export function recordShotNote(productionId: string, shotId: string, patch: { job_id?: string; held_reason?: string | null; failure?: string | null; note?: string | null }): void {
  const runId = runIdOfProduction(productionId);
  if (!runId) return;
  const current = readProgress(runId);
  const next: ShotProgressNote = { ...(current.shots[shotId] ?? {}) };
  if (patch.job_id !== undefined) next.job_id = patch.job_id;
  for (const key of ["held_reason", "failure", "note"] as const) {
    const value = patch[key];
    if (value === null) delete next[key]; else if (value !== undefined) next[key] = value;
  }
  current.shots[shotId] = next;
  db.update(filmRuns).set({ progressJson: JSON.stringify(current) }).where(eq(filmRuns.id, runId)).run();
}

export const recordShotJob = (productionId: string, shotId: string, jobId: string): void => recordShotNote(productionId, shotId, { job_id: jobId, held_reason: null, failure: null });
export const recordShotFailure = (productionId: string, shotId: string, words: string): void => recordShotNote(productionId, shotId, { failure: words });

/** The video job ids of a film's shot clips, so a list of jobs can fold them into the film's own row. */
export function filmShotJobIds(runId: string): string[] {
  return Object.values(readProgress(runId).shots).flatMap((entry) => (entry.job_id ? [entry.job_id] : []));
}

