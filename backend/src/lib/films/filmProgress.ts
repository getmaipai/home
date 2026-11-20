// VF-FILMPROGRESS-01: per-shot film progress for the render page and the Activity list.
// A shot's state and percent are READ from its clip's own `video_jobs` record (the runner already polls it with getVideoJobFor); nothing here copies them.
// The one JSON column `film_runs.progress_json` keeps only what exists nowhere else: the shot-to-job link, a held reason, the failure words, later the repair note.
// A run made before the column existed has null there and loads as "no links": its shots show from the production's own clips and pictures.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns } from "@/db/schema";
import { getMediaProduction } from "@/lib/mediaProductions";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { allowed } from "./background";
import { pageFilmRun } from "./pageFilm";
import type { PersonRow } from "@/types";

export interface ShotProgressNote { job_id?: string; held_reason?: string; failure?: string; note?: string }
export type ShotProgressColumn = { shots: Record<string, ShotProgressNote> };

export type ShotState = "queued" | "running" | "done" | "held" | "failed";
export interface ShotProgressRow {
  id: string;
  label: string;
  state: ShotState;
  progress?: number;
  thumb?: string;
  note?: string;
  heldReason?: string;
  failure?: { message: string; actions: Array<{ label: string; action: string }> };
}

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

const thumbOf = (fileId: string | null | undefined): string | undefined => (fileId ? `/api/files/${encodeURIComponent(fileId)}/thumb?w=320` : undefined);

/** One shot's state from its job (read, never copied), with the notes this module keeps. `jobState` is undefined when the shot has no clip job yet. */
export function shotProgressRow(input: { id: string; label: string; stillFileId?: string | null; clipDone: boolean; job?: { state: string; percent: number } | null; note?: ShotProgressNote }): ShotProgressRow {
  const { id, label, job, note } = input;
  const thumb = thumbOf(input.stillFileId);
  const base = { id, label, ...(thumb ? { thumb } : {}), ...(note?.note ? { note: note.note } : {}) };
  if (job?.state === "failed" || job?.state === "cancelled") {
    return { ...base, state: "failed", failure: { message: note?.failure ?? "This shot did not finish.", actions: [{ label: "Try again", action: "film-again" }] } };
  }
  if (job?.state === "running") return { ...base, state: "running", progress: Math.max(0, Math.min(100, Math.round(job.percent))) };
  if (job?.state === "queued") return { ...base, state: note?.held_reason ? "held" : "queued", ...(note?.held_reason ? { heldReason: note.held_reason } : {}) };
  if (job?.state === "done" || input.clipDone) return { ...base, state: "done", progress: 100 };
  if (note?.failure) return { ...base, state: "failed", failure: { message: note.failure, actions: [{ label: "Try again", action: "film-again" }] } };
  if (note?.held_reason) return { ...base, state: "held", heldReason: note.held_reason };
  return { ...base, state: "queued" };
}

/** Scope `film-progress`: the viewer's own newest film (or the one `id` names), adults only, one row per planned shot. No time left is invented here. */
export function filmProgressRows(person: PersonRow, id?: string): ShotProgressRow[] {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run || !run.plan) return [];
  const column = readProgress(run.id);
  const production = run.production_id ? getMediaProduction(person, run.production_id) : null;
  const shots = production?.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)) ?? [];
  return run.plan.shots.map((planned, index) => {
    const stored = shots.find((shot) => shot.id === planned.id);
    const note = column.shots[planned.id];
    const job = note?.job_id ? getVideoJobFor(person, note.job_id) : null;
    const words = planned.motion.trim().split(/\s+/).slice(0, 4).join(" ");
    return shotProgressRow({ id: planned.id, label: `${index + 1} · ${words}`, stillFileId: stored?.picture_file_id, clipDone: !!stored?.clip_file_id, job: job ? { state: job.state, percent: job.percent } : null, ...(note ? { note } : {}) });
  });
}
