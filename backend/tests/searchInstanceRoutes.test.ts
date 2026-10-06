import { beforeEach, describe, expect, test } from "bun:test";
import { __resetSearchInstanceCheckForTests, __setSearchInstanceFetchForTests } from "@/lib/searchInstanceCheck";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __setLastSearxngCanaryResultForTests } from "@/lib/searxngHealth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

const TEST_URL = "http://192.0.2.20:8080";

beforeEach(() => {
  resetDb();
  __resetSearchInstanceCheckForTests();
  __setLastSearxngCanaryResultForTests(null, 0, null);
  __resetRateLimiterForTests();
  __setSearchInstanceFetchForTests(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/healthz") return new Response("OK", { status: 200 });
    if (url.pathname === "/config") return Response.json({
      version: "2026.10.4",
      safe_search: 2,
      limiter: { enabled: false },
      engines: [
        { name: "brave", enabled: true, safesearch: true, categories: ["general", "web"] },
        { name: "duckduckgo", enabled: true, safesearch: true, categories: ["general", "web"] },
        { name: "wikipedia", enabled: true, safesearch: true, categories: ["general", "web"] },
        { name: "wikidata", enabled: true, safesearch: true, categories: ["general", "web"] },
        { name: "wikicommons.images", enabled: true, safesearch: true, categories: ["images"] },
        { name: "brave.images", enabled: true, safesearch: true, categories: ["images"] },
      ],
    });
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

describe("SearXNG settings routes", () => {
  test("only owner and admin can read status and snippets", async () => {
    const admin = await owner();
    for (const profile of [
      { displayName: "Marlow", role: "child" },
      { displayName: "Iris", role: "teen" },
      { displayName: "Raven", role: "adult", secret: "correcthorse2" },
    ]) {
      const created = await admin.post("/api/people", profile);
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const client = new TestClient();
      if (profile.role === "adult") await client.post("/api/auth/verify-secret", { personId: id, secret: profile.secret });
      else await client.post("/api/auth/select", { personId: id });
      expect((await client.get("/api/search/instance")).status).toBe(403);
      expect((await client.get("/api/search/instance/snippet")).status).toBe(403);
      expect((await client.get("/api/search/instance/preview")).status).toBe(403);
      expect((await client.post("/api/search/instance/apply")).status).toBe(403);
      expect((await client.post("/api/search/instance/revert")).status).toBe(403);
    }
    const adminCreated = await admin.post("/api/people", { displayName: "Nova", role: "admin", secret: "correcthorse3" });
    expect(adminCreated.status).toBe(201);
    const { id } = (await adminCreated.json()) as { id: string };
    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: id, secret: "correcthorse3" });
    expect((await adminClient.get("/api/search/instance")).status).toBe(200);
  });

  test("saving the SearXNG setting calls the checker and status omits its address", async () => {
    const client = await owner();
    const paths: string[] = [];
    __setSearchInstanceFetchForTests(async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/healthz") return new Response("OK", { status: 200 });
      if (url.pathname === "/config") return Response.json({ version: "2026.10.4", safe_search: 2, limiter: { enabled: false }, engines: [] });
      if (url.pathname === "/search") return Response.json({ results: [] });
      return Response.json({});
    });

    const saved = await client.put("/api/settings", { scope: "household", key: "search.searxng_url", value: TEST_URL });
    expect(saved.status).toBe(200);
    expect(paths).toContain("/healthz");
    const status = await client.get("/api/search/instance");
    expect(status.status).toBe(200);
    const body = await status.text();
    expect(body).not.toContain(TEST_URL);
    expect(JSON.parse(body)).toMatchObject({ mode: "owner", checkedAt: expect.any(String), checks: expect.any(Array) });
  });

  test("manual refresh is limited to one check per minute", async () => {
    const client = await owner();
    await client.put("/api/settings", { scope: "household", key: "search.searxng_url", value: TEST_URL });
    expect((await client.get("/api/search/instance?refresh=1")).status).toBe(200);
    const second = await client.get("/api/search/instance?refresh=1");
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ retryAfterSeconds: expect.any(Number) });
  });

  test("an empty owner URL selects Stack mode when the household has a Stack", async () => {
    const client = await owner();
    __setStackClientForTests({} as never);
    setHouseholdSettingValue("search.searxng_url", "");
    const status = await client.get("/api/search/instance");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ mode: "stack" });
  });
});
