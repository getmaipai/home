// SRCH lane (docs/design/RULES.md rules 6 and 7; THIN-1D, THIN-4D): a search
// whose engines are suspended is tried once more, after a person's pause, on
// the engines not benched; the Wikipedia fallback covers the suspended case;
// the retry never multiplies the page reads. Offline: a fake SearXNG with
// /config and /search, the page reader and Wikipedia pointed at fixtures.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "./reset-db";
import { searxngSearch, __setPageReaderForTests, __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests, SEARCH_PAGES_MAX, type PageReadResult } from "@/lib/packageHost";
import { searchTurnContext, searchRetryPauseMs, __setSearchRetryPauseForTests } from "@/lib/search/turnContext";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { useDefaultScriptedStack } from "./stackFixture";

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetSearchRotationForTests();
  __resetSearxngEnginesCacheForTests();
  __setSearchRetryPauseForTests(() => 0);
});

afterEach(() => {
  __setPageReaderForTests(null);
  __setSearchRetryPauseForTests(() => 0);
});

const ENGINES = ["brave", "duckduckgo", "startpage"].map((name) => ({ name, enabled: true, safesearch: true, categories: ["general", "web"] }));
const ROWS = [1, 2, 3, 4, 5].map((n) => ({ title: `Result ${n}`, url: `https://site${n}.example.com/page`, content: `snippet ${n}` }));

/** brave is suspended whenever the request names it or names no engines; a request that names only others succeeds. */
function fakeSearxng(opts: { recovers: boolean }) {
  const searches: URL[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/config") return Response.json({ engines: ENGINES });
      searches.push(url);
      const named = (url.searchParams.get("engines") ?? "").split(",").filter(Boolean);
      const braveAsked = named.length === 0 || named.includes("brave");
      if (braveAsked || !opts.recovers) return Response.json({ results: [], infoboxes: [], unresponsive_engines: [["brave", "Suspended: too many requests"]] });
      return Response.json({ results: ROWS, infoboxes: [] });
    },
  });
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
  return { server, searches };
}

function fakeWikipedia() {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/w/rest.php/v1/search/page")) return Response.json({ pages: [{ key: "Avengers" }] });
      return Response.json({ title: "Avengers", extract: "A team of heroes.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Avengers" } } });
    },
  });
  return server;
}

describe("a suspended engine gets one retry (the RDJ evidence, 2026-10-04)", () => {
  test("zero rows with brave suspended is retried once on the engines not benched, and its rows come back", async () => {
    const { server, searches } = fakeSearxng({ recovers: true });
    try {
      const result = await searxngSearch({ query: "is robert downey in it" }, {});
      expect(result.rows.length).toBeGreaterThan(0);
      const retried = searches[searches.length - 1]!;
      expect((retried.searchParams.get("engines") ?? "").split(",")).not.toContain("brave");
      expect(retried.searchParams.get("engines")).toBeTruthy();
      expect(result.via).toBe("searxng_retry");
    } finally {
      server.stop(true);
    }
  });

  test("it retries once and never more: an instance that stays suspended sees two search requests", async () => {
    const { server, searches } = fakeSearxng({ recovers: false });
    try {
      await expect(searxngSearch({ query: "is robert downey in it" }, { allowWikipediaFallback: false })).rejects.toMatchObject({ code: "search_unavailable" });
      expect(searches.length).toBeLessThanOrEqual(2);
      expect(searches.length).toBeGreaterThanOrEqual(2);
    } finally {
      server.stop(true);
    }
  });

  test("a spoken turn does not pause and retry", async () => {
    const { server, searches } = fakeSearxng({ recovers: true });
    try {
      const run = searchTurnContext.run({ signal: new AbortController().signal, spoken: true }, () => searxngSearch({ query: "is robert downey in it" }, { allowWikipediaFallback: false }));
      await expect(run).rejects.toMatchObject({ code: "search_unavailable" });
      expect(searches).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  test("the turn's abort signal cancels the pause: no second request", async () => {
    __setSearchRetryPauseForTests(() => 60_000);
    const { server, searches } = fakeSearxng({ recovers: true });
    try {
      const controller = new AbortController();
      const started = Date.now();
      const run = searchTurnContext.run({ signal: controller.signal, spoken: false }, () => searxngSearch({ query: "is robert downey in it" }, { allowWikipediaFallback: false }));
      setTimeout(() => controller.abort(), 30);
      await expect(run).rejects.toBeInstanceOf(HostError);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(searches).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  test("the pause is a person's pace: one to three seconds, randomized", () => {
    expect(searchRetryPauseMs(() => 0)).toBe(1_000);
    expect(searchRetryPauseMs(() => 1)).toBe(3_000);
    expect(searchRetryPauseMs(() => 0.5)).toBe(2_000);
  });
});

describe("the key-free Wikipedia fallback covers a suspended search that stays empty", () => {
  test("the rows come from Wikipedia and the outcome says so", async () => {
    const wiki = fakeWikipedia();
    const previous = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${wiki.port}`;
    const { server } = fakeSearxng({ recovers: false });
    try {
      const result = await searxngSearch({ query: "avengers" }, {});
      expect(result.rows[0]?.url).toBe("https://en.wikipedia.org/wiki/Avengers");
      expect(result.via).toBe("wikipedia");
    } finally {
      server.stop(true);
      wiki.stop(true);
      if (previous === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previous;
    }
  });
});

describe("politeness: the retry does not multiply page reads (THIN-4D)", () => {
  test("a recovered search reads at most the page budget", async () => {
    const fetched: string[] = [];
    __setPageReaderForTests(async (url) => {
      fetched.push(url);
      return { type: "document", file_id: "file-1", url, title: url, text: `Body of ${url}`, chunks: [], links: [], sections: [] } satisfies PageReadResult;
    });
    const { server } = fakeSearxng({ recovers: true });
    try {
      await searxngSearch({ query: "is robert downey in it", read_page: true }, {});
      expect(fetched.length).toBeLessThanOrEqual(SEARCH_PAGES_MAX);
      expect(fetched.length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });
});
