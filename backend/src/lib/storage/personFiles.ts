// STORE-DELETE-01 (docs/plans/household-storage-2026-09-23.md, "When a
// person is deleted", and decision 5): what happens to a person's files
// when the person is deleted. One step, called from one place
// (personLifecycle.ts's erasePersonData()):
//
// - a file with no live share pointer is purged with the person, record
//   and blob (the blob only when no record still points at it);
// - a file with any live share remains and passes to the household: it
//   counts against the household cap and nobody's personal cap, and the
//   person stays in its provenance.
//
// "Passes to the household" is derived, never written into the record:
// file.schema.json says owner_person_id is "always a person, never the
// household" and is "captured at write time and not inferred from a later
// profile change". So the record keeps the deleted person as its owner
// (their tombstone keeps the display name, personLifecycle.ts), and a file
// whose owner is a tombstone IS a household file: one fact, one place,
// read by usage.ts's householdInheritedUsage() and by shares.ts's listings.
// Personal caps only ever apply to the person writing (checkStorageCap),
// so a departed owner's files are charged to no one's personal cap, and
// householdUsageBytes() sums every record, so they still count against
// the household cap.
//
// Memorialization never calls this: a memorialized profile keeps every
// file exactly as it was (decision 5).
import { and, eq, inArray, isNotNull, isNull, or, ne } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, shares } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { attachmentsDir } from "@/lib/paths";
import * as tar from "tar";
import { attachmentFilePath, purgeFileRecord, removeTemporaryChatImagesForPerson, toRecord } from "@/lib/attachments";
import { pruneUnreachableShares } from "@/lib/shares";

/** A pointer that still gives a living person other than the departing
 * one a way to see the file: to the household, or to an active person. A
 * pointer to someone deleted before this rule existed reaches nobody. A
 * same-bytes pointer (attachments.ts's grantDedupeShare) counts: the other
 * person's own upload IS this record, so purging it would take their
 * picture too. The one definition both the preview and the step read, so
 * what the confirmation says is what the delete does. */
function hasLiveShareBeyond(fileId: string, departingPersonId: string): boolean {
  const targets = db.select({ to: shares.to }).from(shares).where(eq(shares.fileId, fileId)).all();
  return targets.some((share) => {
    if (share.to === departingPersonId) return false;
    if (share.to === "household") return true;
    return db.select({ id: people.id }).from(people).where(and(eq(people.id, share.to), isNull(people.deletedAt))).get() !== undefined;
  });
}

export interface FileFateCount {
  files: number;
  bytes: number;
}

export interface PersonFilesFate {
  /** Files nobody else can see: deleted with the person. */
  purged: FileFateCount;
  /** Files someone else can still see: kept, now the household's. */
  keptForHousehold: FileFateCount;
}

/** Read-only: what releaseFilesOfDeletedPerson() would do right now, for
 * the confirmation that offers the export first (decision 5). */
export function personFilesFate(personId: string): PersonFilesFate {
  const fate: PersonFilesFate = { purged: { files: 0, bytes: 0 }, keptForHousehold: { files: 0, bytes: 0 } };
  const rows = db.select({ id: attachments.id, size: attachments.size }).from(attachments).where(eq(attachments.ownerPersonId, personId)).all();
  for (const row of rows) {
    const bucket = hasLiveShareBeyond(row.id, personId) ? fate.keptForHousehold : fate.purged;
    bucket.files += 1;
    bucket.bytes += row.size;
  }
  return fate;
}

export interface ReleasedFiles {
  purged: number;
  keptForHousehold: number;
  /** Storage paths whose records are gone, for the caller to unlink once
   * its transaction commits (attachments.ts's removeFileBlobs). */
  blobsToRemove: string[];
}

/** The deletion step. Runs inside deletePerson()'s transaction, before the
 * person's turns and conversations are erased and before the tombstone is
 * written; it unlinks nothing itself (see ReleasedFiles.blobsToRemove). */
export function releaseFilesOfDeletedPerson(personId: string): ReleasedFiles {
  // Pointers first. A pointer addressed to the person points at nobody
  // once they are gone; a re-share they made from someone else's file
  // dies with the access it came from (pruneUnreachableShares).
  const touchedFileIds = [
    ...new Set(
      db
        .select({ fileId: shares.fileId })
        .from(shares)
        .where(or(eq(shares.to, personId), eq(shares.fromPersonId, personId)))
        .all()
        .map((row) => row.fileId),
    ),
  ];
  db.delete(shares).where(eq(shares.to, personId)).run();
  const othersFiles = touchedFileIds.length > 0
    ? db.select().from(attachments).where(and(inArray(attachments.id, touchedFileIds), ne(attachments.ownerPersonId, personId))).all()
    : [];
  for (const file of othersFiles) pruneUnreachableShares(file.id, file.ownerPersonId, personId);

  removeTemporaryChatImagesForPerson(personId);
  const released: ReleasedFiles = { purged: 0, keptForHousehold: 0, blobsToRemove: [] };
  const purge = (row: typeof attachments.$inferSelect) => {
    const blob = purgeFileRecord(row);
    if (blob) released.blobsToRemove.push(blob);
    released.purged += 1;
  };
  const own = db.select().from(attachments).where(eq(attachments.ownerPersonId, personId)).all();
  for (const row of own) {
    if (!hasLiveShareBeyond(row.id, personId)) {
      purge(row);
      continue;
    }
    // Kept for the household. The conversation and turn it arrived in
    // are erased right after this step, so the record stops naming them
    // and stops following their retention: it is kept until someone
    // deletes it. A new hlc, since the record changed.
    db.update(attachments)
      .set({ conversationId: null, turnId: null, retention: "kept", hlc: nextHlc() })
      .where(eq(attachments.id, row.id))
      .run();
    released.keptForHousehold += 1;
  }

  // A file an earlier departed person left to the household lives only
  // through its pointers. If this person held the last one, nobody can
  // reach it any more, so it goes now rather than sitting unreachable.
  for (const file of othersFiles) {
    const ownerDeleted = db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, file.ownerPersonId), isNotNull(people.deletedAt)))
      .get();
    if (!ownerDeleted) continue;
    if (hasLiveShareBeyond(file.id, personId)) continue;
    purge(file);
  }
  return released;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
};

/** Decision 5's export: every file the person owns, as a gzip tar with
 * the bytes under files/ and the File records in files.json, so nothing
 * about where a file came from is lost. Streamed by the `tar` package from
 * a scratch folder of hard links (a copy only when a link is refused), so
 * a person with gigabytes of video never has their files held in memory;
 * the scratch folder goes when the stream ends or is cancelled. A file
 * whose bytes are missing is listed in files.json and skipped, never a
 * failed export. The caller decides who may download it (routes/people.ts:
 * the same self-or-parent-of-a-child rule the memory export uses). */
export function exportPersonFiles(personId: string): ReadableStream<Uint8Array> {
  const rows = db.select().from(attachments).where(eq(attachments.ownerPersonId, personId)).all();
  // Beside the attachments folder, not the system temp folder: a hard link
  // only works within one filesystem, and /tmp is often a separate one
  // (or RAM), where every link would fall back to a full copy.
  const staging = mkdtempSync(join(dirname(attachmentsDir), ".maipai-files-export-"));
  mkdirSync(join(staging, "files"));
  const records = rows.map((row) => {
    const record = toRecord(row);
    const name = `files/${row.id}.${EXTENSIONS[row.mediaType] ?? "bin"}`;
    const source = attachmentFilePath(row.storagePath);
    try {
      try {
        linkSync(source, join(staging, name));
      } catch {
        copyFileSync(source, join(staging, name));
      }
      return { ...record, export_path: name };
    } catch {
      return { ...record, export_path: null };
    }
  });
  writeFileSync(join(staging, "files.json"), JSON.stringify(records, null, 2));
  const cleanup = () => rmSync(staging, { recursive: true, force: true });
  const pack = tar.c({ gzip: true, cwd: staging, portable: true }, ["files.json", "files"]);
  // A late error after a cancel must never go unheard (an unheard stream
  // error is an uncaught exception that would take the hub down).
  pack.on("error", () => {});
  const stop = () => {
    pack.destroy();
    cleanup();
  };
  const chunks = pack[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) {
          cleanup();
          controller.close();
        } else {
          controller.enqueue(new Uint8Array(next.value));
        }
      } catch (err) {
        stop();
        controller.error(err);
      }
    },
    cancel() {
      stop();
    },
  });
}
