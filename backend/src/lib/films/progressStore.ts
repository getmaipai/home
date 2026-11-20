// VF-FILMPROGRESS-01: the light half (no heavy imports, so activity.ts and the runner can import it without a cycle): the progress column's reads and writes.
// A shot's state and percent are READ from its clip's own `video_jobs` record (the runner already polls it with getVideoJobFor); nothing here copies them.
// The one JSON column `film_runs.progress_json` keeps only what exists nowhere else: the shot-to-job link, a held reason, the failure words, later the repair note.
// A run made before the column existed has null there and loads as "no links": its shots show from the production's own clips and pictures.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns } from "@/db/schema";

export interface ShotProgressNote { job_id?: string; still_job?: string; held_reason?: string; failure?: string; note?: string }
/** FILM-CANCEL-01: the run's other child jobs, so Stop finds every one through this one column: the song's job id and the film cut and mix edit jobs' ids (each a `video_jobs` row). A shot's `still_job` is its picture's Stack job id. */
export interface RunJobLinks { music_job?: string; edit_jobs?: string[] }
export type ShotProgressColumn = { shots: Record<string, ShotProgressNote>; run?: RunJobLinks };

/** Reads the column; null, unreadable or a shape from the future is "no links", never an error. */
export function parseProgress(raw: string | null | undefined): ShotProgressColumn {
  if (!raw) return { shots: {} };
  try {
    const value = JSON.parse(raw) as { shots?: unknown; run?: unknown };
    if (!value || typeof value !== "object" || !value.shots || typeof value.shots !== "object") return { shots: {} };
    const shots: Record<string, ShotProgressNote> = {};
    for (const [id, entry] of Object.entries(value.shots as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      shots[id] = {
        ...(typeof e.job_id === "string" ? { job_id: e.job_id } : {}),
        ...(typeof e.still_job === "string" ? { still_job: e.still_job } : {}),
        ...(typeof e.held_reason === "string" ? { held_reason: e.held_reason } : {}),
        ...(typeof e.failure === "string" ? { failure: e.failure } : {}),
        ...(typeof e.note === "string" ? { note: e.note } : {}),
      };
    }
    const run = value.run && typeof value.run === "object" ? value.run as Record<string, unknown> : null;
    const links: RunJobLinks = {
      ...(run && typeof run.music_job === "string" ? { music_job: run.music_job } : {}),
      ...(run && Array.isArray(run.edit_jobs) ? { edit_jobs: run.edit_jobs.filter((id): id is string => typeof id === "string") } : {}),
    };
    return { shots, ...(Object.keys(links).length ? { run: links } : {}) };
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
export function recordShotNote(productionId: string, shotId: string, patch: { job_id?: string; still_job?: string; held_reason?: string | null; failure?: string | null; note?: string | null }): void {
  const runId = runIdOfProduction(productionId);
  if (!runId) return;
  const current = readProgress(runId);
  const next: ShotProgressNote = { ...(current.shots[shotId] ?? {}) };
  if (patch.job_id !== undefined) next.job_id = patch.job_id;
  if (patch.still_job !== undefined) next.still_job = patch.still_job;
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


/** FILM-CANCEL-01: remember the run's song job or a cut or mix edit job so Stop can cancel it. */
export function recordRunJob(productionId: string, kind: "music" | "edit", jobId: string): void {
  const runId = runIdOfProduction(productionId);
  if (!runId) return;
  const current = readProgress(runId);
  const run: RunJobLinks = { ...(current.run ?? {}) };
  if (kind === "music") run.music_job = jobId; else run.edit_jobs = [...new Set([...(run.edit_jobs ?? []), jobId])];
  current.run = run;
  db.update(filmRuns).set({ progressJson: JSON.stringify(current) }).where(eq(filmRuns.id, runId)).run();
}

/** Every child job of a run that the column knows, by kind. */
export function filmRunJobs(runId: string): { stills: Array<{ shot: string; job: string }>; clips: string[]; music: string | null; edits: string[] } {
  const column = readProgress(runId);
  const entries = Object.values(column.shots);
  return { stills: Object.entries(column.shots).flatMap(([shot, e]) => (e.still_job ? [{ shot, job: e.still_job }] : [])), clips: entries.flatMap((e) => (e.job_id ? [e.job_id] : [])), music: column.run?.music_job ?? null, edits: column.run?.edit_jobs ?? [] };
}
