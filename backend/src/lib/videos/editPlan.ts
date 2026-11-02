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

export const JOIN_TRANSITIONS = ["cut", "crossfade"] as const;
export type JoinTransition = (typeof JOIN_TRANSITIONS)[number];
export const MIN_CROSSFADE_S = 0.3;
export const MAX_CROSSFADE_S = 1.0;
export const DEFAULT_CROSSFADE_S = 0.5;
/**
 * Whether the Stack's `media.edit` has a `crossfade` op (2026-11-02: it has not; its ops are trim, concat, mute, frame, audio_overlay, fade, and
 * none of them can lay one clip over another, so a real crossfade cannot be built from them). Home builds the op and the check behind this switch;
 * flip it when the Stack lands the op described at `crossfadeOps`.
 */
export const CROSSFADE_IN_STACK = false;

/** Clips in the order the person named them: the first is the working clip, `concat` joins every later file (a straight cut), `crossfade` blends each seam over `duration_s`. */
export function joinOps(transition: JoinTransition = "cut", duration: number = DEFAULT_CROSSFADE_S): EditOp[] {
  return transition === "crossfade" ? crossfadeOps(duration) : [{ op: "concat" }];
}

/**
 * The Stack op a crossfade join needs, which does not exist yet: `{ op: "crossfade", duration_s, with? }`, run like `concat` (the working clip then
 * the later files, or `with` by index), each seam blending the last `duration_s` of one clip into the first `duration_s` of the next (video `xfade`
 * `fade`, sound `acrossfade`), re-encoded to the first clip's size and rate. `duration_s` is 0.3 to 1.0; every clip must be longer than twice it.
 */
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

export function mixOps(level: MixLevel, startS: number, duck: boolean): EditOp[] {
  const step = MIX_LEVELS.find((item) => item.id === level) ?? MIX_LEVELS[2]!;
  return [{ op: "audio_overlay", input: 1, gain_db: step.gain_db, clip_gain_db: step.clip_gain_db, start_s: startS, duck }];
}
