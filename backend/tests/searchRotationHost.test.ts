// SEARCH-ROTATE-01 through the host: a research round of four searches no longer goes to one source four times. The household
// SearXNG here answers like a walled-off one ("too many requests" from its upstream engines); the live Wikimedia search is a real
// HTTP server on loopback. Offline and deterministic.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { createHost, __benchEngineForTests, __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests, __setEmptyRetryDelayForTests } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { newResearchBudget, runWithResearchBudget } from "@/lib/researchBudget";
import { searchBackendStatus, __setBackendPaceForTests } from "@/lib/retrieval/searchBackends";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";

const servers: Array<{ stop: (force?: boolean) => void }> = [];
const savedBase = process.env.MAIPAI_WIKIPEDIA_BASE_URL;

beforeEach(() => resetDb());
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  if (savedBase === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
  else process.env.MAIPAI_WIKIPEDIA_BASE_URL = savedBase;
  __resetSearchCacheForTests();
  __resetSearxngEnginesCacheForTests();
});

const manifest = () =>
  PackageManifest.parse({ id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test", description: "A test package.", author: "test", license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0, permissions: ["integration:searxng"] });

async function setup(searxBehaviour: "walled" | "ok") {
  __resetSearchCacheForTests();
  __resetSearxngEnginesCacheForTests();
  __resetRateLimiterForTests();
  for (const id of ["searxng", "wikimedia"] as const) __setBackendPaceForTests(id, { minGapMs: 0, burst: 1 });
  const counts = { searx: 0, wiki: 0 };
  const searx = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/config") return Response.json({ engines: [] });
      counts.searx += 1;
      if (searxBehaviour === "walled") return Response.json({ results: [], infoboxes: [], unresponsive_engines: [["brave", "Suspended: too many requests"], ["google", "Suspended: too many requests"]] });
      const q = url.searchParams.get("q") ?? "";
      return Response.json({ results: [1, 2, 3].map((i) => ({ title: `${q} result ${i}`, url: `https://site${i}.example.com/${i}`, content: `about ${q}` })), infoboxes: [] });
    },
  });
  const wiki = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (!url.pathname.endsWith("/search/page")) return new Response("not found", { status: 404 });
      counts.wiki += 1;
      const q = url.searchParams.get("q") ?? "";
      return Response.json({ pages: [1, 2, 3].map((i) => ({ key: `Page_${i}`, title: `${q} page ${i}`, description: `about ${q}`, excerpt: `<span class="searchmatch">${q}</span> text` })) });
    },
  });
  servers.push(searx, wiki);
  process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${wiki.port}`;
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searx.port}`);
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const host = createHost({ ...person, role: "adult" } as typeof person, manifest());
  const run = (query: string) => runWithResearchBudget(newResearchBudget(false), () => host.integration.call("searxng", "search", { query })) as Promise<{ rows: { url: string | null }[] }>;
  return { counts, run };
}

describe("a research round through the host", () => {
  test("a walled-off SearXNG is asked once; the rest of the research round is answered by the other backend", async () => {
    const { counts, run } = await setup("walled");
    const queries = ["harbor lighthouse history", "harbor lighthouse keeper", "harbor lighthouse lens"];
    const answers: { rows: { url: string | null }[] }[] = [];
    for (const q of queries) answers.push(await run(q));
    // Every search still got rows, from the live Wikimedia search, and SearXNG was not hit again after it walled off.
    for (const answer of answers) expect(answer.rows.length).toBeGreaterThan(0);
    expect(answers[0]!.rows[0]!.url).toContain("/wiki/Page_");
    expect(counts.searx).toBe(1);
    expect(counts.wiki).toBeGreaterThanOrEqual(3);
    expect(searchBackendStatus().find((entry) => entry.id === "searxng")!.healthy).toBe(false);
  });

  test("a healthy SearXNG answers a research search by itself and the extra backend is left alone", async () => {
    const { counts, run } = await setup("ok");
    const out = await run("harbor lighthouse history");
    expect(out.rows.length).toBe(3);
    expect(counts.searx).toBe(1);
    expect(counts.wiki).toBe(0);
  });

  test("the same research search asked again within ten minutes does not reach any backend", async () => {
    const { counts, run } = await setup("ok");
    await run("harbor lighthouse history");
    await run("Harbor  Lighthouse History");
    expect(counts.searx).toBe(1);
  });
});

describe("SEARCH-EMPTY-FAST-01: a silent empty answer is retried once with every engine", () => {
  test("bing and mwmbl answer nothing without saying why; the retry also asks the benched yahoo and gets rows", async () => {
    __resetSearchCacheForTests();
    __resetSearxngEnginesCacheForTests();
    __resetSearchRotationForTests();
    __resetRateLimiterForTests();
    __setEmptyRetryDelayForTests(0);
    for (const id of ["searxng", "wikimedia"] as const) __setBackendPaceForTests(id, { minGapMs: 0, burst: 1 });
    const asked: string[] = [];
    const searx = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/config") return Response.json({ engines: ["bing", "mwmbl", "yahoo", "wikipedia"].map((name) => ({ name, enabled: true, safesearch: true, categories: name === "wikipedia" ? ["general"] : ["general", "web"] })) });
        const engines = url.searchParams.get("engines") ?? "";
        asked.push(engines);
        const q = url.searchParams.get("q") ?? "";
        if (!engines.split(",").includes("yahoo")) return Response.json({ results: [], infoboxes: [], unresponsive_engines: [] });
        return Response.json({ results: [1, 2, 3].map((i) => ({ title: `${q} result ${i}`, url: `https://site${i}.example.com/${i}`, content: `about ${q}`, engine: "yahoo" })), infoboxes: [], unresponsive_engines: [] });
      },
    });
    const wiki = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("nope", { status: 404 }) });
    servers.push(searx, wiki);
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${wiki.port}`;
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searx.port}`);
    __benchEngineForTests("yahoo", Date.now() + 120_000);
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const host = createHost({ ...person, role: "adult" } as typeof person, manifest());
    const out = (await runWithResearchBudget(newResearchBudget(false), () => host.integration.call("searxng", "search", { query: "harbor lighthouse keeper" }))) as { rows: { url: string | null }[] };
    expect(out.rows.length).toBe(3);
    expect(asked.length).toBe(2);
    expect(asked[1]!.split(",")).toContain("yahoo");
    __setEmptyRetryDelayForTests(null);
  });
});
