// Fetched copies are owner-scoped files. Other listeners read only through the media item's band and source gate.
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { File as FileRecordSchema } from "@maipai/spec/gen/ts/file.js";
import { attachmentFilePath, purgeFileRecord, removeFileBlobs, storedFileIntact, toRecord } from "@/lib/attachments";
import { contentFor, ensureContent, syncFileReferences } from "@/lib/fileContent";
import { nextHlc } from "@/lib/hlc";
import { newFileId } from "@/lib/id";
import { attachmentsDir, ensureDataDir } from "@/lib/paths";
import { checkStorageCap } from "@/lib/storage/usage";
import type { PersonRow } from "@/types";

export type FetchedFile = ReturnType<typeof toRecord>;
export type FetchedFileResult = { ok: true; value: FetchedFile } | { ok: false; status: 400 | 403 | 500; error: string };
interface Metadata { mediaType: string; mediaSourceId: string; note: string }
export interface FetchedFileInput extends Metadata { bytes: Uint8Array }
const invalidType = (): FetchedFileResult => ({ ok: false, status: 400, error: "That download is not a file type Home can keep. Try playing it from the show's website." });
const normalizedType = (type: string): string => type.split(";")[0]!.trim().toLowerCase();

function existingCopy(owner: PersonRow, input: Metadata, sha256: string): FetchedFile | null {
  // Never adopt a chat upload, another person's file, or another source's artwork.
  const existing = db.select().from(attachments).where(and(eq(attachments.sha256, sha256), eq(attachments.origin, "fetched"), eq(attachments.mediaType, normalizedType(input.mediaType)), eq(attachments.ownerPersonId, owner.id), eq(attachments.mediaSourceId, input.mediaSourceId))).get();
  if (!existing) return null;
  if (input.note === "podcast:manual" && existing.provenance === "podcast:auto") {
    db.update(attachments).set({ provenance: input.note, hlc: nextHlc() }).where(eq(attachments.id, existing.id)).run();
    existing.provenance = input.note;
  }
  return toRecord(existing);
}

function storeRow(owner: PersonRow, input: Metadata, id: string, size: number, sha256: string, write: (path: string) => void): FetchedFileResult {
  // LIBRARY-DEDUP-01: identical bytes already stored (a chat upload, another person's copy) are not written again.
  const stored = contentFor(sha256);
  const storagePath = stored ? stored.storagePath : `people/${owner.id}/attachments/${id}`;
  const filePath = attachmentFilePath(storagePath);
  // Reuse the one stored file only when it is really intact; otherwise the download we just made repairs it.
  const reuse = stored !== undefined && storedFileIntact(filePath, size, sha256);
  const row = {
    id, ownerPersonId: owner.id, conversationId: null, turnId: null, mediaType: normalizedType(input.mediaType), size, sha256, storagePath, retention: "kept" as const,
    provenance: input.note, origin: "fetched", mediaSourceId: input.mediaSourceId, deletedAt: null, trashUntil: null, createdAt: new Date().toISOString(), hlc: nextHlc(),
  };
  const record = toRecord(row);
  if (!reuse) { ensureDataDir(dirname(filePath)); write(filePath); }
  try {
    db.transaction(() => {
      ensureContent(sha256, storagePath, size);
      db.insert(attachments).values(row).run();
      syncFileReferences(id);
    });
  } catch (error) { if (!reuse && !stored) { try { unlinkSync(filePath); } catch { /* already gone */ } } throw error; }
  return { ok: true, value: record };
}

/** Small fetched assets, such as artwork. No second buffer and no share pointer. */
export function createFetchedFile(owner: PersonRow, input: FetchedFileInput): FetchedFileResult {
  if (!FileRecordSchema.shape.media_type.safeParse(normalizedType(input.mediaType)).success) return invalidType();
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = existingCopy(owner, input, sha256);
  if (existing) return { ok: true, value: existing };
  const cap = checkStorageCap(owner.role, owner.id, input.bytes.byteLength, sha256);
  if (!cap.ok) return { ok: false, status: 403, error: cap.error! };
  ensureDataDir(resolve(attachmentsDir, owner.id, "attachments"));
  return storeRow(owner, input, newFileId(), input.bytes.byteLength, sha256, (path) => writeFileSync(path, input.bytes, { mode: 0o600 }));
}

/** Stream into a private temporary file in the destination directory, hash once, then atomically rename. */
export async function createFetchedFileFromResponse(owner: PersonRow, input: Metadata, response: Response, limit: number): Promise<FetchedFileResult> {
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: "The episode has no audio data. Try playing it from the show's website." };
  const id = newFileId();
  const directory = resolve(attachmentsDir, owner.id, "attachments");
  const temporary = resolve(directory, `.${id}.download`);
  let fd: number | undefined;
  let finished = false;
  try {
    if (!FileRecordSchema.shape.media_type.safeParse(normalizedType(input.mediaType)).success) return invalidType();
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > 0) {
      const cap = checkStorageCap(owner.role, owner.id, declared);
      if (!cap.ok) return { ok: false, status: 403, error: cap.error! };
      if (declared > limit) return { ok: false, status: 400, error: "The episode is larger than 400 MB. Play it from the show's website instead." };
    }
    ensureDataDir(directory);
    fd = openSync(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      const cap = checkStorageCap(owner.role, owner.id, size);
      if (!cap.ok) return { ok: false, status: 403, error: cap.error! };
      if (size > limit) return { ok: false, status: 400, error: "The episode is larger than 400 MB. Play it from the show's website instead." };
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) offset += writeSync(fd, value, offset, value.byteLength - offset);
    }
    finished = true;
    closeSync(fd);
    fd = undefined;
    if (size === 0) return { ok: false, status: 400, error: "The episode has no audio data. Try playing it from the show's website." };
    const sha256 = hash.digest("hex");
    const existing = existingCopy(owner, input, sha256);
    if (existing) return { ok: true, value: existing };
    // Recheck after yielding: other jobs may have consumed space during the download.
    const cap = checkStorageCap(owner.role, owner.id, size, sha256);
    if (!cap.ok) return { ok: false, status: 403, error: cap.error! };
    return storeRow(owner, input, id, size, sha256, (path) => renameSync(temporary, path));
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch { /* renamed or never created */ }
  }
}

/** Only call once no media item (including Trash) references the copy. */
export function removeFetchedFile(fileId: string): boolean {
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.origin, "fetched"))).get();
  if (!row) return false;
  // LIBRARY-DEDUP-01: the bytes leave the disk only when no other record or reference holds them.
  const blob = purgeFileRecord(row);
  if (blob) removeFileBlobs([blob]);
  return true;
}
