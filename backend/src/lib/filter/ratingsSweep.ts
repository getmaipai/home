/**
 * RATE-INGEST-01 (RULES.md C9): the glue that writes stored ratings. Each `stamp*` function reads one stored item, rates it with
 * `rateStoredItem` and writes the stamp; none of them runs on a request path for a list. `runRatingsSweep` is the background queue
 * (core job `ratings.sweep`): it stamps what has no stamp, another fingerprint, or an older rater version, and the old stamp holds
 * until the new one is written. A failed rater writes no stamp, so the item stays missing and the next sweep retries it.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, creations, mediaItems } from "@/db/schema";
import { fileAudience } from "@/lib/access";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { rateStoredItem } from "./rateStored";
import { shelfFingerprint, stampShelfItem } from "./shelfStamp";
import { getStamps, isStale, putStamp, staleOrMissing, type StampKind } from "./stamps";

type MediaRow = typeof mediaItems.$inferSelect;
const BATCH = 200;
const MAX_BATCHES_PER_KIND = 50;

function lyricsText(raw: string | null): string | null {
  if (!raw) return null;
  try { const parsed = JSON.parse(raw) as { text?: unknown }; return typeof parsed.text === "string" ? parsed.text : null; } catch { return null; }
}

export const mediaFingerprint = (row: Pick<MediaRow, "id" | "fingerprint" | "externalId">): string => row.fingerprint ?? row.externalId ?? row.id;

/** Stamps one library item from its stored row. Never throws: a failed check or write leaves the item without a new stamp. */
export function stampMediaRow(row: MediaRow): boolean {
  try {
    const rating = rateStoredItem({
      kind: "media_item", explicit: row.advisoryExplicit, title: row.title, description: row.description, lyrics: lyricsText(row.lyrics),
      also: [row.subtitle, row.artist, row.album, row.albumArtist, row.genre, row.series, row.author], bandOk: row.bandOk as "child" | "teen" | "adult",
    });
    if (!rating) return false;
    putStamp({ kind: "media_item", id: row.id }, rating, mediaFingerprint(row));
    return true;
  } catch { return false; }
}
export function stampMediaById(id: string): boolean {
  const row = db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
  return row ? stampMediaRow(row) : false;
}

/** Stamps one file from its audience mark; the fingerprint is the file's sha256. */
export function stampAttachmentRow(row: { id: string; sha256: string; provenance: string }): boolean {
  try {
    const rating = rateStoredItem({ kind: "attachment", audience: fileAudience(row.provenance), provenance: row.provenance });
    if (!rating) return false;
    putStamp({ kind: "attachment", id: row.id }, rating, row.sha256);
    return true;
  } catch { return false; }
}
export function stampAttachmentById(id: string): boolean {
  const row = db.select({ id: attachments.id, sha256: attachments.sha256, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, id)).get();
  return row ? stampAttachmentRow(row) : false;
}

export const creationFingerprint = (row: { madeAudience: string; updatedAt: string }): string => `${row.madeAudience}:${row.updatedAt}`;
export function stampCreationRow(row: { id: string; madeAudience: string; updatedAt: string }): boolean {
  try {
    const audience = row.madeAudience === "all-ages" || row.madeAudience === "adult-only" ? row.madeAudience : null;
    const rating = rateStoredItem({ kind: "creation", audience });
    if (!rating) return false;
    putStamp({ kind: "creation", id: row.id }, rating, creationFingerprint(row));
    return true;
  } catch { return false; }
}
export function stampCreationById(id: string): boolean {
  const row = db.select().from(creations).where(eq(creations.id, id)).get();
  return row ? stampCreationRow(row) : false;
}

async function sweepKind(kind: Exclude<StampKind, "shelf_item">): Promise<number> {
  let done = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_KIND; batch++) {
    const stale = staleOrMissing(kind, BATCH);
    if (stale.length === 0) break;
    let wrote = 0;
    for (const { id } of stale) {
      const ok = kind === "media_item" ? stampMediaById(id) : kind === "attachment" ? stampAttachmentById(id) : stampCreationById(id);
      if (ok) wrote++;
    }
    done += wrote;
    // Every row of a batch failed: stop, the next sweep retries (no stamp was written, so nothing is lost).
    if (wrote === 0) break;
    await new Promise((resolve) => setImmediate(resolve)); // let requests in between batches
  }
  return done;
}

function sweepShelf(): number {
  const store = sharedShelfStore();
  if (!store) return 0;
  let done = 0;
  try {
    const items = store.recent(5000);
    const stamps = getStamps("shelf_item", items.map((item) => item.id));
    const stale = items.filter((item) => isStale(stamps.get(item.id), shelfFingerprint(item)));
    for (const item of stale.slice(0, BATCH * MAX_BATCHES_PER_KIND)) if (stampShelfItem(item)) done++;
  } catch { /* the shelf could not be read; the next sweep tries again */ }
  return done;
}

let running = false;
/** One pass over every kind. Logs one count line, no titles. Returns how many items were stamped. */
export async function runRatingsSweep(log: (line: string) => void = (line) => console.log(line)): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    let total = 0;
    for (const kind of ["media_item", "attachment", "creation"] as const) {
      total += await sweepKind(kind);
    }
    total += sweepShelf();
    if (total > 0) log(`[ratings] swept ${total}`);
    return total;
  } finally { running = false; }
}

export { stampShelfItem };
