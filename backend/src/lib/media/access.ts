// MEDIA-LIB-01: who may read a media item or source. A reader needs an item that is not trashed or hidden, a source that is
// live and visible to them (`visible_to`), and a band that allows it (band.ts). Writes to sources are for an owner or admin.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { bandAllows } from "./band";
import { itemFromRow, sourceFromRow, type MediaItem, type MediaSource } from "./model";

export function isMediaAdmin(actor: PersonRow): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

export function sourceVisibleTo(source: Pick<MediaSource, "visible_to" | "deleted_at" | "scope" | "owner_person_id">, actor: PersonRow): boolean {
  if (source.deleted_at) return false;
  if (source.scope === "person" && source.owner_person_id !== actor.id) return false;
  return source.visible_to === "household" || source.visible_to.includes(actor.id);
}

export function liveSourceById(id: string): MediaSource | null {
  const row = db.select().from(mediaSources).where(and(eq(mediaSources.id, id), isNull(mediaSources.deletedAt))).get();
  return row ? sourceFromRow(row) : null;
}

/** An item `actor` may read, or null (a missing item and a forbidden one look the same). */
export function readableItem(actor: PersonRow, id: string): MediaItem | null {
  const row = db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
  if (!row || row.deletedAt || row.hidden) return null;
  const source = liveSourceById(row.sourceId);
  if (!source || !sourceVisibleTo(source, actor)) return null;
  try {
    const item = itemFromRow(row);
    return bandAllows(actor, item) ? item : null;
  } catch {
    return null; // a row that no longer has the spec shape is not served
  }
}
