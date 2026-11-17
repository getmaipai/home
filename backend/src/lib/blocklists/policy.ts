// MINOR-SEARCH-01e-4: the blocked-site list policy as Home reads it. The rows (id, label, which bands start with a
// list on, which bands cannot turn it off) are declared once in commons (spec/search/blocklists.json) and read here;
// nothing in this repo restates a list id. The pins (source, checksum, size) live in the signed catalog list index,
// never here.
import blocklistsPolicy from "@maipai/spec/search/blocklists.json" with { type: "json" };
import { Blocklists } from "@maipai/spec/gen/ts/blocklists.js";
import type { AgeBand } from "@/lib/ageBand";
import { currentBlockViewer } from "@/lib/blocklists/blockViewer";
import { ceilingFor, ceilingOf, type Ceiling } from "@/lib/filter/ceiling";
import { personFor, searchAudienceFor } from "@/lib/retrieval/minorRowFloor";
import { resolveUnion } from "@/lib/settingsLayers";

export const BLOCKLIST_POLICY: Blocklists = Blocklists.parse(blocklistsPolicy);

/** The settings key that holds a band's checked lists. */
export const BLOCKLIST_KEYS: Record<AgeBand, string> = {
  child: "search.blocklists.child",
  teen: "search.blocklists.teen",
  adult: "search.blocklists.adult",
};


export function blocklistIds(): string[] {
  return BLOCKLIST_POLICY.lists.map((row) => row.id);
}

/** The viewer's web ceiling (SEARCH-RATING-03): the real person's `ceilingOf(searchAudienceFor(band, person), "search")` (which tightens
 * their ceiling to the turn's band, chat rule 0), and the band's role default when no person is in hand. */
export function webCeilingFor(band: AgeBand, personId: string | null | undefined): Ceiling {
  const person = personId ? personFor(personId) : null;
  return person ? ceilingOf(searchAudienceFor(band, person), "search") : ceilingFor(band);
}

/** Lists that cannot be turned off for a viewer: the locked adult-site list for everyone whose web ceiling is below X, and for nobody at X
 * (chat rule 0, RULES.md C3: only an admin's rating override lifts it). With no ceiling given it is the band's role default (child G,
 * teen PG-13: the list; adult X: none), which is what the settings page shows for a role. */
export function lockedListIds(band: AgeBand, ceiling: Ceiling = ceilingFor(band)): string[] {
  if (ceiling >= 4) return [];
  return BLOCKLIST_POLICY.lists.filter((row) => row.locked_for.length > 0).map((row) => row.id);
}

export function defaultListIds(band: AgeBand): string[] {
  return BLOCKLIST_POLICY.lists.filter((row) => row.default_for.includes(band)).map((row) => row.id);
}

/** Every list that counts for one band and, when a person is given (or the ambient block viewer), that
 * person's own overrides: the layers resolve user defaults, then the household's global defaults, then the
 * person's overrides, and the band's locked set is always in (whatever was stored). An unreadable or
 * never-stored choice means the spec's defaults, and an adult default is the empty set. A stored value that
 * is not a list of ids fails to the defaults, never to nothing for a child or teen (rule 0: the protection
 * fails closed). */
export function enabledListIds(band: AgeBand, personId: string | null | undefined = currentBlockViewer()): string[] {
  const known = new Set(blocklistIds());
  const ceiling = webCeilingFor(band, personId);
  const locked = lockedListIds(band, ceiling);
  const liftable = new Set(BLOCKLIST_POLICY.lists.filter((row) => row.locked_for.length > 0).map((row) => row.id));
  try {
    const union = resolveUnion("search.blocklists", { band, personId });
    // At X the locked list is lifted unless a person or the household chose it themself (a stricter choice stays).
    const items = union.items.filter((id) => known.has(id) && !(ceiling >= 4 && liftable.has(id) && union.source[id] === "user-default"));
    return [...new Set([...locked, ...items])];
  } catch {
    return [...new Set([...locked, ...defaultListIds(band).filter((id) => !(ceiling >= 4 && liftable.has(id)))])];
  }
}
