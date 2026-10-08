/** Loopback SearXNG stand-in: fixtures only, no external requests. */
import type { Server } from "bun";

export interface SearchFixture {
  id: string;
  prompt: string;
  fixture?: { as_of: string; title: string; content: string; url?: string };
}
export interface FixtureQuery { query: string; status: number; rows: number; fixtureId: string | null; }
export interface FixtureSearch { url: string; queries: FixtureQuery[]; pagesFetched: string[]; stop(): void; }

const terms = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2));
function chooseFixture(query: string, fixtures: readonly SearchFixture[]): SearchFixture | undefined {
  const queryTerms = terms(query);
  return fixtures.map((item) => ({ item, score: [...terms(item.prompt)].filter((word) => queryTerms.has(word)).length }))
    .sort((a, b) => b.score - a.score)[0]?.item;
}

export function startFixtureSearch(fixtures: readonly SearchFixture[], mode: "fixture" | "down" = "fixture"): FixtureSearch {
  const queries: FixtureQuery[] = [];
  const pagesFetched: string[] = [];
  let server: Server<undefined>;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/page/")) {
      const id = decodeURIComponent(url.pathname.slice("/page/".length));
      const item = fixtures.find((candidate) => candidate.id === id);
      if (!item) return new Response("not found", { status: 404 });
      pagesFetched.push(id);
      const fixture = item.fixture ?? { as_of: "2026-10-08", title: item.prompt, content: `Recorded fixture evidence for ${item.prompt}.` };
      return new Response(`<!doctype html><title>${fixture.title}</title><main>${fixture.content}<p>As of ${fixture.as_of}.</p></main>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const query = url.searchParams.get("q") ?? "";
    if (mode === "down") {
      queries.push({ query, status: 503, rows: 0, fixtureId: null });
      return new Response("fixture search unavailable", { status: 503 });
    }
    const item = chooseFixture(query, fixtures);
    if (!item) {
      queries.push({ query, status: 200, rows: 0, fixtureId: null });
      return Response.json({ query, number_of_results: 0, results: [], unresponsive_engines: [] });
    }
    const fixture = item.fixture ?? {
      as_of: "2026-10-08", title: item.prompt,
      content: `Recorded bench evidence for ${item.prompt}. This row is a fixture stand-in; it is not live search data.`,
      url: `http://fixture.invalid/${encodeURIComponent(item.id)}`,
    };
    const row = {
      title: fixture.title,
      url: `http://127.0.0.1:${server.port}/page/${encodeURIComponent(item.id)}`,
      content: `${fixture.content}\nAs of ${fixture.as_of}.`,
      engine: "maipai-bench-fixture", engines: ["maipai-bench-fixture"], score: 1,
      publishedDate: fixture.as_of,
    };
    queries.push({ query, status: 200, rows: 1, fixtureId: item.id });
    // Full text is included in the search row; no page URL is fetched.
    return Response.json({ query, number_of_results: 1, results: [row], unresponsive_engines: [] });
  }});
  return { url: `http://127.0.0.1:${server.port}`, queries, pagesFetched, stop: () => server.stop(true) };
}
