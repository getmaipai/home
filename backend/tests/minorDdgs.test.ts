// SEARCH-DDGS-TEEN-01: the owner's opt-in that lets teens (or teens and children) use DuckDuckGo (ddgs) beside
// SearXNG. Off by default; SearXNG leads; strict safe search is requested; an admin only; every other gate stays.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { createHost, __resetSearchCacheForTests } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue, getHouseholdSettingValue } from "@/lib/settings";
import { __reloadRegistryForTests, getRegistry, getRegistryKey } from "@/lib/settingsRegistry";
import { DDGS_URL_ENV, __resetDdgsForTests, ddgsSearch } from "@/lib/retrieval/ddgsSource";
import { MINOR_DDGS_KEY, effectiveMode, minorDdgsAllowed } from "@/lib/retrieval/sourceMode";
import { WEB_SOURCES_KEY, webSourcesFor } from "@/lib/retrieval/webSources";

let sidecar: ReturnType<typeof Bun.serve>;
let searx: ReturnType<typeof Bun.serve>;
let sidecarHits: URL[] = [];
const before = process.env[DDGS_URL_ENV];

beforeEach(() => {
  resetDb();
  __resetDdgsForTests();
  __resetSearchCacheForTests();
  __resetRateLimiterForTests();
  sidecarHits = [];
  sidecar = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => { sidecarHits.push(new URL(req.url)); return Response.json({ rows: [{ title: "Duck page", url: "https://duck.example/p", snippet: "from ddgs" }] }); } });
  searx = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => (new URL(req.url).pathname === "/config" ? Response.json({ engines: [] }) : Response.json({ results: [{ title: "Searx page", url: "https://searx.example/p", content: "from searxng" }], infoboxes: [] })) });
  process.env[DDGS_URL_ENV] = `http://127.0.0.1:${sidecar.port}`;
  __reloadRegistryForTests();
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searx.port}`);
  setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
});
afterEach(() => {
  sidecar.stop(true);
  searx.stop(true);
  if (before === undefined) delete process.env[DDGS_URL_ENV]; else process.env[DDGS_URL_ENV] = before;
  __reloadRegistryForTests();
});

const manifest = () => PackageManifest.parse({ id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test", description: "A test package.", author: "test", license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0, permissions: ["integration:searxng"] });
async function ask(role: "child" | "teen" | "adult" | "guest", extra: Record<string, unknown> = {}) {
  __resetSearchCacheForTests();
  __resetRateLimiterForTests();
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const host = createHost({ ...person, role } as typeof person, manifest());
  const out = (await host.integration.call("searxng", "search", { query: "juniper falls", read_page: false, ...extra })) as { rows: { url: string | null }[] };
  return out.rows.map((r) => r.url);
}

describe("the setting", () => {
  test("search.ddgs_for_minors is a household select, off by default, in the Web search card", () => {
    const key = getRegistryKey(MINOR_DDGS_KEY)!;
    expect(key.scope).toBe("household");
    expect(key.default).toBe("off");
    expect(key.range).toEqual({ options: ["off", "teens", "teens_and_children"] });
    expect(key.lives_in).toBe("household.search");
    expect(key.help).toContain("DuckDuckGo's own filter is not guaranteed. Adult results may reach this age group. Leave this off unless you accept that.");
  });
  test("the control is absent while DuckDuckGo search is not set up on this computer", () => {
    delete process.env[DDGS_URL_ENV];
    expect(getRegistry().some((k) => k.key === MINOR_DDGS_KEY)).toBe(false);
    expect(minorDdgsAllowed("teen")).toBe(false);
  });
  test("an owner saves it; a teen and a child cannot", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const put = async (value: string) => (await client.request("/api/settings", { method: "PUT", body: { scope: "household", key: MINOR_DDGS_KEY, value } })).status;
    expect(await put("teens")).toBe(200);
    expect(getHouseholdSettingValue(MINOR_DDGS_KEY)).toBe("teens");
    expect(await put("everyone")).toBe(400);
    const owner = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    for (const role of ["teen", "child"] as const) {
      const { setValue } = await import("@/lib/settings");
      const result = setValue({ ...owner, role } as typeof owner, "household", MINOR_DDGS_KEY, "teens_and_children");
      expect(result.ok).toBe(false);
    }
    expect(getHouseholdSettingValue(MINOR_DDGS_KEY)).toBe("teens");
  });
});

describe("default off", () => {
  test("a teen and a child get SearXNG only and never reach the sidecar", async () => {
    expect(webSourcesFor("teen")).toEqual(["searxng"]);
    expect(webSourcesFor("child")).toEqual(["searxng"]);
    expect(effectiveMode("ddgs", "teen")).toBe("closed");
    expect(await ask("teen")).toEqual(["https://searx.example/p"]);
    expect(await ask("child")).toEqual(["https://searx.example/p"]);
    expect(sidecarHits).toEqual([]);
  });
  test("ddgsSearch refuses a minor directly while off", async () => {
    await expect(ddgsSearch({ args: { query: "herons" }, band: "teen" })).rejects.toThrow();
    expect(sidecarHits).toEqual([]);
  });
});

describe("on for teens", () => {
  beforeEach(() => setHouseholdSettingValue(MINOR_DDGS_KEY, "teens"));
  test("a teen gets SearXNG first then ddgs; a child still gets SearXNG only", async () => {
    expect(webSourcesFor("teen")).toEqual(["searxng", "ddgs"]);
    expect(webSourcesFor("child")).toEqual(["searxng"]);
    expect(await ask("teen")).toEqual(["https://searx.example/p", "https://duck.example/p"]);
    expect(sidecarHits).toHaveLength(1);
    expect(await ask("child")).toEqual(["https://searx.example/p"]);
    expect(sidecarHits).toHaveLength(1);
  });
  test("strict safe search is passed to the sidecar for a minor, and not added for an adult", async () => {
    await ask("teen");
    expect(sidecarHits[0]!.searchParams.get("safesearch")).toBe("on");
    await ask("adult");
    expect(sidecarHits[1]!.searchParams.has("safesearch")).toBe(false);
  });
  test("a stored order that puts ddgs first still leads a minor's blend with SearXNG", () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["ddgs", "searxng"]);
    expect(webSourcesFor("teen")).toEqual(["searxng", "ddgs"]);
    expect(webSourcesFor("adult")).toEqual(["ddgs", "searxng"]);
  });
  test("ddgs is never a minor's only source: a household that picked only ddgs gives them nothing", () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["ddgs"]);
    expect(webSourcesFor("teen")).toEqual([]);
  });
});

describe("on for teens and children", () => {
  beforeEach(() => setHouseholdSettingValue(MINOR_DDGS_KEY, "teens_and_children"));
  test("a child gets ddgs too, with strict safe search", async () => {
    expect(webSourcesFor("child")).toEqual(["searxng", "ddgs"]);
    expect(await ask("child")).toEqual(["https://searx.example/p", "https://duck.example/p"]);
    expect(sidecarHits[0]!.searchParams.get("safesearch")).toBe("on");
  });
});

describe("the other gates still hold", () => {
  test("a spoken turn keeps a minor on SearXNG only", async () => {
    setHouseholdSettingValue(MINOR_DDGS_KEY, "teens_and_children");
    expect(webSourcesFor("teen", false, true)).toEqual(["searxng"]);
    expect(await ask("teen", { spoken: true })).toEqual(["https://searx.example/p"]);
    expect(await ask("child", { spoken: true })).toEqual(["https://searx.example/p"]);
    expect(sidecarHits).toEqual([]);
    await expect(ddgsSearch({ args: { query: "x", spoken: true }, band: "child" })).rejects.toThrow();
  });
  test("a guest never reaches ddgs", async () => {
    setHouseholdSettingValue(MINOR_DDGS_KEY, "teens_and_children");
    await ask("guest");
    expect(sidecarHits).toEqual([]);
  });
  test("the band's web switch off closes ddgs with everything else", () => {
    setHouseholdSettingValue(MINOR_DDGS_KEY, "teens_and_children");
    setHouseholdSettingValue("search.web.teen_mode", "off");
    expect(webSourcesFor("teen")).toEqual([]);
    expect(webSourcesFor("child")).toEqual(["searxng", "ddgs"]);
  });
  test("a child's temporary chat stays offline", () => {
    setHouseholdSettingValue(MINOR_DDGS_KEY, "teens_and_children");
    expect(webSourcesFor("child", true)).toEqual([]);
  });
  test("an unknown stored value reads as off", () => {
    expect(minorDdgsAllowed("teen")).toBe(false);
    expect(minorDdgsAllowed("adult")).toBe(false);
  });
});
