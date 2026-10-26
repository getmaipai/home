// MEDIA-DETAIL-04c: a cover picture uploaded from the Edit sheet. Same gate as editMediaItem (owner, admin or adult, and an item the
// person can read); the size limit, the picture cleaning and the file save are the chat upload's own (imageUpload, attachments.storeFile).
// The picture lands in the person's Library as a kept file; picking it as the cover is a separate `edit` call with its file id.
import { isOwnerOrAdmin } from "@/lib/access";
import { storeFile } from "@/lib/attachments";
import { cleanChatImage } from "@/lib/imageUpload";
import type { PersonRow } from "@/types";
import { MAX_CHAT_IMAGE_BYTES, CHAT_IMAGE_REFUSAL } from "@/wire";
import { readableIn, type MediaAppId } from "./appHost";
import { mediaBandOf } from "./band";

type Result = { ok: true; value: { file_id: string; url: string; alt: string } } | { ok: false; status: 400 | 403 | 404; error: string };

export async function saveMediaCover(person: PersonRow, appId: MediaAppId, id: string, file: File | null): Promise<Result> {
  if (!isOwnerOrAdmin(person) && mediaBandOf(person) !== "adult") return { ok: false, status: 403, error: "You can't edit this." };
  if (!id || !readableIn(person, appId, id)) return { ok: false, status: 404, error: "That item is not in the library." };
  if (!file) return { ok: false, status: 400, error: "Choose a picture to upload." };
  if (file.size > MAX_CHAT_IMAGE_BYTES) return { ok: false, status: 400, error: CHAT_IMAGE_REFUSAL };
  try {
    const cleaned = await cleanChatImage(new Uint8Array(await file.arrayBuffer()));
    const name = file.name.replace(/[\r\n\0]/g, "").slice(0, 255).trim() || "cover.jpg";
    const stored = storeFile(person, { conversationId: null, turnId: null, mediaType: cleaned.mediaType, bytes: cleaned.bytes, provenance: "media:cover", retention: "kept", name });
    if (!stored.ok) return { ok: false, status: stored.status === 403 ? 403 : 400, error: stored.error };
    return { ok: true, value: { file_id: stored.value.id, url: `/api/files/${stored.value.id}/thumb?w=320`, alt: name } };
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : "That file is not a supported picture." };
  }
}
