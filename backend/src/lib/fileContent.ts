// LIBRARY-DEDUP-01 (docs/design/library-2026-10-18.md section 3.16): single-instance storage. The bytes of a file are
// stored once per sha256 (`file_contents`). Every owner, chat, collection and share that holds the file is a row in
// `file_references`; the bytes may leave the disk only when the last reference is gone. A file record (`attachments`) is
// still one per owner, so deleting one person's copy never touches another's. This module is the database half; the
// disk half (reclaiming duplicate blobs after the migration) is lib/fileBlobs.ts.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, fileContents, fileReferences, mediaItems, shares } from "@/db/schema";
import { newFileReferenceId } from "@/lib/id";

export const FILE_REFERENCE_KINDS = ["owner", "chat", "collection", "share"] as const;
export type FileReferenceKind = (typeof FILE_REFERENCE_KINDS)[number];

export function contentFor(sha256: string): typeof fileContents.$inferSelect | undefined {
  return db.select().from(fileContents).where(eq(fileContents.sha256, sha256)).get();
}

/** The one stored copy of these bytes: its row if the bytes are known, else the path to write them to. */
export function ensureContent(sha256: string, storagePath: string, size: number): typeof fileContents.$inferSelect {
  const existing = contentFor(sha256);
  if (existing) return existing;
  const row = { sha256, storagePath, size, createdAt: new Date().toISOString() };
  db.insert(fileContents).values(row).run();
  return row;
}

/** The references one file record should have right now, read from the records that hold it. */
export function expectedReferences(fileId: string): Array<{ kind: FileReferenceKind; holderId: string }> {
  const row = db.select().from(attachments).where(eq(attachments.id, fileId)).get();
  if (!row) return [];
  // The owner holds the record while it is in the Library or in Trash (LIBRARY-REVAMP-10); a chat-only copy has no owner reference.
  const expected: Array<{ kind: FileReferenceKind; holderId: string }> = [];
  if (row.deletedAt === null || row.trashUntil !== null) expected.push({ kind: "owner", holderId: row.ownerPersonId });
  if (row.turnId && row.conversationId) expected.push({ kind: "chat", holderId: row.conversationId });
  for (const share of db.select({ id: shares.id }).from(shares).where(eq(shares.fileId, fileId)).all()) expected.push({ kind: "share", holderId: share.id });
  for (const item of db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.locFileId, fileId)).all()) expected.push({ kind: "collection", holderId: item.id });
  return expected;
}

/** Bring the reference rows of one file record in line with what holds it. Call after any change to the record, its
 * shares or the media item that keeps it. Cheap and idempotent; a record with no content row is left alone (legacy rows
 * written directly by older tests and tools). */
export function syncFileReferences(fileId: string): void {
  const row = db.select({ sha256: attachments.sha256 }).from(attachments).where(eq(attachments.id, fileId)).get();
  if (!row) {
    db.delete(fileReferences).where(eq(fileReferences.fileId, fileId)).run();
    return;
  }
  if (!contentFor(row.sha256)) return;
  const wanted = expectedReferences(fileId);
  const have = db.select().from(fileReferences).where(eq(fileReferences.fileId, fileId)).all();
  const key = (kind: string, holder: string) => `${kind}\u0000${holder}`;
  const wantedKeys = new Set(wanted.map((entry) => key(entry.kind, entry.holderId)));
  const haveKeys = new Set(have.map((entry) => key(entry.kind, entry.holderId)));
  for (const entry of have) if (!wantedKeys.has(key(entry.kind, entry.holderId)) || entry.sha256 !== row.sha256) db.delete(fileReferences).where(eq(fileReferences.id, entry.id)).run();
  const now = new Date().toISOString();
  for (const entry of wanted) {
    if (haveKeys.has(key(entry.kind, entry.holderId)) && have.some((h) => h.kind === entry.kind && h.holderId === entry.holderId && h.sha256 === row.sha256)) continue; // already current
    db.insert(fileReferences).values({ id: newFileReferenceId(), sha256: row.sha256, fileId, kind: entry.kind, holderId: entry.holderId, createdAt: now }).onConflictDoNothing().run();
  }
}

/** The daily repair: recompute every record's references, so a write path that missed a sync cannot leave drift. */
export function syncAllFileReferences(): number {
  let repaired = 0;
  const drift = referenceDrift();
  const touched = new Set([...drift.missing, ...drift.extra].map((entry) => entry.split("|")[0]!));
  for (const fileId of touched) { syncFileReferences(fileId); repaired += 1; }
  return repaired;
}

export function dropFileReferences(fileId: string): void {
  db.delete(fileReferences).where(eq(fileReferences.fileId, fileId)).run();
}

export function referenceCount(sha256: string): number {
  return db.select({ n: sql<number>`count(*)` }).from(fileReferences).where(eq(fileReferences.sha256, sha256)).get()?.n ?? 0;
}

/** Kinds of reference one sha256 has, for tests and the migration report. */
export function referenceKinds(sha256: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of db.select({ kind: fileReferences.kind, n: sql<number>`count(*)` }).from(fileReferences).where(eq(fileReferences.sha256, sha256)).groupBy(fileReferences.kind).all()) out[row.kind] = Number(row.n);
  return out;
}

/** True when this person holds a record of these bytes (so keeping them costs the person nothing more). */
export function personHoldsContent(personId: string, sha256: string): boolean {
  return db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.ownerPersonId, personId), eq(attachments.sha256, sha256))).get() !== undefined;
}

export function contentStored(sha256: string): boolean {
  return db.select({ id: attachments.id }).from(attachments).where(eq(attachments.sha256, sha256)).get() !== undefined;
}

/** After a record and its references are gone: the path to unlink once the caller's transaction commits, or null while
 * anything still holds the bytes. A record written with no content row (legacy) falls back to a path check. */
export function releaseContent(sha256: string, storagePath: string): string | null {
  const content = contentFor(sha256);
  if (!content) {
    const stillNamed = db.select({ id: attachments.id }).from(attachments).where(eq(attachments.storagePath, storagePath)).get();
    return stillNamed ? null : storagePath;
  }
  if (referenceCount(sha256) > 0) return null;
  // Belt and braces: a record that names these bytes but lost its reference row still protects them.
  const holder = db.select({ id: attachments.id }).from(attachments).where(eq(attachments.sha256, sha256)).get();
  if (holder) {
    syncFileReferences(holder.id);
    return null;
  }
  db.delete(fileContents).where(eq(fileContents.sha256, sha256)).run();
  return content.storagePath;
}

/** Dry run numbers for the record: how many records, how many stored blobs, the bytes the records add up to and the
 * bytes actually stored. Read only. */
export function dedupReport(): { records: number; blobs: number; referenceRows: number; recordBytes: number; storedBytes: number; savedBytes: number } {
  const records = db.select({ n: sql<number>`count(*)`, b: sql<number>`coalesce(sum(${attachments.size}), 0)` }).from(attachments).get();
  const blobs = db.select({ n: sql<number>`count(*)`, b: sql<number>`coalesce(sum(${fileContents.size}), 0)` }).from(fileContents).get();
  const refs = db.select({ n: sql<number>`count(*)` }).from(fileReferences).get();
  const recordBytes = Number(records?.b ?? 0);
  const storedBytes = Number(blobs?.b ?? 0);
  return { records: Number(records?.n ?? 0), blobs: Number(blobs?.n ?? 0), referenceRows: Number(refs?.n ?? 0), recordBytes, storedBytes, savedBytes: recordBytes - storedBytes };
}

/** Test and health helper: reference rows that no record explains, and records missing one. */
export function referenceDrift(): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const extra: string[] = [];
  const ids = db.select({ id: attachments.id, sha256: attachments.sha256 }).from(attachments).all();
  const have = db.select().from(fileReferences).all();
  const haveKey = new Set(have.map((r) => `${r.fileId}|${r.kind}|${r.holderId}`));
  const wantedKey = new Set<string>();
  for (const { id, sha256 } of ids) {
    if (!contentFor(sha256)) continue;
    for (const e of expectedReferences(id)) {
      const k = `${id}|${e.kind}|${e.holderId}`;
      wantedKey.add(k);
      if (!haveKey.has(k)) missing.push(k);
    }
  }
  for (const k of haveKey) if (!wantedKey.has(k)) extra.push(k);
  return { missing, extra };
}

// Kept so a caller outside this module can ask which records share one stored copy.
