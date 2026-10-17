import { isPodcastCopyTrash } from "./podcastCopies";
import { and, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { mediaCollections, mediaItems, mediaProgress, mediaSources } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { isMediaAdmin, sourceVisibleTo } from "@/lib/media/access";
import { bandAllows, bandOkAtIngest, mediaBandOf } from "@/lib/media/band";
import { itemFromRow, sourceFromRow } from "@/lib/media/model";
import { removeFetchedFile } from "@/lib/media/fetchedFiles";
import { discardItemProgress } from "@/lib/media/progress";
import { archivePath } from "@/lib/media/sources";
import type { PersonRow } from "@/types";
import { registerTrashProvider, type TrashRow } from "./registry";

type Item = typeof mediaItems.$inferSelect;
function mayManage(person: PersonRow, row: Item): boolean {
  if (person.role === "guest") return false;
  const raw = db.select().from(mediaSources).where(eq(mediaSources.id, row.sourceId)).get();
  if (!raw) return false;
  const source = sourceFromRow(raw);
  const own = source.scope === "person" && source.owner_person_id === person.id;
  if (!own && !(source.scope === "household" && isMediaAdmin(person) && mediaBandOf(person) === "adult")) return false;
  return sourceVisibleTo(source, person) && bandAllows(person, itemFromRow(row));
}
function envelope(kind: string, row: { id: string; title: string; deletedAt: string | null; trashUntil: string | null }): TrashRow {
  return { kind, id: row.id, title: row.title, deleted_at: row.deletedAt!, trash_until: row.trashUntil,
    can_restore: row.trashUntil !== null && row.trashUntil > new Date().toISOString(), can_purge: true };
}
function itemRows(person: PersonRow): Item[] {
  return db.select().from(mediaItems).where(isNotNull(mediaItems.deletedAt)).all().filter((row) => !isPodcastCopyTrash(row) && mayManage(person, row));
}
/** Parts follow their book only when they were trashed together. */
function family(row: Item): Item[] {
  return db.select().from(mediaItems).where(or(eq(mediaItems.id, row.id), and(eq(mediaItems.parentId, row.id), eq(mediaItems.deletedAt, row.deletedAt!)))).all();
}
function purgeItem(row: Item): void {
  db.transaction(() => {
    const rows = family(row);
    for (const item of rows) { const gone = item.locPath ?? item.externalId; if (gone) archivePath(item.sourceId, gone); }
    const ids = rows.map((item) => item.id);
    discardItemProgress(ids);
    db.delete(mediaProgress).where(inArray(mediaProgress.mediaId, ids)).run();
    db.delete(mediaItems).where(inArray(mediaItems.id, ids)).run();
    // A purged podcast episode takes its saved copy with it when no other item uses the file (only fetched copies; a chat upload is never touched).
    for (const item of rows) if (item.locFileId && !db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.locFileId, item.locFileId)).get()) removeFetchedFile(item.locFileId);
  });
}
registerTrashProvider({
  kind: "media_item", label: "Media",
  list: (person) => itemRows(person).map((row) => envelope("media_item", row)),
  restore(person, id) {
    const row = itemRows(person).find((item) => item.id === id);
    if (!row || !envelope("media_item", row).can_restore) return false;
    db.transaction(() => {
      const rows = family(row);
      const source = db.select().from(mediaSources).where(eq(mediaSources.id, row.sourceId)).get()!;
      const paths = new Set(rows.map((item) => item.locPath ?? item.externalId));
      const archive = (JSON.parse(source.archive) as string[]).filter((path) => !paths.has(path));
      db.update(mediaSources).set({ archive: JSON.stringify(archive), hlc: nextHlc() }).where(eq(mediaSources.id, source.id)).run();
      db.update(mediaItems).set({ deletedAt: null, trashUntil: null, missingSince: null, hlc: nextHlc() }).where(inArray(mediaItems.id, rows.map((item) => item.id))).run();
    });
    return true;
  },
  purge(person, id) {
    const row = itemRows(person).find((item) => item.id === id);
    if (!row) return false;
    purgeItem(row);
    return true;
  },
  purgeExpired(now) {
    const rows = db.select().from(mediaItems).where(and(isNotNull(mediaItems.deletedAt), lte(mediaItems.trashUntil, now.toISOString()))).all();
    for (const row of rows) if (!isPodcastCopyTrash(row)) purgeItem(row);
  },
});
function collectionRows(person: PersonRow) {
  if (person.role === "guest") return [];
  return db.select().from(mediaCollections).where(and(eq(mediaCollections.personId, person.id), isNotNull(mediaCollections.deletedAt))).all()
    .filter((row) => mediaBandOf(person) === "adult" || bandOkAtIngest({ title: row.title, explicit: false }).band === "child");
}
registerTrashProvider({
  kind: "media_collection", label: "Playlists and watchlists",
  list: (person) => collectionRows(person).map((row) => envelope("media_collection", row)),
  restore(person, id) {
    const row = collectionRows(person).find((item) => item.id === id);
    if (!row || !envelope("media_collection", row).can_restore) return false;
    db.update(mediaCollections).set({ deletedAt: null, trashUntil: null, hlc: nextHlc() }).where(eq(mediaCollections.id, id)).run();
    return true;
  },
  purge(person, id) {
    if (!collectionRows(person).some((row) => row.id === id)) return false;
    db.delete(mediaCollections).where(eq(mediaCollections.id, id)).run();
    return true;
  },
  purgeExpired(now) {
    db.delete(mediaCollections).where(and(isNotNull(mediaCollections.deletedAt), lte(mediaCollections.trashUntil, now.toISOString()))).run();
  },
});
