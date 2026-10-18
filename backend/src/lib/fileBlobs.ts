// LIBRARY-DEDUP-01: the disk half of single-instance storage. The migration points every record of identical bytes at
// one path and queues the other copies in `file_blob_removals`; this step removes them, but only after the one path is
// confirmed on disk. If the one path is missing and a queued copy has the bytes, that copy is moved into place first, so
// the migration can never leave a record without readable bytes.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, fileBlobRemovals, fileContents } from "@/db/schema";
import { attachmentFilePath } from "@/lib/attachments";

export interface ReclaimResult { removed: number; promoted: number; kept: number; dropped: number }

function digestOf(path: string): string | null {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); } catch { return null; }
}

export function reclaimQueuedBlobs(): ReclaimResult {
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
    const digest = digestOf(queuedFile);
    const content = digest ? db.select().from(fileContents).where(eq(fileContents.sha256, digest)).get() : undefined;
    if (!content) { result.kept += 1; continue; } // not a known duplicate: leave it for the reconcile report
    const canonical = attachmentFilePath(content.storagePath);
    if (!existsSync(canonical)) {
      mkdirSync(dirname(canonical), { recursive: true });
      renameSync(queuedFile, canonical);
      result.promoted += 1;
      drop();
      continue;
    }
    try { unlinkSync(queuedFile); result.removed += 1; drop(); } catch { result.kept += 1; }
  }
  return result;
}
