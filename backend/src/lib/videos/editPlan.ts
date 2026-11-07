// VIDEO-CHAT-01 (C3, C4): the steps of a trim, a join and a mix, as the Stack's `media.edit` takes them (stackEdit.ts). Pure functions: no
// file, no Stack. The levels of a mix are named here once; the chat tool and the manifest read them from this list.
import type { EditOp } from "./stackEdit";

/** The balance of a mix, quiet to loud: how loud the laid-over sound is (gain_db) and how far the clip's own sound is turned down (clip_gain_db). */
export const MIX_LEVEL_IDS = ["quiet", "soft", "balanced", "loud", "very_loud"] as const;
export type MixLevel = (typeof MIX_LEVEL_IDS)[number];
export const MIX_LEVELS: ReadonlyArray<{ id: MixLevel; gain_db: number; clip_gain_db: number }> = [
  { id: "quiet", gain_db: -14, clip_gain_db: 0 },
  { id: "soft", gain_db: -8, clip_gain_db: 0 },
  { id: "balanced", gain_db: 0, clip_gain_db: -3 },
  { id: "loud", gain_db: 4, clip_gain_db: -6 },
  { id: "very_loud", gain_db: 8, clip_gain_db: -9 },
];

/** A voice line sits over the clip at a balanced level, a song under it at a soft one, unless the person asks for another. */
export const DEFAULT_VOICE_LEVEL: MixLevel = "balanced";
export const DEFAULT_MUSIC_LEVEL: MixLevel = "soft";

export const MIN_JOIN_CLIPS = 2;
export const MAX_JOIN_CLIPS = 6;

export type TrimCheck = { ok: true; from: number; to: number } | { ok: false; line: string };

/** The cut a trim asks for, checked against the clip's length when it is known. */
export function trimRange(args: { from_s?: number; to_s?: number }, clipSeconds: number | null): TrimCheck {
  const from = args.from_s ?? 0;
  const to = args.to_s ?? clipSeconds;
  if (to === null || to === undefined) return { ok: false, line: "Tell me where the cut ends, in seconds from the start." };
  if (clipSeconds !== null && from >= clipSeconds) return { ok: false, line: `That video is ${clipSeconds} seconds long, so a cut cannot start at ${from}. Pick a time inside it.` };
  if (from < 0 || to <= from) return { ok: false, line: "The cut has to end after it starts. Tell me the start and end in seconds." };
  if (clipSeconds !== null && from === 0 && to >= clipSeconds) return { ok: false, line: `That video is only ${clipSeconds} seconds long, so there is nothing to cut off. Pick a time inside it.` };
  // An end past the clip's last second is the end of the clip.
  return { ok: true, from, to: clipSeconds !== null ? Math.min(to, clipSeconds) : to };
}

export function trimOps(from: number, to: number): EditOp[] {
  return [{ op: "trim", in_s: from, out_s: to }];
}

export const VIDEO_ASPECTS = ["9:16", "1:1", "16:9", "4:5"] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];
export const CAPTION_POSITIONS = ["bottom", "middle", "top"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export type CaptionLine = { from_s: number; to_s: number; text: string };
export type GradeValues = { brightness?: number; contrast?: number; saturation?: number; warmth?: number; grain?: number; vignette?: number };
export const FILM_LOOK_PRESETS = ["70s_color", "noir", "teal_orange", "bleach_bypass", "technicolor", "faded_vintage", "cool_thriller", "night"] as const;
export type FilmLookPreset = (typeof FILM_LOOK_PRESETS)[number];
export const LETTERBOX_RATIOS = ["2.39:1", "2:1", "1.85:1", "1.33:1"] as const;
export type LetterboxRatio = (typeof LETTERBOX_RATIOS)[number];
export const MAX_EDIT_OPS = 12;
export const MAX_EDIT_SECONDS = 600;
export function reframeOps(aspect: VideoAspect, fill: "crop" | "blur" = "crop"): EditOp[] { return [{ op: "reframe", aspect, fill }]; }
export function upscaleOps(): EditOp[] { return [{ op: "upscale", factor: 2 }]; }
export type CutoutBackground = "black" | "white" | "green" | "blur" | "transparent" | `#${string}`;
export function cutoutOps(background: CutoutBackground): EditOp[] { return [{ op: "cutout", background }]; }
export function gradeOps(values: GradeValues): EditOp[] { return [{ op: "grade", ...values }]; }
export function filmLookOps(preset: FilmLookPreset, strength?: number): EditOp[] { return [{ op: "film_look", preset, ...(strength === undefined ? {} : { strength }) }]; }
export function letterboxOps(ratio: LetterboxRatio): EditOp[] { return [{ op: "letterbox", ratio }]; }
export function speedOps(factor: number): EditOp[] { return [{ op: "speed", factor }]; }
export type VideoEffect = "speed_ramp" | "reverse" | "freeze" | "loop" | "fps_boost" | "flip" | "rotate" | "sharpen" | "denoise" | "pip" | "kenburns" | "ripple";
export interface VideoEffectValues { from_factor?: number; to_factor?: number; at_s?: number; over_s?: number; hold_s?: number; times?: number; fps?: 30 | 48 | 60; direction?: "horizontal" | "vertical"; degrees?: 90 | 180 | 270; amount?: number; /** Only for `denoise`: also smooth the blocky squares a heavily compressed clip shows. */ deblock?: boolean; corner?: "top_left" | "top_right" | "bottom_left" | "bottom_right"; size?: number }
/** Most an effect's `amount` may be: 1 for all but `sharpen`, whose range up to 1.5 is Sharpen+ (the Stack accepts 0 to 1.5). */
export function maxEffectAmount(effect: string | undefined): number { return effect === "sharpen" ? 1.5 : 1; }
export function effectOps(effect: VideoEffect, values: VideoEffectValues, input = 1): EditOp[] {
  switch (effect) {
    case "speed_ramp": return [{ op: effect, from_factor: values.from_factor!, to_factor: values.to_factor!, at_s: values.at_s!, over_s: values.over_s! }];
    case "reverse": return [{ op: effect }];
    case "freeze": return [{ op: effect, at_s: values.at_s!, hold_s: values.hold_s! }];
    case "loop": return [{ op: effect, times: values.times! }];
    case "fps_boost": return [{ op: effect, fps: values.fps! }];
    case "flip": return [{ op: effect, direction: values.direction! }];
    case "rotate": return [{ op: effect, degrees: values.degrees! }];
    case "sharpen": case "ripple": return [{ op: effect, amount: values.amount! }];
    case "denoise": return [{ op: effect, amount: values.amount!, ...(values.deblock === true ? { deblock: true } : {}) }];
    case "pip": return [{ op: effect, input, corner: values.corner!, size: values.size!, margin: 0.05 }];
    case "kenburns": return [{ op: effect, zoom_from: values.from_factor!, zoom_to: values.to_factor!, pan: values.direction === "horizontal" ? "right" : values.direction === "vertical" ? "down" : "none" }];
  }
}
export function captionsOps(lines: CaptionLine[], position: CaptionPosition = "bottom"): EditOp[] { return [{ op: "captions", lines, position }]; }

export const TRANSITION_KINDS = ["fade", "dissolve", "speckle", "wipeleft", "wiperight", "wipeup", "wipedown", "slideleft", "slideright", "slideup", "slidedown", "circleopen", "circleclose", "radial", "smoothleft", "smoothright", "fadeblack", "fadewhite", "zoomin", "pixelize"] as const;
export const JOIN_TRANSITIONS = ["cut", "crossfade", ...TRANSITION_KINDS] as const;
export type JoinTransition = (typeof JOIN_TRANSITIONS)[number];
export const MIN_CROSSFADE_S = 0.3;
export const MAX_CROSSFADE_S = 1.0;
export const DEFAULT_CROSSFADE_S = 0.5;
/**
 * Whether the Stack's `media.edit` has a `crossfade` op. It has since Stack a23ac89 (2026-11-02): `{ op: "crossfade", duration_s (0.3 to 1.0), with? }`, run like
 * `concat`, blending each seam (video `xfade`, sound `acrossfade`), up to 6 clips, every clip longer than twice the duration.
 */
export const CROSSFADE_IN_STACK = true;

/** Clips in the order the person named them: the first is the working clip, `concat` joins every later file (a straight cut), `crossfade` blends each seam over `duration_s`. */
export function joinOps(transition: JoinTransition = "cut", duration: number = DEFAULT_CROSSFADE_S): EditOp[] {
  if (transition === "crossfade") return crossfadeOps(duration);
  if ((TRANSITION_KINDS as readonly string[]).includes(transition)) return [{ op: "transition", kind: transition as (typeof TRANSITION_KINDS)[number], duration_s: duration }];
  return [{ op: "concat" }];
}

export function titleCardOp(text: string, subtitle?: string, place: "start" | "end" = "start"): EditOp {
  return { op: "title_card", text, ...(subtitle ? { subtitle } : {}), duration_s: 3, position: "center", background: "black", text_color: "white", fade_in_s: 0.5, fade_out_s: 0.5, place };
}
export function creditsOp(lines: Array<{ role?: string; name: string }>, title?: string): EditOp {
  return { op: "credits", lines, background: "black", text_color: "white", ...(title ? { title } : {}) };
}

/** The shared sequence used by the `film` change and faceless film assembly. */
/** The line under a film title: the first sentence when it is short; a long one is cut at its first comma, dash or colon when that leaves a whole phrase, else dropped (a sentence cut mid-clause, as "...WORKS, FOR", reads as a mistake). */
export function titleSubtitle(summary: string | undefined): string | undefined {
  const first = (summary ?? "").trim().split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, "").trim() ?? "";
  if (!first) return undefined;
  if (first.length <= 64) return first;
  const cut = first.slice(0, 65).search(/[,;:\u2013\u2014-][^,;:\u2013\u2014-]*$/);
  const phrase = cut > 12 ? first.slice(0, cut).trim() : "";
  return phrase || undefined;
}

export function filmOps(input: { title?: string; summary?: string; credits?: Array<{ role?: string; name: string }>; creditsTitle?: string; look?: FilmLookPreset; letterbox?: LetterboxRatio; transition?: JoinTransition; duration?: number; includeJoin?: boolean }): EditOp[] {
  const ops: EditOp[] = input.includeJoin === false ? [] : input.transition === undefined ? [] : joinOps(input.transition, input.duration ?? DEFAULT_CROSSFADE_S);
  if (input.look) ops.push(...filmLookOps(input.look));
  if (input.letterbox) ops.push(...letterboxOps(input.letterbox));
  if (input.title) {
    const subtitle = titleSubtitle(input.summary);
    ops.push(titleCardOp(input.title, subtitle, "start"));
  }
  if (input.credits) ops.push(creditsOp(input.credits, input.creditsTitle));
  return ops;
}

/** The Stack's `crossfade` op: the working clip then the later files, each seam blending the last `duration_s` of one clip into the first `duration_s` of the next. */
export function crossfadeOps(duration: number): EditOp[] {
  return [{ op: "crossfade", duration_s: Math.round(Math.min(MAX_CROSSFADE_S, Math.max(MIN_CROSSFADE_S, duration)) * 100) / 100 }];
}

/** The plain line when a clip is too short to blend into the next one (each seam eats the duration from both clips), or null. Unknown lengths pass. */
export function crossfadeProblem(seconds: ReadonlyArray<number | null>, duration: number): string | null {
  const short = seconds.some((length) => length !== null && length <= 2 * duration);
  return short ? `One of those videos is too short for a ${duration} second crossfade. Use a shorter crossfade, or join them with a straight cut.` : null;
}

/** The last frame of a clip: a moment just before the end, since the very end holds no picture in many files. An unknown length reads the request's. */
export function lastFrameAt(seconds: number | null): number {
  if (seconds === null || seconds <= 0.2) return 0;
  return Math.round((seconds - 0.1) * 1000) / 1000;
}

export function frameOps(atS: number): EditOp[] {
  return [{ op: "frame", at_s: atS }];
}

/** Where a laid-over sound sits and how it ends, beyond the five balances (the Studio's per-piece fades and cut). */
export interface OverlayExtras { gain_db?: number; clip_gain_db?: number; fade_in_s?: number; fade_out_s?: number; end_s?: number }

export function mixOps(level: MixLevel, startS: number, duck: boolean, extras: OverlayExtras = {}, input = 1): EditOp[] {
  const step = MIX_LEVELS.find((item) => item.id === level) ?? MIX_LEVELS[2]!;
  return [overlayOp(input, { gain_db: extras.gain_db ?? step.gain_db, clip_gain_db: extras.clip_gain_db ?? step.clip_gain_db, ...extras }, startS, duck)];
}

/** One `audio_overlay` step: the file at list position `input` over the working clip from `startS`. Fades and `end_s` are left out when they are zero or absent. */
export function overlayOp(input: number, levels: OverlayExtras & { gain_db: number; clip_gain_db: number }, startS: number, duck: boolean): EditOp {
  const op: Extract<EditOp, { op: "audio_overlay" }> = { op: "audio_overlay", input, gain_db: levels.gain_db, clip_gain_db: levels.clip_gain_db, start_s: startS, duck };
  if (levels.fade_in_s && levels.fade_in_s > 0) op.fade_in_s = levels.fade_in_s;
  if (levels.fade_out_s && levels.fade_out_s > 0) op.fade_out_s = levels.fade_out_s;
  if (levels.end_s !== undefined) op.end_s = levels.end_s;
  return op;
}

export const GAIN_DB_MIN = -60;
export const GAIN_DB_MAX = 24;

/** The level of the clip's own sound, or nothing when it does not change (a gain of less than a hundredth of a dB). */
export function gainOps(db: number): EditOp[] {
  const clean = Math.round(Math.min(GAIN_DB_MAX, Math.max(GAIN_DB_MIN, db)) * 100) / 100;
  return Math.abs(clean) < 0.01 ? [] : [{ op: "gain", db: clean }];
}

/** A fade of picture and sound at the start and end of the working clip, or nothing when both are zero. */
export function fadeOps(inS: number, outS: number): EditOp[] {
  return inS > 0 || outS > 0 ? [{ op: "fade", in_s: Math.max(0, inS), out_s: Math.max(0, outS) }] : [];
}
