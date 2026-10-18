// LIBRARY-REVAMP-12 (docs/design/library-2026-10-18.md sections 3.9 and 3.16): rename and Keep for a Library item. Only the
// owner changes a file. Rename stores the owner's name (ahead of the spec's `file.name`, LIBRARY-REVAMP-03); Keep pins the
// item (retention "kept"), which the nightly job and the storage rules never remove. Un-keeping is only for generated items,
// which then follow the Library's storage rules again; anything a person added stays until they delete it.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { canAccessFile } from "@/lib/access";
import { nextHlc } from "@/lib/hlc";
import { isGeneratedFile } from "@/lib/libraryProvenance";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import type { PersonRow } from "@/types";

export type EditResult = { ok: true; value: { id: string; name: string | null; retention: string } } | { ok: false; status: 400 | 403 | 404; error: string };

const MAX_NAME = 255;

export function cleanFileName(raw: string): string {
  return redactCredentials(raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ")).trim();
}

export function updateLibraryFile(actor: PersonRow, id: string, patch: { name?: string | null; keep?: boolean }): EditResult {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row || !canAccessFile(actor, row.ownerPersonId, id)) return { ok: false, status: 404, error: "That file is not in your Library. Refresh the page and try again." };
  if (row.ownerPersonId !== actor.id) return { ok: false, status: 403, error: "Only the person who added this file can change it." };
  if (row.origin === "fetched") return { ok: false, status: 403, error: "Saved media belongs to its app. Change it there." };
  const set: Partial<typeof attachments.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (patch.name === null || patch.name.trim() === "") set.name = null;
    else {
      const name = cleanFileName(patch.name);
      if (name === "") return { ok: false, status: 400, error: "Type a name for this file." };
      if (name.length > MAX_NAME) return { ok: false, status: 400, error: `Use a name of ${MAX_NAME} characters or fewer.` };
      set.name = name;
    }
  }
  if (patch.keep !== undefined) {
    if (patch.keep) set.retention = "kept";
    else if (!isGeneratedFile(row)) return { ok: false, status: 400, error: "Files you added stay until you delete them." };
    else set.retention = "conversation";
  }
  if (Object.keys(set).length === 0) return { ok: false, status: 400, error: "Send a new name or a keep setting." };
  db.update(attachments).set({ ...set, hlc: nextHlc() }).where(eq(attachments.id, id)).run();
  const updated = db.select().from(attachments).where(eq(attachments.id, id)).get()!;
  return { ok: true, value: { id, name: updated.name, retention: updated.retention } };
}
