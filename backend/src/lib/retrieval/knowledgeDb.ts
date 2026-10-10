// KS-01: `knowledge.db` (DESIGN section 4.1), the rebuildable store the
// retrieval module keeps beside hub.db. It lives in the `cache` data class
// (disposable, excluded from backups, rebuilt on its own), never in
// hub.db. This slice owns one table: the extracted-article cache, keyed by
// book and path, valid for one snapshot of the book. When a book's
// snapshot date changes (the ZIM swapped) its rows are dropped.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "@/lib/paths";
import type { ExtractedArticle } from "@/lib/retrieval/extractArticle";

export interface CachedArticle {
  article: ExtractedArticle;
  /** Whether the extract passed the minor's floor when it was ingested. */
  minorOk: boolean;
}

export interface KnowledgeDb {
  getArticle(book: string, path: string, snapshot: string): CachedArticle | null;
  putArticle(book: string, path: string, snapshot: string, article: ExtractedArticle, minorOk: boolean): void;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS extracted_article (
  book TEXT NOT NULL,
  path TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  minor_ok INTEGER NOT NULL,
  article_json TEXT NOT NULL,
  extracted_at TEXT NOT NULL,
  PRIMARY KEY (book, path)
);
CREATE INDEX IF NOT EXISTS extracted_article_book ON extracted_article (book);
`;

export function openKnowledgeDb(path: string): KnowledgeDb {
  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec(SCHEMA);
  const get = sqlite.query<{ snapshot: string; minor_ok: number; article_json: string }, [string, string]>(
    "SELECT snapshot, minor_ok, article_json FROM extracted_article WHERE book = ?1 AND path = ?2",
  );
  const dropBook = sqlite.query("DELETE FROM extracted_article WHERE book = ?1");
  const put = sqlite.query(
    "INSERT OR REPLACE INTO extracted_article (book, path, snapshot, minor_ok, article_json, extracted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  );
  return {
    getArticle(book, articlePath, snapshot) {
      const row = get.get(book, articlePath);
      if (!row) return null;
      if (row.snapshot !== snapshot) {
        // The book was swapped for a newer snapshot: every row of the old
        // one is stale.
        dropBook.run(book);
        return null;
      }
      try {
        const article = JSON.parse(row.article_json) as ExtractedArticle;
        const shaped =
          typeof article?.title === "string" &&
          typeof article.lead === "string" &&
          Array.isArray(article.infobox) &&
          Array.isArray(article.options) &&
          typeof article.disambiguation === "boolean";
        return shaped ? { article, minorOk: row.minor_ok === 1 } : null;
      } catch {
        return null;
      }
    },
    putArticle(book, articlePath, snapshot, article, minorOk) {
      put.run(book, articlePath, snapshot, minorOk ? 1 : 0, JSON.stringify(article), new Date().toISOString());
    },
    close() {
      sqlite.close();
    },
  };
}

let shared: KnowledgeDb | null = null;

/** The hub's one knowledge.db handle, opened on first use. A failure to
 * open it returns null: the reader works without the cache. */
export function sharedKnowledgeDb(): KnowledgeDb | null {
  if (shared) return shared;
  try {
    shared = openKnowledgeDb(join(cacheDir, "knowledge.db"));
    return shared;
  } catch {
    return null;
  }
}

export function __resetSharedKnowledgeDbForTests(): void {
  shared?.close();
  shared = null;
}
