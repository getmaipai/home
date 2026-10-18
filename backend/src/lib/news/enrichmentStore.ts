import type { Database } from "bun:sqlite";
import type { AgeBand } from "@/lib/ageBand";

// Band variants mirror news_content: a page fetched under adult rules must never supply a child's description.
// A compound key keeps each band's status/12-hour miss receipt independent as well as its text.
export const ENRICHMENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS news_enrichment (
  item_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  image_url TEXT,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok', 'none')),
  at INTEGER NOT NULL,
  PRIMARY KEY (item_id, variant)
);
`;
export interface Enrichment { image_url: string | null; description: string | null; status: "ok" | "none"; at: number }

export function enrichmentStore(sqlite: Database) {
  const read = sqlite.query<Enrichment, [string, string]>("SELECT image_url, description, status, at FROM news_enrichment WHERE item_id = ? AND variant = ?");
  // An in-flight page that finishes after erasure must not resurrect its receipt or text.
  const write = sqlite.query(`INSERT OR REPLACE INTO news_enrichment (item_id, variant, image_url, description, status, at)
    SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM shelf_item WHERE id = ?)`);
  return {
    getEnrichment(itemId: string, band: AgeBand): Enrichment | null { return read.get(itemId, band); },
    putEnrichment(itemId: string, band: AgeBand, value: Enrichment): void {
      write.run(itemId, band, value.image_url, value.description, value.status, value.at, itemId);
    },
  };
}
