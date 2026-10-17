// Saved podcast copies use a trashed media-item envelope so the existing Trash registry owns restore and expiry.
// The live episode keeps streaming. No schema change or second trash store is needed.
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaItems } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newMediaItemId } from "@/lib/id";
import { isMediaAdmin, readableItem } from "@/lib/media/access";
import { mediaBandOf } from "@/lib/media/band";
import { removeFetchedFile } from "@/lib/media/fetchedFiles";
import { TRASH_DAYS } from "@/lib/media/sources";
import type { MediaItemRow } from "@/lib/media/model";
import type { PersonRow } from "@/types";
import { registerTrashProvider } from "./registry";

const PREFIX = "podcast:copy-trash:";
export const isPodcastCopyTrash = (row: Pick<MediaItemRow, "provenance">): boolean => row.provenance.startsWith(PREFIX);
export function mayManagePodcastCopy(person: PersonRow, fileId: string): boolean {
  if (person.role === "guest" || mediaBandOf(person) !== "adult") return false;
  const file = db.select().from(attachments).where(eq(attachments.id, fileId)).get();
  return file?.origin === "fetched" && (file.ownerPersonId === person.id || isMediaAdmin(person));
}

/** Detach only this item; a file still used by another live episode stays available there. */
export function trashPodcastCopy(row: MediaItemRow, now = new Date()): void {
  if (!row.locFileId) return;
  db.transaction(() => {
    const until = new Date(now.getTime() + TRASH_DAYS * 86_400_000).toISOString();
    db.insert(mediaItems).values({ ...row, id: newMediaItemId(), externalId: null, external: null, parentId: null, locUrl: null,
      artwork: null, deletedAt: now.toISOString(), trashUntil: until, provenance: PREFIX + row.id, hlc: nextHlc() }).run();
    db.update(mediaItems).set({ locFileId: null, fingerprint: null, hlc: nextHlc() }).where(eq(mediaItems.id, row.id)).run();
  });
}

function copies() {
  return db.select().from(mediaItems).where(isNotNull(mediaItems.deletedAt)).all().filter(isPodcastCopyTrash);
}
function allowed(person: PersonRow) {
  // Copy ownership plus adult floor: no minor's rows can enter this provider.
  return copies().filter((row) => row.locFileId && mayManagePodcastCopy(person, row.locFileId));
}
function purge(row: MediaItemRow): void {
  db.delete(mediaItems).where(eq(mediaItems.id, row.id)).run();
  if (row.locFileId && !db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.locFileId, row.locFileId)).get()) removeFetchedFile(row.locFileId);
}
registerTrashProvider({
  kind: "podcast_copy", label: "Saved podcast copies",
  list: (person) => allowed(person).map((row) => ({ kind: "podcast_copy", id: row.id, title: row.title, deleted_at: row.deletedAt!, trash_until: row.trashUntil,
    can_restore: !!row.trashUntil && row.trashUntil > new Date().toISOString() && !!readableItem(person, row.provenance.slice(PREFIX.length)), can_purge: true })),
  restore(person, id) {
    const row = allowed(person).find((copy) => copy.id === id);
    if (!row?.trashUntil || row.trashUntil <= new Date().toISOString()) return false;
    const originalId = row.provenance.slice(PREFIX.length);
    if (!readableItem(person, originalId)) return false;
    const original = db.select().from(mediaItems).where(eq(mediaItems.id, originalId)).get();
    if (!original || original.locFileId) return false;
    db.transaction(() => {
      db.update(mediaItems).set({ locFileId: row.locFileId, fingerprint: row.fingerprint, size: row.size, hlc: nextHlc() }).where(eq(mediaItems.id, original.id)).run();
      db.delete(mediaItems).where(eq(mediaItems.id, row.id)).run();
    });
    return true;
  },
  purge(person, id) {
    const row = allowed(person).find((copy) => copy.id === id);
    if (!row) return false;
    purge(row);
    return true;
  },
  purgeExpired(now) {
    const rows = db.select().from(mediaItems).where(and(isNotNull(mediaItems.deletedAt), lte(mediaItems.trashUntil, now.toISOString()))).all().filter(isPodcastCopyTrash);
    for (const row of rows) purge(row);
  },
});
