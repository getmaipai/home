// SIGNAL-02 (docs/BACKLOG.md): resolves a spoken place name ("Tokyo",
// "Seattle") to a real IANA zone through city-timezones (MIT, zero
// runtime dependencies, offline static data - no network call, no host
// access, the same "compute step" posture spec's own compute.ts already
// takes for math). Backs almanac-time's own "what time is it in *"
// wildcard: manifestLint.ts's COMPUTED_WILDCARD_RESOLVERS reads this to
// decide whether the pattern fires at all (nodes/commands.ts), and
// almanac-time's own handler.ts answers with the resolved zone once it
// does. The handler runs as a separate Deno MCP subprocess (every
// bundled package's own recipe/handler runtime), so it cannot import
// this Bun-side file directly - it re-implements the identical
// city-timezones lookup under its own `npm:city-timezones@1.3.4`
// specifier instead (handler.ts's own comment cross-references this
// file); this is the one, deliberate exception the two-runtime split
// forces, not a second, divergent definition of the resolution rule
// itself (highest-population match wins on an ambiguous name, both
// sides, kept identical on purpose).
import { lookupViaCity, findFromCityStateProvince } from "city-timezones";

/** Null for a place the library has no match for at all - the caller's
 * own fixed line ("I don't know that place's time zone") is what a
 * household actually hears then, never a search. A name that matches
 * more than one real city (two "Springfield"s, a "Seattle" that isn't
 * the one meant) resolves to the most populous match - the same
 * disambiguation heuristic this exact class of city-name lookup
 * conventionally uses, since nothing else in a bare "what time is it
 * in Seattle" narrows it further. */
export function resolveZone(place: string): string | null {
  const trimmed = place.trim();
  if (!trimmed) return null;
  const matches = lookupViaCity(trimmed).length > 0 ? lookupViaCity(trimmed) : findFromCityStateProvince(trimmed);
  if (matches.length === 0) return null;
  const best = matches.reduce((a, b) => (b.pop > a.pop ? b : a));
  return best.timezone || null;
}
