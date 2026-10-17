// MEDIA-PODCASTS-01: the household file store's `origin: fetched` writer (spec file.origin): a copy the hub fetched for a media source
// an adult chose (a podcast episode, a show's picture). It is the same blob store as a chat upload (content-addressed by sha256, the
// same caps, the same reconcile job); the difference is the record: origin fetched, retention kept (no conversation owns it) and
// provenance.media_source_id. A saved copy belongs to the household's library, so it is shared to the household at once: the people
// who may see the episode (media band and the source's visible_to decide that) can read its bytes.
import { createHash } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, shares } from "@/db/schema";
import { File as FileRecordSchema } from "@maipai/spec/gen/ts/file.js";
import { attachmentFilePath, toRecord } from "@/lib/attachments";
import { nextHlc } from "@/lib/hlc";
import { newFileId, newShareId } from "@/lib/id";
import { attachmentsDir, ensureDataDir } from "@/lib/paths";
import { checkStorageCap } from "@/lib/storage/usage";
import type { PersonRow } from "@/types";

export type FetchedFile = ReturnType<typeof toRecord>;
export type FetchedFileResult = { ok: true; value: FetchedFile } | { ok: false; status: 400 | 403 | 500; error: string };

export interface FetchedFileInput {
  mediaType: string;
  bytes: Uint8Array;
  mediaSourceId: string;
  /** "podcast:manual" or "podcast:auto": auto copies may be removed by the source's keep rules, manual ones never are. */
  note: string;
}

function shareToHousehold(ownerId: string, fileId: string): void {
  const already = db.select().from(shares).where(and(eq(shares.fileId, fileId), eq(shares.to, "household"))).get();
  if (already) return;
  db.insert(shares).values({ id: newShareId(), fileId, fromPersonId: ownerId, to: "household", provenance: "media-source:fetched", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
}

/** Stores fetched bytes for `owner` (the adult who asked, or who made the source). Identical bytes already in the store are reused. */
export function createFetchedFile(owner: PersonRow, input: FetchedFileInput): FetchedFileResult {
  const mediaType = input.mediaType.split(";")[0]!.trim().toLowerCase();
  if (!FileRecordSchema.shape.media_type.safeParse(mediaType).success) return { ok: false, status: 400, error: "That download is not a kind of file the hub can keep." };
  const bytes = new Uint8Array(input.bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = db.select().from(attachments).where(eq(attachments.sha256, sha256)).get();
  if (existing) {
    // Same bytes: one blob. A manual save outranks an auto one so the keep rules never delete what a person asked for.
    if (input.note === "podcast:manual" && existing.provenance !== "podcast:manual" && existing.origin === "fetched") {
      db.update(attachments).set({ provenance: "podcast:manual" }).where(eq(attachments.id, existing.id)).run();
    }
    shareToHousehold(existing.ownerPersonId, existing.id);
    return { ok: true, value: toRecord(db.select().from(attachments).where(eq(attachments.id, existing.id)).get()!) };
  }
  const cap = checkStorageCap(owner.role, owner.id, bytes.byteLength);
  if (!cap.ok) return { ok: false, status: 403, error: cap.error! };
  const id = newFileId();
  const storagePath = `people/${owner.id}/attachments/${id}`;
  const filePath = attachmentFilePath(storagePath);
  ensureDataDir(resolve(attachmentsDir, owner.id, "attachments"));
  const row = {
    id, ownerPersonId: owner.id, conversationId: null, turnId: null, mediaType, size: bytes.byteLength, sha256, storagePath, retention: "kept" as const,
    provenance: input.note, origin: "fetched", mediaSourceId: input.mediaSourceId, createdAt: new Date().toISOString(), hlc: nextHlc(),
  };
  const record = toRecord(row);
  writeFileSync(filePath, bytes, { mode: 0o600 });
  try {
    db.insert(attachments).values(row).run();
  } catch (error) {
    try { unlinkSync(filePath); } catch { /* the database error is the one to report */ }
    throw error;
  }
  shareToHousehold(owner.id, id);
  return { ok: true, value: record };
}

/** Removes a fetched copy no media item points at any more (the bytes, the row and its shares). Returns whether anything was removed. */
export function removeFetchedFile(fileId: string): boolean {
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.origin, "fetched"))).get();
  if (!row) return false;
  db.delete(shares).where(eq(shares.fileId, fileId)).run();
  db.delete(attachments).where(eq(attachments.id, fileId)).run();
  try { unlinkSync(attachmentFilePath(row.storagePath)); } catch { /* already gone */ }
  return true;
}
