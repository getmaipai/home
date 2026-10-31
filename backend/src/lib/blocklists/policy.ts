// MINOR-SEARCH-01e-4: the blocked-site list policy as Home reads it. The rows (id, label, which bands start with a
// list on, which bands cannot turn it off) are declared once in commons (spec/search/blocklists.json) and read here;
// nothing in this repo restates a list id. The pins (source, checksum, size) live in the signed catalog list index,
// never here.
import blocklistsPolicy from "@maipai/spec/search/blocklists.json" with { type: "json" };
import { Blocklists } from "@maipai/spec/gen/ts/blocklists.js";
import type { AgeBand } from "@/lib/ageBand";
import { currentBlockViewer } from "@/lib/blocklists/blockViewer";
import { resolveUnion } from "@/lib/settingsLayers";

export type BlocklistRow = Blocklists["lists"][number];

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

/** Lists a band cannot turn off. */
export function lockedListIds(band: AgeBand): string[] {
  return BLOCKLIST_POLICY.lists.filter((row) => row.locked_for.includes(band)).map((row) => row.id);
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
  try {
    const items = resolveUnion("search.blocklists", { band, personId }).items.filter((id) => known.has(id));
    return [...new Set([...lockedListIds(band), ...items])];
  } catch {
    return [...new Set([...lockedListIds(band), ...defaultListIds(band)])];
  }
}
