// KS-05: the shelf's items. Cache class (disposable, excluded from backups,
// rebuilt by the next poll), so they live in knowledge.db beside the
// retrieval cache, never in hub.db. This module opens its own handle on
// the same file (WAL allows it) and owns two tables only, so the retrieval
// cache's own module is untouched. A row is the spec's NewsItem shape; the
// feeds that carried it are kept in a link table, so a story two feeds
// both link is one row with two links (canonical-URL dedupe).
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "@/lib/paths";
import type { AgeBand } from "@/lib/ageBand";
import { NewsItem } from "@maipai/spec/gen/ts/news-item.js";

export type ShelfItem = NewsItem;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shelf_item (
  id TEXT NOT NULL,
  canonical_url TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  publisher TEXT NOT NULL,
  lang TEXT NOT NULL,
  band_ok TEXT NOT NULL,
  hlc TEXT NOT NULL,
  provenance TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shelf_item_fetched ON shelf_item (fetched_at);
CREATE TABLE IF NOT EXISTS shelf_item_feed (
  canonical_url TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  PRIMARY KEY (canonical_url, feed_id)
);
CREATE INDEX IF NOT EXISTS shelf_item_feed_feed ON shelf_item_feed (feed_id);
`;

export interface ShelfStore {
  /** Stores a new item, or adds the feed to an existing one's links. */
  put(item: ShelfItem): { inserted: boolean };
  /** The newest items carried by any of these feeds whose band_ok is one of `bandOk`. */
  list(feedIds: readonly string[], bandOk: readonly AgeBand[], limit: number): ShelfItem[];
  /** Deletes items fetched before `cutoffIso`; returns how many. */
  prune(cutoffIso: string): number;
  /** Drops a feed's links, and every item no feed carries any more. */
  forgetFeed(feedId: string): number;
  count(): number;
  close(): void;
}

type Row = {
  id: string; canonical_url: string; feed_id: string; url: string; title: string; summary: string;
  published_at: string | null; fetched_at: string; publisher: string; lang: string; band_ok: string; hlc: string; provenance: string;
};

function toItem(row: Row): ShelfItem | null {
  const parsed = NewsItem.safeParse({
    id: row.id, feed_id: row.feed_id, url: row.url, canonical_url: row.canonical_url, title: row.title, summary: row.summary,
    published_at: row.published_at, fetched_at: row.fetched_at, publisher: row.publisher, lang: row.lang, band_ok: row.band_ok,
    hlc: row.hlc, provenance: row.provenance,
  });
  return parsed.success ? parsed.data : null;
}

export function openShelfStore(path: string): ShelfStore {
  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec(SCHEMA);
  const insert = sqlite.query(
    `INSERT OR IGNORE INTO shelf_item (id, canonical_url, feed_id, url, title, summary, published_at, fetched_at, publisher, lang, band_ok, hlc, provenance)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
  );
  const link = sqlite.query("INSERT OR IGNORE INTO shelf_item_feed (canonical_url, feed_id) VALUES (?1, ?2)");
  const pruneItems = sqlite.query("DELETE FROM shelf_item WHERE fetched_at < ?1");
  const pruneLinks = sqlite.query("DELETE FROM shelf_item_feed WHERE canonical_url NOT IN (SELECT canonical_url FROM shelf_item)");
  const dropLinks = sqlite.query("DELETE FROM shelf_item_feed WHERE feed_id = ?1");
  const dropOrphans = sqlite.query("DELETE FROM shelf_item WHERE canonical_url NOT IN (SELECT canonical_url FROM shelf_item_feed)");
  // A duplicate keeps the stricter verdict: if any carrier's text tripped the floor, the story is adult-only.
  const stricten = sqlite.query("UPDATE shelf_item SET band_ok = ?2 WHERE canonical_url = ?1 AND band_ok <> ?2 AND ?2 = 'adult'");
  const reattribute = sqlite.query(
    `UPDATE shelf_item SET feed_id = (SELECT f.feed_id FROM shelf_item_feed f WHERE f.canonical_url = shelf_item.canonical_url ORDER BY f.feed_id LIMIT 1)
     WHERE feed_id = ?1 AND EXISTS (SELECT 1 FROM shelf_item_feed f WHERE f.canonical_url = shelf_item.canonical_url)`,
  );
  const total = sqlite.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM shelf_item");
  return {
    put(item) {
      const result = insert.run(
        item.id, item.canonical_url, item.feed_id, item.url, item.title, item.summary, item.published_at ?? null,
        item.fetched_at, item.publisher, item.lang, item.band_ok, item.hlc, item.provenance,
      );
      link.run(item.canonical_url, item.feed_id);
      if (result.changes === 0) stricten.run(item.canonical_url, item.band_ok);
      return { inserted: result.changes > 0 };
    },
    list(feedIds, bandOk, limit) {
      if (feedIds.length === 0 || bandOk.length === 0 || limit <= 0) return [];
      const feedMarks = feedIds.map((_, i) => `?${i + 1}`).join(", ");
      const bandMarks = bandOk.map((_, i) => `?${feedIds.length + i + 1}`).join(", ");
      const sql = `SELECT i.* FROM shelf_item i
        WHERE i.band_ok IN (${bandMarks})
          AND EXISTS (SELECT 1 FROM shelf_item_feed f WHERE f.canonical_url = i.canonical_url AND f.feed_id IN (${feedMarks}))
        ORDER BY COALESCE(i.published_at, i.fetched_at) DESC, i.canonical_url
        LIMIT ?${feedIds.length + bandOk.length + 1}`;
      const rows = sqlite.query<Row, (string | number)[]>(sql).all(...feedIds, ...bandOk, limit);
      return rows.map(toItem).filter((item): item is ShelfItem => item !== null);
    },
    prune(cutoffIso) {
      const removed = pruneItems.run(cutoffIso).changes;
      pruneLinks.run();
      return removed;
    },
    forgetFeed(feedId) {
      dropLinks.run(feedId);
      reattribute.run(feedId);
      return dropOrphans.run().changes;
    },
    count() {
      return total.get()?.n ?? 0;
    },
    close() {
      sqlite.close();
    },
  };
}

let shared: ShelfStore | null = null;

/** The hub's one shelf handle, opened on first use; null when knowledge.db
 * cannot be opened (the shelf then serves nothing and the news package
 * falls back to its live path). */
export function sharedShelfStore(): ShelfStore | null {
  if (shared) return shared;
  try {
    shared = openShelfStore(join(cacheDir, "knowledge.db"));
    return shared;
  } catch {
    return null;
  }
}

export function __resetSharedShelfStoreForTests(): void {
  shared?.close();
  shared = null;
}
