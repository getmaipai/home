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
import { ceilingOf, type Audience, type Ceiling } from "@/lib/filter/ceiling";

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

/** SEARCH-RATING-03: the engine mode follows the viewer's web ceiling (RULES.md, Content filter and feature access): G strict; PG, PG-13
 * and R moderate (off only at X, so a raised ceiling never makes clean rows Unrated and hides them); X off. For the role defaults
 * (G, PG-13, X) this is `safeSearchDefaultFor`. */
export function safeSearchModeFor(ceiling: Ceiling): SafeSearchLevel {
  return ceiling === 0 ? "strict" : ceiling >= 4 ? "off" : "moderate";
}

/** Resolve the person's stored choice through the capability gate. The spec-declared floor is never weaker than `floor` (the mode the
 * viewer's web ceiling gives; the band's own default when a caller says nothing), even when an administrator stored a lower value. */
export function applySafeSearchLimits(stored: unknown, band: AgeBand, limits: readonly string[], floor: SafeSearchLevel = safeSearchDefaultFor(band)): SafeSearchLevel {
  const requested = stored === "off" || stored === "moderate" || stored === "strict" ? stored : floor;
  const declaresBandFloor = limits.includes(BAND_DEFAULT_LIMIT);
  if (!declaresBandFloor) return band === "adult" && safeSearchStrictness(requested) >= safeSearchStrictness(floor) ? requested : floor;
  return safeSearchStrictness(requested) < safeSearchStrictness(floor) ? floor : requested;
}

/** The level a search runs with for this viewer. `audience` is the viewer as `searchAudienceFor(band, person)` builds it (never a bare
 * pass): `ceilingOf` tightens the person's ceiling to the turn's band, so an unknown speaker or a shared-surface turn gets the child
 * result (chat rule 0). `stored` is the person's own `search.safe_search`; it can only tighten the ceiling's mode. */
export function resolveSafeSearchLevel(stored: unknown, audience: Audience): SafeSearchLevel {
  const band = audience.band;
  const floor = safeSearchModeFor(ceilingOf(audience, "search"));
  const decision = decide({
    who: { personId: "safe-search", role: band, band },
    what: { capabilities: ["search.safe_search"] },
    context: { provenance: "person" },
  });
  return applySafeSearchLimits(stored, band, decision.kind === "allow_with_limits" ? decision.limits : [], floor);
}

export function safeSearchNumericLevel(level: SafeSearchLevel): 0 | 1 | 2 {
  return NUMERIC[level];
}
