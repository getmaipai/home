import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaSubjects, people } from "@/db/schema";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { attachmentFilePath } from "@/lib/attachments";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canReadFileAudience } from "@/lib/access";
import type { PersonRow } from "@/types";

export type SubjectKind = "character" | "prop" | "place";
export interface SubjectInput { name: string; kind: SubjectKind; look: string; referenceIds?: string[]; real?: boolean }
export interface MediaSubject { id: string; name: string; kind: SubjectKind; owner_person_id: string; shared_with: string[]; look: string; reference_ids: string[]; real: boolean; created_at: string; updated_at: string; hlc: string; provenance: string }
function view(row: typeof mediaSubjects.$inferSelect): MediaSubject { return { id: row.id, name: row.name, kind: row.kind as SubjectKind, owner_person_id: row.ownerPersonId, shared_with: JSON.parse(row.sharedWith), look: row.look, reference_ids: JSON.parse(row.referenceIds), real: row.real, created_at: row.createdAt, updated_at: row.updatedAt, hlc: row.hlc, provenance: row.provenance }; }
function rowById(id: string) { return db.select().from(mediaSubjects).where(eq(mediaSubjects.id, id)).get(); }
export function canUseSubject(actor: PersonRow, row: typeof mediaSubjects.$inferSelect): boolean { return actor.role !== "guest" && (row.ownerPersonId === actor.id || (JSON.parse(row.sharedWith) as string[]).includes(actor.id)); }
export function listMediaSubjects(actor: PersonRow): MediaSubject[] { if (actor.role === "guest") return []; return db.select().from(mediaSubjects).all().filter((r) => canUseSubject(actor, r)).map(view); }
export function getMediaSubject(actor: PersonRow, id: string): MediaSubject | null { const row = rowById(id); return row && canUseSubject(actor, row) ? view(row) : null; }
function validateReferences(actor: PersonRow, ids: string[]) {
  if (ids.length > 8 || new Set(ids).size !== ids.length) return false;
  return ids.every((id) => { const file = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get(); return !!file && file.mediaType.startsWith("image/") && (file.retention === "kept" || file.provenance.startsWith("picture-gen:") || file.provenance === "media-subject-reference"); });
}
export function createMediaSubject(actor: PersonRow, input: SubjectInput, source = "api"): MediaSubject {
  if (actor.role === "guest") throw new Error("Saved subjects aren't available to guest profiles.");
  const name = input.name.trim().slice(0, 80), look = input.look.trim().slice(0, 1000), ids = [...new Set(input.referenceIds ?? [])];
  if (!name || !look || !validateReferences(actor, ids)) throw new Error("Choose a name, look, and pictures from your Library.");
  if (input.real && (actor.role === "child" || actor.role === "teen")) throw new Error("Real-person subjects are not available for this profile yet.");
  const now = new Date().toISOString(), id = `msub-${randomSuffix(10)}`;
  db.insert(mediaSubjects).values({ id, ownerPersonId: actor.id, name, kind: input.kind, sharedWith: "[]", look, referenceIds: JSON.stringify(ids), real: input.real ?? false, createdAt: now, updatedAt: now, hlc: nextHlc(), provenance: `media-subject:${JSON.stringify({ v: 1, source })}` }).run();
  return getMediaSubject(actor, id)!;
}
export function updateMediaSubject(actor: PersonRow, id: string, patch: Partial<SubjectInput>): MediaSubject | null {
  const existing = rowById(id); if (!existing || existing.ownerPersonId !== actor.id || actor.role === "guest") return null;
  const updated: SubjectInput = { name: patch.name ?? existing.name, kind: patch.kind ?? existing.kind as SubjectKind, look: patch.look ?? existing.look, referenceIds: patch.referenceIds ?? JSON.parse(existing.referenceIds), real: patch.real ?? existing.real };
  if (updated.real && (actor.role === "child" || actor.role === "teen")) throw new Error("Real-person subjects are not available for this profile yet.");
  const name = updated.name.trim().slice(0, 80), look = updated.look.trim().slice(0, 1000), ids = [...new Set(updated.referenceIds ?? [])];
  if (!name || !look || !validateReferences(actor, ids)) throw new Error("Choose a name, look, and pictures from your Library.");
  db.update(mediaSubjects).set({ name, kind: updated.kind, look, referenceIds: JSON.stringify(ids), real: updated.real ?? false, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, id)).run();
  return getMediaSubject(actor, id);
}
export function deleteMediaSubject(actor: PersonRow, id: string): boolean { const row = rowById(id); if (!row || row.ownerPersonId !== actor.id) return false; db.delete(mediaSubjects).where(eq(mediaSubjects.id, id)).run(); return true; }
export function shareMediaSubject(actor: PersonRow, id: string, personId: string, shared: boolean): MediaSubject | null {
  const row = rowById(id); if (!row || row.ownerPersonId !== actor.id) return null;
  const target = db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
  if (!target || target.role === "guest" || personId === actor.id) throw new Error("Choose a named household member.");
  const ids = new Set<string>(JSON.parse(row.sharedWith)); shared ? ids.add(personId) : ids.delete(personId);
  db.update(mediaSubjects).set({ sharedWith: JSON.stringify([...ids]), updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, id)).run();
  return getMediaSubject(actor, id);
}
export function subjectsForNames(actor: PersonRow, names: string[]): Array<{ subject: MediaSubject; references: Array<{ id: string; bytes: Uint8Array; mediaType: string; audience: string }> }> | null {
  if (names.length > 3 || new Set(names).size !== names.length) return null;
  const all = listMediaSubjects(actor); const selected: MediaSubject[] = [];
  for (const name of names) { const row = all.find((s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase()); if (!row) return null; if (row.real && (actor.role === "child" || actor.role === "teen")) return null; selected.push(row); }
  const rank = { place: 0, character: 1, prop: 2 };
  selected.sort((a, b) => rank[a.kind] - rank[b.kind]);
  const result: Array<{ subject: MediaSubject; references: Array<{ id: string; bytes: Uint8Array; mediaType: string; audience: string }> }> = [];
  for (const subject of selected) {
    const files = subject.reference_ids.map((id) => {
      const file = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, subject.owner_person_id), isNull(attachments.deletedAt))).get();
      if (!file || !canReadFileAudience(actor, file) || !file.mediaType.startsWith("image/") || (file.retention !== "kept" && !file.provenance.startsWith("picture-gen:") && file.provenance !== "media-subject-reference")) return null;
      try { const bytes = new Uint8Array(readFileSync(attachmentFilePath(file.storagePath))); if (bytes.byteLength !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) return null; return { id, bytes, mediaType: file.mediaType, audience: file.provenance.includes('"audience":"adult-only"') ? "adult-only" : "all-ages" }; } catch { return null; }
    });
    if (files.some((f) => !f)) return null;
    result.push({ subject, references: files as Array<{ id: string; bytes: Uint8Array; mediaType: string; audience: string }> });
  }
  return result;
}
