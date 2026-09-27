// ATT-01a: local attachment storage. The database row is spec-shaped and
// immutable; the file is a household-local implementation detail addressed
// only by its validated relative storage_path.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
// Renamed from the `File` export to `FileRecordSchema` locally: `File` is a
// Bun/Fetch global (the Web API type for a multipart upload), so importing
// the spec's zod object under that bare name would shadow it everywhere in
// this module.
import { File as FileRecordSchema, type File as FileRecord } from "@maipai/spec/gen/ts/file.js";
import { db, sqlite } from "@/db";
import { attachments, conversationTurns, conversations } from "@/db/schema";
import { newFileId } from "@/lib/id";
import { attachmentsDir, dataDir, ensureDataDir } from "@/lib/paths";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

export type AttachmentOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export interface CreateAttachmentInput {
  conversationId: string;
  turnId: string;
  mediaType: string;
  bytes: Uint8Array;
  provenance?: string;
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

function requireSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function storagePathFor(ownerPersonId: string, id: string): string {
  const storagePath = `people/${ownerPersonId}/attachments/${id}`;
  attachmentFilePath(storagePath);
  return storagePath;
}

// STORE-SPEC-01: `kind` is a new required field the old attachment record
// never carried, so nothing here previously classified a media type. This
// module only ever handles origin "sent" (a composer upload), so it only
// needs image/video/audio/other; it deliberately does not fold in
// documentExtraction.ts's own DOCUMENT_MEDIA_TYPES (a PDF or office file
// currently lands in "other", not "document") since that module already
// imports FROM this one (readAttachment) - reaching back for its list
// would be a circular import, and duplicating the list here would be a
// second copy of the same classification. Flagged in the migration report
// as a real gap, not silently guessed past.
function kindForMediaType(mediaType: string): FileRecord["kind"] {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  return "other";
}

function toRecord(row: typeof attachments.$inferSelect): FileRecord {
  const parsed = FileRecordSchema.safeParse({
    id: row.id,
    owner_person_id: row.ownerPersonId,
    // Every attachment this module creates is a chat upload - the old
    // record's only case, and the one origin value that applies here.
    origin: "sent",
    kind: kindForMediaType(row.mediaType),
    media_type: row.mediaType,
    size: row.size,
    sha256: row.sha256,
    storage_path: row.storagePath,
    retention: row.retention,
    // STORE-SPEC-01: conversation_id/turn_id moved off the top level into
    // provenance, which also gained package_id/job_id/requested_by_person_id
    // (never set here - none of those origins apply to a sent upload) and
    // note (the old free-text provenance column, unchanged in meaning).
    provenance: {
      conversation_id: row.conversationId,
      turn_id: row.turnId,
      package_id: null,
      job_id: null,
      requested_by_person_id: null,
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

  const mediaType = input.mediaType.trim().toLowerCase();
  const parsedMediaType = FileRecordSchema.shape.media_type.safeParse(mediaType);
  if (!parsedMediaType.success) return { ok: false, status: 400, error: "invalid attachment media type" };
  const provenance = (input.provenance ?? "composer:upload").trim();
  if (!provenance) return { ok: false, status: 400, error: "attachment provenance is required" };

  const id = newFileId();
  const storagePath = storagePathFor(actor.id, id);
  const filePath = attachmentFilePath(storagePath);
  const directory = resolve(attachmentsDir, actor.id, "attachments");
  ensureDataDir(directory);
  const bytes = new Uint8Array(input.bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const row = {
    id,
    ownerPersonId: actor.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    mediaType,
    size: bytes.byteLength,
    sha256,
    storagePath,
    retention: "conversation" as const,
    provenance,
    createdAt: new Date().toISOString(),
    hlc: nextHlc(),
  };
  const record = toRecord(row);

  writeFileSync(filePath, bytes, { mode: 0o600 });
  try {
    db.insert(attachments).values(row).run();
  } catch (err) {
    try {
      unlinkSync(filePath);
    } catch {
      // Preserve the database error if cleanup itself cannot complete.
    }
    throw err;
  }
  return { ok: true, value: record };
}

/** Return an attachment only to the person who uploaded it. */
export function getAttachment(actor: PersonRow, id: string): AttachmentOpResult<FileRecord> {
  const row = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, actor.id))).get();
  if (!row) return { ok: false, status: 404, error: "attachment not found" };
  return { ok: true, value: toRecord(row) };
}

/** Read and integrity-check the local bytes for an owned attachment. */
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

/** Delete records and their files before the owning turn is deleted. */
export function deleteAttachmentsForTurns(turnIds: string[]): number {
  if (turnIds.length === 0) return 0;
  const rows = db.select().from(attachments).where(inArray(attachments.turnId, turnIds)).all();
  for (const row of rows) removeFile(row.storagePath);
  sqlite.query(`DELETE FROM attachments WHERE turn_id IN (${turnIds.map(() => "?").join(",")})`).run(...turnIds);
  return rows.length;
}

/** Delete all attachment data belonging to a person after authorization. */
export function deleteAttachmentsForPerson(personId: string): number {
  const rows = db.select().from(attachments).where(eq(attachments.ownerPersonId, personId)).all();
  for (const row of rows) removeFile(row.storagePath);
  sqlite.query("DELETE FROM attachments WHERE owner_person_id = ?").run(personId);
  return rows.length;
}
