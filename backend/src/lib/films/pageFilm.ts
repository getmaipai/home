// FILM-PAGE-01: the Film maker page of the Video app (packages/video/pages/film-maker.json). It is the existing film backend on a page, not a new engine:
// one sentence plans the shot list (`startFilm`, waiting for Go), "Draft all" makes only the pictures, each draft is kept or skipped, "Finish kept" renders the
// kept shots and joins them (the same run a full Go makes), and "Music video to the beat" is the chat tool's `cut_to_beat` edit over the finished film's clips.
// The page's rows are `recipes` scopes `film` (the person's newest film) and `film-shots` (its shots); the actions are `film-*` under /api/plugins/video/actions.
import { startVoicedPreview } from "./voicedPreview";
import { repairLine } from "./repair";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { castForTool } from "@/lib/cast";
import { getMediaProduction } from "@/lib/mediaProductions";
import { refuseVideoPrompt, VIDEO_REFUSAL_LINE } from "@/lib/videos/policy";
import { startClipEdit } from "@/lib/videos/clipEditStart";
import { getVideoJobByFileFor } from "@/lib/videos/jobs";
import { allowed, cancelFilm, draftFilmRun, editFilmShot, filmDraftedShots, finishKeptFilm, redoDraftShot, redoFilmRunShot, resumeFilmRun, reviewFilmShot, startFilm, useFilmTake } from "./background";
import { getReelFormat, listReelFormats } from "./reelFormats";
import { castHintsFor } from "./tool";
import { getFilmRun, listFilmRunsInStates, type FilmRun, type FilmRunState } from "./store";

export type FilmPageResult = { ok: true; id: string; state: string } | { ok: false; status: 403 | 404 | 422 | 423; error: string; code: string };
const fail = (status: 403 | 404 | 422 | 423, error: string, code: string): FilmPageResult => ({ ok: false, status, error, code });
export const FILM_PAGE_ACTIONS = ["film-plan", "film-draft", "film-review", "film-shot", "film-again", "film-finish", "film-beat", "film-voiced-preview", "film-cancel", "film-resume", "film-use-take"] as const;
export type FilmPageAction = (typeof FILM_PAGE_ACTIONS)[number];

const GONE_LINE = "That film isn't available any more. Describe a new one and press Plan the film.";
const NOT_ADULT_LINE = "Making a film is for adults on their own written screen.";
const ALL_STATES: FilmRunState[] = ["planning", "waiting_for_go", "running", "done", "failed", "cancelled"];
/** The camera choices of the Change a shot mode: each is the words the planner writes in a shot's motion line. */
export const FILM_CAMERAS: ReadonlyArray<{ value: string; label: string; motion: string }> = [
  { value: "keep", label: "Keep the camera", motion: "" },
  { value: "push_in", label: "Slow push in", motion: "slow push in" },
  { value: "pull_back", label: "Slow pull back", motion: "slow pull back" },
  { value: "pan_left", label: "Pan left", motion: "pan left" },
  { value: "pan_right", label: "Pan right", motion: "pan right" },
  { value: "hold", label: "Hold still", motion: "hold still with a slight handheld sway" },
];

/** A form sends text for every field; a row action leaves `{name}` for a field the person never filled, and a chip may say "none". Both mean not given. */
const given = (value: unknown): string => {
  if (typeof value !== "string") return typeof value === "number" ? String(value) : "";
  const text = value.trim();
  return /^\{[a-z_]+\}$/.test(text) || text.toLowerCase() === "none" ? "" : text;
};
const wholeNumber = (value: unknown): number | undefined | "bad" => { const text = given(value); if (!text) return undefined; const n = Number(text); return Number.isInteger(n) ? n : "bad"; };
const castRefs = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => given(v)) : given(value).split(",").map((part) => part.trim()).filter(Boolean));

/** The person's newest film of their own (a long-form production's parts are not listed), or the one `id` names. */
export function pageFilmRun(person: PersonRow, id?: string): FilmRun | null {
  if (id) { const run = getFilmRun(person, id); return run && !run.parent_id ? run : null; }
  return listFilmRunsInStates(ALL_STATES).filter((run) => run.person_id === person.id && !run.parent_id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function lineOr(result: FilmRun | { line: string } | null): FilmPageResult {
  if (!result) return fail(404, GONE_LINE, "gone");
  if ("line" in result) return fail(422, result.line, "not_ready");
  return { ok: true, id: result.id, state: result.state };
}

async function planFromPage(person: PersonRow, body: Record<string, unknown>): Promise<FilmPageResult> {
  if (!allowed(person)) return fail(403, NOT_ADULT_LINE, "denied");
  const prompt = given(body.prompt);
  if (prompt.length < 3) return fail(422, "Describe the film in a sentence or two, then press Plan the film.", "bad_arguments");
  if (prompt.length > 1200) return fail(422, "Keep the film's description under 1200 characters, then press Plan the film.", "bad_arguments");
  const refusal = refuseVideoPrompt(prompt, { lane: "adult" });
  if (refusal) return fail(422, VIDEO_REFUSAL_LINE[refusal], refusal);
  const seconds = wholeNumber(body.seconds);
  if (seconds === "bad" || (seconds !== undefined && (seconds < 10 || seconds > 300))) return fail(422, "Pick a film length between 10 and 300 seconds.", "bad_arguments");
  const formatId = given(body.format);
  const format = formatId ? getReelFormat(formatId) : undefined;
  if (formatId && !format) return fail(422, "That film style isn't one of the choices. Pick one from the list and try again.", "bad_arguments");
  const cast = castRefs(body.cast);
  const chosen = await castForTool(person, { cast }, { band: speakerAgeBand(person, new Date()), temporary: false });
  if (!chosen.ok) return fail(422, chosen.line, "cast");
  const idea = format ? `${prompt}\n\nPlan it in the "${format.title}" reel format (format id ${format.id}).` : prompt;
  const started = startFilm({ actor: person, idea, seconds, castHints: castHintsFor(chosen), castSubjectIds: chosen.subjects.map(({ subject }) => subject.id), goAhead: false });
  if ("line" in started) return fail(422, started.line, "not_started");
  return { ok: true, id: started.id, state: "planning" };
}

async function beatFromPage(person: PersonRow, runId: string, body: Record<string, unknown>): Promise<FilmPageResult> {
  const run = pageFilmRun(person, runId || undefined);
  if (!run || !allowed(person)) return fail(404, GONE_LINE, "gone");
  if (run.state !== "done" || !run.plan || !run.production_id) return fail(422, "Finish the film first, then cut it to a song.", "not_ready");
  const production = getMediaProduction(person, run.production_id);
  const shots = production?.episodes.flatMap((e) => e.scenes.flatMap((sc) => sc.shots)) ?? [];
  // The edit names clips by their video job; a shot's clip is a Library file, so each is looked up by the job that made it.
  const clips = run.plan.shots.map((planned) => shots.find((shot) => shot.id === planned.id)?.clip_file_id).flatMap((fileId) => { const job = fileId ? getVideoJobByFileFor(person, fileId) : null; return job ? [job.id] : []; });
  if (!clips.length || clips.length < run.plan.shots.length) return fail(422, "This film's clips can't be found any more, so it can't be cut to a song. Make the film again from the Film maker.", "no_clips");
  const length = Math.min(60, Math.max(5, Math.round(run.plan.shots.reduce((sum, shot) => sum + shot.seconds, 0))));
  const started = await startClipEdit(person, clips[0]!, { change: "cut_to_beat", clips, track: given(body.track) || "latest", beats_per_cut: 4, length_s: length }, "I couldn't cut the film to the beat. Try again.", "beat_failed");
  if (!started.ok) return fail(started.status === 423 ? 423 : started.status === 404 ? 404 : started.status === 403 ? 403 : 422, started.error, started.code);
  return { ok: true, id: started.job.id, state: started.job.state };
}

/** One `film-*` action of the page. `body` is what the page posted (strings, as a form sends them). */
export async function filmPageAction(person: PersonRow, action: FilmPageAction, body: Record<string, unknown>): Promise<FilmPageResult> {
  if (action === "film-plan") return planFromPage(person, body);
  // C10: a teen, a child or anyone else gets the answer of a film that does not exist (404), not a refusal that says the feature is there.
  if (action === "film-voiced-preview") { const started = startVoicedPreview(person, pageFilmRun(person, given(body.run) || undefined)); return started.ok ? { ok: true, id: started.id, state: started.state } : fail(started.status, started.line, started.code); }
  if (!allowed(person)) return fail(403, NOT_ADULT_LINE, "denied");
  const runId = given(body.run), shotId = given(body.shot);
  if (action === "film-beat") return beatFromPage(person, runId, body);
  const run = pageFilmRun(person, runId || undefined);
  if (!run) return fail(404, GONE_LINE, "gone");
  if (action === "film-use-take") { if (!shotId) return fail(422, "Pick a shot first.", "bad_arguments"); const which = given(body.take) === "first" ? "first" : "new"; return lineOr(useFilmTake(person, run.id, shotId, which)); }
  if (action === "film-draft") return lineOr(draftFilmRun(person, run.id));
  if (action === "film-finish") return lineOr(finishKeptFilm(person, run.id));
  // FILM-CANCEL-01: stop a film being made (its queued or running shot jobs are cancelled, finished shots are kept) and carry on from the first unfinished shot.
  if (action === "film-cancel") return lineOr(cancelFilm(person, run.id));
  if (action === "film-resume") return lineOr(resumeFilmRun(person, run.id));
  if (!shotId) return fail(422, "Pick a shot first.", "bad_arguments");
  if (action === "film-review") return lineOr(reviewFilmShot(person, run.id, shotId, body.keep === true || given(body.keep) === "true"));
  if (action === "film-again") return lineOr(run.state === "done" ? redoFilmRunShot(person, run.id, shotId) : redoDraftShot(person, run.id, shotId));
  // film-shot: new words, seconds or camera for one shot of a planned film.
  const words = given(body.prompt), seconds = wholeNumber(body.shot_seconds), camera = FILM_CAMERAS.find((entry) => entry.value === given(body.camera));
  if (words && words.length < 15) return fail(422, "Describe the shot in a full sentence (at least 15 characters), then try again.", "bad_arguments");
  if (words.length > 600) return fail(422, "Keep the shot's words under 600 characters.", "bad_arguments");
  if (seconds === "bad" || (seconds !== undefined && (seconds < 3 || seconds > 10))) return fail(422, "A shot lasts between 3 and 10 seconds.", "bad_arguments");
  if (!words && seconds === undefined && !camera?.motion) return fail(422, "Type the new words, or pick a new length or camera, then try again.", "bad_arguments");
  return lineOr(editFilmShot(person, run.id, shotId, { ...(words ? { still: words } : {}), ...(seconds !== undefined ? { seconds } : {}), ...(camera?.motion ? { motion: camera.motion } : {}) }));
}

function statusOf(person: PersonRow, run: FilmRun): { line: string; making: boolean } {
  const drafted = filmDraftedShots(person, run), total = run.plan?.shots.length ?? 0;
  if (run.state === "planning") return { line: "Planning the shots. This takes a minute or two.", making: true };
  if (run.state === "running") return { line: `${run.stage ?? "Working"}: step ${Math.min(run.done_steps, run.total_steps)} of ${run.total_steps}`, making: true };
  if (run.state === "waiting_for_go") return { line: drafted.size === 0 ? "The shot list is ready. Press Draft all to see a picture for each shot." : drafted.size < total ? `${drafted.size} of ${total} pictures are drafted. Press Draft all for the rest.` : "The drafts are ready. Keep or skip each shot, then press Finish kept.", making: false };
  if (run.state === "done") return { line: "The film is finished. It is in My clips.", making: false };
  if (run.state === "cancelled") return { line: run.plan && run.production_id ? "Stopped. The shots already made are kept. Press Resume to carry on." : "This film was stopped. Describe a new one above.", making: false };
  return { line: run.error_line ?? "The film could not be finished. Describe it again above.", making: false };
}
const thumb = (fileId: string | null | undefined) => (fileId ? `/api/files/${encodeURIComponent(fileId)}/thumb?w=320` : null);

/** `recipes` scope `film`: one row for the person's newest film (or the one `id` names), with the buttons its stage allows. */
export function filmRows(person: PersonRow, id?: string): Array<Record<string, unknown>> {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run) return [];
  const { line, making } = statusOf(person, run);
  const drafted = filmDraftedShots(person, run), kept = (run.plan?.shots ?? []).filter((shot) => shot.kept !== false);
  const production = run.production_id ? getMediaProduction(person, run.production_id) : null;
  const first = production?.episodes.flatMap((e) => e.scenes.flatMap((sc) => sc.shots)).find((shot) => !!shot.picture_file_id)?.picture_file_id;
  return [{
    id: run.id, run_id: run.id, title: run.plan?.title ?? (run.idea.slice(0, 60) || "Your film"), subtitle: line, thumbnail: thumb(run.film_file_id ? undefined : first) ?? thumb(run.film_file_id),
    making: making ? "yes" : "no", state: run.state,
    can_draft: run.state === "waiting_for_go" && !!run.plan && drafted.size < run.plan.shots.length,
    can_finish: run.state === "waiting_for_go" && kept.length >= 2 && kept.every((shot) => drafted.has(shot.id)),
    can_beat: run.state === "done" && !!run.film_file_id,
    // VF-UI-12: the finished film's file id, so Titles and credits and Edit and export open it in the existing pages.
    film_file_id: run.film_file_id ?? "",
    can_title: run.state === "done" && !!run.film_file_id,
    // The film's own note (S6, no new status surface): what the voiced preview is doing, why it was not kept, or which lines were left out, in the plain words it was written in. Empty when there is none.
    note: run.note ?? "",
  }];
}

/** `recipes` scope `film-repairs` (VF-REPAIR-01 slice 1): one row per repaired or flagged shot of the film, with the plain line and the buttons its state allows (the UI session's card draws them). */
export function filmRepairRows(person: PersonRow, id?: string): Array<Record<string, unknown>> {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.plan) return [];
  const kept = run.plan.shots.filter((shot) => shot.kept !== false);
  return kept.flatMap((shot, index) => {
    const repair = shot.repair;
    if (!repair) return [];
    const idle = run.state === "done" || run.state === "waiting_for_go";
    return [{
      id: shot.id, run_id: run.id, title: `Shot ${index + 1}`, line: repairLine(index + 1, repair), state: repair.state,
      can_use_new: idle && repair.state === "failed" && !!repair.new_clip_id && !!repair.first_clip_id,
      can_use_earlier: idle && repair.state === "fixed" && !!repair.first_clip_id && !!repair.new_clip_id,
      can_make_again: idle && repair.state !== "fixed",
    }];
  });
}

/** `recipes` scope `film-shots`: the shot list of the newest film as cards (words, seconds, camera, the draft picture, its keep mark). */
export function filmShotRows(person: PersonRow, id?: string): Array<Record<string, unknown>> {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.plan) return [];
  const production = run.production_id ? getMediaProduction(person, run.production_id) : null;
  const stored = new Map((production?.episodes.flatMap((e) => e.scenes.flatMap((sc) => sc.shots)) ?? []).map((shot) => [shot.id, shot]));
  return run.plan.shots.map((shot, index) => {
    const own = stored.get(shot.id), hasPicture = !!own?.picture_file_id, waiting = run.state === "waiting_for_go";
    const status = shot.kept === false ? "Skipped" : run.state === "done" ? "In the film" : hasPicture ? (shot.kept === true ? "Kept" : "Draft") : "Not drafted";
    return {
      id: shot.id, run_id: run.id, title: `Shot ${index + 1}, ${shot.seconds} s`, subtitle: `${status}. ${shot.still.slice(0, 110)}${shot.still.length > 110 ? "..." : ""} Camera: ${shot.motion.slice(0, 40)}`,
      thumbnail: thumb(own?.picture_file_id), status, making: run.state === "running" && !hasPicture ? "yes" : "no",
      can_keep: waiting && hasPicture && shot.kept !== true, can_skip: waiting && hasPicture && shot.kept !== false, can_redo: waiting || run.state === "done",
    };
  });
}

/** The Film maker page's composer lists, filled per person: the film styles from the reel catalog and the shots of the newest film (for Change a shot). */
export function fillFilmMakerPage(person: PersonRow, page: Record<string, unknown>): void {
  const bar = (Array.isArray(page.body) ? page.body : []).find((node) => (node as { type?: string })?.type === "prompt_bar") as { chips?: Array<Record<string, unknown>> } | undefined;
  if (!bar?.chips) return;
  const run = pageFilmRun(person);
  const options: Record<string, Array<Record<string, unknown>>> = {
    format: [{ value: "none", label: "Any style" }, ...listReelFormats().map((format) => ({ value: format.id, label: format.title, note: format.summary }))],
    shot: (run?.plan?.shots ?? []).map((shot, index) => ({ value: shot.id, label: `Shot ${index + 1}` })),
  };
  if (!options.shot!.length) options.shot = [{ value: "none", label: "No shots yet" }];
  for (const chip of bar.chips) if (typeof chip.state === "string" && options[chip.state]) chip.options = options[chip.state];
}
