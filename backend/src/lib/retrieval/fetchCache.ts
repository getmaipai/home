// KS-07 (DESIGN section 4, "FetchCacheEntry"): the fetch cache in `knowledge.db`.
// It keeps the raw body of a page Home already fetched so a second read inside
// the time-to-live makes no request. Home only, never synced, in the `cache`
// data class (disposable, excluded from backups).
//
// What it stores is the raw body and nothing about the asker: no person id, no
// conversation id, no band, no floor verdict. The per-band blocked-site check
// and the minor floor run on every read by the caller, so a cached body is never
// trusted on its own word (the same rule tier K follows in minorFloor.ts). A
// temporary chat never reaches this file's writers (the caller passes no cache).
//
// Kinds and time-to-live (DESIGN section 6): a result page 7 days, a news
// publisher's page 24 hours, a Wayback availability answer 24 hours, an archived
// body 30 days. The daily sweep drops what expired and then the least recently
// used rows until the table fits `search.fetch_cache_gb`.
//
// It opens its own handle on the same file as knowledgeDb.ts (WAL allows it) so
// the reference reader's table definitions stay in one place and this slice owns
// only `fetch_cache_entry`.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "@/lib/paths";
import { getHouseholdSettingValue } from "@/lib/settings";

export type FetchCacheKind = "page" | "availability" | "archive";

export const FETCH_CACHE_GB_KEY = "search.fetch_cache_gb";
const DAY_S = 24 * 60 * 60;
export const FETCH_TTL_S = { page: 7 * DAY_S, news: DAY_S, availability: DAY_S, archive: 30 * DAY_S } as const;

let newsHost: (host: string) => boolean = () => false;
/** The shelf (KS-05) registers which hosts are news publishers so their pages keep the short time-to-live. */
export function setNewsHostMatcher(matcher: ((host: string) => boolean) | null): void {
  newsHost = matcher ?? (() => false);
}

/** The time-to-live in seconds for a fetched thing of this kind. */
export function ttlSecondsFor(kind: FetchCacheKind, url: string): number {
  if (kind === "availability") return FETCH_TTL_S.availability;
  if (kind === "archive") return FETCH_TTL_S.archive;
  try {
    return newsHost(new URL(url).hostname) ? FETCH_TTL_S.news : FETCH_TTL_S.page;
  } catch {
    return FETCH_TTL_S.page;
  }
}

export interface FetchCacheRecord {
  url: string;
  kind: FetchCacheKind;
  status: number;
  contentType: string;
  /** Whether the site's robots.txt allowed the fetch when it was made. */
  robotsOk: boolean;
  body: string;
  fetchedAtMs: number;
  ttlS: number;
}

export interface FetchCache {
  /** A fresh row for this url and kind, or null. Marks the row used. */
  get(url: string, kind: FetchCacheKind, nowMs?: number): FetchCacheRecord | null;
  put(record: Omit<FetchCacheRecord, "fetchedAtMs" | "ttlS"> & { ttlS?: number }, nowMs?: number): void;
  /** Drops expired rows, then least recently used rows until the bodies fit `maxBytes`. */
  sweep(maxBytes: number, nowMs?: number): { expired: number; evicted: number; bytes: number };
  totalBytes(): number;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fetch_cache_entry (
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  ttl_s INTEGER NOT NULL,
  status INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  robots_ok INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (url, kind)
);
CREATE INDEX IF NOT EXISTS fetch_cache_entry_used ON fetch_cache_entry (last_used);
`;

export function openFetchCache(path: string): FetchCache {
  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 3000");
  sqlite.exec(SCHEMA);
  const select = sqlite.query<
    { status: number; content_type: string; robots_ok: number; body: string; fetched_at: number; ttl_s: number },
    [string, string]
  >("SELECT status, content_type, robots_ok, body, fetched_at, ttl_s FROM fetch_cache_entry WHERE url = ?1 AND kind = ?2");
  const touch = sqlite.query("UPDATE fetch_cache_entry SET last_used = ?3 WHERE url = ?1 AND kind = ?2");
  const drop = sqlite.query("DELETE FROM fetch_cache_entry WHERE url = ?1 AND kind = ?2");
  const insert = sqlite.query(
    "INSERT OR REPLACE INTO fetch_cache_entry (url, kind, fetched_at, ttl_s, status, sha256, bytes, content_type, robots_ok, last_used, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
  );
  const dropExpired = sqlite.query("DELETE FROM fetch_cache_entry WHERE fetched_at + ttl_s * 1000 <= ?1");
  const total = sqlite.query<{ n: number }, []>("SELECT COALESCE(SUM(bytes), 0) AS n FROM fetch_cache_entry");
  const oldest = sqlite.query<{ url: string; kind: string; bytes: number }, []>(
    "SELECT url, kind, bytes FROM fetch_cache_entry ORDER BY last_used ASC LIMIT 50",
  );
  const totalBytes = (): number => total.get()?.n ?? 0;
  return {
    get(url, kind, nowMs = Date.now()) {
      const row = select.get(url, kind);
      if (!row) return null;
      if (row.fetched_at + row.ttl_s * 1000 <= nowMs) {
        drop.run(url, kind);
        return null;
      }
      touch.run(url, kind, nowMs);
      return {
        url,
        kind,
        status: row.status,
        contentType: row.content_type,
        robotsOk: row.robots_ok === 1,
        body: row.body,
        fetchedAtMs: row.fetched_at,
        ttlS: row.ttl_s,
      };
    },
    put(record, nowMs = Date.now()) {
      const bytes = new TextEncoder().encode(record.body).byteLength;
      const sha = createHash("sha256").update(record.body).digest("hex");
      insert.run(record.url, record.kind, nowMs, record.ttlS ?? ttlSecondsFor(record.kind, record.url), record.status, sha, bytes, record.contentType, record.robotsOk ? 1 : 0, nowMs, record.body);
    },
    sweep(maxBytes, nowMs = Date.now()) {
      const expired = dropExpired.run(nowMs).changes;
      let evicted = 0;
      let bytes = totalBytes();
      while (bytes > maxBytes) {
        const batch = oldest.all();
        if (batch.length === 0) break;
        for (const row of batch) {
          if (bytes <= maxBytes) break;
          drop.run(row.url, row.kind);
          bytes -= row.bytes;
          evicted++;
        }
      }
      return { expired, evicted, bytes };
    },
    totalBytes,
    close() {
      sqlite.close();
    },
  };
}

let shared: FetchCache | null = null;
let override: FetchCache | null | undefined;

/** The hub's one fetch cache, opened on first use; null when it cannot open (reads then go to the network). */
export function sharedFetchCache(): FetchCache | null {
  if (override !== undefined) return override;
  if (shared) return shared;
  try {
    shared = openFetchCache(join(cacheDir, "knowledge.db"));
    return shared;
  } catch {
    return null;
  }
}

/** Test seam: use this cache (or none, with null) instead of the knowledge.db one; undefined restores. */
export function __setFetchCacheForTests(cache: FetchCache | null | undefined): void {
  override = cache;
}

export function __resetSharedFetchCacheForTests(): void {
  shared?.close();
  shared = null;
  override = undefined;
}

/** The household's cache ceiling in bytes; 0 means the household turned caching off. */
export function fetchCacheLimitBytes(): number {
  let gb: unknown;
  try {
    gb = getHouseholdSettingValue(FETCH_CACHE_GB_KEY);
  } catch {
    gb = undefined;
  }
  const value = typeof gb === "number" && Number.isFinite(gb) && gb >= 0 ? gb : 2;
  return Math.floor(value * 1_000_000_000);
}

/** The daily job (scheduler.ts `fetch_cache.sweep`): drop expired rows and trim to `search.fetch_cache_gb`. */
export function sweepFetchCache(): { expired: number; evicted: number; bytes: number } | null {
  const cache = sharedFetchCache();
  if (!cache) return null;
  return cache.sweep(fetchCacheLimitBytes());
}

/**
 * The cache key for a fetched address. The band is part of the key because a minor's fetch checks every
 * redirect hop against its own blocked-site lists and an adult's does not: an entry one band stored is
 * never served to another (a band label only, never a person).
 */
export function fetchCacheKey(band: string, url: string): string {
  return `${band}|${url}`;
}

/** The cache a non-temporary fetch may use: null when the household set the limit to 0 or the file will not open. */
export function fetchCacheForRead(temporary: boolean): FetchCache | null {
  if (temporary) return null;
  if (fetchCacheLimitBytes() <= 0) return null;
  return sharedFetchCache();
}
