// RATE-INGEST-01: a test that seeds media_items rows directly rates them the way a real ingest would, so a minor's list (which reads stored stamps only) can show them.
import { db } from "@/db";
import { mediaItems } from "@/db/schema";
import { stampMediaRow } from "@/lib/filter/ratingsSweep";
import { getStamp } from "@/lib/filter/stamps";

/** Stamps every media row that has no stamp yet. Call right after the direct inserts. */
export function stampSeededMedia(): void {
  for (const row of db.select().from(mediaItems).all()) if (!getStamp("media_item", row.id)) stampMediaRow(row);
}
