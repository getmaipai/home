// NEWS-07: persistent request receipts, not article content. Kept across shelf prune and process restarts.
import type { Database } from "bun:sqlite";

export const PREFETCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS news_prefetch_attempt (url TEXT PRIMARY KEY, site TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS news_prefetch_site_at ON news_prefetch_attempt(site, at);
CREATE INDEX IF NOT EXISTS news_prefetch_at ON news_prefetch_attempt(at);
CREATE TABLE IF NOT EXISTS news_prefetch_quiet (id INTEGER PRIMARY KEY CHECK(id = 1), until_ms INTEGER NOT NULL, failures INTEGER NOT NULL);
`;

export function prefetchBudget(sqlite: Database): {
  claimPrefetch(url: string, site: string, nowMs: number): boolean;
  prefetchOutcome(ok: boolean, nowMs: number): void;
} {
  return {
    claimPrefetch: sqlite.transaction((url: string, site: string, nowMs: number): boolean => {
      const quiet = sqlite.query<{ until_ms: number }, []>("SELECT until_ms FROM news_prefetch_quiet WHERE id = 1").get();
      if (quiet && quiet.until_ms > nowMs) return false;
      if (sqlite.query("SELECT 1 FROM news_prefetch_attempt WHERE url = ?").get(url)) return false;
      const last = sqlite.query<{ at: number }, []>("SELECT MAX(at) AS at FROM news_prefetch_attempt").get();
      if (last?.at != null && nowMs - last.at < 30_000) return false;
      const count = sqlite.query<{ n: number }, [string, number]>("SELECT COUNT(*) AS n FROM news_prefetch_attempt WHERE site = ? AND at > ?").get(site, nowMs - 86_400_000);
      if ((count?.n ?? 0) >= 150) return false;
      sqlite.query("INSERT INTO news_prefetch_attempt (url, site, at) VALUES (?, ?, ?)").run(url, site, nowMs);
      return true;
    }),
    prefetchOutcome(ok, nowMs) {
      const old = sqlite.query<{ failures: number }, []>("SELECT failures FROM news_prefetch_quiet WHERE id = 1").get();
      const failures = ok ? 0 : (old?.failures ?? 0) + 1;
      const until = ok ? 0 : nowMs + Math.min(86_400_000, 1_800_000 * 2 ** Math.min(failures, 6));
      sqlite.query("INSERT OR REPLACE INTO news_prefetch_quiet (id, until_ms, failures) VALUES (1, ?, ?)").run(until, failures);
    },
  };
}
