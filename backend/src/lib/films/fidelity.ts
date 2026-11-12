// FILM-REAL-05: how far a finished clip drifts from the picture it started on. Works for any film (cars, turtles, a box of cookies): every shot has a
// first-frame picture, and when that picture is a supplied photo the number is also how far the clip is from the person's photo. Measure only for now;
// the limit that turns a number into a retry is set from measured numbers, not guessed.
import { fingerprint, hashDistance } from "@/lib/imageSimilarity/fingerprint";
import { extractKeyframes } from "@/lib/pictures/keyframes";

export interface ClipDrift { first: number; middle: number; last: number }

/** Perceptual-hash distance (0 = same picture, 13 and up = unrelated) of a clip's first, middle and last frames to its starting picture; null when the frames cannot be read. */
export async function measureClipDrift(still: Uint8Array, clip: Uint8Array, seconds: number | null): Promise<ClipDrift | null> {
  try {
    const frames = await extractKeyframes(clip, seconds);
    if (!frames || frames.length < 2) return null;
    const base = await fingerprint(still);
    const distances = await Promise.all(frames.map(async (frame) => hashDistance(base, await fingerprint(frame))));
    return { first: distances[0]!, middle: distances[Math.floor(distances.length / 2)]!, last: distances[distances.length - 1]! };
  } catch { return null; }
}
