// VIDEO-STUDIO-07: the plan the Studio page hands Home on Export, and what it becomes. `TrackStudio` (commons) keeps the edit in the page and posts one JSON
// plan `{ version, film_s, video, voice, music }`; Home never trusts it. `studioPlanSchema` re-checks every number and id, and `compileStudioPlan` turns it
// into the Stack's `media.edit` steps with the ONE set of step builders the chat tool uses (editPlan.ts: trimOps, joinOps, mixOps, gainOps, fadeOps).
// Pure functions: no file, no Stack, no person. studioExport.ts reads the files, applies the gate and runs the stages this file lists.
import { z } from "zod";
import { DEFAULT_CROSSFADE_S, MAX_CROSSFADE_S, MAX_JOIN_CLIPS, MIN_CROSSFADE_S, MIN_JOIN_CLIPS, crossfadeOps, fadeOps, gainOps, joinOps, overlayOp, trimOps } from "./editPlan";
import type { EditOp } from "./stackEdit";

/** The limits the page draws (its `limits`), and the ones Home enforces whatever the page says. */
export const STUDIO_VIDEO_PIECES = MAX_JOIN_CLIPS;
export const STUDIO_AUDIO_PIECES = 2;
export const STUDIO_FILM_S = 60;
/** The shortest a piece may be (the Element's own floor). */
export const STUDIO_MIN_PIECE_S = 0.2;

const seconds = (min: number, max: number) => z.number().finite().min(min).max(max);
const ref = z.string().trim().min(1).max(160);
const level = seconds(-24, 12);

const videoPiece = z.object({ ref, in_s: seconds(0, 600), out_s: seconds(0, 600), level_db: level, fade_in_s: seconds(0, 5), fade_out_s: seconds(0, 5) });
const lanePiece = videoPiece.extend({ start_s: seconds(0, 600), duck: z.boolean() });
const audioLane = z.object({ level_db: level, muted: z.boolean(), pieces: z.array(lanePiece).max(STUDIO_AUDIO_PIECES) });

export const studioPlanSchema = z.object({
  version: z.literal(1),
  film_s: seconds(0, 600),
  video: z.object({
    level_db: level,
    muted: z.boolean(),
    pieces: z.array(videoPiece).min(1).max(STUDIO_VIDEO_PIECES),
    transitions: z.array(z.object({ kind: z.enum(["cut", "crossfade"]), seconds: seconds(0, MAX_CROSSFADE_S) })).max(STUDIO_VIDEO_PIECES - 1),
  }),
  voice: audioLane,
  music: audioLane,
});
export type StudioPlan = z.infer<typeof studioPlanSchema>;

export const STUDIO_PLAN_LINE = "That edit could not be read. Reload the Studio and try again.";
export const STUDIO_TOO_LONG_LINE = `A film can be at most ${STUDIO_FILM_S} seconds. Cut something out and export again.`;
export const STUDIO_NOTHING_LINE = "Nothing has changed yet. Make an edit, then export.";

/** What the files say about each source, read by studioExport.ts: seconds of a clip, a voice line or a song (null when unknown). */
export interface StudioSources { video: Array<number | null>; voice: Array<number | null>; music: Array<number | null> }

/** One video piece prepared on its own: its steps (none when the whole clip is used as it is) and its length after them. */
export interface CompiledPiece { index: number; ops: EditOp[]; seconds: number }
/** One run of seams joined in one Stack step: the next `count` pieces onto the film so far, by a cut or a crossfade of `seconds`. */
export interface CompiledJoin { transition: "cut" | "crossfade"; seconds: number; count: number; ops: EditOp[] }
/** A voice line or a song laid over the film. `trim` (the piece starts inside its file) is cut out first; `op.input` is 1 plus its place among the overlays. */
export interface CompiledOverlay { lane: "voice" | "music"; index: number; trim: EditOp[]; op: EditOp }
export interface CompiledStudio { pieces: CompiledPiece[]; joins: CompiledJoin[]; overlays: CompiledOverlay[]; filmSeconds: number; changed: boolean }

export type CompileResult = { ok: true; value: CompiledStudio } | { ok: false; line: string; code: string };

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const refuse = (code: string, line: string): CompileResult => ({ ok: false, code, line });

/** Fades that cannot be longer than the piece together: scaled down to fit, never refused. */
function fitFades(fadeIn: number, fadeOut: number, length: number): [number, number] {
  const total = fadeIn + fadeOut;
  if (total <= length || total <= 0) return [fadeIn, fadeOut];
  const scale = length / total;
  return [round(fadeIn * scale, 2), round(fadeOut * scale, 2)];
}

/**
 * The plan as Stack steps. `sources` are the lengths the files really have: a cut past a source's end is refused, a crossfade between pieces that are too
 * short is refused with one plain line, a film over a minute is refused, and a voice or song that starts after the film ends is refused. `changed` is false
 * when the plan is the one clip, whole, with nothing laid over it (there is nothing to export).
 */
export function compileStudioPlan(plan: StudioPlan, sources: StudioSources): CompileResult {
  const { video } = plan;
  const lengths: number[] = [];
  const pieces: CompiledPiece[] = [];
  for (const [index, piece] of video.pieces.entries()) {
    const source = sources.video[index] ?? null;
    if (piece.out_s <= piece.in_s + STUDIO_MIN_PIECE_S - 1e-6) return refuse("bad_cut", "A piece has to be at least a fifth of a second long. Make it longer or delete it.");
    if (source !== null && piece.in_s >= source) return refuse("bad_cut", `A piece starts after its clip ends (the clip is ${round(source, 1)} seconds long). Move its start earlier.`);
    const out = source !== null ? Math.min(piece.out_s, source) : piece.out_s;
    const length = round(out - piece.in_s);
    const ops: EditOp[] = [];
    const whole = piece.in_s <= 0.01 && (source === null ? false : out >= source - 0.05);
    if (!whole) ops.push(...trimOps(round(piece.in_s), round(out)));
    // Mute drops the clip's own sound; otherwise the lane's level and the piece's level add up.
    if (video.muted) ops.push({ op: "mute" });
    else ops.push(...gainOps(video.level_db + piece.level_db));
    const [fadeIn, fadeOut] = fitFades(piece.fade_in_s, piece.fade_out_s, length);
    ops.push(...fadeOps(fadeIn, fadeOut));
    lengths.push(length);
    pieces.push({ index, ops, seconds: length });
  }

  // The seams: one transition each, written by the page; a missing one is a cut. Runs of the same transition are one Stack step.
  const seams = video.pieces.slice(1).map((_, i) => {
    const seam = video.transitions[i];
    if (!seam || seam.kind === "cut" || seam.seconds <= 0) return { kind: "cut" as const, seconds: 0 };
    if (seam.seconds < MIN_CROSSFADE_S - 1e-6 || seam.seconds > MAX_CROSSFADE_S + 1e-6) return null;
    return { kind: "crossfade" as const, seconds: round(clamp(seam.seconds, MIN_CROSSFADE_S, MAX_CROSSFADE_S), 2) };
  });
  if (seams.some((s) => s === null)) return refuse("bad_crossfade", `A crossfade is between ${MIN_CROSSFADE_S} and ${MAX_CROSSFADE_S} seconds. Pick a length in that range.`);
  const joins: CompiledJoin[] = [];
  let blend = 0;
  for (const [i, seam] of (seams as Array<{ kind: "cut" | "crossfade"; seconds: number }>).entries()) {
    if (seam.kind === "crossfade") {
      blend += seam.seconds;
      // The Stack needs each clip on both sides of a seam to be longer than twice the blend.
      for (const side of [lengths[i]!, lengths[i + 1]!]) if (side <= 2 * seam.seconds) return refuse("crossfade_too_short", `A piece is too short for a ${seam.seconds} second crossfade. Use a shorter crossfade, or a cut between those pieces.`);
    }
    const last = joins[joins.length - 1];
    const limit = seam.kind === "crossfade" ? STUDIO_VIDEO_PIECES - 1 : 23;
    if (last && last.transition === seam.kind && last.seconds === seam.seconds && last.count < limit) { last.count += 1; continue; }
    joins.push({ transition: seam.kind, seconds: seam.seconds, count: 1, ops: seam.kind === "crossfade" ? crossfadeOps(seam.seconds || DEFAULT_CROSSFADE_S) : joinOps("cut") });
  }
  const filmSeconds = round(lengths.reduce((sum, n) => sum + n, 0) - blend, 2);
  if (filmSeconds > STUDIO_FILM_S + 1e-6) return refuse("too_long", STUDIO_TOO_LONG_LINE);

  // What is laid over the film: songs first, then voice lines, so a line can lower the song under it (the Stack ducks the sound so far under an overlay).
  const overlays: CompiledOverlay[] = [];
  const songDucks = plan.music.pieces.some((p) => p.duck && !plan.music.muted);
  for (const lane of ["music", "voice"] as const) {
    const laneData = plan[lane];
    if (laneData.muted) continue;
    for (const [index, piece] of laneData.pieces.entries()) {
      const source = sources[lane][index] ?? null;
      if (piece.out_s <= piece.in_s + STUDIO_MIN_PIECE_S - 1e-6) return refuse("bad_cut", "A voice or song piece has to be at least a fifth of a second long. Make it longer or delete it.");
      if (source !== null && piece.in_s >= source) return refuse("bad_cut", "A voice or song piece starts after its sound ends. Move its start earlier.");
      const start = round(piece.start_s, 2);
      // A piece that starts at or after the film's end has nothing to sit on.
      if (start >= filmSeconds - 0.1) return refuse("start_past_end", "A voice or song starts after the film ends. Move it earlier on the timeline.");
      const out = source !== null ? Math.min(piece.out_s, source) : piece.out_s;
      const length = round(out - piece.in_s, 2);
      // It ends where the piece ends, or where the film does (a little before, so a rounding never puts the end past the last frame).
      const filmEnd = round(filmSeconds - 0.1, 2);
      const naturalEnd = round(start + length, 2);
      const end = Math.min(naturalEnd, filmEnd);
      const trimmedEnd = source !== null ? out < source - 0.05 : true;
      const onScreen = round(end - start, 2);
      const [fadeIn, fadeOut] = fitFades(piece.fade_in_s, piece.fade_out_s, onScreen);
      const input = 1 + overlays.length;
      const op = overlayOp(input, { gain_db: clamp(round(laneData.level_db + piece.level_db, 2), -40, 20), clip_gain_db: 0, fade_in_s: fadeIn, fade_out_s: fadeOut, ...(trimmedEnd || end < naturalEnd ? { end_s: end } : {}) }, start, lane === "voice" ? piece.duck || songDucks : false);
      const trim = piece.in_s > 0.01 ? trimOps(round(piece.in_s), round(out)) : [];
      overlays.push({ lane, index, trim, op });
    }
  }

  const changed = pieces.some((p) => p.ops.length > 0) || joins.length > 0 || overlays.length > 0 || video.pieces.length > 1;
  return { ok: true, value: { pieces, joins, overlays, filmSeconds, changed } };
}

/** The pieces of a plan that name a clip, a voice line or a song, in the order `StudioSources` lists them. */
export function planRefs(plan: StudioPlan): { video: string[]; voice: string[]; music: string[] } {
  return { video: plan.video.pieces.map((p) => p.ref), voice: plan.voice.pieces.map((p) => p.ref), music: plan.music.pieces.map((p) => p.ref) };
}

export { MIN_JOIN_CLIPS };
