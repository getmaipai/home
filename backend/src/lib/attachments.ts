import { generationOf } from "@/lib/music/types";
import { deleteMusicJobsForFiles, deleteMusicJobsForPerson, deleteMusicJobsForTurns } from "@/lib/music/store";
// ATT-01a: local attachment storage. The database row is spec-shaped and
// immutable; the file is a household-local implementation detail addressed
// only by its validated relative storage_path.
import { deletePictureJobsForFiles, deletePictureJobsForPerson, deletePictureJobsForTurns, dropTemporaryPictureJobs, dropTemporaryPictureJobsForPerson } from "@/lib/pictures/jobStore";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, openSync, readSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
// Renamed from the `File` export to `FileRecordSchema` locally: `File` is a
// Bun/Fetch global (the Web API type for a multipart upload), so importing
// the spec's zod object under that bare name would shadow it everywhere in
// this module.
import { File as FileRecordSchema, type File as FileRecord } from "@maipai/spec/gen/ts/file.js";
import { db } from "@/db";
import { attachments, conversationTurns, conversations, shares } from "@/db/schema";
import { newFileId } from "@/lib/id";
import { attachmentsDir, dataDir, ensureDataDir } from "@/lib/paths";
import { nextHlc } from "@/lib/hlc";
import { checkStorageCap, kindForMediaType } from "@/lib/storage/usage";
import { isGeneratedFile } from "@/lib/libraryProvenance";
import { contentFor, dropFileReferences, ensureContent, releaseContent, syncFileReferences } from "@/lib/fileContent";
import { canAccessFile, canAccessPerson, canReadFileAudience } from "@/lib/access";
import type { PersonRow } from "@/types";

export type AttachmentOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export interface CreateAttachmentInput {
  retention?: "conversation" | "kept";
  conversationId: string;
  turnId: string;
  mediaType: string;
  bytes: Uint8Array;
  provenance?: string;
  deduplicate?: boolean;
  /** LIBRARY-REVAMP-11/12: the file's own name (an upload) or the owner's name for it; ahead of the spec. */
  name?: string | null;
}

/** Check whether bytes would fit before an expensive consumer (such as
 * Tika) runs. Mirrors createAttachment's cost rule (LIBRARY-DEDUP-01):
 * bytes this person already holds cost them nothing, bytes the household
 * already stores cost the household nothing, and a person's usage counts
 * identical bytes once. The write path repeats this check to cover
 * changes during extraction. */
export function checkAttachmentCapacity(actor: PersonRow, mediaTypeInput: string, bytesInput: Uint8Array): AttachmentOpResult<null> {
  const mediaType = mediaTypeInput.trim().toLowerCase();
  if (!FileRecordSchema.shape.media_type.safeParse(mediaType).success) {
    return { ok: false, status: 400, error: "invalid attachment media type" };
  }
  const sha256 = createHash("sha256").update(bytesInput).digest("hex");
  const capCheck = checkStorageCap(actor.role, actor.id, bytesInput.byteLength, sha256);
  return capCheck.ok
    ? { ok: true, value: null }
    : { ok: false, status: 403, error: capCheck.error! };
}

/** Resolve only a normalized, relative attachment path below dataDir. */
export function attachmentFilePath(storagePath: string): string {
  const parsed = FileRecordSchema.shape.storage_path.safeParse(storagePath);
  const normalized = typeof storagePath === "string" ? normalize(storagePath).replaceAll("\\", "/") : "";
  if (!parsed.success || normalized !== storagePath) {
    throw new Error("invalid attachment storage path");
  }
  const filePath = resolve(dataDir, ...storagePath.split("/"));
  const withinDataDir = relative(dataDir, filePath);
  if (!withinDataDir || isAbsolute(withinDataDir) || withinDataDir === ".." || withinDataDir.startsWith(`..${requireSeparator()}`)) {
    throw new Error("invalid attachment storage path");
  }
  return filePath;
}

/** True when the file at path has exactly the expected size and digest (read only on a duplicate hit, which is rare). */
export function storedFileIntact(path: string, size: number, sha256: string): boolean {
  try {
    if (!existsSync(path) || statSync(path).size !== size) return false;
    const hash = createHash("sha256");
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let n: number;
      while ((n = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, n));
      return hash.digest("hex") === sha256;
    } finally { closeSync(fd); }
  } catch { return false; }
}

function requireSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function storagePathFor(ownerPersonId: string, id: string): string {
  const storagePath = `people/${ownerPersonId}/attachments/${id}`;
  attachmentFilePath(storagePath);
  return storagePath;
}

// STORE-SPEC-01: `kind` is a new required field the old attachment record
// never carried, so nothing here previously classified a media type.
// kindForMediaType() moved to lib/storage/usage.ts (STORE-PAGE-01) so its
// own personUsageByKind() can share the identical classification rather
// than growing a second copy - see that module's own comment for why it
// lives there and not here (this module already imports checkStorageCap
// from it, so importing one more thing back is not a new cycle).
//
// Exported: lib/shares.ts builds the same File shape from the same raw
// row for its own listings (the Library page's owned/shared lists), and
// a second copy of this mapping would drift from this one the moment
// STORE-SPEC-01's shape changes again.
export function toRecord(row: typeof attachments.$inferSelect): FileRecord {
  const generation = generationOf(row.provenance);
  const parsed = FileRecordSchema.safeParse({
    id: row.id,
    owner_person_id: row.ownerPersonId,
    // A chat upload is "sent"; MEDIA-PODCASTS-01 adds "fetched" (a copy the hub fetched for a media source,
    // lib/media/fetchedFiles.ts); MUSIC-GEN-03: a generated song is "made".
    origin: generation ? "made" : row.origin === "fetched" ? "fetched" : "sent",
    kind: kindForMediaType(row.mediaType),
    media_type: row.mediaType,
    size: row.size,
    sha256: row.sha256,
    storage_path: row.storagePath,
    retention: row.retention,
    // STORE-SPEC-01: conversation_id/turn_id moved off the top level into
    // provenance, which also gained package_id/job_id/requested_by_person_id and
    // note (the old free-text provenance column, unchanged in meaning).
    provenance: {
      conversation_id: row.conversationId,
      turn_id: row.turnId,
      package_id: generation ? "generate_music" : null,
      job_id: generation?.job_id ?? null,
      requested_by_person_id: null,
      media_source_id: row.origin === "fetched" ? (row.mediaSourceId ?? null) : null,
      note: row.provenance,
    },
    created_at: row.createdAt,
    hlc: row.hlc,
  });
  if (!parsed.success) throw new Error(`invalid attachment row: ${parsed.error.message}`);
  return parsed.data;
}

function removeFile(storagePath: string): void {
  try {
    const filePath = attachmentFilePath(storagePath);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // A row must not survive solely because its local file is locked or
    // already absent. The database deletion below is the source of truth.
  }
}

/** Save an upload only when its conversation and turn both belong to actor. */
export function createAttachment(actor: PersonRow, input: CreateAttachmentInput): AttachmentOpResult<FileRecord> {
  const context = db
    .select({ conversationId: conversations.id, turnId: conversationTurns.id })
    .from(conversationTurns)
    .innerJoin(conversations, eq(conversationTurns.conversationId, conversations.id))
    .where(
      and(
        eq(conversationTurns.id, input.turnId),
        eq(conversationTurns.conversationId, input.conversationId),
        eq(conversationTurns.personId, actor.id),
        eq(conversations.personId, actor.id),
      ),
    )
    .get();
  if (!context) return { ok: false, status: 404, error: "conversation turn not found" };
  return storeFile(actor, input);
}

export type StoreFileInput = Omit<CreateAttachmentInput, "conversationId" | "turnId" | "bytes"> & {
  conversationId: string | null;
  turnId: string | null;
} & ({ bytes: Uint8Array; staged?: never } | {
  bytes?: never;
  /** Internal, already hashed staging file. Never supplied by a client. */
  staged: { path: string; size: number; sha256: string };
});

/** The one write path for a file record (chat upload, generated output, Library upload). Callers check their own context
 * first: createAttachment above proves the turn is the actor's; lib/libraryUpload.ts has no chat at all. */
export function storeFile(actor: PersonRow, input: StoreFileInput): AttachmentOpResult<FileRecord> {
  const mediaType = input.mediaType.trim().toLowerCase();
  const parsedMediaType = FileRecordSchema.shape.media_type.safeParse(mediaType);
  if (!parsedMediaType.success) return { ok: false, status: 400, error: "invalid attachment media type" };
  const provenance = (input.provenance ?? "composer:upload").trim();
  if (!provenance) return { ok: false, status: 400, error: "attachment provenance is required" };

  const bytes = input.bytes;
  const size = input.staged?.size ?? bytes!.byteLength;
  const sha256 = input.staged?.sha256 ?? createHash("sha256").update(bytes!).digest("hex");

  // LIBRARY-DEDUP-01: one stored blob per sha256, one file record per owner. A person who sends the same bytes
  // again gets their existing record back; a different person gets their own record that points at the same stored
  // blob, so deleting one person's copy never takes the other's and no second copy is written to disk. This replaces
  // the old share pointer to the first uploader's record (STORE-SHARE-01's dedupe), which made the second person's copy
  // vanish with the first.
  const mine = input.deduplicate === false
    ? undefined
    : db.select().from(attachments).where(and(eq(attachments.sha256, sha256), eq(attachments.origin, "sent"), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  if (mine) return { ok: true, value: toRecord(mine) };

  // STORE-CAP-01: refused before anything is written to disk, in the person's own words. Bytes this person already
  // holds, or that the household already stores, add nothing to the matching total (storage/usage.ts).
  const capCheck = checkStorageCap(actor.role, actor.id, size, sha256);
  if (!capCheck.ok) return { ok: false, status: 403, error: capCheck.error! };

  const id = newFileId();
  const stored = contentFor(sha256);
  const storagePath = stored ? stored.storagePath : storagePathFor(actor.id, id);
  const filePath = attachmentFilePath(storagePath);
  // Write unless the one stored copy is really on disk and intact; a missing or damaged copy is rewritten from these
  // bytes (they hash to the same digest), so a new record never inherits a broken file.
  const needsWrite = !stored || !storedFileIntact(filePath, size, sha256);
  if (needsWrite) ensureDataDir(dirname(filePath));
  const row = {
    id,
    ownerPersonId: actor.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    mediaType,
    size,
    sha256,
    storagePath,
    retention: input.retention ?? "conversation" as const,
    provenance,
    origin: "sent",
    mediaSourceId: null,
    deletedAt: null,
    trashUntil: null,
    name: input.name ?? null,
    createdAt: new Date().toISOString(),
    hlc: nextHlc(),
  };
  const record = toRecord(row);

  if (needsWrite) {
    if (input.staged) { chmodSync(input.staged.path, 0o600); renameSync(input.staged.path, filePath); }
    else writeFileSync(filePath, bytes!, { mode: 0o600 });
  }
  try {
    db.transaction(() => {
      ensureContent(sha256, storagePath, size);
      db.insert(attachments).values(row).run();
      syncFileReferences(id);
    });
  } catch (err) {
    if (!stored) {
      try {
        unlinkSync(filePath);
      } catch {
        // Preserve the database error if cleanup itself cannot complete.
      }
    }
    throw err;
  }
  return { ok: true, value: record };
}

/** Return a file to its owner, or to anyone a live share names
 * (STORE-SHARE-01's canAccessFile) - the one read boundary every other
 * caller (documentExtraction.ts's extractAttachment, a future package
 * host RPC) goes through, so shared visibility only has to be right
 * here once. A third person with no share still gets the same 404 an
 * owner-only check would have given them - never a 403 that would
 * confirm the id exists. */
export function getAttachment(actor: PersonRow, id: string): AttachmentOpResult<FileRecord> {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row || !canAccessFile(actor, row.ownerPersonId, id)) return { ok: false, status: 404, error: "attachment not found" };
  return { ok: true, value: toRecord(row) };
}

/** Read and integrity-check the local bytes for a file actor may see. */
export function readAttachment(actor: PersonRow, id: string): AttachmentOpResult<{ record: FileRecord; bytes: Uint8Array }> {
  const found = getAttachment(actor, id);
  if (!found.ok) return found;
  try {
    const bytes = new Uint8Array(readFileSync(attachmentFilePath(found.value.storage_path)));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== found.value.size || digest !== found.value.sha256) {
      return { ok: false, status: 500, error: "attachment integrity check failed" };
    }
    return { ok: true, value: { record: found.value, bytes } };
  } catch {
    return { ok: false, status: 404, error: "attachment file not found" };
  }
}

/** Chat images are visible to the people who can read their conversation,
 * while the general Library keeps its explicit-share rule. */
export function readAttachmentForConversation(actor: PersonRow, conversationId: string, id: string): AttachmentOpResult<{ record: FileRecord; bytes: Uint8Array }> {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row || row.conversationId !== conversationId || !canReadFileAudience(actor, row)) return { ok: false, status: 404, error: "attachment not found" };
  const conversation = db.select({ personId: conversations.personId }).from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!conversation || !canAccessPerson(actor, conversation.personId)) return { ok: false, status: 404, error: "attachment not found" };
  const filePath = attachmentFilePath(row.storagePath);
  if (!existsSync(filePath)) return { ok: false, status: 404, error: "attachment bytes not found" };
  const bytes = readFileSync(filePath);
  if (bytes.byteLength !== row.size || createHash("sha256").update(bytes).digest("hex") !== row.sha256) return { ok: false, status: 500, error: "attachment integrity check failed" };
  return { ok: true, value: { record: toRecord(row), bytes: new Uint8Array(bytes) } };
}

/** Keep Library files, detaching their turn before it is deleted. A file in Trash keeps its record until its keep window
 * ends (LIBRARY-REVAMP-10); a chat-only copy (its Library item was purged) goes with its chat. */
export function deleteAttachmentsForTurns(turnIds: string[]): number {
  if (turnIds.length === 0) return 0;
  deleteMusicJobsForTurns(turnIds);
  deletePictureJobsForTurns(turnIds);
  const rows = db.select().from(attachments).where(inArray(attachments.turnId, turnIds)).all();
  let purged = 0;
  const purgedIds: string[] = [];
  for (const row of rows) {
    const chatOnly = row.deletedAt !== null && row.trashUntil === null;
    const inTrash = row.deletedAt !== null && row.trashUntil !== null;
    // LIBRARY-REVAMP-02: anything generated outlives its chat (it is a Library item; the Library's storage rules decide when it
    // goes), as do pinned files and files in Trash. Only a plain chat attachment goes with its chat.
    if (!chatOnly && (row.retention === "kept" || inTrash || isGeneratedFile(row))) {
      // Conversations are tombstoned, not removed. Keep that provenance for
      // conversation reads; only the turn FK must be cleared before deletion.
      db.update(attachments).set({ turnId: null }).where(eq(attachments.id, row.id)).run();
      syncFileReferences(row.id); // the chat reference ends with the turn; the owner's reference keeps the bytes
    } else {
      const blob = purgeFileRecord(row);
      if (blob) removeFile(blob);
      purged += 1;
      purgedIds.push(row.id);
    }
  }
  // A job that named a removed file (a chat-only copy whose Library item was purged earlier) has nothing left to show.
  deleteMusicJobsForFiles(purgedIds);
  deletePictureJobsForFiles(purgedIds);
  return purged;
}

/** Remove one File record for good: its share pointers first (shares.file_id
 * is a real foreign key), then the record. Returns the record's storage
 * path when no other record names it, for the caller to unlink once its
 * transaction has committed (removeFileBlobs below): bytes unlinked inside
 * a transaction that later rolls back would leave a record with no bytes,
 * a broken file in someone's Library, while a blob that outlives its
 * record is only a harmless orphan the reconcile job reports. The path
 * check is a guard: storagePathFor() builds a path from owner and file id,
 * so today no two records share one. */
export function purgeFileRecord(row: typeof attachments.$inferSelect): string | null {
  db.delete(shares).where(eq(shares.fileId, row.id)).run();
  dropFileReferences(row.id);
  db.delete(attachments).where(eq(attachments.id, row.id)).run();
  return releaseContent(row.sha256, row.storagePath);
}

/** Unlink the bytes purgeFileRecord() released. Best effort: a file that
 * will not delete stays as an orphan for the reconcile job, never an
 * error after the records are already gone. */
export function removeFileBlobs(storagePaths: readonly string[]): void {
  for (const storagePath of storagePaths) removeFile(storagePath);
}

/** host.data.forget(person): every file the person owns, shared or not,
 * goes with their memories (file.schema.json: a "conversation" file is
 * "deleted immediately by host.data.forget(person)"). Person deletion is a
 * different rule with a household outcome for shared files; that one is
 * lib/storage/personFiles.ts's releaseFilesOfDeletedPerson(). */
export function deleteAttachmentsForPerson(personId: string): number {
  deleteMusicJobsForPerson(personId);
  deletePictureJobsForPerson(personId);
  const rows = db.select().from(attachments).where(eq(attachments.ownerPersonId, personId)).all();
  const blobs: string[] = [];
  for (const row of rows) {
    const blob = purgeFileRecord(row);
    if (blob) blobs.push(blob);
  }
  removeFileBlobs(blobs);
  return rows.length;
}

// Temporary-chat images stay process memory only, and are keyed by the
// temporary conversation capability just like the conversation's turns.
export interface TemporaryChatImage {
  id: string;
  turnId: string;
  conversationId: string;
  ownerPersonId: string;
  name: string;
  mediaType: string;
  width: number;
  height: number;
  bytes: Uint8Array;
  createdAt: number;
  /** Set by Home on a picture the picture engine made (never by a name a person gave a file). */
  generated?: true;
  /** Safety audience recorded when Home generated this temporary picture. */
  audience?: "all-ages" | "adult-only";
  /** Set on a version the picture editor made: where it came from (lib/imageEdit.ts). */
  edit?: { v: 1; op: string; label: string; source: string; source_sha256: string; root: string; engine?: string; model?: string; ms?: number; width: number; height: number };
}
const temporaryChatImages = new Map<string, TemporaryChatImage>();
export function storeTemporaryChatImage(image: Omit<TemporaryChatImage, "createdAt">): void {
  const now = Date.now();
  for (const [id, value] of temporaryChatImages) if (now - value.createdAt > 2 * 60 * 60 * 1000) temporaryChatImages.delete(id);
  temporaryChatImages.set(image.id, { ...image, createdAt: now });
}
export function getTemporaryChatImage(actor: PersonRow, conversationId: string, id: string): TemporaryChatImage | undefined {
  const image = temporaryChatImages.get(id);
  if (!image || image.ownerPersonId !== actor.id || image.conversationId !== conversationId || Date.now() - image.createdAt > 2 * 60 * 60 * 1000) return undefined;
  return image;
}
/** VIDEO-GEN-05: the newest picture of this temporary chat that Home marked as made by the picture engine, or undefined. */
export function latestGeneratedTemporaryImage(actor: PersonRow, conversationId: string): TemporaryChatImage | undefined {
  let best: TemporaryChatImage | undefined;
  for (const image of temporaryChatImages.values()) if (image.generated === true && image.ownerPersonId === actor.id && image.conversationId === conversationId && (!best || image.createdAt >= best.createdAt)) best = image;
  return best;
}
/** IMGEDIT-01: the newest picture of this temporary chat, whoever made it (an upload, a generated picture or an edit's version). */
export function latestTemporaryChatImage(actor: PersonRow, conversationId: string): TemporaryChatImage | undefined {
  let best: TemporaryChatImage | undefined;
  for (const image of temporaryChatImages.values()) if (image.ownerPersonId === actor.id && image.conversationId === conversationId && image.mediaType.startsWith("image/") && (!best || image.createdAt >= best.createdAt)) best = image;
  return best;
}
export function getTemporaryChatImageForReader(actor: PersonRow, conversationId: string, id: string): TemporaryChatImage | undefined {
  const image = temporaryChatImages.get(id);
  if (!image || image.conversationId !== conversationId || Date.now() - image.createdAt > 2 * 60 * 60 * 1000 || !canAccessPerson(actor, image.ownerPersonId)) return undefined;
  return image;
}
export function temporaryChatImagesForTurn(actor: PersonRow, conversationId: string, turnId: string): TemporaryChatImage[] {
  return [...temporaryChatImages.values()].filter((image) => image.ownerPersonId === actor.id && image.conversationId === conversationId && image.turnId === turnId);
}
/** The editor's versions of one temporary picture, oldest first. */
export function listTemporaryChatImageVersions(actor: PersonRow, conversationId: string, rootId: string): (TemporaryChatImage & { edit: NonNullable<TemporaryChatImage["edit"]> })[] {
  return [...temporaryChatImages.values()]
    .filter((image): image is TemporaryChatImage & { edit: NonNullable<TemporaryChatImage["edit"]> } => Boolean(image.edit) && image.conversationId === conversationId && image.edit!.root === rootId && Date.now() - image.createdAt <= 2 * 60 * 60 * 1000 && canAccessPerson(actor, image.ownerPersonId))
    .sort((a, b) => a.createdAt - b.createdAt);
}
/** VIDEO-GEN-05: other in-memory stores of a temporary chat's media (a generated clip) follow the pictures' lifetime. */
export interface TemporaryMediaHooks { removeConversation(conversationId: string): void; removePerson(personId: string): void; prune(liveConversationIds: ReadonlySet<string>): void }
const temporaryMediaHooks: TemporaryMediaHooks[] = [];
export function registerTemporaryMedia(hooks: TemporaryMediaHooks): void { temporaryMediaHooks.push(hooks); }

export function removeTemporaryChatImages(conversationId: string): void {
  dropTemporaryPictureJobs(conversationId);
  for (const [id, image] of temporaryChatImages) if (image.conversationId === conversationId) temporaryChatImages.delete(id);
  for (const hooks of temporaryMediaHooks) hooks.removeConversation(conversationId);
}

/** Person deletion (lib/storage/personFiles.ts): a temporary chat's
 * pictures are process memory only, but they are still the person's and
 * go with them rather than waiting out the two-hour expiry. */
export function removeTemporaryChatImagesForPerson(personId: string): void {
  dropTemporaryPictureJobsForPerson(personId);
  for (const [id, image] of temporaryChatImages) if (image.ownerPersonId === personId) temporaryChatImages.delete(id);
  for (const hooks of temporaryMediaHooks) hooks.removePerson(personId);
}

export function pruneTemporaryChatImages(liveConversationIds: ReadonlySet<string>): void {
  for (const [id, image] of temporaryChatImages) if (!liveConversationIds.has(image.conversationId)) temporaryChatImages.delete(id);
  for (const hooks of temporaryMediaHooks) hooks.prune(liveConversationIds);
}
