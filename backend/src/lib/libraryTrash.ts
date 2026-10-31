// LIBRARY-REVAMP-10 (docs/design/library-2026-10-18.md section 3.10): Trash for Library files. Delete moves the owner's
// record into Trash for the configured number of days (30 by default). While it is there the file is out of the Library for
// everyone, its owner and every share recipient included (access ends at once, as unshare does); Restore brings the item
// and its sharing back. Purge, and expiry through the six-hour sweep, drop the owner's reference: the record goes too unless
// a chat still shows the file, in which case it stays as a chat-only copy (deleted_at set, trash_until null) with no second
// copy on disk. Bytes leave the disk only when no record or reference holds them (lib/fileContent.ts), so another owner's
// copy of the same bytes is never touched.
//
// Ahead of the spec: deleted_at and trash_until are columns on `attachments` until `file.deleted_at` and `file.trash_until`
// exist in commons (LIBRARY-REVAMP-03).
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { attachments, musicJobs, people, shares } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getHouseholdSettingValue } from "@/lib/settings";
import { LIBRARY_TRASH_DAYS_KEY } from "@/settings/libraryRetentionKeys";
import { libraryProvenance, libraryProvenanceSql } from "@/lib/libraryProvenance";
import { kindForMediaType } from "@/lib/storage/usage";
import { purgeFileRecord, removeFileBlobs } from "@/lib/attachments";
import { syncFileReferences } from "@/lib/fileContent";
import { deleteMusicJobsForFiles } from "@/lib/music/store";
import { deletePictureJobsForFiles } from "@/lib/pictures/jobStore";
import type { PersonRow } from "@/types";

type Row = typeof attachments.$inferSelect;
export type TrashResult<T> = { ok: true; value: T } | { ok: false; status: 403 | 404; error: string };
const DAY = 86_400_000;

export function trashDays(): number {
  const days = Number(getHouseholdSettingValue(LIBRARY_TRASH_DAYS_KEY));
  return Number.isFinite(days) && days > 0 ? days : 30;
}

/** The files that travel with an item: a picture's edit versions, a video's poster and a song's cover. */
export function companionsOf(row: Row): Row[] {
  const meta = libraryProvenance(row.provenance);
  const job = meta.writer === "video-gen" && typeof meta.job === "string" ? meta.job : null;
  const found = sqlite.query<{ id: string }, (string | null)[]>(
    `SELECT a.id FROM attachments a WHERE a.owner_person_id = ? AND a.id != ? AND (
       (a.provenance LIKE 'image-edit:%' AND json_extract(${libraryProvenanceSql("a.provenance")}, '$.root') = ?)
       OR (? IS NOT NULL AND a.provenance LIKE 'video-poster:%' AND json_extract(${libraryProvenanceSql("a.provenance")}, '$.job') = ?))`,
  ).all(row.ownerPersonId, row.id, row.id, job, job).map((r) => r.id);
  const covers = db.select({ cover: musicJobs.coverFileId }).from(musicJobs).where(eq(musicJobs.fileId, row.id)).all().map((j) => j.cover).filter((id): id is string => Boolean(id));
  const ids = [...new Set([...found, ...covers])];
  if (ids.length === 0) return [];
  return db.select().from(attachments).where(and(inArray(attachments.id, ids), eq(attachments.ownerPersonId, row.ownerPersonId))).all();
}

/** The live item a companion file belongs to (an edit's picture, a poster's video, a cover's song), if any. */
export function parentOf(row: Row): Row | undefined {
  const meta = libraryProvenance(row.provenance);
  const live = (id: string) => db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, row.ownerPersonId), isNull(attachments.deletedAt))).get();
  if (meta.writer === "image-edit" && typeof meta.root === "string") return live(meta.root);
  if (meta.writer === "video-poster" && typeof meta.job === "string") {
    const found = sqlite.query<{ id: string }, string[]>(`SELECT a.id FROM attachments a WHERE a.owner_person_id = ? AND a.deleted_at IS NULL AND a.provenance LIKE 'video-gen:%' AND json_extract(${libraryProvenanceSql("a.provenance")}, '$.job') = ?`).get(row.ownerPersonId, meta.job);
    return found ? live(found.id) : undefined;
  }
  const job = db.select({ file: musicJobs.fileId }).from(musicJobs).where(eq(musicJobs.coverFileId, row.id)).get();
  return job?.file ? live(job.file) : undefined;
}

/** A readable name for the Trash list, built from the same notes the Library listing reads. */
function titleOf(row: Row): string {
  if (row.name) return row.name.slice(0, 80);
  const meta = libraryProvenance(row.provenance);
  const text = [meta.title, meta.prompt].find((value): value is string => typeof value === "string" && value.trim() !== "");
  if (text) return text.trim().slice(0, 80);
  const note = row.provenance.startsWith("composer:") ? row.provenance.slice("composer:".length).trim() : "";
  if (note && note !== "upload") return note.slice(0, 80);
  const kind = kindForMediaType(row.mediaType);
  return kind === "image" ? "Picture" : kind === "video" ? "Video" : kind === "audio" ? "Song or audio" : kind === "document" ? "Document" : "File";
}

/** Move one of the caller's own Library files, with its companions, into Trash. */
/** Issue 213: an owner or admin may delete a file whose owner has left the household (their shared files stay household-held). */
export function canDeleteInherited(actor: PersonRow, ownerPersonId: string): boolean {
  if (actor.role !== "owner" && actor.role !== "admin") return false;
  return Boolean(db.select({ deletedAt: people.deletedAt }).from(people).where(eq(people.id, ownerPersonId)).get()?.deletedAt);
}

export function trashFile(actor: PersonRow, id: string, now = new Date()): TrashResult<{ id: string; deleted_at: string; trash_until: string }> {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  // Not the owner's, or already gone: the same answer, so an id never confirms a file someone else holds.
  if (!row || (row.ownerPersonId !== actor.id && !canDeleteInherited(actor, row.ownerPersonId)) || row.deletedAt !== null) return { ok: false, status: 404, error: "That file is not in your Library. Refresh the page and try again." };
  if (row.origin === "fetched") return { ok: false, status: 403, error: "Saved media belongs to its app. Remove it there." };
  if (parentOf(row)) return { ok: false, status: 403, error: "This file belongs to another item. Delete that item instead." };
  const deletedAt = now.toISOString();
  const trashUntil = new Date(now.getTime() + trashDays() * DAY).toISOString();
  db.transaction(() => {
    for (const member of [row, ...companionsOf(row).filter((other) => other.deletedAt === null)]) {
      db.update(attachments).set({ deletedAt, trashUntil, hlc: nextHlc() }).where(eq(attachments.id, member.id)).run();
      syncFileReferences(member.id);
    }
  });
  return { ok: true, value: { id, deleted_at: deletedAt, trash_until: trashUntil } };
}

function trashedMain(person: PersonRow): Row[] {
  const trashed = db.select().from(attachments).where(and(eq(attachments.ownerPersonId, person.id), isNotNull(attachments.deletedAt), isNotNull(attachments.trashUntil))).all();
  if (trashed.length === 0) return [];
  // Companions among the trashed rows only (one pass over them, not a scan of the whole Library per row).
  const ids = new Set(trashed.map((row) => row.id));
  const videoJobs = new Set<string>();
  const metas = trashed.map((row) => ({ row, meta: libraryProvenance(row.provenance) }));
  for (const { meta } of metas) if (meta.writer === "video-gen" && typeof meta.job === "string") videoJobs.add(meta.job);
  const covers = new Set(db.select({ cover: musicJobs.coverFileId }).from(musicJobs).where(inArray(musicJobs.fileId, [...ids])).all().map((job) => job.cover).filter((id): id is string => Boolean(id)));
  const companion = (row: Row, meta: ReturnType<typeof libraryProvenance>) =>
    (meta.writer === "image-edit" && typeof meta.root === "string" && ids.has(meta.root)) ||
    (meta.writer === "video-poster" && typeof meta.job === "string" && videoJobs.has(meta.job)) ||
    covers.has(row.id);
  return metas.filter(({ row, meta }) => !companion(row, meta)).map(({ row }) => row).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!) || a.id.localeCompare(b.id));
}

export function listTrashedFiles(person: PersonRow, now = new Date()): Array<{ id: string; title: string; deleted_at: string; trash_until: string; can_restore: boolean; thumb_url: string | null }> {
  return trashedMain(person).map((row) => ({ id: row.id, thumb_url: kindForMediaType(row.mediaType) === "document" || kindForMediaType(row.mediaType) === "other" ? null : `/api/trash/file/${row.id}/thumb`, title: titleOf(row), deleted_at: row.deletedAt!, trash_until: row.trashUntil!, can_restore: row.trashUntil! > now.toISOString() }));
}

/** Counts for the Library header: items in Trash and the bytes they still hold (identical bytes count once). */
export function trashTotals(person: PersonRow): { items: number; bytes: number } {
  const items = trashedMain(person).length;
  const rows = db.select({ sha: attachments.sha256, size: attachments.size }).from(attachments).where(and(eq(attachments.ownerPersonId, person.id), isNotNull(attachments.deletedAt), isNotNull(attachments.trashUntil))).all();
  const bySha = new Map<string, number>();
  for (const row of rows) bySha.set(row.sha, Math.max(bySha.get(row.sha) ?? 0, row.size));
  return { items, bytes: [...bySha.values()].reduce((sum, size) => sum + size, 0) };
}

function familyInTrash(person: PersonRow, id: string): Row[] {
  const row = trashedMain(person).find((item) => item.id === id);
  if (!row) return [];
  return [row, ...companionsOf(row).filter((other) => other.deletedAt === row.deletedAt && other.trashUntil !== null)];
}

export function restoreFile(person: PersonRow, id: string, now = new Date()): boolean {
  const family = familyInTrash(person, id);
  if (family.length === 0 || family[0]!.trashUntil! <= now.toISOString()) return false;
  db.transaction(() => {
    for (const member of family) {
      db.update(attachments).set({ deletedAt: null, trashUntil: null, hlc: nextHlc() }).where(eq(attachments.id, member.id)).run();
      syncFileReferences(member.id);
    }
  });
  return true;
}

/** Drop the owner's Library reference for these records: a record a chat still shows stays as a chat-only copy, the rest
 * are removed, and bytes go only at zero references. Used by Trash purge and expiry and by the storage-rule removal
 * (lib/libraryRetention.ts). Returns what each record freed on disk. */
export function dropLibraryReference(rows: Row[]): Array<{ id: string; size: number; freed: boolean }> {
  const blobs: string[] = [];
  const gone: string[] = [];
  const result: Array<{ id: string; size: number; freed: boolean }> = [];
  db.transaction(() => {
    for (const row of rows) {
      if (row.turnId !== null && row.conversationId !== null) {
        db.delete(shares).where(eq(shares.fileId, row.id)).run();
        db.update(attachments).set({ deletedAt: row.deletedAt ?? new Date().toISOString(), trashUntil: null, hlc: nextHlc() }).where(eq(attachments.id, row.id)).run();
        syncFileReferences(row.id);
        result.push({ id: row.id, size: row.size, freed: false });
        continue;
      }
      gone.push(row.id);
    }
    const doomed = db.select().from(attachments).where(inArray(attachments.id, gone.length ? gone : [""])).all();
    for (const row of doomed) {
      const blob = purgeFileRecord(row);
      if (blob) blobs.push(blob);
      result.push({ id: row.id, size: row.size, freed: blob !== null });
    }
    // After the records are gone, so a pinned item's job (which a still-present pinned file would protect) goes with it.
    deleteMusicJobsForFiles(gone);
    deletePictureJobsForFiles(gone);
  });
  removeFileBlobs(blobs);
  return result;
}

export function purgeTrashedFile(person: PersonRow, id: string): boolean {
  const family = familyInTrash(person, id);
  if (family.length === 0) return false;
  dropLibraryReference(family);
  return true;
}

/** The six-hour sweep: every record whose keep window has ended. */
export function purgeExpiredFiles(now = new Date()): number {
  const rows = db.select().from(attachments).where(and(isNotNull(attachments.deletedAt), isNotNull(attachments.trashUntil), lte(attachments.trashUntil, now.toISOString()))).all();
  if (rows.length) dropLibraryReference(rows);
  return rows.length;
}

export { titleOf as trashTitleOf };
