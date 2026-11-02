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

/** Clips in the order the person named them: the first is the working clip, `concat` joins every later file. */
export function joinOps(): EditOp[] {
  return [{ op: "concat" }];
}

export function mixOps(level: MixLevel, startS: number, duck: boolean): EditOp[] {
  const step = MIX_LEVELS.find((item) => item.id === level) ?? MIX_LEVELS[2]!;
  return [{ op: "audio_overlay", input: 1, gain_db: step.gain_db, clip_gain_db: step.clip_gain_db, start_s: startS, duck }];
}
