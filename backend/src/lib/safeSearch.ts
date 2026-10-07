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
import { decide } from "@/lib/gate/decide";

export type SafeSearchLevel = "off" | "moderate" | "strict";

const STRICTNESS: Record<SafeSearchLevel, number> = { off: 0, moderate: 1, strict: 2 };
const NUMERIC: Record<SafeSearchLevel, 0 | 1 | 2> = { off: 0, moderate: 1, strict: 2 };
const BAND_DEFAULT_LIMIT = "safe_search:at_least_band_default";

/** child strict, teen moderate, adult off - never an image floor on top
 * (the first cut's own floor is withdrawn by this same ruling: images
 * follow the person's own level, like everything else). */
export function safeSearchDefaultFor(band: AgeBand): SafeSearchLevel {
  return band === "child" ? "strict" : band === "teen" ? "moderate" : "off";
}

export function safeSearchStrictness(level: SafeSearchLevel): number {
  return STRICTNESS[level];
}

/** Resolve the person's stored choice through the capability gate. The
 * spec-declared floor is never weaker than the band's own default, even
 * when an administrator stored a lower value for a child or teen. */
export function applySafeSearchLimits(stored: unknown, band: AgeBand, limits: readonly string[]): SafeSearchLevel {
  const requested = stored === "off" || stored === "moderate" || stored === "strict" ? stored : safeSearchDefaultFor(band);
  const declaresBandFloor = limits.includes(BAND_DEFAULT_LIMIT);
  if (!declaresBandFloor) return band === "adult" ? requested : safeSearchDefaultFor(band);
  const bandFloor = safeSearchDefaultFor(band);
  return safeSearchStrictness(requested) < safeSearchStrictness(bandFloor) ? bandFloor : requested;
}

export function resolveSafeSearchLevel(stored: unknown, band: AgeBand): SafeSearchLevel {
  const decision = decide({
    who: { personId: "safe-search", role: band, band },
    what: { capabilities: ["search.safe_search"] },
    context: { provenance: "person" },
  });
  return applySafeSearchLimits(stored, band, decision.kind === "allow_with_limits" ? decision.limits : []);
}

export function safeSearchNumericLevel(level: SafeSearchLevel): 0 | 1 | 2 {
  return NUMERIC[level];
}
