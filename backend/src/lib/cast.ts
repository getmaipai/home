// CREATOR-04 (docs/design/creatoros-port-2026-11-13.md section 6): the one cast resolver. A cast member is a synth or a saved subject seen
// through this one function: `listCast` is what the viewer may cast (GET /api/cast), `resolveCast` turns ids or names into everything a feature needs.
// Rulings applied as written, nothing new: a synth is governed by `maySeeSynth` (companion use, `synths.of_me`, `synths.real_people`); a household
// member is governed by `generation.household_likeness` alone (rule 0), never `synths.of_me`, and casting one creates no synth; a child or teen is
// refused a real subject; `real` and the minor fact are derived at read time (`subjectFacts`).
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { ensureSubject, listSynths, synthById, synthFloor, type SynthRecord } from "@/lib/synths";
import { ensurePersonSubject, isSheetReference, listMediaSubjects, loadSubjectReferences, subjectFacts, subjectRowForPerson, subjectViewById, type MediaSubject, type SubjectWithRefs } from "@/lib/mediaSubjects";
import { householdLikenessAllowed, LIKENESS_OFF_LINE } from "@/lib/likeness";
import { speakerAgeBand } from "@/lib/ageBand";
import { readCompanionPack } from "@/lib/companionPack";
import type { PersonRow } from "@/types";

export const MAX_CAST = 6;
export type CastKind = "synth" | "member" | "subject";
export interface CastEntry {
  /** The id a caller passes back to `resolveCast`: the subject id when one exists, else the synth id or the person id. */
  id: string;
  kind: CastKind;
  subject_kind: "character" | "prop" | "place";
  name: string;
  subject_id: string | null;
  synth_id: string | null;
  person_id: string | null;
  /** The look: its words, its stored reference sheet (a Library file id) when one exists, and the medium of the rest picture. */
  look: { description: string; sheet_file_id: string | null; medium: "photo" | "stylised" | null };
  locked_description: string | null;
  voice: string | null;
  avatar: { url: string | null; seed: string | null };
  real: boolean;
  minor: boolean;
  audience: "all-ages" | "adult-only";
}
export interface ResolvedCast extends CastEntry { subject_id: string; subject: MediaSubject; synth: SynthRecord | null }
export interface CastResult { members: ResolvedCast[]; refused: Array<{ ref: string; line: string; ambiguous?: boolean }> }

const isMinorBand = (actor: PersonRow) => speakerAgeBand(actor, new Date()) !== "adult";
export const REAL_REFUSED_LINE = "Real-person subjects are not available for this profile yet. Ask a parent or admin if you need one.";

function refFiles(subject: MediaSubject | null) {
  const rows = (subject?.reference_ids ?? []).map((id) => db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).get()).filter((row): row is NonNullable<typeof row> => !!row);
  const sheet = [...rows].reverse().find((row) => isSheetReference(row.provenance));
  const plain = rows.find((row) => !isSheetReference(row.provenance));
  return { sheetId: sheet?.id ?? null, firstId: plain?.id ?? null, adultOnly: rows.some((row) => row.provenance.includes('"audience":"adult-only"')) };
}
function synthEntry(synth: SynthRecord): CastEntry {
  const subject = synth.subject_id ? subjectViewById(synth.subject_id) : null;
  const files = refFiles(subject), facts = subjectFacts({ real: false, synthId: synth.id, personId: null });
  const source = readCompanionPack(synth.id)?.provenance as { source?: string } | undefined;
  const rest = (synth.persona as { animation?: { sheet?: { rest?: string } } }).animation?.sheet?.rest;
  return {
    id: subject?.id ?? synth.id, kind: "synth", subject_kind: "character", name: synth.persona.display_name, subject_id: subject?.id ?? null, synth_id: synth.id, person_id: null,
    look: { description: subject?.look ?? synth.persona.look_prompt ?? synth.persona.display_name, sheet_file_id: files.sheetId, medium: source?.source ? (source.source === "photo" ? "photo" : "stylised") : null },
    locked_description: subject?.locked_description ?? null, voice: subject?.voice ?? synth.persona.voice_id ?? null,
    avatar: { url: rest ? `/api/companions/${encodeURIComponent(synth.id)}/animation/${encodeURIComponent(rest)}` : null, seed: synth.id },
    real: facts.real, minor: facts.minor || (subject?.minor ?? false), audience: synthFloor(synth) === "adult" || files.adultOnly ? "adult-only" : "all-ages",
  };
}
function subjectEntry(subject: MediaSubject): CastEntry {
  const files = refFiles(subject);
  return {
    id: subject.id, kind: "subject", subject_kind: subject.kind, name: subject.name, subject_id: subject.id, synth_id: null, person_id: null,
    look: { description: subject.look, sheet_file_id: files.sheetId, medium: null }, locked_description: subject.locked_description, voice: subject.voice,
    avatar: { url: files.sheetId ?? files.firstId ? `/api/files/${files.firstId ?? files.sheetId}/content` : null, seed: null },
    real: subject.real, minor: subject.minor, audience: files.adultOnly ? "adult-only" : "all-ages",
  };
}
function memberEntry(person: PersonRow): CastEntry {
  const row = subjectRowForPerson(person.id), subject = row ? subjectViewById(row.id) : null, files = refFiles(subject);
  const facts = subjectFacts({ real: false, synthId: null, personId: person.id });
  return {
    id: subject?.id ?? person.id, kind: "member", subject_kind: "character", name: person.displayName, subject_id: subject?.id ?? null, synth_id: null, person_id: person.id,
    look: { description: subject?.look ?? person.displayName, sheet_file_id: facts.minor ? null : files.sheetId, medium: "photo" }, locked_description: subject?.locked_description ?? null, voice: subject?.voice ?? null,
    avatar: { url: null, seed: person.avatarSeed }, real: facts.real, minor: facts.minor, audience: files.adultOnly ? "adult-only" : "all-ages",
  };
}
function householdPeople(): PersonRow[] { return db.select().from(people).where(and(isNull(people.deletedAt), eq(people.enabled, true))).all().filter((p) => p.role !== "guest" && !p.memorializedAt); }

/** What this viewer may cast: synths (the synth gate, band filtering included), saved subjects, and household members (adults only, `generation.household_likeness` alone). */
export function listCast(actor: PersonRow): CastEntry[] {
  if (actor.role === "guest") return [];
  const minorViewer = isMinorBand(actor);
  const entries: CastEntry[] = [];
  for (const synth of listSynths(actor)) {
    const entry = synthEntry(synth);
    if (synth.based_on.kind === "household_member" && synth.based_on.person_id !== actor.id && !householdLikenessAllowed()) continue; // rule 0: household_likeness alone
    entries.push(entry);
  }
  for (const subject of listMediaSubjects(actor)) {
    if (subject.synth_id || subject.person_id) continue;
    if (subject.real && minorViewer) continue;
    entries.push(subjectEntry(subject));
  }
  if (!minorViewer) for (const person of householdPeople()) if (person.id === actor.id || householdLikenessAllowed()) entries.push(memberEntry(person));
  return minorViewer ? entries.filter((e) => e.audience !== "adult-only") : entries; // filtered, not labelled: an adult-only entry never reaches a minor
}
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.trim().toLocaleLowerCase();
function refusalFor(actor: PersonRow, ref: string): string {
  const person = householdPeople().find((p) => p.id === ref || same(p.displayName, ref));
  if (person && person.id !== actor.id) { if (isMinorBand(actor)) return REAL_REFUSED_LINE; if (!householdLikenessAllowed()) return LIKENESS_OFF_LINE; }
  return `"${ref}" is not in your cast list. Pick someone from the list and try again.`;
}
/** Ids or names to cast members, every one checked against what the viewer may cast. The first cast of a synth or a household member makes its subject. */
export async function resolveCast(actor: PersonRow, refs: string[]): Promise<CastResult> {
  const available = listCast(actor), members: ResolvedCast[] = [], refused: CastResult["refused"] = [], seen = new Set<string>();
  for (const ref of refs) {
    const byId = available.find((e) => e.id === ref || e.subject_id === ref || e.synth_id === ref || e.person_id === ref);
    const named = byId ? [] : available.filter((e) => same(e.name, ref));
    if (named.length > 1) { refused.push({ ref, ambiguous: true, line: `More than one cast member is called "${ref}". Pick the one you mean from the cast list.` }); continue; }
    const hit = byId ?? named[0];
    if (!hit) { refused.push({ ref, line: refusalFor(actor, ref) }); continue; }
    if (seen.has(hit.id)) continue;
    if (members.length >= MAX_CAST) { refused.push({ ref, line: `A cast can have at most ${MAX_CAST} members. Remove one and try again.` }); continue; }
    seen.add(hit.id);
    try {
      let synth: SynthRecord | null = null, subjectId = hit.subject_id;
      if (hit.synth_id) { synth = synthById(hit.synth_id); if (!synth) throw new Error("gone"); subjectId = await ensureSubject(synth); synth = synthById(hit.synth_id); }
      else if (hit.person_id && !subjectId) { const person = householdPeople().find((p) => p.id === hit.person_id); if (!person) throw new Error("gone"); subjectId = ensurePersonSubject(person).id; }
      const subject = subjectViewById(subjectId!); if (!subject) throw new Error("gone");
      const fresh = synth ? synthEntry(synth!) : hit.person_id ? memberEntry(householdPeople().find((p) => p.id === hit.person_id)!) : subjectEntry(subject);
      members.push({ ...fresh, subject_id: subject.id, subject, synth });
    } catch { refused.push({ ref, line: `${hit.name} could not be set up as cast. Try again in a moment.` }); }
  }
  return { members, refused };
}

// CREATOR-05: what a media tool does with its `cast` argument. The ids come from GET /api/cast (the model copies them from the structured `@` mentions or the
// list); every one goes through `resolveCast`, so a crafted id, an ambiguous name, someone the viewer may not cast, or more than six is refused with one plain line.
export type CastForTool = { ok: true; members: ResolvedCast[]; subjects: SubjectWithRefs[] } | { ok: false; line: string };
const NOT_IN_LIST = (ref: string) => `"${ref.slice(0, 80)}" is not in your cast list. Pick someone from the list and try again.`;
/** The `cast` argument as text refs. A non-text entry is kept as an empty ref so it is refused, never skipped. */
export function castRefsOf(args: Record<string, unknown>): string[] | null {
  if (args.cast === undefined || args.cast === null) return [];
  if (!Array.isArray(args.cast)) return null;
  return args.cast.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
}
export async function castForTool(actor: PersonRow, args: Record<string, unknown>): Promise<CastForTool> {
  const refs = castRefsOf(args);
  if (refs === null) return { ok: false, line: NOT_IN_LIST("cast") };
  if (!refs.length) return { ok: true, members: [], subjects: [] };
  if (refs.length > MAX_CAST) return { ok: false, line: `A cast can have at most ${MAX_CAST} members. Remove one and try again.` };
  const bad = refs.find((ref) => !ref || ref.length > 120);
  if (bad !== undefined) return { ok: false, line: NOT_IN_LIST(bad || "that") };
  const result = await resolveCast(actor, refs);
  if (result.refused.length) return { ok: false, line: result.refused[0]!.line };
  // The member's locked sentence is its look wherever a saved subject's look is used today.
  const loaded = loadSubjectReferences(actor, result.members.map((member) => ({ ...member.subject, look: member.locked_description?.trim() || member.subject.look })));
  if (!loaded) return { ok: false, line: `${result.members[0]?.name ?? "That cast member"}'s pictures could not be read. Try again in a moment.` };
  return { ok: true, members: result.members, subjects: loaded };
}
/** Saved-subject matches and cast matches as one list, each subject once. */
export function mergeSubjects(named: SubjectWithRefs[], cast: SubjectWithRefs[]): SubjectWithRefs[] {
  const seen = new Set(named.map((entry) => entry.subject.id));
  return [...named, ...cast.filter((entry) => !seen.has(entry.subject.id))];
}
/** The cast the composer sent as structured `@` mentions (type "cast"), kept only where the viewer may cast them (never trusted as sent). */
export function castMentionIds(actor: PersonRow, mentions: unknown): string[] {
  if (!Array.isArray(mentions)) return [];
  const allowed = new Set(listCast(actor).map((entry) => entry.id));
  const out: string[] = [];
  for (const item of mentions.slice(0, 12)) {
    const mention = item as { id?: unknown; type?: unknown } | null;
    if (!mention || mention.type !== "cast" || typeof mention.id !== "string" || !allowed.has(mention.id) || out.includes(mention.id)) continue;
    out.push(mention.id);
    if (out.length >= MAX_CAST) break;
  }
  return out;
}
