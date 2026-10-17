// SEARCH-DDGS-01: the ddgs source against a fake sidecar. Offline and deterministic.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetDdgsForTests, __setDdgsClockForTests, ddgsSearch } from "@/lib/retrieval/ddgsSource";
import { DDGS_URL_ENV, ddgsConfigured } from "@/lib/retrieval/ddgsConfig";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { TestClient } from "./client";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { createHost, __resetSearchCacheForTests } from "@/lib/packageHost";
import { WEB_SOURCES_KEY, validateWebSources, webSourcesFor, UNBUILT_ONLY_NOTE } from "@/lib/retrieval/webSources";

let sidecar: ReturnType<typeof Bun.serve>;
let hits: string[];
let respond: () => Response;
let now: number;

beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetDdgsForTests();
  hits = [];
  now = 1_000_000;
  __setDdgsClockForTests(() => now);
  respond = () => Response.json({ rows: [{ title: "Marsh", url: "https://marsh.example/a#frag", snippet: "a bird" }, { title: "", url: "https://x.example/" }, { title: "Bad", url: "javascript:1" }] });
  sidecar = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => { hits.push(new URL(req.url).searchParams.get("q") ?? ""); return respond(); } });
  process.env[DDGS_URL_ENV] = `http://127.0.0.1:${sidecar.port}`;
});
afterEach(() => {
  sidecar.stop(true);
  delete process.env[DDGS_URL_ENV];
});

const ctx = (band: "adult" | "teen" | "child" = "adult") => ({ args: { query: "herons" }, band });

describe("configuration", () => {
  test("unset means unbuilt: ddgs is inert and a ddgs-only list is refused, as before", () => {
    delete process.env[DDGS_URL_ENV];
    expect(ddgsConfigured()).toBe(false);
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    expect(webSourcesFor("adult")).toEqual(["searxng"]);
    expect(validateWebSources(WEB_SOURCES_KEY, ["ddgs"])).toBe(UNBUILT_ONLY_NOTE);
  });
  test("a non-loopback address is not accepted", () => {
    process.env[DDGS_URL_ENV] = "http://192.0.2.10:8793";
    expect(ddgsConfigured()).toBe(false);
  });
  test("set means built: an adult gets it, a child and teen never do", () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["searxng", "ddgs"]);
    expect(webSourcesFor("adult")).toEqual(["searxng", "ddgs"]);
    expect(webSourcesFor("child")).toEqual(["searxng"]);
    expect(webSourcesFor("teen")).toEqual(["searxng"]);
    expect(validateWebSources(WEB_SOURCES_KEY, ["ddgs"])).toBeNull();
  });
});

describe("ddgsSearch", () => {
  test("returns clean rows and drops rows with no title or a non-web link", async () => {
    const out = await ddgsSearch(ctx());
    expect(out.rows).toEqual([{ title: "Marsh", url: "https://marsh.example/a", snippet: "a bird" }]);
    expect(hits).toEqual(["herons"]);
  });
  test("a child or teen never makes a request, even if called directly", async () => {
    await expect(ddgsSearch(ctx("child"))).rejects.toThrow();
    await expect(ddgsSearch(ctx("teen"))).rejects.toThrow();
    expect(hits).toEqual([]);
  });
  test("the bucket refuses a burst without calling the sidecar", async () => {
    await ddgsSearch(ctx());
    await ddgsSearch(ctx());
    await expect(ddgsSearch(ctx())).rejects.toThrow(/rate-limited/);
    expect(hits).toHaveLength(2);
  });
  test("the first 429 opens quiet mode: no request for an hour, then one; a repeat block waits longer", async () => {
    respond = () => new Response(JSON.stringify({ error: "blocked" }), { status: 429 });
    await expect(ddgsSearch(ctx())).rejects.toThrow(/isn't answering/);
    expect(hits).toHaveLength(1);
    now += 59 * 60_000;
    await expect(ddgsSearch(ctx())).rejects.toThrow(/isn't answering/);
    expect(hits).toHaveLength(1);
    now += 2 * 60_000;
    await expect(ddgsSearch(ctx())).rejects.toThrow();
    expect(hits).toHaveLength(2);
    now += 2 * 60 * 60_000;
    await expect(ddgsSearch(ctx())).rejects.toThrow();
    expect(hits).toHaveLength(2);
    now += 2 * 60 * 60_000;
    respond = () => Response.json({ rows: [] });
    await ddgsSearch(ctx());
    expect(hits).toHaveLength(3);
  });
  test("a refused connection is not a block and opens no quiet window", async () => {
    sidecar.stop(true);
    await expect(ddgsSearch(ctx())).rejects.toThrow(/isn't answering/);
    sidecar = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ rows: [] }) });
    process.env[DDGS_URL_ENV] = `http://127.0.0.1:${sidecar.port}`;
    expect((await ddgsSearch(ctx())).rows).toEqual([]);
  });
});

describe("through the host", () => {
  const manifest = () =>
    PackageManifest.parse({ id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test", description: "A test package.", author: "test", license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0, permissions: ["integration:searxng"] });
  async function ask(role: "adult" | "guest" | "child") {
    __resetSearchCacheForTests();
    __resetRateLimiterForTests();
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:9");
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const host = createHost({ ...person, role } as typeof person, manifest());
    return host.integration.call("searxng", "search", { query: "herons", read_page: false }) as Promise<{ rows: { url: string | null }[] }>;
  }
  test("an adult who picked only ddgs is answered by the sidecar, minus always-blocked sites", async () => {
    respond = () => Response.json({ rows: [{ title: "Good", url: "https://good.example/", snippet: "x" }, { title: "Bad", url: "https://blocked.example.com/p", snippet: "y" }] });
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["ddgs"]);
    setHouseholdSettingValue("search.hosts.deny", "blocked.example.com");
    const out = await ask("adult");
    expect(out.rows.map((r) => r.url)).toEqual(["https://good.example/"]);
    expect(hits).toEqual(["herons"]);
  });
  test("a guest and a child never reach the sidecar", async () => {
    setHouseholdSettingValue(WEB_SOURCES_KEY, ["ddgs"]);
    await ask("guest");
    await ask("child");
    expect(hits).toEqual([]);
  });
});

describe("review fixes", () => {
  test("a guest role is refused even with an adult band", async () => {
    await expect(ddgsSearch({ args: { query: "herons" }, band: "adult", role: "guest" })).rejects.toThrow();
    expect(hits).toEqual([]);
  });
  test("after a block only one probe runs at a time", async () => {
    respond = () => new Response("{}", { status: 429 });
    await expect(ddgsSearch(ctx())).rejects.toThrow();
    now += 61 * 60_000;
    let release: () => void = () => {};
    respond = () => { throw new Error("unused"); };
    sidecar.stop(true);
    sidecar = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async () => { await new Promise<void>((r) => { release = r; }); return Response.json({ rows: [] }); } });
    process.env[DDGS_URL_ENV] = `http://127.0.0.1:${sidecar.port}`;
    const first = ddgsSearch(ctx());
    await Bun.sleep(30);
    await expect(ddgsSearch(ctx())).rejects.toThrow(/isn't answering/);
    release();
    await first;
  });
});
