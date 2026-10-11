// DEFINE-FALLBACK-01: the optional live Wiktionary word lookup, offline and
// deterministic (a scripted fetch and a scripted library). The promises: off by
// default; a child or teen never; source mode offline never; the library's own
// dictionary entry comes first; a failure never fails the answer; a 429 or 5xx
// stops further lookups; counters carry no word.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { federatedLookup } from "@/lib/retrieval/lookup";
import { __resetDictionaryFallbackForTests, headwordOf } from "@/lib/retrieval/dictionaryFallback";
import { __resetReferenceCountersForTests, referenceCounters } from "@/lib/retrieval/referenceCounters";
import { dictionaryFallbackAllowed } from "@/lib/retrieval/sourceMode";
import type { ReferenceLookup } from "@/lib/retrieval/referenceReader";
import type { ReferenceRow } from "@/lib/retrieval/minorFloor";

const MISS = { outcome: "no_match", rows: [], text: "The offline library has no matching article." } as unknown as ReferenceLookup;
function libraryRow(book: string): ReferenceLookup {
  const row: ReferenceRow = { n: 1, kind: "reference", sourceId: "wiktionary-en", sourceLabel: "Wiktionary", licence: "cc-by-sa-4.0", book, path: "serene", title: "serene", snapshotDate: "2026-09-01", lead: "calm", infobox: [], disambiguation: false, options: [] };
  return { outcome: "match", rows: [row], text: "1. serene" } as unknown as ReferenceLookup;
}
const BODY = { en: [{ partOfSpeech: "Adjective", language: "English", definitions: [{ definition: '<a href="/wiki/calm">calm</a> and <i>peaceful</i>' }] }] };

function run(opts: { band?: "child" | "teen" | "adult"; scope?: "reference" | "both"; query?: string; ref?: ReferenceLookup; fetchJson?: (url: string) => Promise<unknown> }) {
  const urls: string[] = [];
  const fetchJson = async (url: string) => {
    urls.push(url);
    return opts.fetchJson ? opts.fetchJson(url) : BODY;
  };
  const out = federatedLookup(
    { query: opts.query ?? "serene", band: opts.band ?? "adult", scope: opts.scope ?? "reference", web: async () => ({ text: "web", rows: [] }) },
    { lookupReference: async () => opts.ref ?? MISS, dictionary: { fetchJson } },
  );
  return { out, urls };
}

beforeEach(() => {
  resetDb();
  __resetDictionaryFallbackForTests();
  __resetReferenceCountersForTests();
});

describe("DEFINE-FALLBACK-01", () => {
  test("off by default: no Wiktionary request", async () => {
    const { out, urls } = run({});
    expect((await out).rows).toHaveLength(0);
    expect(urls).toHaveLength(0);
  });

  test("on, an adult, a miss: one request, a labelled Wiktionary row with plain definitions", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    const { out, urls } = run({});
    const res = await out;
    expect(urls).toEqual(["https://en.wiktionary.org/api/rest_v1/page/definition/serene"]);
    expect(res.rows[0]?.source_label).toBe("Wiktionary (live)");
    expect(res.text).toContain("adjective: calm and peaceful");
    expect(referenceCounters()["reference.dictionary_live_call.adult"]).toBe(1);
  });

  test("a child or teen never reaches it, even with the setting on", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    for (const band of ["child", "teen"] as const) {
      const { out, urls } = run({ band });
      expect((await out).rows).toHaveLength(0);
      expect(urls).toHaveLength(0);
      expect(dictionaryFallbackAllowed(band)).toBe(false);
    }
  });

  test("source mode offline never calls it", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    setHouseholdSettingValue("search.source_mode", "offline");
    const { out, urls } = run({});
    expect((await out).rows).toHaveLength(0);
    expect(urls).toHaveLength(0);
  });

  test("the library's own dictionary entry comes first: no request", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    const { out, urls } = run({ ref: libraryRow("wiktionary_en_all_2026-09") });
    expect((await out).rows).toHaveLength(1);
    expect(urls).toHaveLength(0);
  });

  test("only one headword: a phrase is not sent", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    const { out, urls } = run({ query: "serene lake" });
    await out;
    expect(urls).toHaveLength(0);
    expect(headwordOf("serene lake")).toBeNull();
    expect(headwordOf("don't")).toBe("don't");
  });

  test("a 429 returns the library's result and stops later lookups; the word is never counted", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    const first = run({ fetchJson: async () => { throw new Error("HTTP 429 from en.wiktionary.org"); } });
    expect((await first.out).text).toBe(MISS.text);
    const second = run({ query: "calm" });
    expect((await second.out).rows).toHaveLength(0);
    expect(second.urls).toHaveLength(0);
    for (const key of Object.keys(referenceCounters())) expect(key).not.toMatch(/serene|calm/);
  });

  test("a network error returns the library's result", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    const { out } = run({ fetchJson: async () => { throw new Error("timeout"); } });
    expect((await out).text).toBe(MISS.text);
  });

  test("a repeat of the same word is served from the cache", async () => {
    setHouseholdSettingValue("search.dictionary_fallback", true);
    await run({}).out;
    const b = run({});
    expect((await b.out).rows).toHaveLength(1);
    expect(b.urls).toHaveLength(0);
  });
});
