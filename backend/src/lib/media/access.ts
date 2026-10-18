// MEDIA-LIB-01: who may read a media item or source. A reader needs an item that is not trashed or hidden, a source that is
// live and visible to them (`visible_to`), and a band that allows it (band.ts). Writes to sources are for an owner or admin.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { getPersonSettingValue } from "@/lib/settings";
import { MEDIA_ALLOWLIST_KEY } from "@/settings/mediaKeys";
import { bandAllows, mediaBandOf } from "./band";
import { itemFromRow, sourceFromRow, type MediaItem, type MediaSource } from "./model";

export function isMediaAdmin(actor: PersonRow): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/** App routes use this before assembling discovery shelves or chips. Library search still uses the access gate. */
export function discoveryAllowed(actor: PersonRow): boolean {
  return getPersonSettingValue(actor, MEDIA_ALLOWLIST_KEY) !== true;
}

/** Source allowlist mode for every media read (MEDIA-KID-01): a guest always (a guest's settings resolve as an adult's, so the
 * setting alone would leave a guest open), and anyone whose `media.allowlist_only` is on (the child default; an admin may turn it
 * off for one child, design note section 11). */
export function allowlistMode(actor: PersonRow): boolean {
  return actor.role === "guest" || !discoveryAllowed(actor);
}

/** No discovery rows and no autoplay suggestion: allowlist mode, or any child even when an admin turned allowlist mode off (the
 * override opens sources, not suggestion rows). Every discovery gate in the media apps uses this one test. */
export function noDiscovery(actor: PersonRow): boolean {
  return allowlistMode(actor) || mediaBandOf(actor) === "child";
}

export function sourceVisibleTo(source: Pick<MediaSource, "kind" | "visible_to" | "deleted_at" | "scope" | "owner_person_id">, actor: PersonRow): boolean {
  if (source.deleted_at) return false;
  if (source.scope === "person" && source.owner_person_id !== actor.id) return false;
  const named = Array.isArray(source.visible_to) && source.visible_to.includes(actor.id);
  // Allowlist mode (MEDIA-KID-01): the household library, a source an adult named this person on, or a source made for this
  // person (scope person, owned by them: an adult sets these up; a child never adds one).
  const ownSource = source.scope === "person" && source.owner_person_id === actor.id;
  if (allowlistMode(actor) && !(source.kind === "root" && source.scope === "household") && !named && !ownSource) return false;
  return source.visible_to === "household" || named;
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
