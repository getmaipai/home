import { describe, expect, test } from "bun:test";
import { rankGroups, type SearchGroup } from "@/lib/search/providers";

const group = (kind: string, ...titles: string[]): SearchGroup => ({
  kind,
  heading: kind,
  results: titles.map((title, i) => ({ kind, id: `${kind}-${i}`, title, href: `/${kind}/${i}` })),
});

const kinds = (groups: SearchGroup[]) => groups.map((g) => g.kind);

describe("rankGroups: the person's own content comes first, Wikipedia last", () => {
  test("an exact Wikipedia title does not outrank the person's chats and files", () => {
    const ranked = rankGroups([group("reference", "Export"), group("conversation", "Export report"), group("file", "export-2026.csv")], "export");
    expect(kinds(ranked)).toEqual(["conversation", "file", "reference"]);
  });

  test("reference stays last even when it is the only group with a title match", () => {
    const ranked = rankGroups([group("reference", "Export"), group("conversation", "Quarterly plan"), group("setting", "Export data")], "export");
    expect(kinds(ranked).at(-1)).toBe("reference");
  });

  test("a reference-only result list is unchanged", () => {
    expect(kinds(rankGroups([group("reference", "Export")], "export"))).toEqual(["reference"]);
  });

  test("when the best match scores tie, own content (chat, file, media, memory) comes before the rest", () => {
    const ranked = rankGroups([group("app", "Export"), group("setting", "Export"), group("memory", "Export"), group("media", "Export")], "export");
    expect(kinds(ranked).slice(0, 2).sort()).toEqual(["media", "memory"]);
  });

  test("a clearly better match in another group still wins within the non-reference groups", () => {
    const ranked = rankGroups([group("conversation", "About my export"), group("setting", "Export")], "export");
    expect(kinds(ranked)).toEqual(["setting", "conversation"]);
  });

  test("results inside each group keep their score order", () => {
    const ranked = rankGroups([group("conversation", "My big export notes", "Export")], "export");
    expect(ranked[0]!.results.map((r) => r.title)).toEqual(["Export", "My big export notes"]);
  });
});
