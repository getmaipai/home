// Chunk sessions keep Bun's server-wide body limit unchanged. Only staging bytes live on disk until finish succeeds.
import { createHash, type Hash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileTypeFromFile } from "file-type";
import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { attachmentFilePath, storeFile } from "@/lib/attachments";
import { dataDir, ensureDataDir } from "@/lib/paths";
import { checkStorageCap } from "@/lib/storage/usage";
import { isDocumentMediaType } from "@/lib/documentMediaTypes";
import { cleanFileName } from "@/lib/libraryEdit";
import { cleanChatImageFile } from "@/lib/imageUpload";
import { digestOfFile } from "@/lib/fileBlobs";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import { MAX_LIBRARY_UPLOAD_BYTES, UNSUPPORTED_UPLOAD, type UploadResult } from "@/lib/libraryUpload";

export const LIBRARY_CHUNK_BYTES = 8 * 1024 * 1024;
const AGE = 60 * 60 * 1000;
export class UploadError extends Error {
  constructor(public status: 400 | 403 | 404 | 413 | 409, message: string) { super(message); }
}
interface Prefix { path: string; size: number; read: number; hash: Hash }
interface Session {
  prefixes?: Map<string, Prefix>;
  cancel?: () => Promise<void>;
  owner: string;
  dir: string;
  path: string;
  name: string;
  size: number;
  hash: Hash;
  expires: number;
  busy: boolean;
  timer: ReturnType<typeof setTimeout>;
}
const sessions = new Map<string, Session>();
const starting = new Map<string, number>();
let cap = MAX_LIBRARY_UPLOAD_BYTES;
export function __setLibraryUploadCapForTests(bytes = MAX_LIBRARY_UPLOAD_BYTES) { cap = bytes; }
export function assertLibraryUploadAllowed(actor: PersonRow) {
  const current = db.select().from(people).where(eq(people.id, actor.id)).get();
  if (!current || current.deletedAt || !current.enabled) throw new UploadError(403, "Your profile is no longer available. Sign in again.");
  if (current.role === "child" || current.role === "guest") throw new UploadError(403, "Ask a grown-up to add this file. Adding files to the Library is turned off for your profile.");
}
async function discard(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id); clearTimeout(session.timer);
  await session.cancel?.().catch(() => {});
  await rm(session.dir, { recursive: true, force: true });
}
export async function beginLibraryUpload(actor: PersonRow, name: string, sessionLimit = 3) {
  assertLibraryUploadAllowed(actor);
  // Bound abandoned staging files even before the expiry timer runs.
  if ([...sessions.values()].filter(s => s.owner === actor.id).length + (starting.get(actor.id) ?? 0) >= sessionLimit) throw new UploadError(409, "You already have three uploads running. Finish or cancel one, then try again.");
  starting.set(actor.id, (starting.get(actor.id) ?? 0) + 1);
  let dir: string | undefined;
  try {
    ensureDataDir(dataDir);
    for (const name of await readdir(dataDir)) {
      if (!name.startsWith(".library-upload-")) continue;
      const path = join(dataDir, name);
      if ([...sessions.values()].some(s => s.dir === path)) continue;
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs >= AGE) await rm(path, { recursive: true, force: true });
    }
    dir = await mkdtemp(join(dataDir, ".library-upload-"));
    const id = crypto.randomUUID();
    const path = join(dir, "file");
    await (await open(path, "wx", 0o600)).close();
    // A finish that is still hashing, cleaning or storing at expiry is allowed to complete; the timer retries until it is idle.
    const expire = () => {
      const live = sessions.get(id);
      if (live?.busy) { live.timer = setTimeout(expire, 60_000); live.timer.unref(); return; }
      void discard(id).catch(() => {});
    };
    const timer = setTimeout(expire, AGE); timer.unref();
    sessions.set(id, { owner: actor.id, name: cleanFileName(name.replace(/\\/g, "/").split("/").pop() ?? "").slice(0, 255) || "File", dir, path, size: 0, hash: createHash("sha256"), expires: Date.now() + AGE, busy: false, timer });
    return { upload_id: id, chunk_bytes: LIBRARY_CHUNK_BYTES, max_bytes: cap };
  } catch (error) {
    if (dir) await rm(dir, { recursive: true, force: true });
    throw error;
  } finally {
    const pending = (starting.get(actor.id) ?? 1) - 1;
    if (pending) starting.set(actor.id, pending); else starting.delete(actor.id);
  }
}
function owned(actor: PersonRow, id: string) {
  const s = sessions.get(id);
  if (!s || s.owner !== actor.id || s.expires <= Date.now()) throw new UploadError(404, "That upload is no longer available. Add the file again.");
  if (s.busy) throw new UploadError(409, "That upload is still working. Wait for it to finish, then try again.");
  return s;
}
// A duplicate still fits a full store. Only an exact matching prefix of an existing blob can defer refusal until finish.
function capacity(actor: PersonRow, s: Session, size: number, digest: string) {
  const raw = checkStorageCap(actor.role, actor.id, size);
  if (raw.ok) return;
  if (!s.prefixes) {
    s.prefixes = new Map();
    for (const row of db.select({ sha256: attachments.sha256, size: attachments.size, storagePath: attachments.storagePath }).from(attachments).where(gte(attachments.size, size)).all()) {
      if (row.size >= size && checkStorageCap(actor.role, actor.id, size, row.sha256).ok) s.prefixes.set(row.sha256, {
        path: attachmentFilePath(row.storagePath), size: row.size, read: 0, hash: createHash("sha256"),
      });
    }
  }
  let matches = false;
  for (const [sha256, prefix] of s.prefixes) {
    if (prefix.size < size || !checkStorageCap(actor.role, actor.id, size, sha256).ok || !existsSync(prefix.path)) {
      s.prefixes.delete(sha256); continue;
    }
    let fd: number | undefined;
    try {
      fd = openSync(prefix.path, "r");
      const buffer = Buffer.alloc(64 * 1024);
      while (prefix.read < size) {
        const n = readSync(fd, buffer, 0, Math.min(size - prefix.read, buffer.length), prefix.read);
        if (!n) break;
        prefix.hash.update(buffer.subarray(0, n)); prefix.read += n;
      }
      if (prefix.read === size && prefix.hash.copy().digest("hex") === digest) matches = true;
      else s.prefixes.delete(sha256);
    } catch { s.prefixes.delete(sha256); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  if (!matches) throw new UploadError(403, raw.error!);
}

export async function appendLibraryUpload(actor: PersonRow, id: string, body: ReadableStream<Uint8Array> | null, offset: number, chunkLimit = LIBRARY_CHUNK_BYTES) {
  const s = owned(actor, id);
  if (offset !== s.size) throw new UploadError(409, "That chunk is out of order. Send the next chunk at the returned offset.");
  s.busy = true;
  const reader = body?.getReader();
  s.cancel = async () => { await reader?.cancel(); };
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let count = 0;
  try {
    assertLibraryUploadAllowed(actor);
    handle = await open(s.path, "a");
    if (!reader) throw new UploadError(400, "That chunk is empty. Send the file bytes again.");
    for (;;) {
      const { done, value } = await reader.read();
      if (s.expires <= Date.now() || sessions.get(id) !== s) throw new UploadError(404, "That upload is no longer available. Add the file again.");
      if (done) break;
      count += value.byteLength;
      if (s.size + value.byteLength > cap) throw new UploadError(413, "That file is bigger than 500 MB. Choose a smaller file.");
      if (count > chunkLimit) throw new UploadError(413, "That chunk is bigger than 8 MB. Add the file again using smaller chunks.");
      s.hash.update(value);
      capacity(actor, s, s.size + value.byteLength, s.hash.copy().digest("hex"));
      await handle.writeFile(value);
      s.size += value.byteLength;
    }
    if (!count) throw new UploadError(400, "That chunk is empty. Add the file again.");
    return { offset: s.size };
  } catch (error) {
    s.cancel = undefined;
    await reader?.cancel().catch(() => {});
    await handle?.close().catch(() => {}); handle = undefined;
    await discard(id);
    if (error instanceof UploadError) throw error;
    throw new UploadError(400, "The upload stopped before it finished. Add the file again.");
  } finally { await handle?.close(); reader?.releaseLock(); s.cancel = undefined; s.busy = false; }
}
async function classify(s: Session) {
  const found = await fileTypeFromFile(s.path);
  if (found) {
    if (["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"].includes(found.mime)) return { type: found.mime, picture: true };
    if (found.mime.startsWith("audio/") || found.mime.startsWith("video/") || isDocumentMediaType(found.mime)) return { type: found.mime, picture: false };
    throw new UploadError(400, UNSUPPORTED_UPLOAD);
  }
  const ext = s.name.split(".").pop()!.toLowerCase();
  if (!["txt", "md", "csv"].includes(ext)) throw new UploadError(400, UNSUPPORTED_UPLOAD);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const bytes of Bun.file(s.path).stream()) { if (bytes.includes(0)) throw new Error(); decoder.decode(bytes, { stream: true }); }
    decoder.decode();
  } catch { throw new UploadError(400, UNSUPPORTED_UPLOAD); }
  return { type: ext === "csv" ? "text/csv" : "text/plain", picture: false };
}
export async function finishLibraryUpload(actor: PersonRow, id: string): Promise<UploadResult> {
  const s = owned(actor, id); s.busy = true;
  try {
    const current = db.select().from(people).where(eq(people.id, actor.id)).get();
    if (!current || current.deletedAt || !current.enabled) throw new UploadError(403, "Your profile is no longer available. Sign in again.");
    assertLibraryUploadAllowed(current);
    if (!s.size) throw new UploadError(400, "That file is empty. Choose a file with something in it.");
    const found = await classify(s);
    let path = s.path, size = s.size, sha256 = s.hash.copy().digest("hex"), mediaType = found.type;
    if (found.picture) {
      const cleaned = join(s.dir, "clean.jpg");
      await cleanChatImageFile(path, mediaType, cleaned);
      path = cleaned; size = Bun.file(path).size; sha256 = (await digestOfFile(path))!; mediaType = "image/jpeg";
    }
    const duplicate = !!db.select().from(attachments).where(and(eq(attachments.sha256, sha256), eq(attachments.origin, "sent"), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
    const writer = db.select().from(people).where(eq(people.id, actor.id)).get();
    if (!writer) throw new UploadError(403, "Your profile is no longer available. Sign in again.");
    assertLibraryUploadAllowed(writer);
    const stored = storeFile(writer, { conversationId: null, turnId: null, mediaType, staged: { path, size, sha256 }, provenance: "library:upload", retention: "kept", name: s.name });
    if (!stored.ok) return { ok: false, status: stored.status === 403 ? 403 : 400, error: stored.error };
    const row = db.select().from(attachments).where(eq(attachments.id, stored.value.id)).get()!;
    if (row.retention !== "kept" || !row.name) db.update(attachments).set({ retention: "kept", name: row.name ?? s.name, hlc: nextHlc() }).where(eq(attachments.id, row.id)).run();
    return { ok: true, value: { id: row.id, name: row.name ?? s.name, kind: stored.value.kind, media_type: row.mediaType, size_bytes: row.size, duplicate } };
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(400, "That file could not be read. Save it in a supported format and add it again.");
  } finally { await discard(id); }
}
export async function cancelLibraryUpload(actor: PersonRow, id: string) { owned(actor, id); await discard(id); }
