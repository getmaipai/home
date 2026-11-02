// SEARCH-ROTATE-01 bench: 20 varied queries through the real backends, once the old way (every query to every backend) and once
// through the rotation in Max-style rounds of four. Reports, per backend, how many requests it received, how many answered with rows,
// how many were empty or failed, and the median time. Read-only requests only. Addresses come from the environment and are never printed:
//   SEARXNG_URL=<household search address> DDGS_URL=<the ddgs sidecar address, from GET /stack/v1/search> \
//     bun scripts/bench/searchRotation.ts [--wikimedia-base https://en.wikipedia.org]
// Without SEARXNG_URL or DDGS_URL that backend is left out.
import { __resetSearchBackendsForTests, rotateSearch, searchBackendStatus, searchRotationCounters, type BackendAdapter, type BackendId } from "@/lib/retrieval/searchBackends";
import type { WebRow, WebRows } from "@/lib/retrieval/webSources";

const QUERIES = [
  "how tides are predicted", "history of the printing press", "how long do sourdough starters last", "causes of the 1929 market crash",
  "what is a heat pump water heater", "migration route of monarch butterflies", "how are vaccines tested", "early history of the bicycle",
  "difference between baking soda and baking powder", "how does a lighthouse lens work", "why is the sky blue", "origin of the marathon distance",
  "how do noise cancelling headphones work", "history of the postal service", "how are bridges inspected", "what causes aurora",
  "how is cheese aged", "history of public libraries", "how do solar panels degrade", "how are coral reefs restored",
];

const args = process.argv.slice(2);
const wikiBase = args.includes("--wikimedia-base") ? args[args.indexOf("--wikimedia-base") + 1]! : "https://en.wikipedia.org";
const UA = "MaiPai-Home-bench/1.0 (self-hosted; search rotation bench)";

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 429 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

function adapters(): BackendAdapter[] {
  const list: BackendAdapter[] = [];
  const searx = process.env.SEARXNG_URL?.replace(/\/+$/, "");
  const ddgs = process.env.DDGS_URL?.replace(/\/+$/, "");
  if (searx) {
    list.push({ id: "searxng", blockedCodes: ["search_unavailable"], search: async (q) => {
      const body = await getJson(`${searx}/search?q=${encodeURIComponent(q)}&format=json`);
      const unresponsive = Array.isArray(body.unresponsive_engines) ? (body.unresponsive_engines as unknown[]).length : 0;
      const rows: WebRow[] = (Array.isArray(body.results) ? (body.results as { title?: string; url?: string; content?: string }[]) : []).slice(0, 8).map((r) => ({ title: r.title ?? "", url: r.url ?? null, snippet: r.content ?? null }));
      if (rows.length === 0 && unresponsive > 0) throw Object.assign(new Error("walled off"), { status: 429 });
      return { text: "", rows };
    } });
  }
  if (ddgs) {
    list.push({ id: "ddgs", blockedCodes: ["search_unavailable"], search: async (q) => {
      const body = await getJson(`${ddgs}/search?q=${encodeURIComponent(q)}&max=8`);
      const rows: WebRow[] = (Array.isArray(body.rows) ? (body.rows as { title?: string; url?: string; snippet?: string }[]) : []).map((r) => ({ title: r.title ?? "", url: r.url ?? null, snippet: r.snippet ?? null }));
      return { text: "", rows };
    } });
  }
  list.push({ id: "wikimedia", search: async (q) => {
    const body = await getJson(`${wikiBase}/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=8`);
    const rows: WebRow[] = (Array.isArray(body.pages) ? (body.pages as { key?: string; title?: string; description?: string }[]) : []).map((p) => ({ title: p.title ?? "", url: `${wikiBase}/wiki/${encodeURIComponent(p.key ?? "")}`, snippet: p.description ?? null }));
    return { text: "", rows };
  } });
  return list;
}

interface Tally { requests: number; withRows: number; empty: number; failed: number; ms: number[] }
const blank = (): Record<string, Tally> => ({});
const note = (tally: Record<string, Tally>, id: string, outcome: "rows" | "empty" | "failed", ms: number): void => {
  const t = (tally[id] ??= { requests: 0, withRows: 0, empty: 0, failed: 0, ms: [] });
  t.requests += 1;
  if (outcome === "rows") t.withRows += 1;
  else if (outcome === "empty") t.empty += 1;
  else t.failed += 1;
  t.ms.push(ms);
};
const median = (xs: number[]): number => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!);
const report = (title: string, tally: Record<string, Tally>): void => {
  console.log(`\n${title}`);
  for (const [id, t] of Object.entries(tally)) console.log(`  ${id.padEnd(10)} requests ${String(t.requests).padStart(3)}  rows ${String(t.withRows).padStart(3)}  empty ${String(t.empty).padStart(3)}  failed ${String(t.failed).padStart(3)}  median ${median(t.ms)} ms`);
};

const all = adapters();
console.log(`backends in this run: ${all.map((a) => a.id).join(", ")}; ${QUERIES.length} queries`);

// A. The old way: every query to every backend, one query after another with a short gap so no backend is hammered by the bench itself.
const old = blank();
for (const q of QUERIES.slice(0, 10)) {
  await Promise.all(all.map(async (a) => {
    const t0 = Date.now();
    try { const r = await a.search(q); note(old, a.id, r.rows.length ? "rows" : "empty", Date.now() - t0); } catch { note(old, a.id, "failed", Date.now() - t0); }
  }));
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
report("old way (10 queries, each sent to every backend)", old);

// B. The rotation: the same 20 queries in rounds of four at once, with the real pace and cooldowns.
__resetSearchBackendsForTests();
const rot = blank();
const tapped: BackendAdapter[] = all.map((a) => ({ ...a, search: async (q) => {
  const t0 = Date.now();
  try { const r = await a.search(q); note(rot, a.id, r.rows.length ? "rows" : "empty", Date.now() - t0); return r as WebRows; } catch (err) { note(rot, a.id, "failed", Date.now() - t0); throw err; }
} }));
let answered = 0;
let hits4 = 0;
for (let i = 0; i < QUERIES.length; i += 4) {
  const round = QUERIES.slice(i, i + 4);
  const before: Partial<Record<BackendId, number>> = { ...searchRotationCounters().requests };
  const out = await Promise.all(round.map((q) => rotateSearch({ query: q, adapters: tapped, scope: "adult" }).catch(() => null)));
  answered += out.filter((r) => r && r.rows.length > 0).length;
  const after = searchRotationCounters().requests;
  const worst = Math.max(...(Object.keys(after) as BackendId[]).map((id) => (after[id] ?? 0) - (before[id] ?? 0)));
  if (worst >= round.length) hits4 += 1;
}
report("rotation (20 queries, rounds of four)", rot);
console.log(`\nrotation: ${answered}/${QUERIES.length} queries answered with rows; rounds where one backend took every search: ${hits4}/${QUERIES.length / 4}`);
console.log("backend status after the run:", JSON.stringify(searchBackendStatus().map((s) => ({ id: s.id, healthy: s.healthy, ok: s.ok, failed: s.failed }))));
const c = searchRotationCounters();
console.log(`cache hits ${c.cacheHits}, misses ${c.cacheMisses}`);
