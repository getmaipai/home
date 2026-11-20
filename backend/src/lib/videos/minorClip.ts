// VF-MINOR-RECIPE-01 (Home half, SHADOW ONLY; design record docs/design/video-door-remaining-moves-2026-11-20.md, B2): what Home would send the Stack's generic door for a young person's
// plain clip: audience `minor`, a rating level from the person's own ceiling (G for a child by default, PG-13 for a teen; an admin may move a ceiling, so it is never the age), the person's
// own words as the description and nothing else about wording. The Stack's rating-keyed recipe holds the cartoon look and every safety term (so a caller cannot ask for less), refuses any
// loosening key, and the clip's part must be on the minor list with its speech checked. NOTHING CALLS THIS AT RUN TIME: a child's clip is still made on the old door with Home's own wording
// (forceCartoon, CHILD_NEGATIVE_PROMPT); the Home switch waits for a high-effort review of both diffs, the full gate and the architect's ruling on the actual diff. The shadow test compares
// this request against what Home sends today for a fixed set of 40 requests.
import type { StackMakeClipRequest } from "@/lib/stack/makeShape";
import { minorClipRatings } from "./stack";

/** The keys a minor's clip may carry on the Stack (its allow-list, makePlan.ts): mirrored here so a test fails if Home ever builds a key the Stack would refuse. */
export const MINOR_CLIP_KEYS: ReadonlySet<string> = new Set(["job", "audience", "rating", "description", "shape", "level", "seconds", "seed", "part", "loop"]);
/** The longest idea the Stack takes from a minor (characters); a longer one stays on the old door, never trimmed. */
export const MINOR_DESCRIPTION_MAX = 400;
export type MinorRating = "G" | "PG-13";

/** The rating a ceiling (0 G, 1 PG, 2 PG-13, 3 R, 4 X) is sent as, or null when the person is not held below R for this kind of content (an adult: the adult door). */
export function minorRatingOf(ceiling: 0 | 1 | 2 | 3 | 4): MinorRating | null { return ceiling === 0 ? "G" : ceiling <= 2 ? "PG-13" : null; }

export interface MinorClipInput {
  /** The person's own words, before any wording of Home's. */
  words: string;
  size?: string;
  seconds?: number;
  seed?: number;
  ceiling: 0 | 1 | 2 | 3 | 4;
  /** Anything else the old door would carry; any of these keeps the clip on the old door (a loosening or unsupported field for a minor). */
  extras?: { image?: unknown; end_image?: unknown; negative_prompt?: unknown; loras?: unknown; model?: unknown; source_video?: unknown; tier?: unknown };
}

export function minorClipRequestFor(input: MinorClipInput): StackMakeClipRequest | null {
  const rating = minorRatingOf(input.ceiling);
  if (!rating) return null;
  if (Object.values(input.extras ?? {}).some((value) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0))) return null;
  const words = input.words.trim();
  if (!words || words.length > MINOR_DESCRIPTION_MAX) return null;
  const size = /^(\d+)x(\d+)$/.exec(input.size ?? "");
  if (!size || input.seconds === undefined || input.seconds <= 0) return null;
  const width = Number(size[1]), height = Number(size[2]);
  const shape = width === height ? "square" : width > height ? "landscape" : "portrait";
  return { job: "clip", audience: "minor", rating, description: words, shape, level: "standard", seconds: input.seconds, ...(input.seed !== undefined ? { seed: input.seed } : {}) } as unknown as StackMakeClipRequest;
}

/** Whether the Stack would take it: it advertises the rating on its minor list (no part does today, until the speech check ships). */
export async function minorDoorWouldTake(rating: MinorRating): Promise<boolean> { return (await minorClipRatings())?.includes(rating) === true; }
