// SEARCH-ROTATE-01: searches are spread across the search backends instead of going to one. The backends here are real HTTP
// servers on loopback (a fake that answers, one that answers 429, one that is slow, one that is down), so the scheduler, the
// pace, the cooldown ladder, the snapshot, the fusion and the cache run against real connections. Deterministic, offline.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __flushSearchBackendsForTests,
  __reloadSearchBackendsForTests,
  __resetSearchBackendsForTests,
  __setBackendPaceForTests,
  backendAvailable,
  pageCacheGet,
  pageCachePut,
  reportBackendOutcome,
  rotateSearch,
  rowsRelevant,
  searchBackendStatus,
  searchRotationCounters,
  type BackendAdapter,
  type BackendId,
} from "@/lib/retrieval/searchBackends";
import type { WebRow } from "@/lib/retrieval/webSources";

type Behaviour = "ok" | "429" | "down" | "junk" | "empty" | "thin";
interface Fake { id: BackendId; url: string; hits: number[]; behaviour: Behaviour; stop: () => void; adapter: BackendAdapter }

const servers: { stop: () => void }[] = [];

function rowsFor(id: string, q: string, count: number, base = id): WebRow[] {
  return Array.from({ length: count }, (_, i) => ({ title: `${q} guide ${i + 1} from ${base}`, url: `https://${base}.example.com/${encodeURIComponent(q)}/${i + 1}`, snippet: `About ${q}, part ${i + 1}` }));
}

function fake(id: BackendId, behaviour: Behaviour, over: { sharedUrls?: boolean } = {}): Fake {
  const hits: number[] = [];
  const state = { behaviour };
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      hits.push(Date.now());
      const q = new URL(req.url).searchParams.get("q") ?? "";
      switch (state.behaviour) {
        case "429": return new Response("slow down", { status: 429 });
        case "down": return new Response("nope", { status: 503 });
        case "junk": return Response.json({ rows: [{ title: "Unrelated pop singer news", url: "https://junk.example.com/a", snippet: "tour dates" }, { title: "Celebrity gossip", url: "https://junk.example.com/b", snippet: "red carpet" }, { title: "Fan club", url: "https://junk.example.com/c", snippet: "merch" }] });
        case "empty": return Response.json({ rows: [] });
        case "thin": return Response.json({ rows: rowsFor(id, q, 1, over.sharedUrls ? "shared" : id) });
        default: return Response.json({ rows: rowsFor(id, q, 4, over.sharedUrls ? "shared" : id) });
      }
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const adapter: BackendAdapter = {
    id,
    blockedCodes: ["search_unavailable"],
    async search(query) {
      const res = await fetch(`${url}/search?q=${encodeURIComponent(query)}`);
      if (res.status === 429) throw Object.assign(new Error("asked to slow down"), { status: 429 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { rows: WebRow[] };
      return { text: "", rows: body.rows };
    },
  };
  const entry: Fake = { id, url, hits, get behaviour() { return state.behaviour; }, set behaviour(value: Behaviour) { state.behaviour = value; }, stop: () => server.stop(true), adapter };
  servers.push(entry);
  return entry;
}

let dir: string;
let now: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maipai-rotate-"));
  now = 1_800_000_000_000;
  __resetSearchBackendsForTests({ now: () => now, file: join(dir, "search-backends.json") });
  for (const id of ["searxng", "ddgs", "wikimedia", "hosted"] as const) __setBackendPaceForTests(id, { minGapMs: 0, burst: 1 });
});
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
  __resetSearchBackendsForTests();
  rmSync(dir, { recursive: true, force: true });
});

const ask = (query: string, adapters: BackendAdapter[], extra: Partial<Parameters<typeof rotateSearch>[0]> = {}) => rotateSearch({ query, adapters, scope: "adult", ...extra });

describe("rotation across backends", () => {
  test("a backend that answers 429 does not fail the round: the others answer and the refuser cools down", async () => {
    const a = fake("searxng", "429");
    const b = fake("ddgs", "ok");
    const c = fake("wikimedia", "ok");
    const adapters = [a.adapter, b.adapter, c.adapter];
    // Several different queries: the refuser is asked at most once before it is skipped.
    for (const q of ["first topic", "second topic", "third topic", "fourth topic", "fifth topic"]) {
      const out = await ask(q, adapters);
      expect(out.rows.length).toBeGreaterThanOrEqual(3);
      expect(out.via).not.toContain("searxng");
    }
    expect(a.hits.length).toBe(1);
    expect(backendAvailable("searxng")).toBe(false);
    const status = searchBackendStatus().find((entry) => entry.id === "searxng")!;
    expect(status.healthy).toBe(false);
    expect(status.coolingUntil).toBeGreaterThan(now);
  });

  test("with every backend but one down the round still completes from that one", async () => {
    const down1 = fake("searxng", "down");
    const down2 = fake("ddgs", "429");
    const up = fake("wikimedia", "ok");
    const out = await ask("only one answers", [down1.adapter, down2.adapter, up.adapter]);
    expect(out.via).toEqual(["wikimedia"]);
    expect(out.rows.length).toBe(4);
  });

  test("when every backend fails the error reaches the caller, and a lone cooling backend is still probed once its turn comes", async () => {
    const only = fake("searxng", "down");
    await expect(ask("nothing answers", [only.adapter])).rejects.toThrow();
    expect(backendAvailable("searxng")).toBe(false);
    // The next query is a probe of the one cooling backend, not a refusal made without asking: it recovers.
    only.behaviour = "ok";
    const out = await ask("it is back", [only.adapter]);
    expect(out.via).toEqual(["searxng"]);
    expect(backendAvailable("searxng")).toBe(true);
  });

  test("a round of four searches is spread over the backends, not sent to one", async () => {
    const a = fake("searxng", "ok");
    const b = fake("ddgs", "ok");
    const c = fake("wikimedia", "ok");
    const adapters = [a.adapter, b.adapter, c.adapter];
    await Promise.all(["alpha topic", "bravo topic", "charlie topic", "delta topic"].map((q) => ask(q, adapters)));
    const counts = [a, b, c].map((f) => f.hits.length);
    expect(counts.reduce((x, y) => x + y, 0)).toBe(4);
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
  });

  test("a thin first answer is fused with a second backend, one entry per page, shared pages ranked first", async () => {
    const a = fake("searxng", "thin", { sharedUrls: true });
    const b = fake("ddgs", "ok", { sharedUrls: true });
    const out = await ask("fused topic", [a.adapter, b.adapter]);
    expect(out.via.length).toBe(2);
    const urls = out.rows.map((row) => row.url);
    expect(new Set(urls).size).toBe(urls.length);
    // The page both backends returned leads the list.
    expect(urls[0]).toBe("https://shared.example.com/fused%20topic/1");
  });

  test("rows about something else are junk: the backend is skipped for that query and benched after a second unrelated answer", async () => {
    const junk = fake("searxng", "junk");
    const good = fake("ddgs", "ok");
    expect(rowsRelevant("pasta carbonara recipe", [{ title: "Unrelated pop singer news", url: "https://junk.example.com/a", snippet: "tour dates" }, { title: "Celebrity gossip", url: "https://junk.example.com/b", snippet: "red carpet" }])).toBe(false);
    expect(rowsRelevant("pasta carbonara recipe", [{ title: "Pasta carbonara", url: "https://example.com/c", snippet: "a recipe" }])).toBe(true);
    const out = await ask("pasta carbonara recipe", [junk.adapter, good.adapter]);
    expect(out.rows[0]!.url).toContain("ddgs.example.com");
    expect(out.tried.map((t) => t.outcome)).toEqual(["junk", "ok"]);
    expect(backendAvailable("searxng")).toBe(true);
    reportBackendOutcome("searxng", "junk");
    expect(backendAvailable("searxng")).toBe(false);
  });

  test("an empty answer falls through to the next backend", async () => {
    const empty = fake("searxng", "empty");
    const good = fake("wikimedia", "ok");
    const out = await ask("empty then good", [empty.adapter, good.adapter]);
    expect(out.via).toEqual(["wikimedia"]);
  });
});

describe("pace and cooldown", () => {
  test("no backend is asked faster than its pace: a burst of two, then one gap apart", async () => {
    const a = fake("searxng", "ok");
    __setBackendPaceForTests("searxng", { minGapMs: 120, burst: 2 });
    const queries = ["one topic", "two topic", "three topic", "four topic", "five topic"];
    const started = Date.now();
    await Promise.all(queries.map((q) => ask(q, [a.adapter])));
    const elapsed = Date.now() - started;
    expect(a.hits.length).toBe(5);
    // Five requests, burst 2, 120 ms apart after: the last starts about 3 gaps in.
    expect(elapsed).toBeGreaterThanOrEqual(3 * 120 - 40);
    const sorted = [...a.hits].sort((x, y) => x - y);
    for (let i = 2; i < sorted.length; i += 1) expect(sorted[i]! - sorted[i - 2]!).toBeGreaterThanOrEqual(120 - 30);
  });

  test("the cooldown doubles with each refusal and a good answer clears it", () => {
    reportBackendOutcome("ddgs", "blocked");
    const first = searchBackendStatus().find((e) => e.id === "ddgs")!.coolingUntil! - now;
    now += first + 1;
    expect(backendAvailable("ddgs")).toBe(true);
    reportBackendOutcome("ddgs", "blocked");
    const second = searchBackendStatus().find((e) => e.id === "ddgs")!.coolingUntil! - now;
    expect(second).toBe(first * 2);
    now += second + 1;
    reportBackendOutcome("ddgs", "ok");
    reportBackendOutcome("ddgs", "blocked");
    expect(searchBackendStatus().find((e) => e.id === "ddgs")!.coolingUntil! - now).toBe(first);
  });

  test("a cooldown survives a restart, and an expired one is forgotten", () => {
    reportBackendOutcome("searxng", "blocked");
    const until = searchBackendStatus().find((e) => e.id === "searxng")!.coolingUntil!;
    __flushSearchBackendsForTests();
    __reloadSearchBackendsForTests();
    expect(backendAvailable("searxng")).toBe(false);
    expect(searchBackendStatus().find((e) => e.id === "searxng")!.coolingUntil).toBe(until);
    // Another start after the ban ended: available again.
    now = until + 1000;
    __reloadSearchBackendsForTests();
    expect(backendAvailable("searxng")).toBe(true);
  });
});

describe("cache", () => {
  test("the same query is not asked twice within ten minutes, and the counters say so", async () => {
    const a = fake("searxng", "ok");
    const first = await ask("Cached  Topic", [a.adapter]);
    const second = await ask("cached topic", [a.adapter]);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(a.hits.length).toBe(1);
    const counters = searchRotationCounters();
    expect(counters.cacheHits).toBe(1);
    expect(counters.cacheMisses).toBe(1);
    // After ten minutes it is asked again.
    now += 10 * 60_000 + 1;
    await ask("cached topic", [a.adapter]);
    expect(a.hits.length).toBe(2);
  });

  test("two askers of the same query at once share one request", async () => {
    const a = fake("searxng", "ok");
    const [x, y] = await Promise.all([ask("shared question", [a.adapter]), ask("shared question", [a.adapter])]);
    expect(a.hits.length).toBe(1);
    expect(x.rows).toEqual(y.rows);
  });

  test("an adult's cached answer is never handed to another scope", async () => {
    const a = fake("searxng", "ok");
    await ask("scoped topic", [a.adapter], { scope: "adult" });
    await ask("scoped topic", [a.adapter], { scope: "teen" });
    expect(a.hits.length).toBe(2);
  });

  test("a page read within the hour is kept; after an hour it is read again", () => {
    expect(pageCacheGet("https://example.com/a?utm_source=x")).toBeUndefined();
    pageCachePut("https://www.example.com/a", { text: "kept" });
    expect(pageCacheGet<{ text: string }>("https://example.com/a?utm_source=x")?.text).toBe("kept");
    now += 61 * 60_000;
    expect(pageCacheGet("https://example.com/a")).toBeUndefined();
    const counters = searchRotationCounters();
    expect(counters.pageHits).toBe(1);
    expect(counters.pageMisses).toBe(2);
  });
});
