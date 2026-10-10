// KS-01 (data-scratch/design/KNOWLEDGE-SEARCH-DESIGN.md sections 2 and 7,
// BENCH-05): the closed source list per age band. The enumerating tests pin
// the list: a source added to a child's band is a visible change here.
import { describe, expect, test } from "bun:test";
import { BAND_SOURCE_IDS, REFERENCE_SOURCES, readableBooks, sourceById, sourceForBook } from "@/lib/retrieval/referenceSources";

describe("the closed source list per band", () => {
  test("a child's list is exactly the child sets, plain ones first and English Wikipedia last", () => {
    expect(BAND_SOURCE_IDS.child).toEqual(["vikidia", "wikipedia-simple", "wiktionary-simple", "wikivoyage", "world-factbook", "wikipedia-en"]);
  });

  test("a child's list never names an adult-only or teen-and-adult set", () => {
    for (const forbidden of ["medlineplus", "stackexchange", "wikibooks", "wiktionary-en"]) {
      expect(BAND_SOURCE_IDS.child).not.toContain(forbidden);
    }
  });

  test("a teen's list never names MedlinePlus or the child-only Vikidia", () => {
    expect(BAND_SOURCE_IDS.teen).not.toContain("medlineplus");
    expect(BAND_SOURCE_IDS.teen).not.toContain("vikidia");
    expect(BAND_SOURCE_IDS.teen).toContain("stackexchange");
  });

  test("an adult's list is the teen's plus MedlinePlus", () => {
    expect(BAND_SOURCE_IDS.adult).toEqual([...BAND_SOURCE_IDS.teen, "medlineplus"]);
  });

  test("every id in every list is a declared source, with no repeats", () => {
    for (const ids of Object.values(BAND_SOURCE_IDS)) {
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(sourceById(id)).not.toBeNull();
    }
    expect(new Set(REFERENCE_SOURCES.map((s) => s.id)).size).toBe(REFERENCE_SOURCES.length);
  });
});

describe("matching a served book to a source", () => {
  test("a book maps to its source by the longest prefix, and an unlisted book maps to nothing", () => {
    expect(sourceForBook("wikipedia_en_all_mini_2026-09")?.id).toBe("wikipedia-en");
    expect(sourceForBook("wikipedia_en_simple_all_maxi_2026-09")?.id).toBe("wikipedia-simple");
    expect(sourceForBook("wiktionary_en_simple_all_nopic_2026-09")?.id).toBe("wiktionary-simple");
    expect(sourceForBook("wiktionary_en_all_nopic_2026-09")?.id).toBe("wiktionary-en");
    expect(sourceForBook("superuser.com_en_all_2026-08")?.id).toBe("stackexchange");
    expect(sourceForBook("someone_elses_private_notes")).toBeNull();
  });
});

describe("which installed books a band may read", () => {
  const installed = [
    "medlineplus.gov_en_all_2026-09",
    "superuser.com_en_all_2026-08",
    "wikipedia_en_all_mini_2026-09",
    "vikidia_en_all_maxi_2026-09",
    "wikipedia_en_simple_all_maxi_2026-09",
    "some_unlisted_archive_2026",
  ];

  test("a child reads Vikidia, then Simple, then English Wikipedia, and nothing else", () => {
    const { books, excluded } = readableBooks(installed, "child");
    expect(books.map((b) => b.book)).toEqual(["vikidia_en_all_maxi_2026-09", "wikipedia_en_simple_all_maxi_2026-09", "wikipedia_en_all_mini_2026-09"]);
    expect(excluded).toBe(3);
  });

  test("a teen cannot reach MedlinePlus or an unlisted archive, and reads Stack Exchange", () => {
    const names = readableBooks(installed, "teen").books.map((b) => b.book);
    expect(names).not.toContain("medlineplus.gov_en_all_2026-09");
    expect(names).not.toContain("some_unlisted_archive_2026");
    expect(names).toContain("superuser.com_en_all_2026-08");
  });

  test("an adult reaches MedlinePlus but still not an archive the list does not name", () => {
    const names = readableBooks(installed, "adult").books.map((b) => b.book);
    expect(names).toContain("medlineplus.gov_en_all_2026-09");
    expect(names).not.toContain("some_unlisted_archive_2026");
  });
});
