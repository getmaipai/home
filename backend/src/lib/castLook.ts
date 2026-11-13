// CREATOR-06 (CREATOR-PORT-2026-11-13, section 6.3): one look capture for any cast member. Capturing a look = building the member's reference sheet ONCE through the one
// sheet builder (films/sheetMaker.ts, 768x448, the "Reference sheet:" text; never a second builder) from the member's own pictures, storing it as the subject's sheet
// reference, and writing the locked sentence. Every feature then reads that sheet through `resolveCast` (`look.sheet_file_id`); a sheet whose source pictures changed is
// rebuilt on the next capture (`look.sheet_stale`). Retires `mediaSubjectSheet.ts` `makeSubjectSheet` and PRODUCTION-VIDEO-02's separate turnaround sheet.
// Gates, exactly as `cast.ts` applies them: the cast resolver decides who may be cast at all (guests, minors and real people, `synths.real_people`, `generation.household_likeness`);
// a household member who is under 18 (or a real person's synth who is) is never turned into a sheet; a child's photos never widen access (`canUseSubject` still refuses
// person-linked rows). A household member's look is built only from pictures the person doing the capture supplies; nothing is generated for a real person.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, mediaSubjects, people } from "@/db/schema";
import { attachmentFilePath, storeFile } from "@/lib/attachments";
import { canReadFileAudience } from "@/lib/access";
import { nextHlc } from "@/lib/hlc";
import { resolveCast, type ResolvedCast } from "@/lib/cast";
import { lookSourceKey, lookSheetState, plainReferences, sheetNote, synthLookParts, SHEET_PROVENANCE_PREFIX } from "@/lib/castLookKey";
import { readLook, versionPath } from "@/lib/companionLook";
import { cancelOrDelete, fetchPicture, getGenerationJob, submitGeneration } from "@/lib/pictures/stack";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import type { SheetPicture, MadeSheet } from "@/lib/films/sheetMaker";
import type { PictureRole } from "@/lib/pictures/roles";
import type { PersonRow } from "@/types";

export const MAX_LOOK_SOURCES = 7; // a subject keeps at most 8 reference files and one of them is the sheet
export const LOOK_MINOR_LINE = "A child's or teen's pictures are not turned into a look sheet. Ask a parent or admin if you need one.";
export const LOOK_OWNER_LINE = "Only the person who saved this can capture its look. Ask them, or save your own copy and capture that.";
export const LOOK_NO_PHOTOS_LINE = "To capture this person's look, add one or more clear photos of them from your Library, then try again.";
export const LOOK_FAILED_LINE = "The look sheet could not be made. Try again in a moment.";

export type LookSheetMaker = (pictures: SheetPicture[], onStep?: (step: { phase: "cut" | "draw"; done: number; total: number }) => void) => Promise<MadeSheet>;
export type LookPortraitMaker = (owner: PersonRow, subject: { id: string; name: string; kind: string; look: string }, adultOnly: boolean) => Promise<{ bytes: Uint8Array; mediaType: string }>;
export interface CaptureOptions {
  /** Pictures of the person to add to the member before capturing (the doing person's own Library files); required for a household member with none. */
  photoFileIds?: string[];
  /** Rebuild even when the sheet's source pictures are unchanged. */
  force?: boolean;
  onStep?: (step: { phase: "cut" | "draw"; done: number; total: number }) => void;
  /** Test seams: the sheet builder and the portrait maker. The real ones are `films/sheetMaker.ts` and the picture engine. */
  sheetMaker?: LookSheetMaker;
  portraitMaker?: LookPortraitMaker;
}
export type CaptureResult =
  | { ok: true; member: ResolvedCast; sheet_file_id: string; reused: boolean; description: string; locked_description: string | null; notes: string[] }
  | { ok: false; line: string };

const realSheetMaker: LookSheetMaker = async (pictures, onStep) => (await import("@/lib/films/sheetMaker")).makeSheetFromPictures(pictures, undefined, { drawViews: true, ...(onStep ? { onStep } : {}) });
const roleOf = (kind: string): PictureRole => kind === "place" ? "set" : kind === "prop" ? "prop" : "actor";
const personById = (id: string): PersonRow | null => (db.select().from(people).where(and(eq(people.id, id), isNull(people.deletedAt))).get() as PersonRow | undefined) ?? null;

/** The portrait of a made-up being, prop or place that has no picture yet: drawn from its words by the picture engine, age-checked and gated like any finished picture. Never used for a real person. */
export const realPortraitMaker: LookPortraitMaker = async (owner, subject, adultOnly) => {
  const prompt = `${subject.kind === "place" ? "A clean wide picture of" : "A clean picture of"} ${subject.look}. One subject only, fully visible, plain light background, no text.`;
  const submitted = await submitGeneration({ prompt, size: subject.kind === "place" ? "1024x576" : "1024x1024", n: 1, audience: adultOnly ? "adult" : "all-ages", timeout_ms: 1 });
  const deadline = Date.now() + 8 * 60_000;
  try {
    let data = submitted.done;
    while (!data?.length && Date.now() < deadline) {
      const job = await getGenerationJob(submitted.job);
      if (job.state === "failed" || job.state === "cancelled") throw new Error(job.error ?? "The picture could not be made.");
      if (job.state === "done") { data = job.data; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!data?.length) throw new Error("The picture took too long. Try again.");
    const bytes = await fetchPicture(submitted.job, 0);
    const meta = await sharp(bytes, { failOn: "error" }).metadata();
    if (meta.format !== "png" || !meta.width || !meta.height) throw new Error("The picture could not be checked.");
    const checks = await checkImages([bytes], "picture");
    const decision = await gateFinished({ actor: owner, kind: "picture", jobId: `look-portrait:${subject.id}`, adultOnly, checks, images: [bytes], prompt });
    if (decision.action === "withhold") throw new Error(decision.line);
    return { bytes, mediaType: "image/png" };
  } catch (error) { void cancelOrDelete(submitted.job); throw error; }
};

function loadFile(row: typeof attachments.$inferSelect): Uint8Array | null {
  try { const bytes = new Uint8Array(readFileSync(attachmentFilePath(row.storagePath))); return bytes.byteLength === row.size && createHash("sha256").update(bytes).digest("hex") === row.sha256 ? bytes : null; } catch { return null; }
}
const adultOnlyFile = (provenance: string) => provenance.includes('"audience":"adult-only"');
const inFlight = new Map<string, Promise<CaptureResult>>();

/** Capture the look of one cast member (an id or name `resolveCast` understands): build its sheet once from its pictures, store it on the member, reuse it until the pictures change. */
export function captureLook(actor: PersonRow, ref: string, options: CaptureOptions = {}): Promise<CaptureResult> {
  const key = `${actor.id}:${ref}`;
  const running = inFlight.get(key);
  if (running) return running;
  const run = doCapture(actor, ref, options).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function doCapture(actor: PersonRow, ref: string, options: CaptureOptions): Promise<CaptureResult> {
  const resolved = await resolveCast(actor, [ref]);
  const member = resolved.members[0];
  if (!member) return { ok: false, line: resolved.refused[0]?.line ?? `"${ref}" is not in your cast list. Pick someone from the list and try again.` };
  if (member.real && member.minor) return { ok: false, line: LOOK_MINOR_LINE };
  const row = db.select().from(mediaSubjects).where(eq(mediaSubjects.id, member.subject_id)).get();
  if (!row) return { ok: false, line: `${member.name} could not be set up as cast. Try again in a moment.` };
  // Who may write: a synth and a saved subject only for the person who made it (the maker stores the sheet); a household member by any adult who may cast them (the cast gate already applied).
  const isMember = member.kind === "member";
  if (!isMember && row.ownerPersonId !== actor.id && !(member.kind === "synth" && member.synth && actor.role !== "guest")) return { ok: false, line: LOOK_OWNER_LINE };
  const storer = isMember ? actor : personById(row.ownerPersonId);
  if (!storer) return { ok: false, line: LOOK_OWNER_LINE };

  // 1. Pictures supplied now are added to the member (the doing person's own, readable, kept Library pictures).
  let ids = JSON.parse(row.referenceIds) as string[];
  const added: string[] = [];
  for (const id of options.photoFileIds ?? []) {
    if (ids.includes(id)) continue;
    const file = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
    if (!file || !file.mediaType.startsWith("image/") || !canReadFileAudience(actor, file)) return { ok: false, line: "One of those pictures is not in your Library any more. Choose pictures from your Library and try again." };
    added.push(id);
  }
  if (added.length) {
    if (plainReferences(ids).length + added.length > MAX_LOOK_SOURCES) return { ok: false, line: `A look can use at most ${MAX_LOOK_SOURCES} pictures. Remove some and try again.` };
    ids = [...ids, ...added];
    db.update(mediaSubjects).set({ referenceIds: JSON.stringify(ids), updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, row.id)).run();
  }

  // 2. Gather the source pictures: a synth's rest picture and approved views, the member's references. Deduplicated by content.
  const sources: Array<{ bytes: Uint8Array; mediaType: string; adultOnly: boolean }> = [];
  const seen = new Set<string>();
  const take = (bytes: Uint8Array | null, mediaType: string, adultOnly: boolean) => { if (!bytes) return; const sha = createHash("sha256").update(bytes).digest("hex"); if (seen.has(sha) || sources.length >= MAX_LOOK_SOURCES) return; seen.add(sha); sources.push({ bytes, mediaType, adultOnly }); };
  const synthId = row.synthId;
  if (synthId) {
    const parts = synthLookParts(synthId), read = (versionId: string | null) => { const path = versionId ? versionPath(synthId, versionId) : null; try { return path ? new Uint8Array(readFileSync(path)) : null; } catch { return null; } };
    take(read(parts.rest), "image/png", false);
    for (const view of parts.views) take(read(view), "image/png", false);
  }
  for (const reference of plainReferences(ids)) {
    // The copy of the synth's rest picture that the cast setup stored is replaced by the synth's current rest picture above.
    if (synthId && readLook(synthId).rest && reference.name === `${member.name}.png`) continue;
    const file = db.select().from(attachments).where(eq(attachments.id, reference.id)).get();
    if (!file || !file.mediaType.startsWith("image/") || !canReadFileAudience(actor, file)) continue;
    take(loadFile(file), file.mediaType, adultOnlyFile(file.provenance));
  }
  let adultOnly = sources.some((s) => s.adultOnly) || member.audience === "adult-only";

  // 3. A made-up being, prop or place with no picture yet gets one portrait drawn from its words and kept as its first reference. A real person never does.
  if (!sources.length) {
    if (member.real) return { ok: false, line: LOOK_NO_PHOTOS_LINE };
    let portrait: { bytes: Uint8Array; mediaType: string };
    try { portrait = await (options.portraitMaker ?? realPortraitMaker)(storer, { id: row.id, name: member.name, kind: member.subject_kind, look: row.look }, adultOnly); }
    catch (error) { return { ok: false, line: error instanceof Error && error.message ? error.message : LOOK_FAILED_LINE }; }
    const stored = storeFile(storer, { conversationId: null, turnId: null, mediaType: portrait.mediaType, bytes: portrait.bytes, provenance: `media-subject-reference:${JSON.stringify({ role: "portrait", audience: adultOnly ? "adult-only" : "all-ages" })}`, retention: "kept", name: `${member.name} portrait` });
    if (!stored.ok) return { ok: false, line: LOOK_FAILED_LINE };
    ids = [...ids, stored.value.id];
    db.update(mediaSubjects).set({ referenceIds: JSON.stringify(ids), updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, row.id)).run();
    take(portrait.bytes, portrait.mediaType, adultOnly);
  }
  if (!sources.length) return { ok: false, line: member.real ? LOOK_NO_PHOTOS_LINE : LOOK_FAILED_LINE };

  // 4. Reuse: one sheet per cast member while its pictures are the same.
  const sourceKey = lookSourceKey(row.id)!;
  const state = lookSheetState(row.id);
  const currentRow = state.sheet_file_id ? db.select().from(attachments).where(and(eq(attachments.id, state.sheet_file_id), isNull(attachments.deletedAt))).get() : undefined;
  const currentNote = currentRow ? sheetNote(currentRow.provenance) : null;
  if (currentRow && currentNote && !options.force && currentNote.key === sourceKey) {
    return { ok: true, member: (await resolveCast(actor, [ref])).members[0] ?? member, sheet_file_id: currentRow.id, reused: true, description: currentNote.description ?? "", locked_description: row.lockedDescription, notes: [] };
  }

  // 5. Build it with the one sheet builder and store it as the subject's sheet reference.
  const pictures: SheetPicture[] = sources.map((s, index) => ({ bytes: s.bytes, mediaType: s.mediaType, name: sources.length > 1 ? `${member.name} ${index + 1}` : member.name, role: roleOf(member.subject_kind), look: row.look }));
  let made: MadeSheet;
  try { made = await (options.sheetMaker ?? realSheetMaker)(pictures, options.onStep); }
  catch (error) { console.error("[cast-look] sheet failed:", error instanceof Error ? error.message : error); return { ok: false, line: LOOK_FAILED_LINE }; }
  // The locked sentence: written from the look words, and rewritten on a rebuild only when the person has not edited it by hand.
  const auto = row.look.trim().slice(0, 400) || null;
  const locked = row.lockedDescription && row.lockedDescription !== currentNote?.locked ? row.lockedDescription : auto;
  const note = { role: "sheet" as const, audience: adultOnly ? "adult-only" as const : "all-ages" as const, key: sourceKey, maker: "films/sheetMaker", description: made.description, locked: auto };
  const stored = storeFile(storer, { conversationId: null, turnId: null, mediaType: "image/png", bytes: made.png, provenance: `${SHEET_PROVENANCE_PREFIX}${JSON.stringify(note)}`, retention: "kept", name: `${member.name} look sheet` });
  if (!stored.ok) return { ok: false, line: LOOK_FAILED_LINE };
  const latest = db.select().from(mediaSubjects).where(eq(mediaSubjects.id, row.id)).get()!;
  // The replaced sheet is left unreferenced in the Library; no file is deleted here.
  const kept = (JSON.parse(latest.referenceIds) as string[]).filter((id) => { const file = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, id)).get(); return !(file && sheetNote(file.provenance)); });
  db.update(mediaSubjects).set({ referenceIds: JSON.stringify([...kept, stored.value.id]), lockedDescription: locked, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, row.id)).run();
  const fresh = (await resolveCast(actor, [ref])).members[0] ?? member;
  return { ok: true, member: fresh, sheet_file_id: stored.value.id, reused: false, description: made.description, locked_description: locked, notes: made.notes };
}
