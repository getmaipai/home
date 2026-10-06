import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import configFull from "./fixtures/searxng/config-full.json";
import searchOk from "./fixtures/searxng/search-ok.json";
import { checkSearchInstance, buildSearchInstanceSnippet, __resetSearchInstanceCheckForTests, type SearchInstanceFetch } from "@/lib/searchInstanceCheck";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetRateLimiterForTests, __setRateLimiterClockForTests, tryConsume } from "@/lib/rateLimiter";
import { __setLastSearxngCanaryResultForTests } from "@/lib/searxngHealth";
import { listIssues } from "@/lib/issues";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const TEST_URL = "http://192.0.2.10:8080";
const FIXED_NOW = Date.parse("2026-10-06T18:00:00.000Z");

beforeEach(() => {
  resetDb();
  __resetSearchInstanceCheckForTests();
  __setLastSearxngCanaryResultForTests(null, 0, null);
  __resetRateLimiterForTests();
  __setRateLimiterClockForTests(() => FIXED_NOW);
  setHouseholdSettingValue("search.searxng_url", TEST_URL);
});

afterEach(() => {
  __setRateLimiterClockForTests(() => Date.now());
  return __drainBackgroundWorkForTests();
});

function stubFetch(config: unknown, searchResponse: Response = Response.json(searchOk)) {
  const paths: string[] = [];
  const fetcher: SearchInstanceFetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === "/healthz") return new Response("OK", { status: 200 });
    if (url.pathname === "/config") return Response.json(config);
    if (url.pathname === "/stats/errors") return Response.json({});
    if (url.pathname === "/search") return searchResponse;
    return new Response("missing", { status: 404 });
  };
  return { fetcher, paths };
}

describe("search instance checks", () => {
  test("an instance with JSON turned off fails the readable-results check and the snippet adds json to search.formats", async () => {
    const { fetcher } = stubFetch(configFull, new Response("Forbidden", { status: 403 }));
    const status = await checkSearchInstance({ force: true, fetcher, now: FIXED_NOW });
    const readable = status.checks.find((check) => check.id === "json-format");

    expect(readable).toMatchObject({ state: "fail", detail: "JSON results are turned off.", fix: "Add json to search.formats." });
    expect(buildSearchInstanceSnippet(status).settingsYml).toContain("json");
  });

  test("an instance with no picture engines fails the pictures check and the snippet enables wikicommons.images and brave.images", async () => {
    const noImages = {
      ...configFull,
      engines: configFull.engines.filter((engine) => engine.categories[0] !== "images"),
    };
    const { fetcher } = stubFetch(noImages);
    const status = await checkSearchInstance({ force: true, fetcher, now: FIXED_NOW });
    const pictures = status.checks.find((check) => check.id === "pictures");
    const snippet = buildSearchInstanceSnippet(status).settingsYml;

    expect(pictures).toMatchObject({ state: "fail", detail: "No picture engines are on, so answers can't show pictures from the web." });
    expect(snippet).toContain("wikicommons.images");
    expect(snippet).toContain("brave.images");
  });

  test("one full check makes at most four requests through the shared SearXNG bucket", async () => {
    const { fetcher, paths } = stubFetch(configFull);
    await checkSearchInstance({ force: true, fetcher, now: FIXED_NOW });

    expect(paths.length).toBeLessThanOrEqual(4);
    expect(paths).toContain("/healthz");
    expect(paths).toContain("/config");
    expect(paths.filter((path) => path === "/healthz" || path === "/config" || path === "/stats/errors" || path === "/search").length).toBeLessThanOrEqual(4);
    expect(tryConsume("searxng", { capacity: 3, refillPerSecond: 1 / 6 }, FIXED_NOW)).toBe(false);
  });

  test("an SSO page fails the readable-results check with a sign-in fix", async () => {
    const { fetcher } = stubFetch(configFull, new Response("<html><form>Sign in</form></html>", { headers: { "content-type": "text/html" } }));
    const status = await checkSearchInstance({ force: true, fetcher, now: FIXED_NOW });
    expect(status.checks.find((check) => check.id === "json-format")).toMatchObject({ state: "fail", detail: "The address opens a sign-in page.", fix: "Use an address that skips your sign-in page." });
  });

  test("a 429 with the limiter on produces the limiter fix", async () => {
    const { fetcher } = stubFetch(configFull, new Response("blocked", { status: 429 }));
    const status = await checkSearchInstance({ force: true, fetcher, now: FIXED_NOW });
    expect(status.checks.find((check) => check.id === "limiter")).toMatchObject({ state: "fail", detail: "Your SearXNG's limiter is blocking MaiPai.", fix: "Add this hub's address to pass_ip in limiter.toml." });
    expect(buildSearchInstanceSnippet(status).limiterToml).not.toBeNull();
  });

  test("an old version warns, while missing /stats/errors stays unknown", async () => {
    __setLastSearxngCanaryResultForTests(TEST_URL, FIXED_NOW - 60_000, true);
    const oldConfig = { ...configFull, version: "2025.01.01" };
    const { fetcher } = stubFetch(oldConfig);
    const statsAwareFetcher: SearchInstanceFetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/stats/errors") return new Response("missing", { status: 404 });
      return fetcher(input, init);
    };
    const status = await checkSearchInstance({ force: true, fetcher: statsAwareFetcher, now: FIXED_NOW });

    expect(status.checks.find((check) => check.id === "version")).toMatchObject({ state: "warn", fix: "Update SearXNG." });
    expect(status.checks.find((check) => check.id === "engine-errors")).toMatchObject({ state: "unknown", detail: "This SearXNG doesn't share error numbers." });
  });

  test("a child profile with no safe picture engine gets a failing check and a Repairs item", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.post("/api/people", { displayName: "Marlow", role: "child" });
    const noSafeImages = {
      ...configFull,
      engines: configFull.engines.map((engine) => engine.categories[0] === "images" ? { ...engine, enabled: false } : engine),
    };
    const { fetcher } = stubFetch(noSafeImages);
    const status = await checkSearchInstance({ force: true, fetcher, now: FIXED_NOW });

    expect(status.checks.find((check) => check.id === "safe-search")).toMatchObject({ state: "fail", detail: "No child-safe engines are on for pictures." });
    expect(listIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ source: "websearch", key: "searxng_safe_search_engines", severity: "error" })]));
  });

  test("the snippet never includes a secret key or the SearXNG address", async () => {
    const { fetcher } = stubFetch({ ...configFull, engines: configFull.engines.filter((engine) => engine.categories[0] !== "images") });
    const status = await checkSearchInstance({ force: true, fetcher, now: FIXED_NOW });
    const snippet = buildSearchInstanceSnippet(status);
    expect(snippet.settingsYml).not.toContain("secret_key");
    expect(snippet.settingsYml).not.toContain(TEST_URL);
    expect(snippet.limiterToml ?? "").not.toContain(TEST_URL);
  });
});
