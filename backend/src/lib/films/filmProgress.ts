// VF-FILMPROGRESS-01: per-shot film progress for the render page. A shot's state and percent are READ from its clip's own `video_jobs` record; the column (progressStore.ts)
// keeps only what exists nowhere else. A run made before the column existed has null there and loads as "no links".
import { getMediaProduction } from "@/lib/mediaProductions";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { allowed } from "./background";
import { pageFilmRun } from "./pageFilm";
import { readProgress, type ShotProgressNote } from "./progressStore";
import type { PersonRow } from "@/types";

export * from "./progressStore";

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

/** One shot row in the names the kit's `job_progress` block reads (its `item_fields`). A failed shot offers Try again, which is the Film maker's own `film-again` action; no other repair is offered until it exists. */
export function pageShotRow(runId: string, row: ShotProgressRow): Record<string, unknown> {
  return {
    shot_id: row.id, label: row.label, state: row.state,
    ...(row.progress !== undefined ? { progress: row.progress } : {}),
    ...(row.thumb ? { thumb: row.thumb } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.heldReason ? { held_reason: row.heldReason } : {}),
    ...(row.failure ? { failure_message: row.failure.message, failure_actions: [{ label: "Try again", action: { call: { target: "/api/plugins/video/actions/film-again", method: "POST", args: { run: runId, shot: row.id } } } }] } : {}),
  };
}

/** Scope `film-progress` as the page binds it: the same rows as `filmProgressRows`, in the block's field names. */
export function filmProgressPageRows(person: PersonRow, id?: string): Array<Record<string, unknown>> {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  return run ? filmProgressRows(person, run.id).map((row) => pageShotRow(run.id, row)) : [];
}

/** Scope `film-progress`: the viewer's own newest film (or the one `id` names), adults only, one row per planned shot. No time left is invented here. */
export function filmProgressRows(person: PersonRow, id?: string): ShotProgressRow[] {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run || !run.plan) return [];
  // A stopped film has no shots in progress: its unfinished shots would read as failed or waiting (and keep the page's spinner and Cancel), so the page shows its Stopped line and Resume instead (FILM-CANCEL-01).
  if (run.state === "cancelled") return [];
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
