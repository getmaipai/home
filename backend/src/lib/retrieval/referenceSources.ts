// KS-01 (data-scratch/design/KNOWLEDGE-SEARCH-DESIGN.md sections 2 and 7):
// the closed list of reference sources, per age band. Tier K only ever
// reads a book that appears here for the asker's band; an installed ZIM
// the list does not name is unreachable for everyone (a closed list, not
// a block list), and a child's list never names an adult-only set. The
// list is code, declared once; the enumerating test
// (tests/retrievalReferenceSources.test.ts) pins it, so a source added
// here for a child is a visible test change.
//
// A book is matched by the prefix of its served id (the ZIM file stem,
// which is what kiwix-serve puts in /content/<id>). That is matching a
// file name the host installed, not reading anything a person wrote.
import type { AgeBand } from "@/lib/ageBand";

export type ReferenceLicence = "cc-by-sa-4.0" | "public-domain";

export interface ReferenceSource {
  /** Stable id of the source (not of a book file). */
  id: string;
  /** Plain label shown in the sources footer and the model's data line. */
  label: string;
  /** Served-book id prefixes that belong to this source. */
  bookPrefixes: readonly string[];
  licence: ReferenceLicence;
}

/** Every source tier K can read, in no particular order. */
export const REFERENCE_SOURCES: readonly ReferenceSource[] = [
  { id: "vikidia", label: "Vikidia", bookPrefixes: ["vikidia_"], licence: "cc-by-sa-4.0" },
  { id: "wikipedia-simple", label: "Simple English Wikipedia", bookPrefixes: ["wikipedia_en_simple"], licence: "cc-by-sa-4.0" },
  { id: "wikipedia-en", label: "Wikipedia", bookPrefixes: ["wikipedia_en_all", "wikipedia_en_top"], licence: "cc-by-sa-4.0" },
  { id: "wiktionary-simple", label: "Simple English Wiktionary", bookPrefixes: ["wiktionary_en_simple"], licence: "cc-by-sa-4.0" },
  { id: "wiktionary-en", label: "Wiktionary", bookPrefixes: ["wiktionary_en_all"], licence: "cc-by-sa-4.0" },
  { id: "wikivoyage", label: "Wikivoyage", bookPrefixes: ["wikivoyage_en"], licence: "cc-by-sa-4.0" },
  { id: "wikibooks", label: "Wikibooks", bookPrefixes: ["wikibooks_en"], licence: "cc-by-sa-4.0" },
  // UNVERIFIED: the Kiwix catalogue's exact book name for the Factbook and
  // for MedlinePlus; both prefixes are read from the publisher's listing
  // when the library manager installs them (KS-BENCH-05 re-checks).
  { id: "world-factbook", label: "CIA World Factbook", bookPrefixes: ["zimgit-the-world-factbook", "world-factbook", "worldfactbook"], licence: "public-domain" },
  { id: "medlineplus", label: "MedlinePlus", bookPrefixes: ["medlineplus"], licence: "public-domain" },
  { id: "stackexchange", label: "Stack Exchange", bookPrefixes: ["cooking.stackexchange.com", "diy.stackexchange.com", "gardening.stackexchange.com", "askubuntu.com", "superuser.com", "stackoverflow.com"], licence: "cc-by-sa-4.0" },
];

/** The closed list per band, in reading order (first is read first). The
 * child list is Vikidia, Simple English Wikipedia and the plain sets
 * first; English Wikipedia is last and its text passes the minor's floor
 * like every other source's. No Stack Exchange and no MedlinePlus for a
 * child; no MedlinePlus for a teen (the 2026-09-24 default: medical sets
 * are adult only). */
export const BAND_SOURCE_IDS: Readonly<Record<AgeBand, readonly string[]>> = {
  child: ["vikidia", "wikipedia-simple", "wiktionary-simple", "wikivoyage", "world-factbook", "wikipedia-en"],
  teen: ["wikipedia-en", "wikipedia-simple", "wiktionary-en", "wiktionary-simple", "wikivoyage", "world-factbook", "wikibooks", "stackexchange"],
  adult: ["wikipedia-en", "wikipedia-simple", "wiktionary-en", "wiktionary-simple", "wikivoyage", "world-factbook", "wikibooks", "stackexchange", "medlineplus"],
};

const SOURCE_BY_ID = new Map(REFERENCE_SOURCES.map((s) => [s.id, s]));

export function sourceById(id: string): ReferenceSource | null {
  return SOURCE_BY_ID.get(id) ?? null;
}

/** The source a served book belongs to, or null when the list does not
 * name it. The longest matching prefix wins, so a more specific prefix
 * is never swallowed by a shorter one. */
export function sourceForBook(bookId: string): ReferenceSource | null {
  let best: { source: ReferenceSource; len: number } | null = null;
  for (const source of REFERENCE_SOURCES) {
    for (const prefix of source.bookPrefixes) {
      if (bookId.startsWith(prefix) && (!best || prefix.length > best.len)) best = { source, len: prefix.length };
    }
  }
  return best?.source ?? null;
}

export interface ReadableBook {
  book: string;
  source: ReferenceSource;
}

/** The one place a band's closed list meets the installed books: the
 * installed books this band may read, in the band's reading order. A book
 * the band's list does not name, or that no source names, is absent from
 * the result (so no request to it is ever made). `excluded` counts the
 * installed books left out, for the counter (a number, never an id). */
export function readableBooks(installed: readonly string[], band: AgeBand): { books: ReadableBook[]; excluded: number } {
  const allowed = BAND_SOURCE_IDS[band];
  const books: ReadableBook[] = [];
  for (const id of allowed) {
    const source = SOURCE_BY_ID.get(id);
    if (!source) continue;
    for (const book of [...installed].sort()) {
      if (sourceForBook(book)?.id === id) books.push({ book, source });
    }
  }
  return { books, excluded: installed.length - books.length };
}
