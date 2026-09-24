import { describe, expect, test, beforeEach } from "bun:test";
import { checkSearxngHealth } from "@/lib/searxngHealth";
import { listIssues } from "@/lib/issues";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";

beforeEach(() => {
  resetDb();
  // SEARCH-PACE-01: every test here makes a real searxngSearch() call
  // through the same shared per-host bucket, now tightened to a burst
  // of 3 - without this, a later test in the file starts with whatever
  // tokens earlier ones left it and can see a spurious rate_limited
  // instead of the real fixture response it scripted.
  __resetRateLimiterForTests();
});

// Jesse, 2026-09-07: "we need to be able to detect if search is down,
// outdated, or simply not returning results - or if the URL is invalid -
// and notify on all of those." Three distinct failure modes, three
// distinct issues (searxngHealth.ts's own header has the full reasoning
// for why they're kept separate rather than one generic "search is
// broken").
describe("checkSearxngHealth", () => {
  test("not configured yet: a no-op, not a fault - web search is opt-in", async () => {
    await checkSearxngHealth();
    expect(listIssues()).toHaveLength(0);
  });

  test("an unreachable/invalid URL raises searxng_unreachable", async () => {
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
    await checkSearxngHealth();
    const issue = listIssues().find((i) => i.source === "websearch" && i.key === "searxng_unreachable");
    expect(issue).toBeDefined();
    expect(issue!.title).toBe("Web search can't reach your SearXNG instance");
  });

  // Found live 2026-09-06: a URL sitting behind SSO returns its login
  // page (real HTML, not JSON) rather than erroring outright -
  // searxngSearch() itself now throws for this shape (packageHost.ts's
  // expectJsonObject), which this reuses rather than re-deriving.
  test("a non-JSON response (e.g. an SSO login page) also raises searxng_unreachable", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("<html><body>Log in</body></html>", { headers: { "content-type": "text/html" } }) });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      await checkSearxngHealth();
      const issue = listIssues().find((i) => i.source === "websearch" && i.key === "searxng_unreachable");
      expect(issue).toBeDefined();
      expect(issue!.detail).toContain("didn't return a JSON response");
    } finally {
      server.stop(true);
    }
  });

  // Found live 2026-09-06/07: an 18-month-stale SearXNG install returned
  // real, valid JSON with zero results for ordinary queries (its
  // scraping-based engines' parsers no longer matched the real sites) -
  // reachable and JSON, but still broken in a way a household needs to
  // know about.
  test("valid JSON with zero results raises searxng_empty, a different issue than unreachable", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ results: [], infoboxes: [] }) });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      await checkSearxngHealth();
      const issues = listIssues();
      const empty = issues.find((i) => i.source === "websearch" && i.key === "searxng_empty");
      expect(empty).toBeDefined();
      expect(empty!.title).toBe("Web search isn't finding anything");
      expect(issues.find((i) => i.key === "searxng_unreachable")).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  // SEARCH-EMPTY-01 (docs/dev.md, 2026-09-24): distinguished from BOTH
  // the unreachable and the stale-install cases - a real, reachable,
  // JSON-answering instance whose own engines are suspended must not
  // send someone chasing the URL field in Settings, which was never
  // the problem (a review caught the first cut of this item's own
  // packageHost.ts throw doing exactly that, by falling into this
  // function's catch-all branch).
  test("engines suspended (unresponsive_engines, zero rows) raises searxng_empty, never searxng_unreachable", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ results: [], infoboxes: [], unresponsive_engines: [["brave", "Suspended: too many requests"]] }),
    });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      await checkSearxngHealth();
      const issues = listIssues();
      expect(issues.find((i) => i.source === "websearch" && i.key === "searxng_empty")).toBeDefined();
      expect(issues.find((i) => i.key === "searxng_unreachable")).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  // The infobox-only counterpart to the review's own finding: a real
  // answer via infoboxes (never checked by rows alone, only by the
  // shared SEARXNG_NO_RESULTS_TEXT signal) must not be misclassified as
  // an outage just because some other, unrelated engine also reported
  // itself suspended on the same response.
  test("a real infobox answer alongside an unrelated suspended engine still clears both issues", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          results: [],
          infoboxes: [{ infobox: "Earth", content: "The third planet from the Sun." }],
          unresponsive_engines: [["some other engine", "Suspended: too many requests"]],
        }),
    });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      await checkSearxngHealth();
      expect(listIssues().filter((i) => i.source === "websearch")).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  test("a real result clears both issues", async () => {
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
    await checkSearxngHealth();
    expect(listIssues().some((i) => i.source === "websearch" && i.key === "searxng_unreachable")).toBe(true);

    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ results: [{ title: "Earth", url: "https://example.com/earth", content: "The third planet." }] }),
    });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      await checkSearxngHealth();
      // listIssues() excludes resolved rows by default (lib/issues.ts's
      // own doc comment: "Unresolved-and-undismissed by default"), so a
      // healthy check leaving zero here proves both were actually
      // resolved, not just that nothing new was raised.
      expect(listIssues().filter((i) => i.source === "websearch")).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });
});
