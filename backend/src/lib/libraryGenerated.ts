// LIBRARY-REVAMP-02: generated items outlive chats. There is no data to rewrite: a generated picture, video, song or edit is
// already a Library item owned by the person who asked (owner_person_id), and deleteAttachmentsForTurns now detaches it from a
// deleted or expired chat instead of removing it. This read-only report is the dry run: what the rule applies to today.
import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { isGeneratedFile } from "@/lib/libraryProvenance";

export interface GeneratedReport {
  generated: { items: number; bytes: number };
  /** Generated items that were not pinned: before this rule a chat deletion or the nightly job removed them. */
  followingStorageRules: { items: number; bytes: number };
  pinned: { items: number; bytes: number };
  /** Of the items following storage rules, those still tied to a chat. */
  tiedToChat: { items: number; bytes: number };
}

export function generatedLibraryReport(): GeneratedReport {
  const report: GeneratedReport = { generated: { items: 0, bytes: 0 }, followingStorageRules: { items: 0, bytes: 0 }, pinned: { items: 0, bytes: 0 }, tiedToChat: { items: 0, bytes: 0 } };
  const add = (bucket: { items: number; bytes: number }, size: number) => { bucket.items += 1; bucket.bytes += size; };
  for (const row of db.select().from(attachments).where(isNull(attachments.deletedAt)).all()) {
    if (row.origin === "fetched" || !isGeneratedFile(row)) continue;
    add(report.generated, row.size);
    if (row.retention === "kept") add(report.pinned, row.size);
    else {
      add(report.followingStorageRules, row.size);
      if (row.turnId !== null) add(report.tiedToChat, row.size);
    }
  }
  return report;
}
