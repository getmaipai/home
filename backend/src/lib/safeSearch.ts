// SEARCH-SAFE-01 (Jesse's own ruling, 2026-09-24, superseding the age-
// band-only first cut): the safesearch level is a real per-person
// setting (`search.safe_search`, commons spec-vX.Y.Z), not just derived
// from the speaker's band every time - a person can be given, or (an
// adult only) choose, an explicit level that stands until changed. One
// definition of the level names, their strictness order, and each
// band's own default, shared by `settings.ts` (the write-time "never
// loosen your own" check) and `packageHost.ts` (the real SearXNG
// request) so the two can never drift apart.
import type { AgeBand } from "@/lib/ageBand";

export type SafeSearchLevel = "off" | "moderate" | "strict";

const STRICTNESS: Record<SafeSearchLevel, number> = { off: 0, moderate: 1, strict: 2 };
const NUMERIC: Record<SafeSearchLevel, 0 | 1 | 2> = { off: 0, moderate: 1, strict: 2 };

/** child strict, teen moderate, adult off - never an image floor on top
 * (the first cut's own floor is withdrawn by this same ruling: images
 * follow the person's own level, like everything else). */
export function safeSearchDefaultFor(band: AgeBand): SafeSearchLevel {
  return band === "child" ? "strict" : band === "teen" ? "moderate" : "off";
}

export function safeSearchStrictness(level: SafeSearchLevel): number {
  return STRICTNESS[level];
}

/** The stored choice resolved against a band: "default" (or anything
 * not a real choice - a defensive fallback, never reachable through a
 * real write once `validateSelectorValue` guards the key) takes the
 * band's own default; an explicit `off`/`moderate`/`strict` stands as
 * given, whatever the band. */
export function resolveSafeSearchLevel(stored: unknown, band: AgeBand): SafeSearchLevel {
  if (stored === "off" || stored === "moderate" || stored === "strict") return stored;
  return safeSearchDefaultFor(band);
}

export function safeSearchNumericLevel(level: SafeSearchLevel): 0 | 1 | 2 {
  return NUMERIC[level];
}
