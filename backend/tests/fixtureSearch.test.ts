import { afterEach, describe, expect, test } from "bun:test";
import { startFixtureSearch } from "../scripts/bench/fixtureSearch";
import dataset from "../scripts/bench/datasets/chat-ab-01.json";

const running: { stop(): void }[] = [];
afterEach(() => { for (const server of running.splice(0)) server.stop(); });

describe("SEARCH-FRESH-01 fixture search", () => {
  test("resized E1 set is 60 fresh items plus 30 hard negatives in ten families", () => {
    const items = dataset.fresh.items;
    expect(items).toHaveLength(90);
    expect(items.filter((item) => item.kind === "time-sensitive" || item.kind === "timeless")).toHaveLength(60);
    const negatives = items.filter((item) => item.kind === "hard-negative");
    expect(negatives).toHaveLength(30);
    expect(new Set(negatives.map((item) => item.family)).size).toBe(10);
    // Bun's toMatchObject writes asymmetric matcher values onto the received
    // object. Match a copy so this shared JSON import stays fixture data for
    // other test files in the same process.
    for (const item of items) expect(structuredClone(item)).toMatchObject({ family: expect.any(String), split: "dev", gold: expect.stringMatching(/must|must_not|may/), age_row: "adult", acceptable_tools: expect.any(Array), expected_terms: expect.any(Array), fixture: { as_of: "2026-10-08" } });
  });
  test("serves recorded SearXNG rows and full page text from loopback", async () => {
    const fixture = startFixtureSearch([{ id: "ts-1", prompt: "weather Chicago this weekend", fixture: { as_of: "2026-10-08", title: "Chicago forecast", content: "Rain Saturday.", url: "http://fixture.invalid/ts-1" } }]);
    running.push(fixture);
    const response = await fetch(`${fixture.url}/search?q=${encodeURIComponent("weather Chicago this weekend")}&format=json`);
    const body = await response.json() as { results: { content: string; engines: string[] }[] };
    expect(response.status).toBe(200);
    expect(body.results[0]?.content).toContain("Rain Saturday.");
    expect(body.results[0]?.content).toContain("As of 2026-10-08");
    expect(fixture.queries).toEqual([{ query: "weather Chicago this weekend", status: 200, rows: 1, fixtureId: "ts-1" }]);
  });
  test("the down fixture returns 503 without contacting an upstream", async () => {
    const fixture = startFixtureSearch([{ id: "down-1", prompt: "current weather", fixture: { as_of: "2026-10-08", title: "fixture", content: "fixture" } }], "down");
    running.push(fixture);
    const response = await fetch(`${fixture.url}/search?q=current+weather&format=json`);
    expect(response.status).toBe(503);
    expect(fixture.queries[0]).toMatchObject({ query: "current weather", status: 503, rows: 0 });
  });
  test("all 60 fresh and timeless dataset items return fixture rows without network access", async () => {
    const fixtures = dataset.fresh.items.filter((item) => item.kind === "time-sensitive" || item.kind === "timeless");
    const server = startFixtureSearch(fixtures);
    running.push(server);
    for (const item of fixtures) {
      const response = await fetch(`${server.url}/search?q=${encodeURIComponent(item.prompt)}&format=json`);
      const body = await response.json() as { results: { content: string; url: string }[] };
      expect(response.status).toBe(200);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]?.content).toContain("As of 2026-10-08");
      expect(new URL(body.results[0]!.url).hostname).toBe("127.0.0.1");
    }
    expect(server.queries).toHaveLength(60);
    expect(server.queries.every((q) => q.rows === 1 && q.status === 200)).toBe(true);
  });
});
