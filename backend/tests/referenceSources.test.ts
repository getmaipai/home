// KS-02F-BE: offline-library rows reach the chat as spec-shaped `reference`
// Sources; web Sources stay byte-identical; one licence label map.
import { describe, expect, test } from "bun:test";
import { Source as SourceSchema } from "@maipai/spec/gen/ts/source.js";
import { federatedLookup, referenceToLookupRow, referenceUrl } from "@/lib/retrieval/lookup";
import type { ReferenceRow } from "@/lib/retrieval/minorFloor";
import { LICENCE_LABELS, licenceLabel } from "@/routes/reference";
import { outcomeOf, sourcesFromRows } from "@/lib/turnContext";
import { TurnArtifact } from "@maipai/spec/gen/ts/turn-artifact.js";
import { canonicalPageUrl } from "@/lib/retrieval/referenceSources";

const BOOK = "wikipedia_en_simple_all_maxi_2026-09";

function row(over: Partial<ReferenceRow> = {}): ReferenceRow {
  return { n: 1, kind: "reference", sourceId: "wikipedia-simple", sourceLabel: "Simple English Wikipedia", licence: "cc-by-sa-4.0", book: BOOK, path: "Juniper_Falls", title: "Juniper Falls", snapshotDate: "2026-09-01", lead: "Juniper Falls is a waterfall.", infobox: [], disambiguation: false, options: [], ...over };
}

describe("reference rows become reference Sources", () => {
  test("sourcesFromRows emits the spec shape for a library row", () => {
    const lookupRow = referenceToLookupRow(row());
    const [src] = sourcesFromRows([lookupRow]);
    const proxy = referenceUrl(BOOK, "Juniper_Falls");
    expect(src).toMatchObject({ kind: "reference", title: "Juniper Falls", url: "https://simple.wikipedia.org/wiki/Juniper_Falls", local_path: proxy, site: "Simple English Wikipedia", licence: "cc-by-sa-4.0", snapshot_date: "2026-09-01", snippet: "Juniper Falls is a waterfall." });
    expect(src!.id).toMatch(/^src-[a-z0-9]{6,}$/);
    expect(SourceSchema.safeParse(src).success).toBe(true);
    const doc = { id: "doc-abc123", turn_id: "turn-abc123", revision: 1, evidence_version: "v1", provenance: "composer", created_at: "2026-10-11T12:00:00Z", hlc: "1791547200003:0:a1b2c5", section: { type: "lookup", query: "Juniper Falls", results: [{ title: "Juniper Falls", line: "A waterfall.", source_id: src!.id }] }, sources: [src] };
    expect(TurnArtifact.safeParse(doc).success).toBe(true);
  });

  test("a multi-segment library path passes the Source schema; a book with no public page emits nothing", () => {
    const multi = { ...referenceToLookupRow(row()), url: "/api/reference/wikipedia_en_all_maxi_2026-09/A/Sourdough" };
    const [src] = sourcesFromRows([multi]);
    expect(src).toMatchObject({ url: "https://en.wikipedia.org/wiki/Sourdough", local_path: multi.url });
    expect(SourceSchema.safeParse(src).success).toBe(true);
    expect(canonicalPageUrl("world-factbook_en_2026", "France")).toBeNull();
    expect(canonicalPageUrl("medlineplus_en_2026", "x")).toBeNull();
    expect(sourcesFromRows([{ ...multi, url: "/api/reference/medlineplus_en_2026/Flu" }])).toEqual([]);
    expect(sourcesFromRows([{ ...multi, url: "/api/reference/wikipedia_en_all_maxi_2026-09/A/../x" }])).toEqual([]);
  });

  test("a relative url is accepted only as /api/reference/<book>/<path>", () => {
    const ok = referenceToLookupRow(row());
    const bad = ["/api/other/x/y", "/api/reference/onlybook", "/api/reference/a/b/..", "/api/reference/a/b?x=1", "../api/reference/a/b", "//evil.example.com/api/reference/a/b", "/etc/passwd"];
    expect(sourcesFromRows([ok])).toHaveLength(1);
    for (const url of bad) expect(sourcesFromRows([{ ...ok, url }])).toEqual([]);
  });

  test("a row that claims reference with an absolute or missing label is dropped, and kind-less relative urls stay dropped", () => {
    const ok = referenceToLookupRow(row());
    expect(sourcesFromRows([{ ...ok, url: "https://example.com/a" }])).toEqual([]);
    expect(sourcesFromRows([{ ...ok, source_label: "  " }])).toEqual([]);
    const { kind: _k, ...noKind } = ok;
    expect(sourcesFromRows([noKind])).toEqual([]);
  });

  test("web Sources are unchanged: kind web, hostname site, no reference fields", () => {
    const [src] = sourcesFromRows([{ title: "Hit", url: "https://www.example.com/a#x", snippet: "s" }]);
    expect(src).toMatchObject({ kind: "web", url: "https://www.example.com/a", site: "example.com", snippet: "s", source: "websearch" });
    expect(Object.keys(src!).sort()).toEqual(["created_at", "hlc", "id", "kind", "site", "snippet", "source", "title", "url"]);
  });

  test("outcomeOf keeps the reference fields on the retained source and the sources list", () => {
    const lookupRow = referenceToLookupRow(row({ licence: "public-domain" }));
    const outcome = outcomeOf({ callId: "c1", packageId: "websearch", status: "succeeded", via: "model", args: {}, result: { actions: [], data: { rows: [lookupRow] } } } as never);
    expect(outcome.sources?.[0]).toMatchObject({ kind: "reference", licence: "public-domain", snapshot_date: "2026-09-01", site: "Simple English Wikipedia" });
  });

  test("a Source carries no query text and no person id", () => {
    const [src] = sourcesFromRows([referenceToLookupRow(row())]);
    const text = JSON.stringify(src);
    expect(Object.keys(src!).some((k) => /query|person|speaker|user/i.test(k))).toBe(false);
    expect(text).not.toContain("secret query words");
  });
});

describe("the licence label map", () => {
  test("covers every spec enum value, once", () => {
    const enumValues = (SourceSchema.shape.licence as unknown as { unwrap(): { options: string[] } }).unwrap().options;
    expect(Object.keys(LICENCE_LABELS).sort()).toEqual([...enumValues].sort());
    for (const v of enumValues) expect(licenceLabel(v as keyof typeof LICENCE_LABELS).length).toBeGreaterThan(0);
  });
});

describe("the composer's outcome source", () => {
  const mk = (source: Record<string, unknown>) => ({ at: "2026-10-11T12:00:00.000Z", via: "tool_call" as const, callId: "c1", packageId: "kb", status: "succeeded" as const, args: { topic: "falls" }, result: { actions: [], data: { kind: "film", title: "Bramble Moon", year: 2024, director: "Quill Arden", genres: ["adventure"] } }, source }) as never;

  test("a reference outcome source becomes a reference Source; a relative non-library url is dropped", async () => {
    const { sourceFromOutcome } = await import("@/lib/composer");
    const good = { kind: "reference", title: "Juniper Falls", url: referenceUrl(BOOK, "Juniper_Falls"), site: "Simple English Wikipedia", snippet: null, licence: "cc0", snapshot_date: "2026-09-01" };
    const a = sourceFromOutcome(mk(good));
    expect(a).toMatchObject({ kind: "reference", site: "Simple English Wikipedia", licence: "cc0", snapshot_date: "2026-09-01", url: "https://simple.wikipedia.org/wiki/Juniper_Falls", local_path: good.url });
    expect(SourceSchema.safeParse(a).success).toBe(true);
    expect(sourceFromOutcome(mk({ ...good, url: "/somewhere/else" }))).toBeNull();
  });

  test("a web outcome source is unchanged", async () => {
    const { sourceFromOutcome } = await import("@/lib/composer");
    const a = sourceFromOutcome(mk({ kind: "web", title: "Hit", url: "https://www.example.com/a#x", snippet: "s" }));
    expect(a).toMatchObject({ kind: "web", url: "https://www.example.com/a", site: "example.com" });
    expect(Object.keys(a!).sort()).toEqual(["created_at", "hlc", "id", "kind", "site", "snippet", "source", "title", "url"]);
  });
});

describe("minors get only tier-K reference Sources", () => {
  for (const band of ["child", "teen"] as const) {
    test(`a ${band} turn emits reference Sources only and no wikimedia-live Source`, async () => {
      let kMatchedSeen: boolean | null = null;
      const out = await federatedLookup(
        { query: "Juniper Falls", band, scope: "both", web: async (ctx) => { kMatchedSeen = ctx.kMatched; return { text: "", rows: [] }; } },
        { lookupReference: async () => ({ outcome: "answered", rows: [row()], text: "[1] Simple English Wikipedia" }) as never },
      );
      expect(kMatchedSeen as unknown).toBe(true);
      const sources = sourcesFromRows(out.rows);
      expect(sources.length).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.kind).toBe("reference");
        expect(s.local_path?.startsWith("/api/reference/")).toBe(true);
        expect(s.url.startsWith("https://")).toBe(true);
      }
      expect(sources.some((s) => (s.kind as string) === "wikimedia")).toBe(false);
    });
  }
});

