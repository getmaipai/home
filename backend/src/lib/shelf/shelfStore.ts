// KS-05: the shelf's items. Cache class (disposable, excluded from backups,
// rebuilt by the next poll), so they live in knowledge.db beside the
// retrieval cache, never in hub.db. This module opens its own handle on
// the same file (WAL allows it) and owns two tables only, so the retrieval
// cache's own module is untouched. A row is the spec's NewsItem shape; the
// feeds that carried it are kept in a link table, so a story two feeds
// both link is one row with two links (canonical-URL dedupe).
import { Database } from "bun:sqlite";
import { enrichmentStore, ENRICHMENT_SCHEMA, type Enrichment } from "@/lib/news/enrichmentStore";
import { prefetchBudget, PREFETCH_SCHEMA } from "@/lib/news/prefetchBudget";
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
CREATE INDEX IF NOT EXISTS shelf_item_id ON shelf_item (id);
${PREFETCH_SCHEMA}
${ENRICHMENT_SCHEMA}
-- NEWS-02: the cleaned article of an item a person opened (spec NewsItem.content_ref is the item id). One row per item
-- and band: each band keeps its own copy (a child's holds no links, a teen's and an adult's keep them). A pinned row belongs
-- to a saved story and is never pruned while the save exists.
CREATE TABLE IF NOT EXISTS news_content (
  item_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  blocks TEXT NOT NULL,
  source TEXT NOT NULL,
  reading_s INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, variant)
);
`;

/** NEWS-02: columns added after the first release of the table; added in place on an older knowledge.db. */
const ADDED_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["image_url", "TEXT"],
  ["image_ref", "TEXT"],
  ["topics", "TEXT"],
];

export interface ShelfStore {
  /** Stores a new item, or adds the feed to an existing one's links. */
  put(item: ShelfItem): { inserted: boolean };
  /** The newest items carried by any of these feeds whose band_ok is one of `bandOk`. */
  list(feedIds: readonly string[], bandOk: readonly AgeBand[], limit: number): ShelfItem[];
  /** Deletes items fetched before `cutoffIso`, except those a saved story pinned; returns how many. */
  prune(cutoffIso: string): number;
  /** NEWS-02: one item by its id, or null. */
  get(id: string): ShelfItem | null;
  /** NEWS-02: the feeds that carried an item (a story two feeds linked has two). */
  feedIdsOf(canonicalUrl: string): string[];
  /** NEWS-02: records that a screen asked for the item's picture and the cache holds it (null forgets it). */
  setImageRef(id: string, ref: string | null): void;
  /** NEWS-02: the topic ids the classifier gave an item. */
  setTopics(id: string, topics: readonly string[]): void;
  /** NEWS-02: the cleaned article of an item, if one is stored for this variant. */
  getContent(itemId: string, variant: ContentVariant): StoredContent | null;
  putContent(itemId: string, variant: ContentVariant, content: Omit<StoredContent, "pinned">): void;
  /** NEWS-02: a saved story keeps its stored text out of the prune (every variant stored for it). */
  pinContent(itemId: string, pinned: boolean): void;
  /** Drops a feed's links, and every item no feed carries any more. */
  forgetFeed(feedId: string): number;
  /** Atomically reserve one background attempt, including failed fetches. Rolling 24 hour site cap, global pace. */
  claimPrefetch(url: string, site: string, nowMs: number): boolean;
  prefetchOutcome(ok: boolean, nowMs: number): void;
  getEnrichment(itemId: string, band: AgeBand): Enrichment | null;
  putEnrichment(itemId: string, band: AgeBand, value: Enrichment): void;
  count(): number;
  close(): void;
}

export type ContentVariant = "child" | "teen" | "adult";
export interface StoredContent { blocks: unknown[]; source: "feed" | "fetched" | "archived" | "teaser"; reading_s: number; fetched_at: string; pinned: boolean }

type Row = {
  image_url?: string | null; image_ref?: string | null; topics?: string | null;
  id: string; canonical_url: string; feed_id: string; url: string; title: string; summary: string;
  published_at: string | null; fetched_at: string; publisher: string; lang: string; band_ok: string; hlc: string; provenance: string;
};

function topicsOf(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : undefined;
  } catch {
    return undefined;
  }
}

function toItem(row: Row): ShelfItem | null {
  const topics = topicsOf(row.topics);
  const parsed = NewsItem.safeParse({
    ...(row.image_url ? { image_url: row.image_url } : {}),
    image_ref: row.image_ref ?? null,
    ...(topics ? { topics } : {}),
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
  const have = new Set(sqlite.query<{ name: string }, []>("PRAGMA table_info(shelf_item)").all().map((column) => column.name));
  for (const [name, type] of ADDED_COLUMNS) if (!have.has(name)) sqlite.exec(`ALTER TABLE shelf_item ADD COLUMN ${name} ${type}`);
  const insert = sqlite.query(
    `INSERT OR IGNORE INTO shelf_item (id, canonical_url, feed_id, url, title, summary, published_at, fetched_at, publisher, lang, band_ok, hlc, provenance, image_url, topics)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
  );
  const byId = sqlite.query<Row, [string]>("SELECT * FROM shelf_item WHERE id = ?1");
  const carriers = sqlite.query<{ feed_id: string }, [string]>("SELECT feed_id FROM shelf_item_feed WHERE canonical_url = ?1");
  const setRef = sqlite.query("UPDATE shelf_item SET image_ref = ?2 WHERE id = ?1");
  const setTopicList = sqlite.query("UPDATE shelf_item SET topics = ?2 WHERE id = ?1");
  const topicsByCanonical = sqlite.query<{ id: string; topics: string | null }, [string]>("SELECT id, topics FROM shelf_item WHERE canonical_url = ?1");
  // A feed that gave no picture on the first poll may give one later: fill it in, never replace one.
  const fillImage = sqlite.query("UPDATE shelf_item SET image_url = ?2 WHERE canonical_url = ?1 AND image_url IS NULL");
  const readContent = sqlite.query<{ blocks: string; source: string; reading_s: number; fetched_at: string; pinned: number }, [string, string]>(
    "SELECT blocks, source, reading_s, fetched_at, pinned FROM news_content WHERE item_id = ?1 AND variant = ?2",
  );
  const writeContent = sqlite.query(
    `INSERT INTO news_content (item_id, variant, blocks, source, reading_s, fetched_at, pinned) VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE((SELECT MAX(pinned) FROM news_content WHERE item_id = ?1), 0))
     ON CONFLICT (item_id, variant) DO UPDATE SET blocks = excluded.blocks, source = excluded.source, reading_s = excluded.reading_s, fetched_at = excluded.fetched_at`,
  );
  const pin = sqlite.query("UPDATE news_content SET pinned = ?2 WHERE item_id = ?1");
  const pruneContent = sqlite.query("DELETE FROM news_content WHERE pinned = 0 AND item_id NOT IN (SELECT id FROM shelf_item)");
  const pruneEnrichment = sqlite.query("DELETE FROM news_enrichment WHERE item_id NOT IN (SELECT id FROM shelf_item)");
  const link = sqlite.query("INSERT OR IGNORE INTO shelf_item_feed (canonical_url, feed_id) VALUES (?1, ?2)");
  const pruneItems = sqlite.query("DELETE FROM shelf_item WHERE fetched_at < ?1 AND id NOT IN (SELECT item_id FROM news_content WHERE pinned = 1)");
  const pruneLinks = sqlite.query("DELETE FROM shelf_item_feed WHERE canonical_url NOT IN (SELECT canonical_url FROM shelf_item)");
  const dropLinks = sqlite.query("DELETE FROM shelf_item_feed WHERE feed_id = ?1");
  // A saved story's item stays when its feed is removed: its pinned text keeps it out of this delete as it does out of the prune.
  const dropOrphans = sqlite.query("DELETE FROM shelf_item WHERE canonical_url NOT IN (SELECT canonical_url FROM shelf_item_feed) AND id NOT IN (SELECT item_id FROM news_content WHERE pinned = 1)");
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
        item.fetched_at, item.publisher, item.lang, item.band_ok, item.hlc, item.provenance, item.image_url ?? null, item.topics && item.topics.length > 0 ? JSON.stringify(item.topics) : null,
      );
      link.run(item.canonical_url, item.feed_id);
      if (result.changes === 0) {
        stricten.run(item.canonical_url, item.band_ok);
        if (item.image_url) fillImage.run(item.canonical_url, item.image_url);
        // A story two feeds carry keeps the topics of both (NPR's top stories and NPR's World feed).
        if (item.topics && item.topics.length > 0) {
          for (const row of topicsByCanonical.all(item.canonical_url)) {
            const merged = [...new Set([...(topicsOf(row.topics) ?? []), ...item.topics])];
            if (merged.length !== (topicsOf(row.topics) ?? []).length) setTopicList.run(row.id, JSON.stringify(merged));
          }
        }
      }
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
      pruneContent.run();
      pruneEnrichment.run();
      return removed;
    },
    get(id) {
      const row = byId.get(id);
      return row ? toItem(row) : null;
    },
    feedIdsOf(canonicalUrl) {
      return carriers.all(canonicalUrl).map((row) => row.feed_id);
    },
    setImageRef(id, ref) {
      setRef.run(id, ref);
    },
    setTopics(id, topics) {
      setTopicList.run(id, JSON.stringify([...new Set(topics)]));
    },
    getContent(itemId, variant) {
      const row = readContent.get(itemId, variant);
      if (!row) return null;
      try {
        const blocks: unknown = JSON.parse(row.blocks);
        if (!Array.isArray(blocks)) return null;
        return { blocks, source: row.source as StoredContent["source"], reading_s: row.reading_s, fetched_at: row.fetched_at, pinned: row.pinned === 1 };
      } catch {
        return null;
      }
    },
    putContent(itemId, variant, content) {
      writeContent.run(itemId, variant, JSON.stringify(content.blocks), content.source, content.reading_s, content.fetched_at);
    },
    pinContent(itemId, pinned) {
      pin.run(itemId, pinned ? 1 : 0);
    },
    forgetFeed(feedId) {
      dropLinks.run(feedId);
      reattribute.run(feedId);
      const removed = dropOrphans.run().changes;
      pruneContent.run();
      pruneEnrichment.run();
      return removed;
    },
    ...prefetchBudget(sqlite),
    ...enrichmentStore(sqlite),
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
