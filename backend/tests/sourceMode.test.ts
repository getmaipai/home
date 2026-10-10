// KS-MODE-01: the search source mode (live | offline | mix), enforced at the
// lookup choke points. Offline and deterministic: a scripted kiwix-serve, a
// scripted SearXNG, a scripted Wikipedia and a scripted hosted provider.
// The promises: every mode crossed with child, teen and adult and with the
// model's `scope` does exactly what the tier table says; a per-source override
// beats the household value; a child or teen never reaches `wikimedia-live`
// or the hosted provider in any mode; `offline` makes no `wikimedia-live`
// call; the stored `search.wikipedia_fallback` migrates once; counters carry
// no text and no person id.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { createHost, __resetSearchCacheForTests, __resetSearxngEnginesCacheForTests } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { registerSidecar } from "@/lib/sidecars";
import { KIWIX_SIDECAR_ID } from "@/lib/kiwixSidecar";
import { REFERENCE_COUNTER_NAMES, __resetReferenceCountersForTests, referenceCounters } from "@/lib/retrieval/referenceCounters";
import { __resetReferenceReaderCachesForTests } from "@/lib/retrieval/referenceReader";
import { effectiveMode, WEB_OFF_NOTE, type ModeSource, type SourceMode } from "@/lib/retrieval/sourceMode";
import { migrateWikipediaFallbackToSourceMode } from "@/lib/retrieval/sourceModeMigration";
import { HOSTED_SEARCH_KEY_SETTING, __setHostedSearchEndpointForTests, hostedSearch } from "@/lib/hostedSearch";
import { articleHtml, startFakeKiwix, type FakeKiwix } from "./support/fakeKiwix";
import { SEARCH_SETTINGS_KEYS } from "@/settings/searchKeys";
import { getRegistry, getRegistryKey } from "@/lib/settingsRegistry";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";

const WIKI = "wikipedia_en_all_mini_2026-09";
const SIMPLE = "wikipedia_en_simple_all_maxi_2026-09";
const HIT = "Juniper Falls";
const MISS = "Zzyzx Quartz Harbour";
const MODES: SourceMode[] = ["live", "offline", "mix"];
const BANDS = ["child", "teen", "adult"] as const;
type Band = (typeof BANDS)[number];

const servers: Array<{ stop: (force?: boolean) => void }> = [];
let kiwix: FakeKiwix | null = null;
const savedWiki = process.env.MAIPAI_WIKIPEDIA_BASE_URL;

beforeEach(() => {
  resetDb();
  resetCaches();
  __resetReferenceCountersForTests();
});

afterEach(() => {
  kiwix?.stop();
  kiwix = null;
  for (const s of servers.splice(0)) s.stop(true);
  __setHostedSearchEndpointForTests(null);
  if (savedWiki === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
  else process.env.MAIPAI_WIKIPEDIA_BASE_URL = savedWiki;
});

function resetCaches() {
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetSearxngEnginesCacheForTests();
  __resetReferenceReaderCachesForTests();
}

function manifest(): PackageManifest {
  return PackageManifest.parse({ id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test", description: "A test package.", author: "test", license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0, permissions: ["integration:searxng"] });
}

async function actorAs(role: Band) {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { ...row, role } as typeof row;
}

function startKiwix(): FakeKiwix {
  const html = articleHtml({ title: HIT, lead: ["Juniper Falls is a waterfall in the made-up county of Alder.[1]"], infobox: [["Height", "40 m"]] });
  const article = { Juniper_Falls: { title: HIT, html } };
  kiwix = startFakeKiwix([
    { id: WIKI, date: "2026-09-01", articles: article },
    { id: SIMPLE, date: "2026-09-01", articles: article },
  ]);
  registerSidecar({ id: KIWIX_SIDECAR_ID, command: ["true"], port: Number(new URL(kiwix.baseUrl).port) });
  return kiwix;
}

/** A scripted SearXNG that answers with `results` and counts search requests. */
function fakeWeb(results: Array<{ title: string; url: string; content: string }> = []) {
  const state = { searches: 0, all: [] as string[] };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      state.all.push(url.pathname);
      if (url.pathname === "/config") return Response.json({ engines: [] });
      if (url.pathname === "/search") state.searches++;
      return Response.json({ results, infoboxes: [] });
    },
  });
  servers.push(server);
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
  return state;
}

/** A scripted Wikipedia. Any request is recorded, and the test asserts the list stays empty where it must. */
function fakeWiki() {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      requests.push(url.pathname);
      if (url.pathname === "/w/rest.php/v1/search/page") return Response.json({ pages: [{ key: "Live_Topic" }] });
      if (url.pathname.startsWith("/api/rest_v1/page/summary/")) return Response.json({ title: "Live Topic", extract: "A live Wikimedia extract.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Live_Topic" } } });
      return new Response("nf", { status: 404 });
    },
  });
  servers.push(server);
  process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${server.port}`;
  return { requests };
}

function fakeProvider() {
  const hits: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      hits.push(new URL(req.url).searchParams.get("q") ?? "");
      return Response.json({ web: { results: [{ title: "Hosted", url: "https://hosted.example/", description: "from the provider" }] } });
    },
  });
  servers.push(server);
  __setHostedSearchEndpointForTests(`http://127.0.0.1:${server.port}/res/v1/web/search`);
  return { hits };
}

function setMode(mode: SourceMode, overrides: { wikimedia?: string; web?: string } = {}) {
  expect(setHouseholdSettingValue("search.source_mode", mode).ok).toBe(true);
  if (overrides.wikimedia) expect(setHouseholdSettingValue("search.source_mode.wikimedia", overrides.wikimedia).ok).toBe(true);
  if (overrides.web) expect(setHouseholdSettingValue("search.source_mode.web", overrides.web).ok).toBe(true);
}

type Result = { text: string; rows: Array<{ title: string; kind?: string }> };
// Both books answer a library query, so a hit can carry more than one reference row.
const uniq = (xs: Array<string | undefined>) => [...new Set(xs)];
const search = async (band: Band, args: Record<string, unknown>) => {
  const host = createHost(await actorAs(band), manifest());
  return (await host.integration.call("searxng", "search", args)) as Result;
};

describe("effectiveMode, the one interpreter", () => {
  test("the household value defaults to mix, and the declared options are the spec's", () => {
    expect(getHouseholdSettingValue("search.source_mode")).toBe("mix");
    expect(getHouseholdSettingValue("search.source_mode.wikimedia")).toBe("inherit");
    expect(getHouseholdSettingValue("search.source_mode.web")).toBe("inherit");
    expect(effectiveMode("wikimedia", "adult")).toBe("mix");
    expect(effectiveMode("web", "adult")).toBe("mix");
    expect(effectiveMode("hosted", "adult")).toBe("mix");
  });

  test("household offline is the narrow reading: wikimedia off, web and hosted as today (live)", () => {
    setMode("offline");
    expect(effectiveMode("wikimedia", "adult")).toBe("offline");
    expect(effectiveMode("web", "adult")).toBe("live");
    expect(effectiveMode("hosted", "adult")).toBe("live");
  });

  test("a per-source override beats the household value, and hosted follows web", () => {
    setMode("live", { wikimedia: "offline", web: "mix" });
    expect(effectiveMode("wikimedia", "adult")).toBe("offline");
    expect(effectiveMode("web", "adult")).toBe("mix");
    expect(effectiveMode("hosted", "adult")).toBe("mix");
    setMode("offline", { web: "offline" });
    expect(effectiveMode("web", "adult")).toBe("offline");
    expect(effectiveMode("hosted", "adult")).toBe("offline");
  });

  test("a minor's wikimedia and hosted are closed in every mode and override; their web follows the same value", () => {
    for (const mode of MODES) {
      for (const override of ["inherit", ...MODES]) {
        setMode(mode, { wikimedia: override, web: override });
        for (const band of ["child", "teen"] as const) {
          for (const source of ["wikimedia", "hosted"] as ModeSource[]) expect(effectiveMode(source, band)).toBe("closed");
          expect(effectiveMode("web", band)).toBe(effectiveMode("web", "adult"));
        }
      }
    }
  });
});

// What the tier table says, written out once for the matrix below.
function expectedWebCalled(mode: SourceMode, webOverride: string | undefined, scope: string, kHit: boolean): boolean {
  if (scope === "reference") return false;
  if (webOverride === "offline") return false;
  const webMode = webOverride && webOverride !== "inherit" ? webOverride : mode === "offline" ? "live" : mode;
  if (webMode === "mix" && scope === "both" && kHit) return false;
  return true;
}
function expectedWikiCalled(mode: SourceMode, wikiOverride: string | undefined, band: Band, webCalled: boolean, kHit: boolean): boolean {
  if (band !== "adult" || !webCalled) return false;
  const wikiMode = wikiOverride && wikiOverride !== "inherit" ? wikiOverride : mode;
  if (wikiMode === "offline") return false;
  if (kHit && wikiMode !== "live") return false;
  return true;
}

describe("the matrix: mode x band x scope x library hit, through the host", () => {
  for (const mode of MODES) {
    for (const band of BANDS) {
      test(`mode ${mode}, ${band}: web and wikimedia-live are reached exactly as the tier table says`, async () => {
        startKiwix();
        const web = fakeWeb([]);
        const wiki = fakeWiki();
        setMode(mode);
        const host = createHost(await actorAs(band), manifest());
        for (const scope of ["reference", "web", "both"] as const) {
          for (const kHit of [true, false]) {
            resetCaches();
            web.searches = 0;
            wiki.requests.length = 0;
            const args = scope === "both" ? { query: kHit ? HIT : MISS } : { query: kHit ? HIT : MISS, scope };
            const out = (await host.integration.call("searxng", "search", args)) as Result;
            const webCalled = expectedWebCalled(mode, undefined, scope, kHit);
            const label = `${mode}/${band}/${scope}/${kHit ? "hit" : "miss"}`;
            expect(`${label} web ${web.searches > 0}`).toBe(`${label} web ${webCalled}`);
            const wikiCalled = expectedWikiCalled(mode, undefined, band, webCalled, kHit);
            expect(`${label} wiki ${wiki.requests.length > 0}`).toBe(`${label} wiki ${wikiCalled}`);
            if (kHit) expect(out.rows[0]?.kind).toBe("reference");
            // A child or teen never reaches the live Wikipedia lookup, in any mode.
            if (band !== "adult") expect(wiki.requests).toEqual([]);
          }
        }
      });
    }
  }

  test("mix, an adult, scope omitted: a library hit answers alone and is counted; a miss goes online and then to wikimedia-live, counted", async () => {
    startKiwix();
    const web = fakeWeb([]);
    const wiki = fakeWiki();
    setMode("mix");
    const hit = await search("adult", { query: HIT });
    expect(uniq(hit.rows.map((r) => r.kind))).toEqual(["reference"]);
    expect(web.searches).toBe(0);
    expect(referenceCounters()["reference.mode_mix_library_hit.adult"]).toBe(1);
    resetCaches();
    const miss = await search("adult", { query: MISS });
    expect(miss.rows[0]?.title).toBe("Live Topic");
    expect(wiki.requests.length).toBe(2);
    expect(referenceCounters()["reference.mode_mix_live_fallthrough.adult"]).toBe(1);
  });

  test("mix honours scope web: the web is asked even though the library has a hit, and wikimedia-live stays quiet", async () => {
    startKiwix();
    const web = fakeWeb([{ title: "News", url: "https://example.com/n", content: "today" }]);
    const wiki = fakeWiki();
    setMode("mix");
    const out = await search("adult", { query: HIT, scope: "web" });
    expect(web.searches).toBeGreaterThan(0);
    expect(uniq(out.rows.map((r) => r.title))).toEqual([HIT, "News"]);
    expect(wiki.requests).toEqual([]);
  });

  test("live: an unscoped library hit still asks the web, and wikimedia-live runs when the web found nothing even though the library matched", async () => {
    startKiwix();
    const web = fakeWeb([]);
    const wiki = fakeWiki();
    setMode("live");
    const out = await search("adult", { query: HIT });
    expect(web.searches).toBeGreaterThan(0);
    expect(wiki.requests.length).toBe(2);
    expect(out.rows.map((r) => r.title)).toContain("Live Topic");
    expect(referenceCounters()["reference.wikimedia_live_call.adult"]).toBe(1);
  });
});

describe("offline performs no wikimedia-live call", () => {
  test("household offline: an adult's empty web and empty library never reach the fake Wikipedia, and web search still runs", async () => {
    startKiwix();
    const web = fakeWeb([]);
    const wiki = fakeWiki();
    setMode("offline");
    const out = await search("adult", { query: MISS });
    expect(web.searches).toBeGreaterThan(0);
    expect(wiki.requests).toEqual([]);
    expect(referenceCounters()["reference.mode_blocked_offline.adult"]).toBeGreaterThan(0);
    expect(referenceCounters()["reference.wikimedia_live_call.adult"]).toBeUndefined();
    expect(out.rows.some((r) => r.title === "Live Topic")).toBe(false);
  });

  test("the wikimedia override alone: web is untouched, wikimedia-live is off; the same override at inherit leaves it on", async () => {
    startKiwix();
    const web = fakeWeb([]);
    const wiki = fakeWiki();
    setMode("live", { wikimedia: "offline" });
    await search("adult", { query: MISS });
    expect(web.searches).toBeGreaterThan(0);
    expect(wiki.requests).toEqual([]);
    resetCaches();
    setMode("live", { wikimedia: "inherit" });
    await search("adult", { query: MISS });
    expect(wiki.requests.length).toBe(2);
  });
});

describe("web = offline turns off web search, page reads and the hosted provider together", () => {
  test("a search gets the library result and a plain note, no SearXNG request, no hosted request, no wikimedia-live", async () => {
    startKiwix();
    const web = fakeWeb([{ title: "Web", url: "https://example.com", content: "c" }]);
    const wiki = fakeWiki();
    const provider = fakeProvider();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, "test-key");
    setMode("live", { web: "offline" });
    for (const scope of [undefined, "web"] as const) {
      resetCaches();
      const out = await search("adult", { query: HIT, ...(scope ? { scope } : {}) });
      expect(uniq(out.rows.map((r) => r.kind))).toEqual(["reference"]);
      expect(out.text).toContain(WEB_OFF_NOTE);
    }
    const none = await search("adult", { query: MISS });
    expect(none.rows).toEqual([]);
    expect(none.text).toContain(WEB_OFF_NOTE);
    expect(web.searches).toBe(0);
    expect(provider.hits).toEqual([]);
    expect(wiki.requests).toEqual([]);
    expect(referenceCounters()["reference.mode_blocked_offline.adult"]).toBe(3);
  });

  test("an image search and a page read are refused the same way, as a policy note and a permission error, not a crash", async () => {
    startKiwix();
    const web = fakeWeb([]);
    setMode("mix", { web: "offline" });
    const images = await search("adult", { query: "juniper", category: "images" });
    expect(images.rows).toEqual([]);
    expect(images.text).toBe(WEB_OFF_NOTE);
    const host = createHost(await actorAs("adult"), manifest());
    let thrown: unknown;
    try {
      await host.integration.call("searxng", "page.read", { url: "https://example.com/page" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HostError);
    expect((thrown as HostError).code).toBe("permission_denied");
    expect(web.all).toEqual([]);
  });

  test("scope web is honoured under household offline (the narrow reading): the web is asked", async () => {
    startKiwix();
    const web = fakeWeb([{ title: "Web", url: "https://example.com", content: "c" }]);
    setMode("offline");
    const out = await search("adult", { query: HIT, scope: "web" });
    expect(web.searches).toBeGreaterThan(0);
    expect(uniq(out.rows.map((r) => r.title))).toEqual([HIT, "Web"]);
  });

  test("a child under web = offline gets library rows and the note, and SearXNG is not asked", async () => {
    startKiwix();
    const web = fakeWeb([]);
    setMode("live", { web: "offline" });
    const out = await search("child", { query: HIT });
    expect(uniq(out.rows.map((r) => r.kind))).toEqual(["reference"]);
    expect(web.searches).toBe(0);
  });
});

let hostedCalls = 0;
describe("the hosted provider", () => {
  async function hostedHits(band: Band, mode: SourceMode, web?: string): Promise<number> {
    const provider = fakeProvider();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, "test-key");
    setMode(mode, web ? { web } : {});
    await hostedSearch(`juniper ${++hostedCalls}`, band, "off", undefined, band);
    return provider.hits.length;
  }

  test("an adult with a key reaches it in live and mix and in household offline, but not when web is offline", async () => {
    await actorAs("adult");
    expect(await hostedHits("adult", "live")).toBe(1);
    expect(await hostedHits("adult", "mix")).toBe(1);
    expect(await hostedHits("adult", "offline")).toBe(1);
    expect(await hostedHits("adult", "live", "offline")).toBe(0);
  });

  test("a child or a teen with a key never reaches it, in any mode or override", async () => {
    await actorAs("adult");
    for (const band of ["child", "teen"] as const) {
      for (const mode of MODES) {
        expect(await hostedHits(band, mode)).toBe(0);
        expect(await hostedHits(band, mode, "live")).toBe(0);
      }
    }
  });

  test("without a key the provider is not reached in any mode", async () => {
    await actorAs("adult");
    const provider = fakeProvider();
    for (const mode of MODES) {
      setMode(mode);
      await hostedSearch("juniper", "adult", "off", undefined, "adult");
    }
    expect(provider.hits).toEqual([]);
  });
});

describe("migration of search.wikipedia_fallback", () => {
  const legacy = () => db.select().from(settingsValues).where(eq(settingsValues.key, "search.wikipedia_fallback")).all();
  const storeLegacy = (value: boolean) => {
    // The key is gone from the registry, so the API refuses it; seed the row an older hub left behind.
    expect(setHouseholdSettingValue("search.wikipedia_fallback", value).ok).toBe(false);
    const now = new Date().toISOString();
    db.insert(settingsValues).values({ scope: "household", key: "search.wikipedia_fallback", value: JSON.stringify(value), hlc: "0", source: "admin", updatedAt: now }).run();
  };

  test("a stored false becomes the wikimedia override offline, never the household mode, and the old row is deleted", () => {
    storeLegacy(false);
    expect(migrateWikipediaFallbackToSourceMode()).toBe("migrated_off");
    expect(getHouseholdSettingValue("search.source_mode.wikimedia")).toBe("offline");
    expect(getHouseholdSettingValue("search.source_mode")).toBe("mix");
    expect(effectiveMode("web", "adult")).toBe("mix");
    expect(legacy()).toEqual([]);
  });

  test("a stored true is dropped and leaves the override at inherit", () => {
    storeLegacy(true);
    expect(migrateWikipediaFallbackToSourceMode()).toBe("dropped_on");
    expect(getHouseholdSettingValue("search.source_mode.wikimedia")).toBe("inherit");
    expect(legacy()).toEqual([]);
  });

  test("nothing stored changes nothing", () => {
    expect(migrateWikipediaFallbackToSourceMode()).toBe("none");
    expect(getHouseholdSettingValue("search.source_mode.wikimedia")).toBe("inherit");
  });

  test("a second run is a no-op, even after the household changed the override back", () => {
    storeLegacy(false);
    migrateWikipediaFallbackToSourceMode();
    expect(setHouseholdSettingValue("search.source_mode.wikimedia", "mix").ok).toBe(true);
    expect(migrateWikipediaFallbackToSourceMode()).toBe("none");
    expect(getHouseholdSettingValue("search.source_mode.wikimedia")).toBe("mix");
  });

  test("an override the household already chose is kept", () => {
    expect(setHouseholdSettingValue("search.source_mode.wikimedia", "live").ok).toBe(true);
    storeLegacy(false);
    expect(migrateWikipediaFallbackToSourceMode()).toBe("migrated_off");
    expect(getHouseholdSettingValue("search.source_mode.wikimedia")).toBe("live");
    expect(legacy()).toEqual([]);
  });

  test("an explicitly stored inherit is not a choice: a stored false still becomes offline", () => {
    expect(setHouseholdSettingValue("search.source_mode.wikimedia", "inherit").ok).toBe(true);
    storeLegacy(false);
    expect(migrateWikipediaFallbackToSourceMode()).toBe("migrated_off");
    expect(getHouseholdSettingValue("search.source_mode.wikimedia")).toBe("offline");
    expect(legacy()).toEqual([]);
  });

  test("after the migration a former false household makes no wikimedia-live call", async () => {
    startKiwix();
    fakeWeb([]);
    const wiki = fakeWiki();
    storeLegacy(false);
    migrateWikipediaFallbackToSourceMode();
    await search("adult", { query: MISS });
    expect(wiki.requests).toEqual([]);
  });

  test("the retired key is no longer declared by Home", () => {
    expect(SEARCH_SETTINGS_KEYS.map((k) => k.key)).not.toContain("search.wikipedia_fallback");
  });
});

describe("counters carry no text and no person id (rule 6a)", () => {
  test("after searches in every mode, every counter key is a closed name plus at most a band", async () => {
    startKiwix();
    fakeWeb([]);
    fakeWiki();
    const secretQuery = "Zzyzx Quartz Harbour private question";
    for (const mode of MODES) {
      for (const band of BANDS) {
        setMode(mode);
        resetCaches();
        await search(band, { query: secretQuery });
        resetCaches();
        await search(band, { query: HIT });
      }
    }
    setMode("mix", { web: "offline" });
    await search("adult", { query: secretQuery });
    const names = new Set<string>(REFERENCE_COUNTER_NAMES);
    for (const key of Object.keys(referenceCounters())) {
      const m = /^reference\.([a-z_]+)(?:\.(child|teen|adult))?$/.exec(key);
      expect(m).not.toBeNull();
      expect(names.has(m![1]!)).toBe(true);
      expect(key.toLowerCase()).not.toContain("zzyzx");
      expect(key.toLowerCase()).not.toContain("sage");
    }
    for (const name of ["mode_blocked_offline", "mode_mix_library_hit", "mode_mix_live_fallthrough"]) {
      expect((REFERENCE_COUNTER_NAMES as readonly string[]).includes(name)).toBe(true);
    }
  });
});

describe("the privacy row and the user doc", () => {
  test("the wikimedia-live privacy row names the setting that turns it off", async () => {
    const manifestJson = await Bun.file(new URL("../packages/websearch/manifest.json", import.meta.url)).json();
    const row = (manifestJson.data_sources as Array<{ id: string; when: string; opt_in: boolean }>).find((d) => d.id === "wikimedia-live");
    expect(row).toBeDefined();
    expect(row!.when).toContain("search.source_mode");
  });

  test("docs/user/web-search.md names the three choices in plain words", async () => {
    const doc = await Bun.file(new URL("../../docs/user/web-search.md", import.meta.url)).text();
    for (const label of ["Library only", "Library first", "Internet first"]) expect(doc).toContain(label);
  });
});

describe("the retired wikipedia fallback key", () => {
  test("search.wikipedia_fallback is not in the settings registry, so it cannot be shown or set", () => {
    expect(getRegistryKey("search.wikipedia_fallback")).toBeUndefined();
    expect(getRegistry().some((k) => k.key === "search.wikipedia_fallback")).toBe(false);
    expect(getRegistryKey("search.source_mode.wikimedia")).toBeDefined();
  });
});
