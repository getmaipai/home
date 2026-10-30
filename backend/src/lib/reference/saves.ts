import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { referenceSaves } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newReferenceSaveId } from "@/lib/id";
import { ReferenceSave } from "@maipai/spec/gen/ts/reference-save.js";

const PROVENANCE = "reader:save";

function saveOf(row: typeof referenceSaves.$inferSelect): ReferenceSave {
  return ReferenceSave.parse({ id: row.id, person_id: row.personId, book: row.book, path: row.path, title: row.title, saved_at: row.savedAt, offline: row.offline, hlc: row.hlc, provenance: row.provenance });
}

export function listReferenceSaves(personId: string): ReferenceSave[] {
  return db.select().from(referenceSaves).where(eq(referenceSaves.personId, personId)).orderBy(desc(referenceSaves.savedAt), desc(referenceSaves.id)).all().map(saveOf);
}

export function getReferenceSave(personId: string, book: string, path: string): ReferenceSave | null {
  const row = db.select().from(referenceSaves).where(and(eq(referenceSaves.personId, personId), eq(referenceSaves.book, book), eq(referenceSaves.path, path))).get();
  return row ? saveOf(row) : null;
}

export function addReferenceSave(personId: string, input: { book: string; path: string; title: string }, nowIso = new Date().toISOString()): ReferenceSave {
  const existing = getReferenceSave(personId, input.book, input.path);
  if (existing) return existing;
  const record = ReferenceSave.parse({ id: newReferenceSaveId(), person_id: personId, book: input.book, path: input.path, title: input.title, saved_at: nowIso, offline: false, hlc: nextHlc(), provenance: PROVENANCE });
  db.insert(referenceSaves).values({ id: record.id, personId, book: record.book, path: record.path, title: record.title, savedAt: record.saved_at, offline: false, hlc: record.hlc, provenance: record.provenance }).run();
  return record;
}

export function removeReferenceSave(personId: string, id: string): boolean {
  return db.delete(referenceSaves).where(and(eq(referenceSaves.personId, personId), eq(referenceSaves.id, id))).returning({ id: referenceSaves.id }).all().length > 0;
}
