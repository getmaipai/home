// LIBRARY-REVAMP-12 (docs/design/library-2026-10-18.md sections 3.9 and 3.16): rename and Keep for a Library item. Only the
// owner changes a file. Rename stores the owner's name (ahead of the spec's `file.name`, LIBRARY-REVAMP-03); Keep pins the
// item (retention "kept"), which the nightly job and the storage rules never remove. Un-keeping is only for generated items,
// which then follow the Library's storage rules again; anything a person added stays until they delete it.
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { canAccessFile } from "@/lib/access";
import { nextHlc } from "@/lib/hlc";
import { isGeneratedFile } from "@/lib/libraryProvenance";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import type { PersonRow } from "@/types";
import { refusal, type Result } from "@/lib/result";

export type EditResult = Result<{ id: string; name: string | null; retention: string }, 400 | 403 | 404>;

const MAX_NAME = 255;

export function cleanFileName(raw: string): string {
  return redactCredentials(raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ")).trim();
}

export function updateLibraryFile(actor: PersonRow, id: string, patch: { name?: string | null; keep?: boolean }): EditResult {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row || !canAccessFile(actor, row.ownerPersonId, id) || lockState(lockItemOfProvenance(row.ownerPersonId, row.provenance), actor) !== "open") return refusal(404, "file_not_in_library");
  if (row.ownerPersonId !== actor.id) return refusal(403, "file_change_owner_only");
  if (row.origin === "fetched") return refusal(403, "file_edit_in_app");
  const set: Partial<typeof attachments.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (patch.name === null || patch.name.trim() === "") set.name = null;
    else {
      const name = cleanFileName(patch.name);
      if (name === "") return refusal(400, "file_name_required");
      if (name.length > MAX_NAME) return refusal(400, "file_name_too_long");
      set.name = name;
    }
  }
  if (patch.keep !== undefined) {
    if (patch.keep) set.retention = "kept";
    else if (!isGeneratedFile(row)) return refusal(400, "file_stays_until_deleted");
    else set.retention = "conversation";
  }
  if (Object.keys(set).length === 0) return refusal(400, "file_edit_nothing");
  db.update(attachments).set({ ...set, hlc: nextHlc() }).where(eq(attachments.id, id)).run();
  const updated = db.select().from(attachments).where(eq(attachments.id, id)).get()!;
  return { ok: true, value: { id, name: updated.name, retention: updated.retention } };
}
