// MEDIA-LIB-01: the bytes of a media item and its artwork. A file on a library root is served straight from the disk with HTTP Range
// support and the item's own media type (no transcoding here: MEDIA-PLAYER-01 and the Stack's media.transcode own that); a saved copy
// comes from the household file store. Every path is resolved inside its root, symbolic links included, so a name in the database can
// never reach a file outside the folder an admin chose.
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaSources } from "@/db/schema";
import { attachmentFilePath, getAttachment, readAttachment } from "@/lib/attachments";
import type { PersonRow } from "@/types";
import type { MediaItem } from "./model";
import { readableItem } from "./access";
import { IMAGE_TYPES } from "./kinds";
import { readEmbeddedCover } from "./parsers/audioTags";
import { readEpubCover } from "./parsers/epub";
import { extensionOf } from "./parsers/text";

const BASE_HEADERS = { "accept-ranges": "bytes", "x-content-type-options": "nosniff", "cache-control": "private, no-store" } as const;

export interface ByteRange {
  start: number;
  end: number;
}

/** One `Range: bytes=` header against a file of `total` bytes: a range, `null` for the whole file, or `"unsatisfiable"`. */
export function parseRange(header: string | undefined | null, total: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (total === 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(total - suffix, 0);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= total) return "unsatisfiable";
  return { start, end };
}

/** The absolute path of a file under a root, or null when the name escapes the root or the root is gone. */
export function resolveUnderRoot(sourceId: string, rel: string): string | null {
  const row = db.select({ rootPath: mediaSources.rootPath, deletedAt: mediaSources.deletedAt }).from(mediaSources).where(eq(mediaSources.id, sourceId)).get();
  if (!row?.rootPath || row.deletedAt) return null;
  try {
    const root = realpathSync(row.rootPath);
    const candidate = resolve(root, rel);
    if (candidate !== root && !candidate.startsWith(root + sep)) return null;
    const real = realpathSync(candidate);
    return real === root || real.startsWith(root + sep) ? real : null;
  } catch {
    return null;
  }
}

function bytesResponse(source: { size: number; slice(start?: number, end?: number): Blob }, mediaType: string, range: ByteRange | null | "unsatisfiable", extra: Record<string, string> = {}): Response {
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...BASE_HEADERS, "content-range": `bytes */${source.size}` } });
  if (range === null) return new Response(source.slice(0, source.size), { status: 200, headers: { ...BASE_HEADERS, ...extra, "content-type": mediaType, "content-length": String(source.size) } });
  return new Response(source.slice(range.start, range.end + 1), {
    status: 206,
    headers: { ...BASE_HEADERS, ...extra, "content-type": mediaType, "content-range": `bytes ${range.start}-${range.end}/${source.size}`, "content-length": String(range.end - range.start + 1) },
  });
}

/** Internal only: the caller has reloaded the item's own gate and uses its stored file reference. */
function fetchedBlob(id: string) {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (row?.origin !== "fetched") return null;
  const path = attachmentFilePath(row.storagePath);
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size !== row.size) return null;
    return { path, file: Bun.file(path), mediaType: row.mediaType, sha256: row.sha256, version: `${row.sha256}:${info.size}:${info.mtimeMs}` };
  } catch { return null; }
}

// The file store's integrity boundary, with bounded memory: a copy is hashed once per on-disk version (size and mtime), so a Range seek
// on a 400 MB episode does not re-read the whole file. A changed file has a new mtime and is hashed again.
const verifiedVersions = new Map<string, string>();
async function verifiedFetchedBlob(id: string) {
  const fetched = fetchedBlob(id);
  if (!fetched) return null;
  if (verifiedVersions.get(id) === fetched.version) return fetched;
  try {
    const hash = createHash("sha256");
    for await (const chunk of fetched.file.stream()) hash.update(chunk);
    if (hash.digest("hex") !== fetched.sha256) { verifiedVersions.delete(id); return null; }
    if (verifiedVersions.size > 2000) verifiedVersions.clear();
    verifiedVersions.set(id, fetched.version);
    return fetched;
  } catch { return null; }
}

export type ServeResult = Response | { error: string; status: 404 | 422 };

export async function serveItemBytes(actor: PersonRow, item: MediaItem, rangeHeader: string | undefined): Promise<ServeResult> {
  const gated = readableItem(actor, item.id);
  if (!gated) return { error: "This item is not available. Open your library and choose an available item.", status: 404 };
  item = gated;
  const location = item.location as { file_id?: string; root_id?: string; path?: string; url?: string };
  if (location.file_id) {
    const fetched = await verifiedFetchedBlob(location.file_id);
    if (fetched) return bytesResponse(fetched.file, item.media_type, parseRange(rangeHeader, fetched.file.size));
    const read = readAttachment(actor, location.file_id);
    if (!read.ok) return { error: "That file is not available to you.", status: 404 };
    const blob = new Blob([read.value.bytes as never]);
    return bytesResponse(blob as never, item.media_type, parseRange(rangeHeader, blob.size));
  }
  if (location.root_id && location.path !== undefined) {
    const abs = resolveUnderRoot(item.source_id, location.path);
    if (!abs) return { error: "This file is not available right now. If it lives on a network share, check that the share is mounted.", status: 404 };
    let info;
    try { info = statSync(abs); } catch { return { error: "This file is not available right now.", status: 404 }; }
    if (info.isDirectory()) return { error: "This audiobook is a folder of parts. Play its parts one by one.", status: 422 };
    const file = Bun.file(abs);
    return bytesResponse(file, item.media_type, parseRange(rangeHeader, file.size));
  }
  return { error: "This item is not saved on this computer yet.", status: 404 };
}

export async function serveItemArtwork(actor: PersonRow, item: MediaItem): Promise<ServeResult> {
  const gated = readableItem(actor, item.id);
  if (!gated) return { error: "This picture is not available. Open your library and choose an available item.", status: 404 };
  item = gated;
  const art = item.artwork as { file_id?: string; path?: string } | null;
  if (!art) return { error: "No picture for this item.", status: 404 };
  if (art.file_id) {
    const fetched = await verifiedFetchedBlob(art.file_id);
    if (fetched) return new Response(fetched.file, { headers: { ...BASE_HEADERS, "content-type": fetched.mediaType } });
    const read = readAttachment(actor, art.file_id);
    if (!read.ok) return { error: "That picture is not available to you.", status: 404 };
    return new Response(read.value.bytes as never, { status: 200, headers: { ...BASE_HEADERS, "cache-control": "private, max-age=300", "content-type": read.value.record.media_type } });
  }
  if (art.path) {
    const abs = resolveUnderRoot(item.source_id, art.path);
    if (!abs) return { error: "No picture for this item.", status: 404 };
    const ext = extensionOf(abs);
    const headers = { ...BASE_HEADERS, "cache-control": "private, max-age=300" };
    if (ext in IMAGE_TYPES) return new Response(Bun.file(abs), { status: 200, headers: { ...headers, "content-type": IMAGE_TYPES[ext]! } });
    const embedded = ext === "epub" ? await readEpubCover(abs) : await readEmbeddedCover(abs);
    if (embedded) return new Response(embedded.data as never, { status: 200, headers: { ...headers, "content-type": embedded.mediaType } });
  }
  return { error: "No picture for this item.", status: 404 };
}

/** Availability and HTTP date from the same guarded locations as serveItemBytes, without loading the stream. */
export function itemByteMetadata(actor: PersonRow, item: MediaItem): { modified: Date; size: number } | null {
  const gated = readableItem(actor, item.id);
  if (!gated) return null;
  item = gated;
  const location = item.location as { file_id?: string; root_id?: string; path?: string };
  let path: string | null = null;
  if (location.file_id) {
    const found = getAttachment(actor, location.file_id);
    if (found.ok) path = attachmentFilePath(found.value.storage_path);
    else path = fetchedBlob(location.file_id)?.path ?? null;
  } else if (location.root_id && location.path !== undefined) path = resolveUnderRoot(item.source_id, location.path);
  if (!path) return null;
  try {
    const info = statSync(path);
    return info.isFile() ? { modified: info.mtime, size: info.size } : null;
  } catch { return null; }
}
