/** RATE-INGEST-01: the one stamp-over-ceiling comparison (no database import, so the door can use it). The door's `filterList` and
 * `allowedIds` in stamps.ts both call it; there is no second list filter. */
import { ContentRating, overCeiling } from "@maipai/spec/ratings/ts/contentRating";

/** A missing or unparseable stamp is Unrated, which is over every ceiling below X (C4). */
export function stampAllowed(stamp: unknown, ceiling: 0 | 1 | 2 | 3 | 4, unratedAllowed = false): boolean {
  if (stamp === null || stamp === undefined) return !overCeiling("Unrated", ceiling);
  try {
    // A stored stamp carries its fingerprint beside the spec fields; the spec shape is strict, so compare the spec fields only.
    const { fingerprint: _fingerprint, ...rating } = stamp as Record<string, unknown>;
    const level = ContentRating.parse(rating).level;
    // OVERRIDES-01 (C4, C9): an override that allows unrated covers only a stamp a rater wrote and that says Unrated; never a missing or invalid stamp.
    if (level === "Unrated" && unratedAllowed) return true;
    return !overCeiling(level, ceiling);
  } catch { return !overCeiling("Unrated", ceiling); }
}
