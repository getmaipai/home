// MINOR-SEARCH-01e-4: the blocked-site list policy as Home reads it. The rows (id, label, which bands start with a
// list on, which bands cannot turn it off) are declared once in commons (spec/search/blocklists.json) and read here;
// nothing in this repo restates a list id. The pins (source, checksum, size) live in the signed catalog list index,
// never here.
import blocklistsPolicy from "@maipai/spec/search/blocklists.json" with { type: "json" };
import { Blocklists } from "@maipai/spec/gen/ts/blocklists.js";
import type { AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";

export type BlocklistRow = Blocklists["lists"][number];

export const BLOCKLIST_POLICY: Blocklists = Blocklists.parse(blocklistsPolicy);

/** The settings key that holds a band's checked lists. */
export const BLOCKLIST_KEYS: Record<AgeBand, string> = {
  child: "search.blocklists.child",
  teen: "search.blocklists.teen",
  adult: "search.blocklists.adult",
};

export function blocklistRow(id: string): BlocklistRow | undefined {
  return BLOCKLIST_POLICY.lists.find((row) => row.id === id);
}

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

/** Every list that counts for one band: the locked set (always, whatever was stored) plus the stored choice,
 * with unknown ids dropped. An unreadable or never-stored choice means the spec's defaults, and an adult
 * default is the empty set. A stored value that is not a list of ids fails to the defaults, never to nothing
 * for a child or teen (rule 0: the protection fails closed). */
export function enabledListIds(band: AgeBand): string[] {
  const known = new Set(blocklistIds());
  let chosen: string[];
  try {
    const stored = getHouseholdSettingValue(BLOCKLIST_KEYS[band]);
    chosen = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && known.has(id)) : defaultListIds(band);
  } catch {
    chosen = defaultListIds(band);
  }
  return [...new Set([...lockedListIds(band), ...chosen])];
}
