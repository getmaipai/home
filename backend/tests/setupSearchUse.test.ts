import { beforeEach, describe, expect, test } from "bun:test";
import { __resetSearchInstanceCheckForTests, __setSearchInstanceFetchForTests } from "@/lib/searchInstanceCheck";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __setLastSearxngCanaryResultForTests } from "@/lib/searxngHealth";
import { getHouseholdSettingValue } from "@/lib/settings";
import { parseSearchAddress } from "@/lib/setupSearchAddress";
import { db } from "@/db";
import { people } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

const ENGINES = ["brave", "duckduckgo", "wikipedia", "wikidata"].map((name) => ({ name, enabled: true, safesearch: true, categories: ["general", "web"] }))
  .concat(["wikicommons.images", "brave.images"].map((name) => ({ name, enabled: true, safesearch: true, categories: ["images"] })));
const seen: string[] = [];

beforeEach(() => {
  resetDb();
  __resetSearchInstanceCheckForTests();
  __setLastSearxngCanaryResultForTests(null, 0, null);
  __resetRateLimiterForTests();
  seen.length = 0;
  __setSearchInstanceFetchForTests(async (input) => {
    const url = new URL(String(input));
    seen.push(url.host);
    if (url.pathname === "/healthz") return new Response("OK", { status: 200 });
    if (url.pathname === "/config") return Response.json({ version: "2026.10.4", safe_search: 2, limiter: { enabled: false }, engines: ENGINES });
    if (url.pathname === "/search") return Response.json({ results: [] });
    if (url.pathname === "/stats/errors") return Response.json({});
    return new Response("missing", { status: 404 });
  });
});

const use = (body: unknown) => new TestClient().post("/api/setup/search/use-candidate", body);

describe("setup web search address", () => {
  test("home network hosts are accepted; public, link-local, metadata and credentials are refused", () => {
    for (const ok of ["http://127.0.0.1:8888", "http://localhost:8080", "https://10.0.0.5", "http://172.16.0.9:80", "http://172.31.255.1", "http://192.168.1.20:8888", "http://searx.local:8888"]) {
      expect(parseSearchAddress(ok).ok).toBe(true);
    }
    for (const bad of ["http://example.com", "http://8.8.8.8", "http://172.32.0.1", "http://169.254.169.254", "http://[fe80::1]", "http://localhost.example.com", "http://user:pw@192.168.1.2", "ftp://192.168.1.2", "searx.local"]) {
      expect(parseSearchAddress(bad).ok).toBe(false);
    }
    expect((parseSearchAddress("http://example.com") as { error: string }).error).toBe("Use a search service on your home network.");
  });

  test("Test checks the address and saves nothing; Save stores it", async () => {
    const tested = await use({ url: "http://192.168.1.20:8888", dry_run: true });
    expect(tested.status).toBe(200);
    expect(await tested.json()).toEqual({ saved: false });
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
    const saved = await use({ url: "http://192.168.1.20:8888" });
    expect(saved.status).toBe(200);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("http://192.168.1.20:8888");
    expect(getHouseholdSettingValue("search.web_sources")).toEqual(["searxng"]);
  });

  test("a public host and a 169.254 address are refused before anything is fetched", async () => {
    for (const url of ["http://example.com", "http://169.254.169.254/latest"]) {
      const response = await use({ url });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("Use a search service on your home network.");
    }
    expect(seen).toEqual([]);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
  });

  test("an address that does not answer says what happened and what to do", async () => {
    __setSearchInstanceFetchForTests(async () => { throw new Error("down"); });
    const response = await use({ url: "http://192.168.1.20:8888", dry_run: true });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error.length).toBeGreaterThan(10);
  });

  test("skipping turns DuckDuckGo on by default for adults and saves no address", async () => {
    const response = await use({ ddgs_default: true });
    expect(response.status).toBe(200);
    expect(getHouseholdSettingValue("search.web_sources")).toEqual(["searxng", "ddgs"]);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
  });

  test("no address and no skip choice is refused", async () => {
    expect((await use({})).status).toBe(400);
    expect((await use({ dry_run: true })).status).toBe(400);
  });

  test("the no-people-yet guard holds: once Home has someone, nothing is tested or saved", async () => {
    const now = new Date().toISOString();
    const id = newPersonId();
    db.insert(people).values({ id, displayName: "Willow", role: "owner", avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix" }).run();
    for (const body of [{ url: "http://192.168.1.20:8888" }, { ddgs_default: true }]) expect((await use(body)).status).toBe(400);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
    expect(getHouseholdSettingValue("search.web_sources")).toEqual(["searxng"]);
  });
});
