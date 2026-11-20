// VF-UI-09: the rows of the Film maker page's storyboard_player and the one row of its action bar, for the viewer's own newest film (adults only).
// Today a shot has a picture, a length and at most one line as words: the silent animatic. When the Stack's `media.rough_cut` op answers, `roughCutRows` turns its result into
// the same row shape (Stack-known parts from the result, Home's own words and pictures beside it), so the page does not change.
import { roughCutShotRows, type StackRoughCutResult } from "@maipai/spec/stack/ts/stack-rough-cut.js";
import { getMediaProduction } from "@/lib/mediaProductions";
import { allowed } from "./background";
import { pageFilmRun } from "./pageFilm";
import type { FilmRun } from "./store";
import type { PersonRow } from "@/types";

export type StoryboardRow = ReturnType<typeof roughCutShotRows>[number];

const thumb = (fileId: string | null | undefined): string | null => (fileId ? `/api/files/${encodeURIComponent(fileId)}/thumb?w=640` : null);

function captionOf(index: number, framing: string | undefined, motion: string): string {
  const frame = framing ? `${framing[0]!.toUpperCase()}${framing.slice(1)}` : "";
  const words = frame ? "" : motion.trim().split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return `${index + 1}${frame || words ? ` · ${frame || words}` : ""}`;
}

/** The speaker of a line is the film's one cast character when there is exactly one; otherwise the line is narration. Never an invented name. */
function speakerOf(run: FilmRun): string {
  const characters = (run.plan?.cast ?? []).filter((entry) => entry.kind === "character");
  return characters.length === 1 ? characters[0]!.name : "Narration";
}

/** The silent animatic: each planned shot's picture held for its seconds, its line as words. A shot with no picture yet is `no_picture`. */
export function storyboardRows(person: PersonRow, id?: string): StoryboardRow[] {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.plan) return [];
  const production = run.production_id ? getMediaProduction(person, run.production_id) : null;
  const stored = production?.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)) ?? [];
  const speaker = speakerOf(run);
  return run.plan.shots.filter((shot) => shot.kept !== false).map((planned, index) => {
    const still = thumb(stored.find((shot) => shot.id === planned.id)?.picture_file_id);
    return {
      shot_id: planned.id, caption: captionOf(index, (planned as { framing?: string }).framing, planned.motion), duration_sec: planned.seconds, still, clip: null, status: still ? "ready" : "no_picture",
      line_speaker: planned.line ? speaker : null, line_text: planned.line ?? null, line_start_sec: planned.line ? 0 : null, line_audio: null, line_wave: null,
    };
  });
}

/** When the rough-cut op answers: the same rows, with the Stack-known parts (lengths from the cut, line start, audio, wave) from its result. */
export function roughCutRows(person: PersonRow, result: StackRoughCutResult, id?: string): StoryboardRow[] {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.plan) return [];
  const own = { captions: {} as Record<string, string>, stills: {} as Record<string, string>, lineTexts: {} as Record<string, string> };
  for (const row of storyboardRows(person, id)) {
    own.captions[row.shot_id] = row.caption;
    if (row.still) own.stills[row.shot_id] = row.still;
    if (row.line_text) own.lineTexts[row.shot_id] = row.line_text;
  }
  return roughCutShotRows(result, own);
}

/** The action bar's one row: whether Render film can start now and, when it cannot, why in plain words. No estimate until the Stack serves one (VF-PROFILE-01). */
export function renderPlanRows(person: PersonRow, id?: string): Array<{ run_id: string; ready: boolean; reason: string | null }> {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.plan) return [];
  if (run.state !== "waiting_for_go") return [{ run_id: run.id, ready: false, reason: run.state === "done" ? "This film is finished." : run.state === "running" || run.state === "planning" ? "This film is being made." : "Plan the film again to render it." }];
  const rows = storyboardRows(person, id);
  const missing = rows.filter((row) => row.status === "no_picture").length;
  if (rows.length < 2) return [{ run_id: run.id, ready: false, reason: "Keep at least two shots to render a film." }];
  if (missing > 0) return [{ run_id: run.id, ready: false, reason: missing === 1 ? "One shot has no picture yet. Draft all makes them." : `${missing} shots have no picture yet. Draft all makes them.` }];
  return [{ run_id: run.id, ready: true, reason: null }];
}
