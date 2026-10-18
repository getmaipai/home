// LIBRARY-DEDUP-01: the disk half of single-instance storage. The migration points every record of identical bytes at
// one path and queues the other copies in `file_blob_removals`; this step removes them, but only after the one path is
// confirmed on disk AND its bytes hash to the content row's sha256. If the one path is missing or damaged and a queued
// copy has the right bytes, that copy is moved into place first, so the migration can never leave a record without
// readable bytes. Hashing is streamed (a video can be gigabytes) and runs off the boot path.
import { createReadStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, fileBlobRemovals, fileContents } from "@/db/schema";
import { attachmentFilePath } from "@/lib/attachments";
import { syncAllFileReferences } from "@/lib/fileContent";

export interface ReclaimResult { removed: number; promoted: number; kept: number; dropped: number }

/** Hash a file without reading it into memory; null when it cannot be read. */
export function digestOfFile(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", () => resolve(null));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function reclaimQueuedBlobs(): Promise<ReclaimResult> {
  const result: ReclaimResult = { removed: 0, promoted: 0, kept: 0, dropped: 0 };
  for (const queued of db.select().from(fileBlobRemovals).all()) {
    const drop = () => db.delete(fileBlobRemovals).where(eq(fileBlobRemovals.storagePath, queued.storagePath)).run();
    // A path some record or content row still names is a live blob, never a duplicate.
    const named = db.select({ id: attachments.id }).from(attachments).where(eq(attachments.storagePath, queued.storagePath)).get()
      ?? db.select({ sha256: fileContents.sha256 }).from(fileContents).where(eq(fileContents.storagePath, queued.storagePath)).get();
    if (named) { drop(); result.dropped += 1; continue; }
    let queuedFile: string;
    try { queuedFile = attachmentFilePath(queued.storagePath); } catch { drop(); result.dropped += 1; continue; }
    if (!existsSync(queuedFile)) { drop(); result.dropped += 1; continue; }
    const digest = await digestOfFile(queuedFile);
    const content = digest ? db.select().from(fileContents).where(eq(fileContents.sha256, digest)).get() : undefined;
    if (!content) { result.kept += 1; continue; } // not a known duplicate: leave it for the reconcile report
    const canonical = attachmentFilePath(content.storagePath);
    const canonicalIntact = existsSync(canonical) && (await digestOfFile(canonical)) === content.sha256;
    if (!canonicalIntact) {
      // The one stored file is missing or damaged and this copy has the right bytes: it becomes the stored file.
      mkdirSync(dirname(canonical), { recursive: true });
      renameSync(queuedFile, canonical);
      result.promoted += 1;
      drop();
      continue;
    }
    try { unlinkSync(queuedFile); result.removed += 1; drop(); } catch { result.kept += 1; }
  }
  if (result.removed + result.promoted + result.dropped > 0) syncAllFileReferences();
  return result;
}

/** Boot and daily step: never throws, never blocks the caller. */
export function reclaimQueuedBlobsInBackground(): void {
  void reclaimQueuedBlobs()
    .then((reclaimed) => { if (reclaimed.removed + reclaimed.promoted > 0) console.log(`[storage] folded duplicate files: ${reclaimed.removed} removed, ${reclaimed.promoted} moved into place`); })
    .catch((error: unknown) => console.error(`[storage] could not fold duplicate files yet: ${(error as Error).message}`));
}
