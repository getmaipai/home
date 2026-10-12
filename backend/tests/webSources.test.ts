// SEARCH-SOURCES-01: the household's web search source list, its write refusals,
// its band gate and the blend. Offline and deterministic.
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { createHost, __resetSearchCacheForTests } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { effectiveMode } from "@/lib/retrieval/sourceMode";
import {
  NO_SOURCE_NOTE,
  UNBUILT_ONLY_NOTE,
  WEB_SOURCES_KEY,
  __setWebSourceForTests,
  blendWebRows,
  runWebSources,
  validateWebSources,
  webSourcesFor,
  type WebRow,
} from "@/lib/retrieval/webSources";

const row = (url: string, title = url): WebRow => ({ title, url, snippet: null });
const ok = (rows: WebRow[]) => ({ text: "x", rows });

beforeEach(() => resetDb());
afterEach(() => __setWebSourceForTests("ddgs", null));

describe("the key", () => {
  test("search.web_sources is a multi-select of searxng and ddgs defaulting to searxng, declared by the spec", () => {
    const key = getRegistryKey(WEB_SOURCES_KEY)!;
    expect(key.selector).toBe("select");
    expect(key.range).toEqual({ options: ["searxng", "ddgs"], multiple: true });
    expect(key.default).toEqual(["searxng"]);
    expect(key.lives_in).toBe("household.search");
    expect(key.copy?.option_labels).toEqual({ searxng: "SearXNG", ddgs: "DuckDuckGo" });
  });
});

describe("validateWebSources", () => {
  test("an empty list is refused with the fix named", () => {
    expect(validateWebSources(WEB_SOURCES_KEY, [])).toBe(NO_SOURCE_NOTE);
    expect(NO_SOURCE_NOTE).toContain("Library only");
  });
  test("a ddgs-only list is refused while ddgs is unbuilt, and allowed once it is built", () => {
    expect(validateWebSources(WEB_SOURCES_KEY, ["ddgs"])).toBe(UNBUILT_ONLY_NOTE);
    __setWebSourceForTests("ddgs", async () => ok([]));
    expect(validateWebSources(WEB_SOURCES_KEY, ["ddgs"])).toBeNull();
  });
  test("searxng alone and searxng with ddgs save; other keys and non-arrays are not this file's business", () => {
    expect(validateWebSources(WEB_SOURCES_KEY, ["searxng"])).toBeNull();
    expect(validateWebSources(WEB_SOURCES_KEY, ["searxng", "ddgs"])).toBeNull();
    expect(validateWebSources("search.source_mode", [])).toBeNull();
    expect(validateWebSources(WEB_SOURCES_KEY, "searxng")).toBeNull();
  });
  test("the generic write check refuses an unknown option and a duplicate", () => {
    expect(setHouseholdSettingValue(WEB_SOURCES_KEY, ["bing"]).ok).toBe(false);
    expect(setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "searxng"]).ok).toBe(false);
    expect(setHouseholdSettingValue(WEB_SOURCES_KEY, "searxng").ok).toBe(false);
    expect(setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]).ok).toBe(true);
  });
  test("a non-list value is refused with the fix named, in the spec's option labels", () => {
    const result = setHouseholdSettingValue(WEB_SOURCES_KEY, "searxng");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Pick one or more of: SearXNG, DuckDuckGo.");
  });
});

describe("webSourcesFor, the band gate", () => {
  test("the default is searxng for every band", () => {
    for (const band of ["child", "teen", "adult"] as const) expect(webSourcesFor(band)).toEqual(["searxng"]);
  });
  test("ddgs is inert while unbuilt, even when picked", () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    expect(webSourcesFor("adult")).toEqual(["searxng"]);
  });
  test("once built, ddgs answers an adult but never a child or teen", () => {
    __setWebSourceForTests("ddgs", async () => ok([]));
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    expect(webSourcesFor("adult")).toEqual(["searxng", "ddgs"]);
    expect(webSourcesFor("child")).toEqual(["searxng"]);
    expect(webSourcesFor("teen")).toEqual(["searxng"]);
    expect(effectiveMode("ddgs", "child")).toBe("closed");
    expect(effectiveMode("ddgs", "teen")).toBe("closed");
  });
  test("a minor whose household picked only ddgs gets no source at all, never searxng", () => {
    __setWebSourceForTests("ddgs", async () => ok([]));
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["ddgs"]);
    expect(webSourcesFor("child")).toEqual([]);
    expect(webSourcesFor("teen")).toEqual([]);
    expect(webSourcesFor("adult")).toEqual(["ddgs"]);
  });
  test("with web search set to Library only, no source is left for an adult", () => {
    __setWebSourceForTests("ddgs", async () => ok([]));
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    setHouseholdSettingValue("search.source_mode.web", "offline");
    expect(webSourcesFor("adult")).toEqual([]);
    expect(effectiveMode("ddgs", "adult")).toBe("offline");
  });
  test("ddgs follows the web mode for an adult", () => {
    setHouseholdSettingValue("search.source_mode.web", "mix");
    expect(effectiveMode("ddgs", "adult")).toBe(effectiveMode("web", "adult"));
  });
});

describe("blendWebRows", () => {
  test("a URL both sources return appears once and ranks above single-source rows", () => {
    const out = blendWebRows([[row("a"), row("shared")], [row("b"), row("shared")]]);
    expect(out.map((r) => r.url)).toEqual(["shared", "a", "b"]);
  });
  test("ties follow the stored order of the sources, then rank", () => {
    const out = blendWebRows([[row("a1"), row("a2")], [row("b1"), row("b2")]]);
    expect(out.map((r) => r.url)).toEqual(["a1", "b1", "a2", "b2"]);
  });
  test("a row with no url is keyed by title and snippet", () => {
    const bare = { title: "T", url: null, snippet: "s" };
    expect(blendWebRows([[bare], [{ ...bare }]])).toHaveLength(1);
  });
});

describe("runWebSources", () => {
  test("blends the sources that answer and numbers the text", async () => {
    const out = await runWebSources([async () => ok([row("a", "A")]), async () => ok([row("b", "B")])]);
    expect(out.rows.map((r) => r.url)).toEqual(["a", "b"]);
    expect(out.text).toBe("1. A (a)\n2. B (b)");
  });
  test("one source throwing still answers from the other", async () => {
    const out = await runWebSources([async () => { throw new Error("down"); }, async () => ok([row("b")])]);
    expect(out.rows.map((r) => r.url)).toEqual(["b"]);
  });
  test("every source throwing throws the first source's error", async () => {
    const first = new Error("first");
    await expect(runWebSources([async () => { throw first; }, async () => { throw new Error("second"); }])).rejects.toBe(first);
  });
  test("no rows at all reads as the no-results text", async () => {
    const out = await runWebSources([async () => ok([]), async () => ok([])]);
    expect(out.rows).toEqual([]);
    expect(out.text).toBe("No web search results were found.");
  });
});

describe("PUT /api/settings for search.web_sources", () => {
  async function owner() {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    return async (value: unknown) => {
      const res = await client.request("/api/settings", { method: "PUT", body: { scope: "household", key: WEB_SOURCES_KEY, value } });
      return { status: res.status, body: (await res.json()) as { error?: string; value?: unknown } };
    };
  }
  test("[] and [ddgs] return 400 with the fix named", async () => {
    const put = await owner();
    expect(await put([])).toEqual({ status: 400, body: { error: NO_SOURCE_NOTE } });
    expect(await put(["ddgs"])).toEqual({ status: 400, body: { error: UNBUILT_ONLY_NOTE } });
  });
  test("an unknown option and a duplicate return 400", async () => {
    const put = await owner();
    expect((await put(["bing"])).status).toBe(400);
    expect((await put(["searxng", "searxng"])).status).toBe(400);
  });
  test("[searxng] and [searxng, ddgs] save", async () => {
    const put = await owner();
    expect(await put(["searxng"])).toMatchObject({ status: 200, body: { value: ["searxng"] } });
    expect(await put(["searxng", "ddgs"])).toMatchObject({ status: 200, body: { value: ["searxng", "ddgs"] } });
  });
});

describe("blendWebRows snippets", () => {
  test("a shared page with no snippet in the first source takes the other source's snippet", () => {
    const rows = blendWebRows([[{ title: "A", url: "https://a.example/", snippet: null }], [{ title: "A", url: "https://a.example/", snippet: "full text" }]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snippet).toBe("full text");
  });
});

describe("the blend through the host", () => {
  const servers: Array<{ stop: (force?: boolean) => void }> = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true);
  });
  const manifest = () =>
    PackageManifest.parse({ id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test", description: "A test package.", author: "test", license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0, permissions: ["integration:searxng"] });
  async function search(role: "child" | "teen" | "adult", searxUrls: string[]) {
    __resetSearchCacheForTests();
    __resetRateLimiterForTests();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/config") return Response.json({ engines: [] });
        return Response.json({ results: searxUrls.map((url) => ({ title: url, url, content: "about it" })), infoboxes: [] });
      },
    });
    servers.push(server);
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const host = createHost({ ...person, role } as typeof person, manifest());
    return (await host.integration.call("searxng", "search", { query: "juniper falls" })) as { rows: WebRow[] };
  }

  test("two sources blend into one list with a shared URL ranked first and no duplicates", async () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    __setWebSourceForTests("ddgs", async () => ok([row("https://b.example/"), row("https://c.example/")]));
    const out = await search("adult", ["https://a.example/", "https://b.example/"]);
    expect(out.rows.map((r) => r.url)).toEqual(["https://b.example/", "https://a.example/", "https://c.example/"]);
  });

  test("a failing second source leaves the first source's answer alone", async () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    __setWebSourceForTests("ddgs", async () => {
      throw new Error("ddgs down");
    });
    const out = await search("adult", ["https://a.example/"]);
    expect(out.rows.map((r) => r.url)).toEqual(["https://a.example/"]);
  });

  test("a child never reaches the second source", async () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    let called = 0;
    __setWebSourceForTests("ddgs", async () => {
      called++;
      return ok([row("https://c.example/")]);
    });
    const out = await search("child", ["https://a.example/"]);
    expect(called).toBe(0);
    expect(out.rows.map((r) => r.url)).not.toContain("https://c.example/");
  });
});
