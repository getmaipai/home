// MEDIA-PARITY-02 (Videos): the Library's sort, remembered per person in the registry setting `videos.library_sort` (recents | az). The page's sort control
// writes its choice into the library request (`sort`); a choice is saved when it differs from what is saved, and a request with no choice uses the saved one.
import type { PersonRow } from "@/types";
import { getPersonSettingValue, setValue } from "@/lib/settings";

export const LIBRARY_SORT_KEY = "videos.library_sort";
export type LibrarySort = "recents" | "a-z";

const parse = (value: unknown): LibrarySort | null => (value === "az" || value === "a-z" ? "a-z" : value === "recents" ? "recents" : null);

export function savedLibrarySort(person: PersonRow): LibrarySort {
  return parse(getPersonSettingValue(person, LIBRARY_SORT_KEY)) ?? "recents";
}

/** The sort this request uses, saving a new explicit choice. A word that is neither sort is ignored. */
export function librarySortFor(person: PersonRow, asked: unknown): LibrarySort {
  const saved = savedLibrarySort(person);
  const chosen = parse(asked);
  if (!chosen) return saved;
  if (chosen !== saved) {
    try { setValue(person, `person:${person.id}`, LIBRARY_SORT_KEY, chosen === "a-z" ? "az" : "recents"); } catch { /* the sort still applies for this request */ }
  }
  return chosen;
}
