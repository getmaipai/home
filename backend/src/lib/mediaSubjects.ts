import { and, eq, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { attachments, mediaSubjects, mediaProductions, people } from "@/db/schema";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { attachmentFilePath } from "@/lib/attachments";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canReadFileAudience } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";

export type SubjectKind = "character" | "prop" | "place";
export interface SubjectInput { name: string; kind: SubjectKind; look: string; referenceIds?: string[]; real?: boolean }
/** CREATOR-04: `real` and `minor` of a linked subject are derived at read time, never read from the stored column (talent architect condition 13). */
export interface MediaSubject { id: string; name: string; kind: SubjectKind; owner_person_id: string; shared_with: string[]; look: string; reference_ids: string[]; real: boolean; minor: boolean; synth_id: string | null; person_id: string | null; voice: string | null; trained_style_id: string | null; locked_description: string | null; created_at: string; updated_at: string; hlc: string; provenance: string }
/** `lib/synths.ts` registers how a synth-linked subject's real-person and minor facts are read (it imports this module, so this one cannot import it). */
export type SynthFactDeriver = (synthId: string) => { real: boolean; minor: boolean; personId: string | null } | null;
let synthFacts: SynthFactDeriver = () => null;
export function registerSynthFactDeriver(fn: SynthFactDeriver): void { synthFacts = fn; }
function personBand(personId: string): "child" | "teen" | "adult" | null {
  const person = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
  return person ? speakerAgeBand(person, new Date()) : null;
}
/** The one place the real-person and minor facts of a subject are worked out: real is the strictest of the synth's `based_on`, the stored flag and the person link, so
 *  real is never laundered into fictional. A synth that is gone fails safe (the stored flag or the person link still count). A household member's subject is real,
 *  and minor when the person is under 18 now. */
export function subjectFacts(row: Pick<typeof mediaSubjects.$inferSelect, "real" | "synthId" | "personId">): { real: boolean; minor: boolean } {
  let real = row.real, minor = false;
  if (row.synthId) { const facts = synthFacts(row.synthId); if (facts) { real = real || facts.real; minor = facts.minor; if (facts.personId) { const band = personBand(facts.personId); if (band && band !== "adult") minor = true; } } }
  if (row.personId) { const band = personBand(row.personId); real = true; minor = minor || (band !== null && band !== "adult"); }
  return { real, minor };
}
function view(row: typeof mediaSubjects.$inferSelect): MediaSubject { const facts = subjectFacts(row); return { id: row.id, name: row.name, kind: row.kind as SubjectKind, owner_person_id: row.ownerPersonId, shared_with: JSON.parse(row.sharedWith), look: row.look, reference_ids: JSON.parse(row.referenceIds), real: facts.real, minor: facts.minor, synth_id: row.synthId, person_id: row.personId, voice: row.voice, trained_style_id: row.trainedStyleId, locked_description: row.lockedDescription, created_at: row.createdAt, updated_at: row.updatedAt, hlc: row.hlc, provenance: row.provenance }; }
export function isSheetReference(fileProvenance: string): boolean { if (!fileProvenance.startsWith("media-subject-reference:")) return false; try { return (JSON.parse(fileProvenance.slice("media-subject-reference:".length)) as { role?: string }).role === "sheet"; } catch { return false; } }
function rowById(id: string) { return db.select().from(mediaSubjects).where(eq(mediaSubjects.id, id)).get(); }
/** A household member's subject (`person_id`) is reached only through the cast resolver (`lib/cast.ts`), never through these subject paths:
 *  its pictures are a person's own photos and no path here may show them to anyone `main` did not already show them to. */
export function canUseSubject(actor: PersonRow, row: typeof mediaSubjects.$inferSelect): boolean { return actor.role !== "guest" && !row.personId && (row.ownerPersonId === actor.id || (JSON.parse(row.sharedWith) as string[]).includes(actor.id)); }
/** The synth a subject is linked to, or null (the link `synth.subject_id` points back through). */
export function synthIdOfSubject(subjectId: string): string | null { return rowById(subjectId)?.synthId ?? null; }
/** The subject made from a household member's own photos, or null; no reader access check (callers apply `canUseSubject`). */
export function subjectRowForPerson(personId: string) { return db.select().from(mediaSubjects).where(eq(mediaSubjects.personId, personId)).get(); }
export function subjectRowById(id: string) { return rowById(id); }
/** One subject by id with no access check: the cast resolver checks access first. */
export function subjectViewById(id: string): MediaSubject | null { const row = rowById(id); return row ? view(row) : null; }
/** The first time a household member is cast: a subject owned by the member, carrying the person link, no persona and no synth. `real` and `minor` are derived, so none is stored. */
export function ensurePersonSubject(person: PersonRow): MediaSubject {
  const existing = subjectRowForPerson(person.id); if (existing) return view(existing);
  const now = new Date().toISOString(), id = `msub-${randomSuffix(10)}`;
  db.insert(mediaSubjects).values({ id, ownerPersonId: person.id, name: person.displayName.trim().slice(0, 80), kind: "character", sharedWith: "[]", look: person.displayName.trim().slice(0, 1000), referenceIds: "[]", real: false, personId: person.id, createdAt: now, updatedAt: now, hlc: nextHlc(), provenance: `media-subject:${JSON.stringify({ v: 1, source: "cast:household-member" })}` }).run();
  return view(rowById(id)!);
}
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
  const existing = rowById(id); if (!existing || existing.personId || existing.ownerPersonId !== actor.id || actor.role === "guest") return null;
  const updated: SubjectInput = { name: patch.name ?? existing.name, kind: patch.kind ?? existing.kind as SubjectKind, look: patch.look ?? existing.look, referenceIds: patch.referenceIds ?? JSON.parse(existing.referenceIds), real: patch.real ?? existing.real };
  if (existing.synthId || existing.personId) updated.real = existing.real; // a linked subject's `real` is derived, never set by hand
  if (updated.real && (actor.role === "child" || actor.role === "teen")) throw new Error("Real-person subjects are not available for this profile yet.");
  const name = updated.name.trim().slice(0, 80), look = updated.look.trim().slice(0, 1000), ids = [...new Set(updated.referenceIds ?? [])];
  if (!name || !look || !validateReferences(actor, ids)) throw new Error("Choose a name, look, and pictures from your Library.");
  db.update(mediaSubjects).set({ name, kind: updated.kind, look, referenceIds: JSON.stringify(ids), real: updated.real ?? false, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, id)).run();
  return getMediaSubject(actor, id);
}
export function deleteMediaSubject(actor: PersonRow, id: string): boolean {
  const row = rowById(id); if (!row || row.personId || row.ownerPersonId !== actor.id) return false;
  const names = db.select().from(mediaProductions).all().filter((p) => p.ownerPersonId === actor.id).filter((p) => {
    const cast = JSON.parse(p.cast) as Array<{subject_id:string;wardrobe_variant_ids?:string[]}>;
    const sets = JSON.parse(p.sets) as string[], props = JSON.parse(p.props) as string[];
    const episodes = JSON.parse(p.episodes) as Array<{scenes:Array<{shots:Array<{subject_ids:string[]}>}>}>;
    return cast.some((c) => c.subject_id === id || c.wardrobe_variant_ids?.includes(id)) || sets.includes(id) || props.includes(id) || episodes.some((e) => e.scenes.some((s) => s.shots.some((shot) => shot.subject_ids.includes(id))));
  }).map((p) => p.title);
  if (names.length) throw new Error(`This subject is used in ${names.join(", ")}. Remove it from those productions first.`);
  db.delete(mediaSubjects).where(eq(mediaSubjects.id, id)).run(); sqlite.query("DELETE FROM creation_cast WHERE subject_id = ?").run(id); return true; // CREATOR-02: the cast index forgets a deleted subject
}
export function shareMediaSubject(actor: PersonRow, id: string, personId: string, shared: boolean): MediaSubject | null {
  const row = rowById(id); if (!row || row.personId || row.ownerPersonId !== actor.id) return null;
  const target = db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
  if (!target || target.role === "guest" || personId === actor.id) throw new Error("Choose a named household member.");
  const ids = new Set<string>(JSON.parse(row.sharedWith)); shared ? ids.add(personId) : ids.delete(personId);
  db.update(mediaSubjects).set({ sharedWith: JSON.stringify([...ids]), updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, id)).run();
  return getMediaSubject(actor, id);
}
export type SubjectWithRefs = { subject: MediaSubject; references: Array<{ id: string; bytes: Uint8Array; mediaType: string; audience: string }>; sheet?: { id: string; bytes: Uint8Array; mediaType: string; audience: string } };
export function subjectsForNames(actor: PersonRow, names: string[]): SubjectWithRefs[] | null {
  if (names.length > 3 || new Set(names).size !== names.length) return null;
  const all = listMediaSubjects(actor); const selected: MediaSubject[] = [];
  for (const name of names) { const row = all.find((s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase()); if (!row) return null; if (row.real && (actor.role === "child" || actor.role === "teen")) return null; selected.push(row); }
  return loadSubjectReferences(actor, selected);
}
/** CREATOR-05: the picture files (references and the sheet) of subjects already chosen and checked (`resolveCast` or a name match); null when a file is missing or altered. */
export function loadSubjectReferences(actor: PersonRow, chosen: MediaSubject[]): SubjectWithRefs[] | null {
  const selected = [...chosen];
  const rank = { place: 0, character: 1, prop: 2 };
  selected.sort((a, b) => rank[a.kind] - rank[b.kind]);
  const result: SubjectWithRefs[] = [];
  for (const subject of selected) {
    const files = subject.reference_ids.map((id) => {
      const file = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, subject.owner_person_id), isNull(attachments.deletedAt))).get();
      if (!file || !canReadFileAudience(actor, file) || !file.mediaType.startsWith("image/") || (file.retention !== "kept" && !file.provenance.startsWith("picture-gen:") && !file.provenance.startsWith("media-subject-reference"))) return null;
      try { const bytes = new Uint8Array(readFileSync(attachmentFilePath(file.storagePath))); if (bytes.byteLength !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) return null; return { id, bytes, mediaType: file.mediaType, audience: file.provenance.includes('"audience":"adult-only"') ? "adult-only" : "all-ages" }; } catch { return null; }
    });
    if (files.some((f) => !f)) return null;
    const loaded = files as Array<{ id: string; bytes: Uint8Array; mediaType: string; audience: string }>;
    result.push({ subject, references: loaded.filter((file) => { const row = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, file.id)).get(); return !row || !isSheetReference(row.provenance); }), ...(loaded.find((file) => { const row = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, file.id)).get(); return !!row && isSheetReference(row.provenance); }) ? { sheet: loaded.find((file) => { const row = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, file.id)).get(); return !!row && isSheetReference(row.provenance); })! } : {}) });
  }
  return result;
}
