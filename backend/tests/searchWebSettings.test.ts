// SEARXNG-SET-05: the Settings > Search > Web search routes. Owner and admin only; same test, host rules and
// plain-words result as the setup screen (lib/searchAddressSave.ts); an empty address removes SearXNG.
import { beforeEach, describe, expect, test } from "bun:test";
import { __resetSearchInstanceCheckForTests, __setSearchInstanceFetchForTests } from "@/lib/searchInstanceCheck";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __setLastSearxngCanaryResultForTests } from "@/lib/searxngHealth";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
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

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

describe("web search settings routes", () => {
  test("a teen, a child and a normal adult get 403 on both routes", async () => {
    const admin = await owner();
    for (const profile of [{ displayName: "Marlow", role: "child" }, { displayName: "Iris", role: "teen" }, { displayName: "Raven", role: "adult", secret: "correcthorse2" }]) {
      const { id } = (await (await admin.post("/api/people", profile)).json()) as { id: string };
      const client = new TestClient();
      if (profile.role === "adult") await client.post("/api/auth/verify-secret", { personId: id, secret: profile.secret });
      else await client.post("/api/auth/select", { personId: id });
      expect((await client.get("/api/search/web")).status).toBe(403);
      expect((await client.post("/api/search/address", { url: "http://192.168.1.20:8888", dry_run: true })).status).toBe(403);
    }
  });

  test("Test saves nothing, Save stores the address, an empty address removes it", async () => {
    const admin = await owner();
    const tested = await admin.post("/api/search/address", { url: "http://192.168.1.20:8888", dry_run: true });
    expect(tested.status).toBe(200);
    const body = (await tested.json()) as { saved: boolean; result: { level: string; address: string } };
    expect(body.saved).toBe(false);
    expect(body.result.address).toBe("192.168.1.20:8888");
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
    expect((await admin.post("/api/search/address", { url: "http://192.168.1.20:8888" })).status).toBe(200);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("http://192.168.1.20:8888");
    const status = (await (await admin.get("/api/search/web")).json()) as { address: string; works: boolean | null; sources: string[]; ddgsReady: boolean };
    expect(status.address).toBe("http://192.168.1.20:8888");
    // The save re-checks at once and the checker paces repeat probes, so the answer is unknown (null), never a false "not working".
    expect(status.works).not.toBe(false);
    expect(status.sources).toEqual(["searxng"]);
    const cleared = await admin.post("/api/search/address", { url: "  " });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { cleared?: boolean }).cleared).toBe(true);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
  });

  test("the setup host rules apply: a public host is refused before anything is fetched", async () => {
    const admin = await owner();
    seen.length = 0;
    const refused = await admin.post("/api/search/address", { url: "http://example.com", dry_run: true });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("Use a search service on your home network.");
    expect(seen).toEqual([]);
  });

  test("an address that does not answer: Test reports fail, Save is refused and the old address stays", async () => {
    const admin = await owner();
    setHouseholdSettingValue("search.searxng_url", "http://192.168.1.99:8888");
    __setSearchInstanceFetchForTests(async () => { throw new Error("down"); });
    const tested = await admin.post("/api/search/address", { url: "http://192.168.1.20:8888", dry_run: true });
    expect(((await tested.json()) as { result: { canUse: boolean } }).result.canUse).toBe(false);
    expect((await admin.post("/api/search/address", { url: "http://192.168.1.20:8888" })).status).toBe(400);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("http://192.168.1.99:8888");
  });
});
