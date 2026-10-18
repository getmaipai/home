import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync, renameSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, musicJobs } from "@/db/schema";
import { canAccessFile } from "@/lib/access";
import { attachmentFilePath } from "@/lib/attachments";
import { classDir } from "@/lib/paths";
import { libraryProvenance, libraryProvenanceSql } from "@/lib/libraryProvenance";
import { MAX_CHAT_IMAGE_BYTES } from "@/wire";
import type { PersonRow } from "@/types";

export const thumbnailsDir = classDir("previews");
export function previewStats() {
  let bytes = 0; let removed = 0;
  if (existsSync(thumbnailsDir)) for (const name of readdirSync(thumbnailsDir)) {
    const stat = statSync(join(thumbnailsDir,name));
    if (stat.isFile()) { bytes += stat.size; removed++; }
  }
  return { removed, bytes };
}
let generation = 0;
export function clearPreviews() {
  generation++;
  const stats = previewStats();
  if (existsSync(thumbnailsDir)) for (const name of readdirSync(thumbnailsDir)) unlinkSync(join(thumbnailsDir,name));
  return stats;
}
type Row = typeof attachments.$inferSelect;
function allowed(actor: PersonRow, row: Row | undefined): row is Row { return !!row && canAccessFile(actor,row.ownerPersonId,row.id); }
function sourceFor(actor: PersonRow, row: Row): Row | undefined {
  if (row.mediaType.startsWith("image/")) return row;
  const meta = libraryProvenance(row.provenance);
  if (row.mediaType.startsWith("video/") && meta.writer === "video-gen" && typeof meta.job === "string") {
    const noteSql = sql.raw(libraryProvenanceSql("attachments.provenance"));
    return db.select().from(attachments).where(and(eq(attachments.ownerPersonId,row.ownerPersonId),
      sql`json_extract(${noteSql}, '$.writer') = 'video-poster'`,
      sql`json_extract(${noteSql}, '$.job') = ${meta.job}`)).all().find(candidate => {
      const note = libraryProvenance(candidate.provenance);
      return note.writer === "video-poster" && note.job === meta.job && allowed(actor,candidate);
    });
  }
  if (row.mediaType.startsWith("audio/")) {
    const job = db.select().from(musicJobs).where(and(eq(musicJobs.fileId,row.id),eq(musicJobs.personId,row.ownerPersonId))).get();
    if (job?.coverFileId) return db.select().from(attachments).where(eq(attachments.id,job.coverFileId)).get();
  }
}
// Serialize decoding to bound peak native memory, and coalesce requests for the same cache key.
let tail: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<Buffer>>();
function generate(row: Row, path: string, width: number, mayRead: () => boolean): Promise<Buffer> {
  const running = pending.get(path); if (running) return running;
  const epoch = generation;
  const task = tail.catch(() => {}).then(async () => {
    if (!mayRead()) throw new Error("no preview");
    try { return readFileSync(path); } catch { /* Rebuildable cache miss. */ }
    const original = attachmentFilePath(row.storagePath);
    if (statSync(original).size > MAX_CHAT_IMAGE_BYTES) throw new Error("no preview");
    const input = readFileSync(original);
    if (input.length > MAX_CHAT_IMAGE_BYTES || input.length !== row.size || createHash("sha256").update(input).digest("hex") !== row.sha256) throw new Error("no preview");
    const bytes = await sharp(input, { failOn: "error", limitInputPixels: 64_000_000 }).rotate()
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    if (!mayRead() || epoch !== generation) throw new Error("no preview");
    mkdirSync(thumbnailsDir,{ recursive: true });
    const temp = `${path}.tmp`;
    writeFileSync(temp,bytes); renameSync(temp,path);
    return bytes;
  }).finally(() => { pending.delete(path); });
  tail = task; pending.set(path,task); return task;
}
export async function fileThumbnail(actor: PersonRow, id: string, width: 320 | 640, ifNoneMatch?: string): Promise<Response> {
  const row = db.select().from(attachments).where(eq(attachments.id,id)).get();
  if (!allowed(actor,row)) return new Response("attachment not found",{ status:404 });
  const source = sourceFor(actor,row);
  if (!allowed(actor,source) || !source.mediaType.startsWith("image/") || source.size > MAX_CHAT_IMAGE_BYTES || !/^[a-f0-9]{64}$/.test(source.sha256)) return new Response("no preview",{ status:404 });
  const etag = `"${source.sha256}-${width}"`;
  const headers = { "content-type":"image/webp", "cache-control":"private, no-cache", etag };
  try {
    const bytes = await generate(source,join(thumbnailsDir,`${source.sha256}-${width}.webp`),width,() => allowed(actor,row) && allowed(actor,source));
    // Shares may have changed while a queued native decode was running.
    if (!allowed(actor,row) || !allowed(actor,source)) return new Response("attachment not found",{ status:404 });
    if (ifNoneMatch?.split(",").some(value => value.trim().replace(/^W\//,"") === etag || value.trim() === "*")) return new Response(null,{ status:304,headers });
    return new Response(bytes,{ headers });
  } catch {
    if (!allowed(actor,row)) return new Response("attachment not found",{ status:404 });
    return new Response("no preview",{ status:404 });
  }
}
