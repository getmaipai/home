// CREATOR-06 (CREATOR-PORT-2026-11-13, section 6.3): what a stored look sheet was built from, as one short key. The sheet's provenance carries the key it was built
// with; a cast member whose current key differs has changed pictures (a new rest picture, an approved sheet view, an added or deleted reference) and its sheet is stale.
// Database and manifest reads only (no picture bytes), so the cast list can ask for every member cheaply. Kept apart from castLook.ts so lib/cast.ts can import it.
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaSubjects } from "@/db/schema";
import { readLook } from "@/lib/companionLook";

export const LOOK_KEY_VERSION = "k1";
/** The sheet file's provenance prefix and note: a kept sheet of a cast member (role "sheet" is how every reader finds it). */
export const SHEET_PROVENANCE_PREFIX = "media-subject-reference:";

export interface LookSheetNote { role: "sheet"; audience: "adult-only" | "all-ages"; key?: string; maker?: string; description?: string; locked?: string | null }
export function sheetNote(provenance: string): LookSheetNote | null {
  if (!provenance.startsWith(SHEET_PROVENANCE_PREFIX)) return null;
  try { const note = JSON.parse(provenance.slice(SHEET_PROVENANCE_PREFIX.length)) as LookSheetNote; return note.role === "sheet" ? note : null; } catch { return null; }
}
/** The source pictures a subject's look is built from: its kept reference files that are not a sheet (id and sha). */
export function plainReferences(referenceIds: string[]): Array<{ id: string; sha256: string; provenance: string; name: string | null }> {
  const rows: Array<{ id: string; sha256: string; provenance: string; name: string | null }> = [];
  for (const id of referenceIds) {
    const row = db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).get();
    if (row && !sheetNote(row.provenance)) rows.push({ id, sha256: row.sha256, provenance: row.provenance, name: row.name });
  }
  return rows;
}
/** The approved views of a synth's look (a synth's pictures: its rest picture and, once approved, the left and right views). */
export function synthLookParts(synthId: string): { rest: string | null; views: string[] } {
  const look = readLook(synthId);
  const views = look.sheet?.state === "approved" ? [look.sheet.views.left, look.sheet.views.right].filter((v): v is string => !!v) : [];
  return { rest: look.rest, views };
}
export function lookSourceKey(subjectId: string): string | null {
  const row = db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subjectId)).get();
  if (!row) return null;
  const parts = plainReferences(JSON.parse(row.referenceIds) as string[]).map((r) => `${r.id}:${r.sha256}`).sort();
  if (row.synthId) { const look = synthLookParts(row.synthId); parts.push(`rest:${look.rest ?? ""}`, ...look.views.map((v) => `view:${v}`)); }
  return createHash("sha256").update(`${LOOK_KEY_VERSION}\n${row.kind}\n${row.look}\n${parts.join("\n")}`).digest("hex").slice(0, 32);
}
/** The newest stored sheet of a subject and whether its source key still matches. `stale` is false when there is no sheet (nothing to rebuild) or the sheet predates the key. */
export function lookSheetState(subjectId: string): { sheet_file_id: string | null; stale: boolean } {
  const row = db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subjectId)).get();
  if (!row) return { sheet_file_id: null, stale: false };
  const ids = JSON.parse(row.referenceIds) as string[];
  for (const id of [...ids].reverse()) {
    const file = db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).get();
    const note = file ? sheetNote(file.provenance) : null;
    if (note) return { sheet_file_id: id, stale: !!note.key && note.key !== lookSourceKey(subjectId) };
  }
  return { sheet_file_id: null, stale: false };
}
