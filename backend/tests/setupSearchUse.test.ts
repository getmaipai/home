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
    const body = (await tested.json()) as { saved: boolean; result: { level: string; headline: string; recommendation: string; canUse: boolean; address: string } };
    expect(body.saved).toBe(false);
    expect(body.result.level).toBe("pass");
    expect(body.result.address).toBe("192.168.1.20:8888");
    expect(body.result.headline).toBe("192.168.1.20:8888 works. 6 search engines are turned on.");
    expect(body.result.recommendation).toBe("Recommended: use it.");
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

  test("an address that does not answer: Test names it and says what to do, Save is refused", async () => {
    __setSearchInstanceFetchForTests(async () => { throw new Error("down"); });
    const response = await use({ url: "http://192.168.1.20:8888", dry_run: true });
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: { level: string; canUse: boolean; headline: string; recommendation: string } };
    expect(result.level).toBe("fail");
    expect(result.canUse).toBe(false);
    expect(result.headline).toBe("Home could not reach 192.168.1.20:8888.");
    expect(result.recommendation).toContain("press Test again");
    const refused = await use({ url: "http://192.168.1.20:8888" });
    expect(refused.status).toBe(400);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
  });

  test("engines having trouble: works with a warning, names the engines, recommends, and Save is allowed", async () => {
    __setSearchInstanceFetchForTests(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/healthz") return new Response("OK", { status: 200 });
      if (url.pathname === "/config") return Response.json({ version: "2026.10.4", safe_search: 2, limiter: { enabled: false }, engines: ENGINES });
      if (url.pathname === "/search") return Response.json({ results: [] });
      if (url.pathname === "/stats/errors") return Response.json({ brave: [{ percentage: 80 }], duckduckgo: [{ percentage: 90 }] });
      return new Response("missing", { status: 404 });
    });
    const response = await use({ url: "http://192.168.1.20:8888", dry_run: true });
    const { result } = (await response.json()) as { result: { level: string; canUse: boolean; verdict: string; recommendation: string; trouble: { label: string }[] } };
    expect(result.level).toBe("warn");
    expect(result.canUse).toBe(true);
    expect(result.trouble.length).toBe(2);
    expect(result.verdict).toContain("not answering right now. Results may be thinner.");
    expect(result.recommendation).toStartWith("Recommended: use it anyway");
    expect(JSON.stringify(result)).not.toContain("Check whether these engines");
    expect((await use({ url: "http://192.168.1.20:8888" })).status).toBe(200);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("http://192.168.1.20:8888");
  });

  test("a failing check blocks: no web engines gives a fail with the one next step", async () => {
    __setSearchInstanceFetchForTests(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/healthz") return new Response("OK", { status: 200 });
      if (url.pathname === "/config") return Response.json({ version: "2026.10.4", safe_search: 2, limiter: { enabled: false }, engines: [] });
      if (url.pathname === "/search") return Response.json({ results: [] });
      return new Response("missing", { status: 404 });
    });
    const { result } = (await (await use({ url: "http://192.168.1.20:8888", dry_run: true })).json()) as { result: { level: string; canUse: boolean; recommendation: string } };
    expect(result.level).toBe("fail");
    expect(result.canUse).toBe(false);
    expect(result.recommendation).toStartWith("Recommended: ");
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
