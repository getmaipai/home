// The package cache (platform plan 4.10, session-d-packages-and-store.md
// step 3): "one cache per household in data/cache/<package>/... host.fetch
// reads through it." A package with no `cache` declared in its manifest
// (spec/schemas/manifest.schema.json) is never cached - opt-in, per
// package, not a blanket layer every fetch goes through whether the
// package wants it or not.
//
// Keying: the manifest's own `cache.key_template` is a human-readable
// naming convention for a package author to reason about ("one entry per
// distinct call", the schema's own words) - the actual on-disk key is
// derived straight from the request (method + url + body), which is
// exactly the same "one entry per distinct call" property without needing
// a second templating engine to resolve `{arg}` placeholders against
// values this layer never sees (host.fetch only ever gets the already-
// interpolated URL, not the recipe's own input names). This also means a
// warm run (recipe run with `warm.keys`' synthetic inputs, step 3's own
// mechanism below) and a live turn that resolves to the identical URL
// share the identical cache entry with no coordination required - the
// acceptance test this step names ("weather warmed for the household's
// home place is answered without a fetch") falls out of this for free.
//
// Only GET requests are cached: a POST through host.fetch is presumed to
// have a side effect on the third-party service (or is at least not
// provably idempotent from here), and caching one could serve a stale
// result for what looks like a fresh action.
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, utimesSync, statfsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { cacheDir, dataDir, ensureDataDir } from "@/lib/paths";

export interface CacheFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

type CachePolicy = NonNullable<PackageManifest["cache"]>;

interface CacheEntryFile {
  url: string;
  method: string;
  fetchedAt: string; // ISO
  value: unknown;
}

const DEFAULT_TTL_S = 300; // 5 minutes, if a package declares `cache` with no ttl_s
const DEFAULT_STALE_OK_S = 0; // no stale-while-revalidate window unless declared
const DEFAULT_MAX_BYTES = 1_000_000; // 1 MB per entry, if unset

// The total budget across every package's cache combined, scaled to free
// disk rather than a single fixed number a tiny SBC and a beefy NUC would
// both be stuck with: never more than CEILING_BYTES, and never more than
// FREE_DISK_FRACTION of whatever's actually free right now, so a nearly-
// full disk still leaves room for backups/downloads/the database itself
// to win the argument.
const CEILING_BYTES = 512 * 1024 * 1024; // 512 MB
const FREE_DISK_FRACTION = 0.05;

function packageDir(packageId: string): string {
  return join(cacheDir, packageId);
}

function cacheKey(url: string, opts?: CacheFetchOptions): string {
  const method = (opts?.method ?? "GET").toUpperCase();
  const body = opts?.body !== undefined ? JSON.stringify(opts.body) : "";
  // Header order isn't semantically meaningful (an Accept-Language of
  // "en" plus "Accept: json" is the same request regardless of which key
  // a package happened to set first), so this sorts by name before
  // hashing - without it, two calls with identically-valued headers set
  // in a different order would miss each other's cache entry for no
  // real reason. A code review (2026-09-06) caught the first version of
  // this cache ignoring headers entirely: harmless for weather/define/
  // joke/trivia today (none vary a header per call), but a future
  // package whose recipe varies e.g. Accept-Language per input would
  // have silently served one input's cached response to another's.
  const headers = opts?.headers
    ? Object.entries(opts.headers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k.toLowerCase()}:${v}`)
        .join("\n")
    : "";
  return createHash("sha256").update(`${method}\n${url}\n${headers}\n${body}`).digest("hex");
}

function entryPath(packageId: string, key: string): string {
  return join(packageDir(packageId), `${key}.json`);
}

function readEntry(packageId: string, key: string): CacheEntryFile | null {
  const path = entryPath(packageId, key);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CacheEntryFile;
  } catch {
    // A truncated or corrupted entry (an interrupted write) is treated as
    // a miss, never a crash - the same "unreadable is absence, not an
    // exception the caller has to special-case" posture lib/plugins.ts's
    // loadPackage() already takes for a broken manifest.json.
    return null;
  }
}

function writeEntry(packageId: string, key: string, entry: CacheEntryFile, maxBytes: number): void {
  const serialized = JSON.stringify(entry);
  if (Buffer.byteLength(serialized, "utf-8") > maxBytes) return; // per-entry ceiling: never cached, not truncated
  const dir = packageDir(packageId);
  ensureDataDir(dir);
  writeFileSync(entryPath(packageId, key), serialized, "utf-8");
  evictIfOverBudget();
}

/** Bumps an entry's mtime on every read hit, the recency signal
 * evictIfOverBudget() below sorts on - the cheapest possible LRU clock
 * that survives a restart, since it rides the filesystem's own metadata
 * instead of a separate index this module would have to keep consistent
 * with the files themselves. */
function touch(path: string): void {
  const now = new Date();
  try {
    utimesSync(path, now, now);
  } catch {
    // A touch racing a concurrent eviction of the same file is a lost
    // cache hit's recency bump at worst, never a correctness problem -
    // the entry it was about to save is already gone.
  }
}

function freeDiskBytes(): number {
  // statfsSync needs an existing path; cacheDir may not exist yet on a
  // fresh install (nothing has been cached at all), so this falls back to
  // dataDir, created at boot by every other lib/*.ts's own
  // ensureDataDir() call long before packageCache.ts's first write.
  const target = existsSync(cacheDir) ? cacheDir : dataDir;
  try {
    const stats = statfsSync(target);
    return stats.bavail * stats.bsize;
  } catch {
    // Filesystem stats aren't available on every platform/CI sandbox;
    // falling back to the fixed ceiling alone (below) rather than
    // throwing keeps the cache usable everywhere check.sh runs.
    return Number.POSITIVE_INFINITY;
  }
}

// Real free disk on a dev machine or CI runner is tens of gigabytes,
// which no test can afford to actually fill to prove eviction fires -
// this lets a test pin the budget to something small and deterministic
// instead of mocking node:fs's statfsSync.
let testBudgetBytes: number | null = null;

export function __setTestCacheBudgetBytes(bytes: number | null): void {
  testBudgetBytes = bytes;
}

function totalBudgetBytes(): number {
  if (testBudgetBytes !== null) return testBudgetBytes;
  const scaled = Math.floor(freeDiskBytes() * FREE_DISK_FRACTION);
  return Math.min(CEILING_BYTES, scaled);
}

interface DiskEntry {
  packageId: string;
  path: string;
  size: number;
  mtimeMs: number;
}

/** The one directory walk every disk-facing function below builds on -
 * eviction (needs every entry, flat, for a global oldest-first sort) and
 * getCacheStats() (needs the identical entries aggregated per package)
 * were each independently re-implementing this same cacheDir ->
 * per-package-dir -> *.json scan (a code review, 2026-09-06, found the
 * two already drifting in shape); this is the one place that changes if
 * the on-disk layout ever does. */
function walkAllEntries(): DiskEntry[] {
  if (!existsSync(cacheDir)) return [];
  const entries: DiskEntry[] = [];
  for (const pkgEntry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!pkgEntry.isDirectory()) continue;
    const dir = join(cacheDir, pkgEntry.name);
    for (const fileEntry of readdirSync(dir, { withFileTypes: true })) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".json")) continue;
      const path = join(dir, fileEntry.name);
      const stat = statSync(path);
      entries.push({ packageId: pkgEntry.name, path, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return entries;
}

/** LRU eviction over the combined cache, run after every write: oldest
 * `mtime` first (see touch() above) until the total is back under budget.
 * Deliberately global rather than per-package - one household package
 * warming a large payload shouldn't be capped by its own history while a
 * different package's cold, forgotten entries sit untouched; the budget
 * is a shared household resource, same as disk itself. */
function evictIfOverBudget(): void {
  const budget = totalBudgetBytes();
  const entries = walkAllEntries();
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total <= budget) return;
  const oldestFirst = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of oldestFirst) {
    if (total <= budget) break;
    try {
      unlinkSync(entry.path);
      total -= entry.size;
    } catch {
      // Already gone (a concurrent eviction pass, or the entry expired
      // and was cleaned up some other way) - not an error, just move on.
    }
  }
}

interface HitStats {
  hits: number;
  misses: number;
}

const stats = new Map<string, HitStats>();

function recordHit(packageId: string): void {
  const s = stats.get(packageId) ?? { hits: 0, misses: 0 };
  s.hits++;
  stats.set(packageId, s);
}

function recordMiss(packageId: string): void {
  const s = stats.get(packageId) ?? { hits: 0, misses: 0 };
  s.misses++;
  stats.set(packageId, s);
}

/** Wraps a real `doFetch()` (packageHost.ts's own network call) with the
 * package's declared cache policy. A package with no `cache` field passes
 * straight through, uncached, every time - the opt-in this module's own
 * header describes. */
export async function cachedFetch(
  packageId: string,
  cachePolicy: CachePolicy | undefined,
  url: string,
  opts: CacheFetchOptions | undefined,
  doFetch: () => Promise<unknown>,
): Promise<unknown> {
  if (!cachePolicy) return doFetch();
  const method = (opts?.method ?? "GET").toUpperCase();
  if (method !== "GET") return doFetch();

  const ttlS = cachePolicy.ttl_s ?? DEFAULT_TTL_S;
  const staleOkS = cachePolicy.stale_ok_s ?? DEFAULT_STALE_OK_S;
  const maxBytes = cachePolicy.max_bytes ?? DEFAULT_MAX_BYTES;
  const key = cacheKey(url, opts);
  const existing = readEntry(packageId, key);

  if (existing) {
    const ageS = (Date.now() - new Date(existing.fetchedAt).getTime()) / 1000;
    if (ageS <= ttlS) {
      recordHit(packageId);
      touch(entryPath(packageId, key));
      return existing.value;
    }
    if (ageS <= ttlS + staleOkS) {
      recordHit(packageId);
      touch(entryPath(packageId, key));
      // Stale-while-revalidate: the caller gets the stale value right
      // now; the real fetch runs in the background and refreshes the
      // entry for next time. A failure here is silent on purpose - the
      // caller already has their answer, and the next call past ttl_s
      // (with no fresher entry) will surface the real error the ordinary
      // way, through doFetch() itself.
      void doFetch()
        .then((value) => writeEntry(packageId, key, { url, method, fetchedAt: new Date().toISOString(), value }, maxBytes))
        .catch(() => {});
      return existing.value;
    }
  }

  recordMiss(packageId);
  const value = await doFetch();
  writeEntry(packageId, key, { url, method, fetchedAt: new Date().toISOString(), value }, maxBytes);
  return value;
}

export interface CacheStats {
  packageId: string;
  entryCount: number;
  sizeBytes: number;
  oldestEntryAt: string | null;
  newestEntryAt: string | null;
  hits: number;
  misses: number;
}

/** One row per package with anything cached, plus every package that has
 * ever recorded a hit/miss even if its cache is currently empty (a fresh
 * eviction, or every entry already expired past disk retention) - F's
 * `GET /api/storage` route reads this. */
export function getCacheStats(): CacheStats[] {
  const byPackage = new Map<string, { entryCount: number; sizeBytes: number; oldest: number | null; newest: number | null }>();
  for (const entry of walkAllEntries()) {
    const agg = byPackage.get(entry.packageId) ?? { entryCount: 0, sizeBytes: 0, oldest: null, newest: null };
    agg.entryCount++;
    agg.sizeBytes += entry.size;
    if (agg.oldest === null || entry.mtimeMs < agg.oldest) agg.oldest = entry.mtimeMs;
    if (agg.newest === null || entry.mtimeMs > agg.newest) agg.newest = entry.mtimeMs;
    byPackage.set(entry.packageId, agg);
  }
  const packageIds = new Set([...byPackage.keys(), ...stats.keys()]);
  return [...packageIds].map((packageId) => {
    const disk = byPackage.get(packageId);
    const hitStats = stats.get(packageId);
    return {
      packageId,
      entryCount: disk?.entryCount ?? 0,
      sizeBytes: disk?.sizeBytes ?? 0,
      oldestEntryAt: disk?.oldest != null ? new Date(disk.oldest).toISOString() : null,
      newestEntryAt: disk?.newest != null ? new Date(disk.newest).toISOString() : null,
      hits: hitStats?.hits ?? 0,
      misses: hitStats?.misses ?? 0,
    };
  });
}

export function __resetPackageCacheForTests(): void {
  stats.clear();
  testBudgetBytes = null;
}

/** Wipes one package's on-disk cache directory - a test's own cleanup,
 * since MAIPAI_DATA_DIR's throwaway temp dir (tests/preload.ts) is shared
 * across every test file in a `bun test` run, not per-file. */
export function __clearPackageCacheDirForTests(packageId: string): void {
  rmSync(packageDir(packageId), { recursive: true, force: true });
}
