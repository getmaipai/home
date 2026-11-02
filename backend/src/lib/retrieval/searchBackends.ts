// SEARCH-ROTATE-01 (owner, 2026-11-01): "you've been bombarding a single source with searches; you need to cycle through
// search, ddgs, other". One search used to go to every picked source at once, and a research round of several searches
// went to the same one, so the household SearXNG fanned each into the same upstream engines until they answered
// "too many requests". This file is the one place that spreads searches across the backends Home can reach:
//
//   - a registry of backends (SearXNG, ddgs, the live Wikimedia search, the hosted key), each with a health state,
//     its own pace (a gap between requests and a small burst) and a cooldown that grows after a refusal or a failure;
//   - a scheduler that picks the next backend by smooth weighted round-robin (weight = recent success), runs the
//     query there, falls through to the next backend on a failure, an empty answer or unrelated rows, and fuses
//     what answered (reciprocal rank fusion, one entry per URL, webSources.ts);
//   - a short-lived result cache (the same normalised query is not asked twice in ten minutes) and a page cache;
//   - a small snapshot file so a restart does not reset a cooldown.
//
// It decides where a query goes, never who may ask: each adapter keeps its own gates (age band, guest, source mode).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { dataDir } from "@/lib/paths";
import { blendWebRows, normalizeUrlKey, type WebRow, type WebRows } from "@/lib/retrieval/webSources";

export type BackendId = "searxng" | "ddgs" | "wikimedia" | "hosted";
export type BackendOutcome = "ok" | "empty" | "junk" | "blocked" | "failed" | "busy";

export interface BackendAdapter {
  id: BackendId;
  search: (query: string) => Promise<WebRows>;
  /** HostError codes that mean "this backend asked Home to slow down or is walled off" (a longer cooldown than a plain failure). */
  blockedCodes?: string[];
  /** RESEARCH-THROTTLE-01: asked only after the other backends of this query gave fewer rows than wanted (failed, benched, empty or thin), never beside a healthy one. */
  fallbackOnly?: boolean;
}

/** Pace per backend: `minGapMs` between requests, `burst` requests allowed back to back. */
const DEFAULT_PACE: Record<BackendId, { minGapMs: number; burst: number }> = {
  searxng: { minGapMs: 1500, burst: 2 },
  ddgs: { minGapMs: 4000, burst: 1 },
  wikimedia: { minGapMs: 1000, burst: 3 },
  hosted: { minGapMs: 1000, burst: 2 },
};
const IDS = Object.keys(DEFAULT_PACE) as BackendId[];
const PACE: Record<BackendId, { minGapMs: number; burst: number }> = { ...DEFAULT_PACE };

/** Cooldown ladder: a refusal starts at 30 s and doubles to 30 min; a failure starts at 10 s and doubles to 10 min. */
const BLOCK_BASE_MS = 30_000;
const BLOCK_MAX_MS = 30 * 60_000;
const FAIL_BASE_MS = 10_000;
const FAIL_MAX_MS = 10 * 60_000;
/** Two unrelated answers in a row bench a backend for five minutes; three empty ones, for twenty seconds. */
const JUNK_BENCH_MS = 5 * 60_000;
const EMPTY_BENCH_MS = 20_000;
/** The longest a query waits for a backend's turn before the next backend is tried instead. */
const MAX_WAIT_MS = 6000;
const SNAPSHOT_FILE = "search-backends.json";
const QUERY_CACHE_TTL_MS = 10 * 60_000;
const QUERY_CACHE_MAX = 300;
const PAGE_CACHE_TTL_MS = 60 * 60_000;
const PAGE_CACHE_MAX = 120;

interface BackendState {
  level: number;
  bannedUntil: number;
  nextFree: number;
  ok: number;
  fail: number;
  junkStreak: number;
  emptyStreak: number;
  credit: number;
  lastLatencyMs: number;
  lastOkAt: number;
  probing: boolean;
}

const fresh = (): BackendState => ({ level: 0, bannedUntil: 0, nextFree: 0, ok: 0, fail: 0, junkStreak: 0, emptyStreak: 0, credit: 0, lastLatencyMs: 0, lastOkAt: 0, probing: false });
const state = new Map<BackendId, BackendState>();
let loaded = false;
let clock: () => number = Date.now;
let snapshotPath = (): string => join(dataDir, SNAPSHOT_FILE);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const counters = { cacheHits: 0, cacheMisses: 0, pageHits: 0, pageMisses: 0, requests: { searxng: 0, ddgs: 0, wikimedia: 0, hosted: 0 } as Record<BackendId, number> };

function backend(id: BackendId): BackendState {
  ensureLoaded();
  let entry = state.get(id);
  if (!entry) {
    entry = fresh();
    state.set(id, entry);
  }
  return entry;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const path = snapshotPath();
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, "utf8")) as { v?: unknown; backends?: Record<string, { level?: unknown; bannedUntil?: unknown }> };
    if (raw.v !== 1 || !raw.backends) return;
    const now = clock();
    for (const id of IDS) {
      const saved = raw.backends[id];
      if (!saved) continue;
      const bannedUntil = typeof saved.bannedUntil === "number" ? saved.bannedUntil : 0;
      const level = typeof saved.level === "number" && saved.level >= 0 ? Math.min(saved.level, 12) : 0;
      const entry = fresh();
      // An expired ban is forgotten but the ladder level stays, so a backend that keeps refusing keeps climbing.
      entry.level = level;
      entry.bannedUntil = bannedUntil > now ? bannedUntil : 0;
      state.set(id, entry);
    }
  } catch {
    // A missing or damaged snapshot starts every backend healthy.
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeSnapshotNow();
  }, 500);
  (saveTimer as { unref?: () => void }).unref?.();
}

function writeSnapshotNow(): void {
  try {
    const backends: Record<string, { level: number; bannedUntil: number }> = {};
    for (const id of IDS) {
      const entry = state.get(id);
      if (entry && (entry.level > 0 || entry.bannedUntil > 0)) backends[id] = { level: entry.level, bannedUntil: entry.bannedUntil };
    }
    const path = snapshotPath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 1, backends }), "utf8");
    renameSync(tmp, path);
  } catch {
    // A snapshot that cannot be written costs only the restart memory, never a search.
  }
}

const backoff = (base: number, max: number, level: number): number => Math.min(max, base * 2 ** Math.min(level, 10));

function cool(id: BackendId, outcome: "blocked" | "failed"): void {
  const entry = backend(id);
  const ms = outcome === "blocked" ? backoff(BLOCK_BASE_MS, BLOCK_MAX_MS, entry.level) : backoff(FAIL_BASE_MS, FAIL_MAX_MS, entry.level);
  entry.level += 1;
  entry.bannedUntil = clock() + ms;
  console.warn(`[search] backend ${id} cooling down for ${Math.round(ms / 1000)} s (${outcome === "blocked" ? "it asked Home to slow down" : "it did not answer"})`);
  scheduleSave();
}

/** Record what one request found. `latencyMs` is how long it took. */
export function reportBackendOutcome(id: BackendId, outcome: BackendOutcome, latencyMs = 0): void {
  const entry = backend(id);
  entry.lastLatencyMs = latencyMs;
  if (outcome === "ok") {
    entry.ok += 1;
    entry.level = 0;
    entry.bannedUntil = 0;
    entry.junkStreak = 0;
    entry.emptyStreak = 0;
    entry.lastOkAt = clock();
    scheduleSave();
    return;
  }
  if (outcome === "busy") return;
  entry.fail += 1;
  if (outcome === "blocked" || outcome === "failed") {
    cool(id, outcome);
    return;
  }
  if (outcome === "junk") {
    entry.junkStreak += 1;
    if (entry.junkStreak >= 2) {
      entry.bannedUntil = clock() + JUNK_BENCH_MS;
      entry.junkStreak = 0;
      console.warn(`[search] backend ${id} benched for ${JUNK_BENCH_MS / 60000} minutes: it returned rows unrelated to the query twice in a row`);
      scheduleSave();
    }
    return;
  }
  entry.emptyStreak += 1;
  if (entry.emptyStreak >= 3) {
    entry.bannedUntil = clock() + EMPTY_BENCH_MS;
    entry.emptyStreak = 0;
  }
}

/** Whether the backend may be asked now. */
export function backendAvailable(id: BackendId): boolean {
  const entry = backend(id);
  return entry.bannedUntil <= clock();
}

const weight = (id: BackendId): number => {
  const entry = backend(id);
  return (entry.ok + 1) / (entry.ok + entry.fail + 2);
};

/** Smooth weighted round-robin over `ids`: the pick over many calls follows the weights and consecutive calls differ. */
function pickNext(ids: BackendId[]): BackendId {
  let total = 0;
  let best = ids[0]!;
  let bestCredit = -Infinity;
  for (const id of ids) {
    const entry = backend(id);
    const w = weight(id);
    entry.credit += w;
    total += w;
    if (entry.credit > bestCredit) {
      bestCredit = entry.credit;
      best = id;
    }
  }
  backend(best).credit -= total;
  return best;
}

/** Order for one query: the weighted pick first, the rest by weight. */
function orderFor(ids: BackendId[]): BackendId[] {
  if (ids.length <= 1) return [...ids];
  const first = pickNext(ids);
  return [first, ...ids.filter((id) => id !== first).sort((a, b) => weight(b) - weight(a))];
}

/** The wait before this backend's next request may start, and the reservation of that slot (a token bucket of `burst`). */
function reserve(id: BackendId, maxWaitMs: number): number | null {
  const entry = backend(id);
  const { minGapMs, burst } = PACE[id];
  const now = clock();
  const earliest = entry.nextFree - (burst - 1) * minGapMs;
  const start = Math.max(now, earliest);
  if (start - now > maxWaitMs) return null;
  entry.nextFree = Math.max(entry.nextFree, start) + minGapMs;
  return start - now;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "when", "where", "which", "who", "how", "why", "are", "was", "were", "about", "into", "your", "you"]);
function tokens(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOP_WORDS.has(word)))];
}

/** Whether the answer is about the query: among the first five rows, at least two share enough of the query's words with the
 * row's title, snippet or address (one row is enough when the query has a single word). Rows about something else are junk. */
export function rowsRelevant(query: string, rows: WebRow[]): boolean {
  const want = tokens(query);
  if (want.length === 0 || rows.length === 0) return rows.length > 0;
  const need = Math.min(2, want.length);
  const hits = rows.slice(0, 5).filter((row) => {
    const hay = `${row.title} ${row.snippet ?? ""} ${row.url ?? ""}`.toLowerCase();
    return want.filter((word) => hay.includes(word)).length >= need;
  }).length;
  // With fewer rows than the bar a single matching row is enough: a thin answer is not an unrelated one.
  return hits >= Math.min(want.length === 1 ? 1 : 2, Math.min(rows.length, 5));
}

function classify(err: unknown, adapter: BackendAdapter): BackendOutcome {
  if (err instanceof HostError) {
    if (err.code === "rate_limited") return "busy";
    if (adapter.blockedCodes?.includes(err.code)) return "blocked";
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 429 || status === 403) return "blocked";
  return "failed";
}

// ---- the result cache -------------------------------------------------------------------------------------------------

interface CachedAnswer { rows: WebRow[]; via: BackendId[]; storedAt: number }
const queryCache = new Map<string, CachedAnswer>();
const inFlight = new Map<string, Promise<RotateResult>>();

const cacheKey = (query: string, scope: string): string => `${scope}|${query.toLowerCase().replace(/\s+/g, " ").trim()}`;

export interface RotateResult extends WebRows {
  via: BackendId[];
  cached: boolean;
  tried: { id: BackendId; outcome: BackendOutcome; ms: number }[];
}

export interface RotateOptions {
  query: string;
  adapters: BackendAdapter[];
  /** Keeps one kind of asker's cached answers apart from another's (an adult's rows are never a minor's). */
  scope: string;
  /** Rows wanted before the first backend's answer counts as enough. */
  wantRows?: number;
  /** Distinct hosts wanted among the rows before the answer counts as enough (default 1: rows alone decide). A backend whose
   * rows all share one host does not count toward `maxBackends` while this is above 1. */
  wantHosts?: number;
  /** The most backends whose answers are fused for one query. */
  maxBackends?: number;
  signal?: AbortSignal;
}

function textOf(rows: WebRow[]): string {
  if (rows.length === 0) return "No web search results were found.";
  return rows.map((row, i) => `${i + 1}. ${row.title}${row.url ? ` (${row.url})` : ""}${row.snippet ? ` - ${row.snippet}` : ""}`).join("\n");
}

function hostOf(row: WebRow): string | null {
  if (!row.url) return null;
  try { return new URL(row.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

async function rotateUncached(opts: RotateOptions): Promise<RotateResult> {
  const { query, adapters, signal } = opts;
  const wantRows = opts.wantRows ?? 3;
  const maxBackends = opts.maxBackends ?? 2;
  const wantHosts = opts.wantHosts ?? 1;
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter] as const));
  let candidates = adapters.map((adapter) => adapter.id).filter(backendAvailable);
  const tried: RotateResult["tried"] = [];
  if (candidates.length === 0) {
    // Every backend is cooling down. One probe at a time goes to the one whose cooldown ends first, so a lone backend is never
    // locked out for good and a single request tests whether it answers again.
    const soonest = adapters.map((a) => a.id).filter((id) => !backend(id).probing).sort((a, b) => backend(a).bannedUntil - backend(b).bannedUntil)[0];
    if (!soonest) throw new HostError("search_unavailable", "Web search isn't answering right now.");
    candidates = [soonest];
    backend(soonest).probing = true;
  }
  const lists: WebRow[][] = [];
  const via: BackendId[] = [];
  // Rows that looked unrelated to the query: kept as a last resort so a wrong guess about relevance never leaves a person with nothing.
  let unrelated: { rows: WebRow[]; id: BackendId } | undefined;
  let lastError: unknown;
  const hosts = new Set<string>();
  // Backends whose answer counts toward maxBackends: with wantHosts above 1, one whose rows all share a single host does not.
  let counted = 0;
  const enough = (): boolean => lists.reduce((n, l) => n + l.length, 0) >= wantRows && hosts.size >= wantHosts;
  // Fall-through backends come after every ordinary one, and only while the rows found so far are fewer than wanted.
  const ordinary = candidates.filter((id) => byId.get(id)!.fallbackOnly !== true);
  const fallbacks = candidates.filter((id) => byId.get(id)!.fallbackOnly === true);
  for (const id of [...orderFor(ordinary), ...orderFor(fallbacks)]) {
    const fallback = byId.get(id)!.fallbackOnly === true;
    if (fallback && enough()) break;
    if (!fallback && counted >= maxBackends) break;
    const adapter = byId.get(id)!;
    const wait = reserve(id, MAX_WAIT_MS);
    if (wait === null) {
      tried.push({ id, outcome: "busy", ms: 0 });
      continue;
    }
    try {
      await sleep(wait, signal);
    } catch (err) {
      backend(id).probing = false;
      throw err;
    }
    const started = clock();
    counters.requests[id] += 1;
    try {
      const answer = await adapter.search(query);
      const ms = clock() - started;
      backend(id).probing = false;
      if (answer.rows.length === 0) {
        reportBackendOutcome(id, "empty", ms);
        tried.push({ id, outcome: "empty", ms });
        continue;
      }
      if (!rowsRelevant(query, answer.rows)) {
        reportBackendOutcome(id, "junk", ms);
        tried.push({ id, outcome: "junk", ms });
        unrelated ??= { rows: answer.rows, id };
        continue;
      }
      reportBackendOutcome(id, "ok", ms);
      tried.push({ id, outcome: "ok", ms });
      lists.push(answer.rows);
      via.push(id);
      const own = new Set<string>();
      for (const row of answer.rows) { const host = hostOf(row); if (host) { own.add(host); hosts.add(host); } }
      if (wantHosts <= 1 || own.size > 1) counted += 1;
      if (answer.rows.length >= wantRows && hosts.size >= wantHosts) break;
    } catch (err) {
      if (signal?.aborted) {
        backend(id).probing = false;
        throw err;
      }
      const ms = clock() - started;
      backend(id).probing = false;
      const outcome = classify(err, adapter);
      lastError = err;
      reportBackendOutcome(id, outcome, ms);
      tried.push({ id, outcome, ms });
    }
  }
  for (const id of IDS) backend(id).probing = false;
  if (lists.length === 0 && unrelated) return { text: textOf(unrelated.rows), rows: unrelated.rows, via: [unrelated.id], cached: false, tried };
  if (lists.length === 0) {
    if (lastError) throw lastError;
    return { text: textOf([]), rows: [], via: [], cached: false, tried };
  }
  const rows = lists.length === 1 ? lists[0]! : blendWebRows(lists);
  return { text: textOf(rows), rows, via, cached: false, tried };
}

/** Run one query across the backends: the cache first, then the rotation. Throws when a backend failed and none answered. */
export async function rotateSearch(opts: RotateOptions): Promise<RotateResult> {
  const key = cacheKey(opts.query, opts.scope);
  const now = clock();
  const hit = queryCache.get(key);
  if (hit && now - hit.storedAt < QUERY_CACHE_TTL_MS) {
    counters.cacheHits += 1;
    return { text: textOf(hit.rows), rows: hit.rows, via: hit.via, cached: true, tried: [] };
  }
  if (hit) queryCache.delete(key);
  const running = inFlight.get(key);
  if (running) {
    counters.cacheHits += 1;
    return running;
  }
  counters.cacheMisses += 1;
  const task = rotateUncached(opts).then((result) => {
    if (result.rows.length > 0 && result.tried.some((t) => t.outcome === "ok")) {
      queryCache.set(key, { rows: result.rows, via: result.via, storedAt: clock() });
      while (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string);
    }
    return result;
  });
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

// ---- the page cache ---------------------------------------------------------------------------------------------------

const pageCache = new Map<string, { value: unknown; storedAt: number }>();

/** A page read an hour ago is not read again. Only an adult's plain read is kept, so no floor or filter is bypassed. */
export function pageCacheGet<T>(url: string): T | undefined {
  const key = normalizeUrlKey(url);
  const hit = pageCache.get(key);
  if (!hit) {
    counters.pageMisses += 1;
    return undefined;
  }
  if (clock() - hit.storedAt >= PAGE_CACHE_TTL_MS) {
    pageCache.delete(key);
    counters.pageMisses += 1;
    return undefined;
  }
  counters.pageHits += 1;
  return hit.value as T;
}

export function pageCachePut(url: string, value: unknown): void {
  pageCache.set(normalizeUrlKey(url), { value, storedAt: clock() });
  while (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value as string);
}

// ---- status -----------------------------------------------------------------------------------------------------------

export interface BackendStatus { id: BackendId; healthy: boolean; coolingUntil: number | null; ok: number; failed: number; lastLatencyMs: number; requests: number }

/** Plain facts for the Status page and the logs: which backends answer, which are cooling down. */
export function searchBackendStatus(): BackendStatus[] {
  const now = clock();
  return IDS.map((id) => {
    const entry = backend(id);
    return { id, healthy: entry.bannedUntil <= now, coolingUntil: entry.bannedUntil > now ? entry.bannedUntil : null, ok: entry.ok, failed: entry.fail, lastLatencyMs: entry.lastLatencyMs, requests: counters.requests[id] };
  });
}

export function searchRotationCounters(): { cacheHits: number; cacheMisses: number; pageHits: number; pageMisses: number; requests: Record<BackendId, number> } {
  return { ...counters, requests: { ...counters.requests } };
}

// ---- test seams -------------------------------------------------------------------------------------------------------

export function __resetSearchBackendsForTests(options: { now?: () => number; file?: string } = {}): void {
  state.clear();
  queryCache.clear();
  inFlight.clear();
  pageCache.clear();
  loaded = false;
  for (const id of IDS) PACE[id] = DEFAULT_PACE[id];
  clock = options.now ?? Date.now;
  const file = options.file;
  snapshotPath = file ? () => file : () => join(dataDir, SNAPSHOT_FILE);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  // A test starts with no memory of an earlier one's cooldowns.
  try { rmSync(snapshotPath(), { force: true }); } catch { /* nothing to remove */ }
  counters.cacheHits = counters.cacheMisses = counters.pageHits = counters.pageMisses = 0;
  for (const id of IDS) counters.requests[id] = 0;
}

/** Write the snapshot now (a test then "restarts" with `__reloadSearchBackendsForTests`). */
export function __flushSearchBackendsForTests(): void {
  writeSnapshotNow();
}

/** Forget the in-memory state and read the snapshot again, as a restarted Home would. */
export function __reloadSearchBackendsForTests(): void {
  state.clear();
  loaded = false;
}

/** Test seam: replace one backend's pace (null restores the default). */
export function __setBackendPaceForTests(id: BackendId, pace: { minGapMs: number; burst: number } | null): void {
  PACE[id] = pace ?? DEFAULT_PACE[id];
}
