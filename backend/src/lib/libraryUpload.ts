// LIBRARY-REVAMP-11 (docs/design/library-2026-10-18.md section 3.11): add a file to the Library without a chat. The file is
// stored as a "sent" item kept until the person deletes it, with its own name. The type is read from the bytes, never from
// what the browser claims. Pictures get the same cleaning a chat picture gets (HEIC to JPEG, orientation applied, every EXIF
// tag dropped, longest edge 2000 px). The storage cap is checked before any byte is written, on the bytes that would really be
// stored (a copy the person already holds, or that the home already stores, costs nothing). A child asks a grown-up (the
// kid-mode Ask is not built yet, so a child's upload is refused with that next step; nothing uploads silently).
import { fileTypeFromBuffer } from "file-type";
import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { checkAttachmentCapacity, storeFile, toRecord } from "@/lib/attachments";
import { isDocumentMediaType } from "@/lib/documentMediaTypes";
import { nextHlc } from "@/lib/hlc";
import { cleanChatImage } from "@/lib/imageUpload";
import { cleanFileName } from "@/lib/libraryEdit";
import type { PersonRow } from "@/types";

export const MAX_LIBRARY_UPLOAD_BYTES = 500 * 1024 * 1024;
export const UNSUPPORTED_UPLOAD = "That file type is not supported. Use a picture, video, song or document.";
const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const TEXT_EXTENSIONS: Record<string, string> = { txt: "text/plain", md: "text/plain", csv: "text/csv" };

export type UploadResult =
  | { ok: true; value: { id: string; name: string; kind: string; media_type: string; size_bytes: number; duplicate: boolean } }
  | { ok: false; status: 400 | 403 | 413; error: string };

function textType(name: string, bytes: Uint8Array): string | null {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const type = TEXT_EXTENSIONS[extension];
  if (!type || bytes.includes(0)) return null;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
  return type;
}

/** Decide the stored type from the bytes. Returns null for anything the Library does not take. */
async function detect(name: string, bytes: Uint8Array): Promise<{ mediaType: string; picture: boolean } | null> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected) {
    if (RASTER.has(detected.mime)) return { mediaType: detected.mime, picture: true };
    if (detected.mime.startsWith("video/") || detected.mime.startsWith("audio/") || isDocumentMediaType(detected.mime)) return { mediaType: detected.mime, picture: false };
    return null;
  }
  const text = textType(name, bytes);
  return text ? { mediaType: text, picture: false } : null;
}

export async function uploadToLibrary(actor: PersonRow, upload: { name: string; bytes: Uint8Array }): Promise<UploadResult> {
  if (actor.role === "child" || actor.role === "guest") return { ok: false, status: 403, error: "Ask a grown-up to add this file. Adding files to the Library is turned off for your profile." };
  const size = upload.bytes.byteLength;
  if (size === 0) return { ok: false, status: 400, error: "That file is empty. Choose a file with something in it." };
  if (size > MAX_LIBRARY_UPLOAD_BYTES) return { ok: false, status: 413, error: "That file is bigger than 500 MB. Choose a smaller file." };
  const found = await detect(upload.name, upload.bytes);
  if (!found) return { ok: false, status: 400, error: UNSUPPORTED_UPLOAD };
  let bytes = upload.bytes;
  let mediaType = found.mediaType;
  if (found.picture) {
    try {
      const cleaned = await cleanChatImage(upload.bytes);
      bytes = cleaned.bytes;
      mediaType = cleaned.mediaType;
    } catch (error) {
      return { ok: false, status: 400, error: error instanceof Error ? error.message : "That picture could not be read." };
    }
  }
  const name = cleanFileName(upload.name).slice(0, 255) || "File";
  const capacity = checkAttachmentCapacity(actor, mediaType, bytes);
  if (!capacity.ok) return { ok: false, status: capacity.status === 400 ? 400 : 403, error: capacity.error };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const duplicate = db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.sha256, sha256), eq(attachments.origin, "sent"), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get() !== undefined;
  const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType, bytes, provenance: "library:upload", retention: "kept", name });
  if (!stored.ok) return { ok: false, status: stored.status === 403 ? 403 : 400, error: stored.error };
  const row = db.select().from(attachments).where(eq(attachments.id, stored.value.id)).get()!;
  // The same bytes sent again return the person's earlier item; make sure it is kept and has a name.
  if (row.retention !== "kept" || !row.name) db.update(attachments).set({ retention: "kept", name: row.name ?? name, hlc: nextHlc() }).where(eq(attachments.id, row.id)).run();
  const record = toRecord(db.select().from(attachments).where(eq(attachments.id, row.id)).get()!);
  return { ok: true, value: { id: record.id, name: row.name ?? name, kind: record.kind, media_type: record.media_type, size_bytes: record.size, duplicate } };
}
