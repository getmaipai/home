// CREATOR-02 (docs/design/creatoros-port-2026-11-13.md section 7): the creation store. One row per made item holds the spec `creation-record` as JSON (what the
// item was made from); `creation_cast` is the derived index of who is cast in it, written in the same transaction and rebuildable from the records.
//
// Rules this file keeps, and nothing else writes the two tables:
// - Write: only `recordCreation`, called by a finished job's writer (a picture, clip, film or edit that already exists as a file). Never from a live plan or an
//   autosave. It never throws: a record is metadata, and a failed record never fails the item.
// - Read: only by the person who made it, and only when the item itself is readable for them (the Library's own rules: `canReadFileAudience`, the Adult lock's
//   `lockState`). A locked or adult-only record is never returned to a minor, a shared screen or an adult without the unlock; the answer for a locked one is
//   the lock tile (no title, no id), and for a hidden one it is "not found".
// - Mark: `made_audience` and `lock` are the maximum over the made files, the source files and the parent record, by the one function `newItemMark`.
// - Purge: a record goes with its main file (`dropCreationsForFile`, called from `purgeFileRecord`).
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, creationCast, creations, mediaSubjects } from "@/db/schema";
import { canReadFileAudience } from "@/lib/access";
import { fileLockState, lockItemOfProvenance, lockState, newItemMark, requestProof, type AdultProof, type ItemMark, type MarkSource } from "@/lib/adultLock";
import { nextHlc } from "@/lib/hlc";
import { newCreationId } from "@/lib/id";
import { CreationRecord } from "@maipai/spec/gen/ts/creation-record.js";
import { validateCreationRecord } from "@maipai/spec/records/ts/validate.js";
import type { PersonRow } from "@/types";
export { dropCreationsForFile } from "./purge";

export type Creation = ReturnType<typeof CreationRecord.parse>;
type CastEntry = Creation["cast"][number];
type SourceEntry = Creation["sources"][number];

export const FILE_ID = /^file-[a-z0-9]{6,}$/;
const SUBJECT_ID = /^msub-[a-z0-9]{6,}$/;
const PRODUCTION_ID = /^mprd-[a-z0-9]{6,}$/;
const LORA_ID = /^lora-[a-z0-9]{6,}$/;

/** What a writer hands over. Anything not given is empty (the cast stays empty until CREATOR-04 fills it). */
export interface CreationInput {
  /** Pre-allocated by a writer that puts the pointer in the file note before the record exists (`newCreationId`). */
  id?: string;
  kind: Creation["kind"];
  /** The made files, the main one first (the clip before its poster). */
  fileIds: string[];
  jobIds?: string[];
  productionId?: string | null;
  shotId?: string | null;
  recipe: { tool: string; route: NonNullable<Creation["recipe"]>["route"] };
  words?: { written?: string; composed?: string } | null;
  plan?: Creation["plan"];
  cast?: Array<{ subject_id: string; synth_id?: string | null; role: string }>;
  sources?: Array<{ file_id: string; role: SourceEntry["role"] }>;
  generation?: Creation["generation"];
  settings?: Creation["settings"];
  checks?: Record<string, unknown> | null;
  /** The record this one was made from (another take, an edit): its mark is a floor for this one. */
  parentId?: string | null;
  /** The item adds an adult-only style or words on its own (not only through its files). */
  adult?: boolean;
  madeAt?: string;
}

const clean = (value: string | null | undefined): string | null => (value && PRODUCTION_ID.test(value) ? value : null);

/** The mark of a made item: the maximum over its own files, its source files and its parent record (never lowered by a creator's earlier clearing of a source). */
function markOf(personId: string, ownIds: readonly string[], sourceIds: readonly string[], parent: { madeAudience: string; lock: string } | null, adult: boolean): ItemMark {
  const ids = [...new Set([...ownIds, ...sourceIds])];
  const rows = ids.length ? db.select({ id: attachments.id, owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(inArray(attachments.id, ids)).all() : [];
  const items: MarkSource[] = [];
  for (const row of rows) {
    const item = lockItemOfProvenance(row.owner, row.provenance);
    // An unlabelled file (no audience in its note) is held back from a minor by the Library's own gate and is not covered by the Adult lock: it adds no mark of its own.
    if (item && item.madeAudience !== null) items.push({ madeAudience: item.madeAudience, lock: item.lock });
  }
  if (parent) items.push({ madeAudience: parent.madeAudience === "adult-only" ? "adult-only" : "all-ages", lock: parent.lock === "on" ? "on" : "off" });
  return newItemMark(items, adult);
}

function rowOfFile(personId: string, fileId: string): typeof creations.$inferSelect | undefined {
  return db.select().from(creations).where(and(eq(creations.personId, personId), sqliteHasFile(fileId))).get();
}

const sqliteHasFile = (fileId: string) => sql`EXISTS (SELECT 1 FROM json_each(${creations.fileIds}) WHERE value = ${fileId})`;
const sqliteHasJob = (jobId: string) => sql`EXISTS (SELECT 1 FROM json_each(${creations.jobIds}) WHERE value = ${jobId})`;

/** The id of the creation a file belongs to (any of its made files), for the person, or null. */
export function creationIdOfFile(personId: string, fileId: string | null | undefined): string | null {
  return fileId ? rowOfFile(personId, fileId)?.id ?? null : null;
}

/** The id of the creation a job ran, for the person, or null. */
export function creationIdOfJob(personId: string, jobId: string | null | undefined): string | null {
  if (!jobId) return null;
  return db.select({ id: creations.id }).from(creations).where(and(eq(creations.personId, personId), sqliteHasJob(jobId))).get()?.id ?? null;
}

function parentRow(personId: string, parentId: string | null | undefined): typeof creations.$inferSelect | undefined {
  return parentId ? db.select().from(creations).where(and(eq(creations.id, parentId), eq(creations.personId, personId))).get() : undefined;
}

function writeCast(creationId: string, cast: readonly CastEntry[]): void {
  db.delete(creationCast).where(eq(creationCast.creationId, creationId)).run();
  const seen = new Set<string>();
  for (const member of cast) {
    if (seen.has(member.subject_id)) continue;
    seen.add(member.subject_id);
    db.insert(creationCast).values({ creationId, subjectId: member.subject_id, synthId: member.synth_id ?? null }).run();
  }
}

/**
 * The one writer. Called by a finished job's writer after its files are stored. A second call for the same main file updates that record (a film's cut is first
 * a clip), keeping its id, its date and its parent. Returns the record, or null when it could not be written (never throws).
 */
export function recordCreation(actor: PersonRow, input: CreationInput): Creation | null {
  try {
    const fileIds = [...new Set(input.fileIds.filter((id) => FILE_ID.test(id)))];
    if (fileIds.length === 0) return null;
    const existing = rowOfFile(actor.id, fileIds[0]!);
    const old = existing ? (JSON.parse(existing.body) as Creation) : null;
    const sources = [...(old?.sources ?? []), ...(input.sources ?? [])].filter((s) => FILE_ID.test(s.file_id));
    const uniqueSources = sources.filter((s, i) => sources.findIndex((o) => o.file_id === s.file_id && o.role === s.role) === i);
    const parentId = input.parentId !== undefined ? input.parentId : old?.parent_id ?? null;
    const parent = parentRow(actor.id, parentId);
    const mark = markOf(actor.id, fileIds, uniqueSources.map((s) => s.file_id), parent ? { madeAudience: parent.madeAudience, lock: parent.lock } : existing ? { madeAudience: existing.madeAudience, lock: existing.lock } : null, input.adult === true);
    const now = new Date().toISOString();
    const cast: CastEntry[] = (input.cast ? input.cast.map((member) => ({ subject_id: member.subject_id, synth_id: member.synth_id ?? null, role: member.role.slice(0, 100) || "cast", voice: null })) : old?.cast ?? []).filter((member) => SUBJECT_ID.test(member.subject_id));
    const settings = input.settings ? { ...input.settings } : old?.settings ?? {};
    if (settings.styles) settings.styles = settings.styles.filter((style) => LORA_ID.test(style.style_id));
    const record = CreationRecord.parse({
      id: existing?.id ?? input.id ?? newCreationId(),
      version: 1,
      made_at: old?.made_at ?? input.madeAt ?? now,
      kind: input.kind,
      file_ids: [...new Set([...(old?.file_ids ?? []).filter((id) => !fileIds.includes(id)), ...fileIds])].sort((a, b) => (fileIds.includes(a) ? fileIds.indexOf(a) : 99) - (fileIds.includes(b) ? fileIds.indexOf(b) : 99)),
      job_ids: [...new Set([...(old?.job_ids ?? []), ...(input.jobIds ?? [])])],
      production_id: clean(input.productionId) ?? old?.production_id ?? null,
      shot_id: input.shotId ?? old?.shot_id ?? null,
      recipe: input.recipe,
      words: input.words === undefined ? old?.words ?? null : input.words,
      plan: input.plan === undefined ? old?.plan ?? null : input.plan,
      cast,
      sources: uniqueSources,
      generation: input.generation === undefined ? old?.generation ?? null : input.generation,
      settings,
      checks: input.checks === undefined ? old?.checks ?? null : input.checks,
      parent_id: parent ? parent.id : null,
      review: old?.review ?? "pending",
      audience: mark.madeAudience,
      made_audience: mark.madeAudience,
      lock: mark.lock,
      provenance: `person:${actor.id}`,
      created_at: old?.created_at ?? now,
      updated_at: now,
      hlc: nextHlc(),
    });
    if (validateCreationRecord(record).length > 0) return null;
    db.transaction((tx) => {
      const values = {
        personId: actor.id, kind: record.kind, parentId: record.parent_id ?? null, review: record.review, madeAudience: record.made_audience, lock: record.lock,
        fileIds: JSON.stringify(record.file_ids), jobIds: JSON.stringify(record.job_ids), body: JSON.stringify(record), updatedAt: record.updated_at, hlc: record.hlc, provenance: record.provenance,
      };
      if (existing) tx.update(creations).set(values).where(eq(creations.id, existing.id)).run();
      else tx.insert(creations).values({ id: record.id, createdAt: record.created_at, ...values }).run();
      writeCast(record.id, record.cast);
    });
    return record;
  } catch (error) {
    // The words and plan are private: log the kind of failure only.
    console.error(`[creations] a record was not written (${error instanceof Error ? error.name : "error"})`);
    return null;
  }
}

/**
 * The Adult lock changed on a file (the creator marked or cleared it, or a recheck lowered its audience): bring the records that hold it back in line, by the same
 * rule as at write time (the maximum over the made files, the source files and the parent). Called from `adultMarks.ts` and `libraryAudience.ts` after they write.
 */
export function syncCreationMarkForFile(fileId: string): void {
  try {
    const rows = db.select().from(creations).where(sqliteHasFile(fileId)).all();
    for (const row of rows) {
      const body = JSON.parse(row.body) as Creation;
      const parent = parentRow(row.personId, row.parentId);
      const mark = markOf(row.personId, body.file_ids, body.sources.map((s) => s.file_id), parent ? { madeAudience: parent.madeAudience, lock: parent.lock } : null, false);
      if (mark.madeAudience === row.madeAudience && mark.lock === row.lock) continue;
      body.audience = mark.madeAudience; body.made_audience = mark.madeAudience; body.lock = mark.lock; body.updated_at = new Date().toISOString(); body.hlc = nextHlc();
      db.update(creations).set({ madeAudience: mark.madeAudience, lock: mark.lock, body: JSON.stringify(body), updatedAt: body.updated_at, hlc: body.hlc }).where(eq(creations.id, row.id)).run();
    }
  } catch { /* the read path also checks the file's own live mark, so a record that could not be synced is never more open than the file */ }
}

/** The creation of a file as the maker's own back-end code needs it (no viewer gate): used by writers to find a parent and by the back-fill. */
export function creationOfFile(personId: string, fileId: string): Creation | null {
  const row = rowOfFile(personId, fileId);
  return row ? (JSON.parse(row.body) as Creation) : null;
}

/** Read the review mark without exposing or parsing the rest of a creation record. */
export function reviewOfFile(personId: string, fileId: string): Creation["review"] | null {
  const review = rowOfFile(personId, fileId)?.review;
  return (review as Creation["review"] | undefined) ?? null;
}

/** Update advisory clip-check fields and take review without rewriting provenance. */
export function updateCreationReview(personId: string, fileId: string, patch: { checks?: Record<string, unknown>; review?: Creation["review"] }): Creation | null {
  try {
    const row = rowOfFile(personId, fileId);
    if (!row) return null;
    const body = CreationRecord.parse(JSON.parse(row.body));
    const record = CreationRecord.parse({ ...body, ...(patch.checks ? { checks: { ...(body.checks ?? {}), ...patch.checks } } : {}), ...(patch.review ? { review: patch.review } : {}), updated_at: new Date().toISOString(), hlc: nextHlc() });
    if (validateCreationRecord(record).length) return null;
    db.update(creations).set({ review: record.review, body: JSON.stringify(record), updatedAt: record.updated_at, hlc: record.hlc }).where(eq(creations.id, row.id)).run();
    return record;
  } catch { return null; }
}

export type CreationRead = { state: "ok"; creation: Creation } | { state: "locked" } | { state: "none" };

/**
 * What the maker may read about a file. "none" covers every case that must not be told apart: no such file, not theirs, trashed, no record, a minor reaching an
 * adult-only item. "locked" is only for the adult maker without a live unlock proof: the caller answers with the lock tile and nothing else.
 */
export function readCreationByFile(actor: PersonRow, fileId: string, proof: AdultProof = requestProof(), backfill?: (actor: PersonRow, fileId: string) => boolean): CreationRead {
  const file = db.select({ id: attachments.id, owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  if (!file) return { state: "none" };
  if (!canReadFileAudience(actor, { ownerPersonId: file.owner, provenance: file.provenance })) return { state: "none" };
  let row = rowOfFile(actor.id, fileId);
  if (!row) {
    // The back-fill runs only when the reader would get the record: a hidden or locked item (a minor, an adult without the unlock) is never rebuilt, and answers like a file with no record.
    if (fileLockState(actor, fileId, proof) !== "open") return { state: "none" };
    backfill?.(actor, fileId);
    row = rowOfFile(actor.id, fileId);
  }
  if (!row) return { state: "none" };
  const gate = worst(lockState({ ownerPersonId: row.personId, madeAudience: row.madeAudience === "adult-only" ? "adult-only" : "all-ages", lock: row.lock === "off" ? "off" : "on" }, actor, proof), fileLockState(actor, fileId, proof));
  if (gate === "hidden") return { state: "none" };
  if (gate === "locked") return { state: "locked" };
  const creation = JSON.parse(row.body) as Creation;
  // A parent that this viewer could not open is not named.
  if (creation.parent_id) {
    const parent = parentRow(actor.id, creation.parent_id);
    const parentFile = parent ? (JSON.parse(parent.fileIds) as string[])[0] : undefined;
    if (!parent || !parentFile || readCreationByFile(actor, parentFile, proof, backfill).state !== "ok") creation.parent_id = null;
  }
  return { state: "ok", creation };
}

function worst(a: "open" | "locked" | "hidden", b: "open" | "locked" | "hidden"): "open" | "locked" | "hidden" {
  return a === "hidden" || b === "hidden" ? "hidden" : a === "locked" || b === "locked" ? "locked" : "open";
}

/** Rebuild `creation_cast` from the records (the index is derived). Returns the number of records read. */
export function rebuildCreationCast(): number {
  const rows = db.select({ id: creations.id, body: creations.body }).from(creations).all();
  db.transaction(() => {
    db.delete(creationCast).run();
    const known = new Set(db.select({ id: mediaSubjects.id }).from(mediaSubjects).all().map((r) => r.id));
    for (const row of rows) writeCast(row.id, (JSON.parse(row.body) as Creation).cast.filter((member) => known.has(member.subject_id)));
  });
  return rows.length;
}
