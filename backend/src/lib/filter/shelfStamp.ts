/** RATE-INGEST-01: the stored rating of one shelf item. Its own module (no shelf store import) so the store can stamp a new item
 * as it is put, and the ratings sweep can stamp what is still missing. Never throws; a failed check writes no stamp. */
import { createHash } from "node:crypto";
import { rateStoredItem } from "./rateStored";
import { putStamp } from "./stamps";

type ShelfFields = { id: string; title: string; summary: string; canonical_url: string; band_ok: "child" | "teen" | "adult" };

/** What the rating was computed from: the story's address and the band the store holds for it (a duplicate can make it adult-only). */
export const shelfFingerprint = (item: Pick<ShelfFields, "canonical_url" | "band_ok">): string => createHash("sha256").update(`${item.canonical_url}|${item.band_ok}`).digest("hex");

export function stampShelfItem(item: ShelfFields): boolean {
  try {
    const rating = rateStoredItem({ kind: "shelf_item", title: item.title, text: item.summary, bandOk: item.band_ok });
    if (!rating) return false;
    putStamp({ kind: "shelf_item", id: item.id }, rating, shelfFingerprint(item));
    return true;
  } catch { return false; }
}
