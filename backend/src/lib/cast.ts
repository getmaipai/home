// CREATOR-04 (docs/design/creatoros-port-2026-11-13.md section 6): the one cast resolver. A cast member is a synth or a saved subject seen
// through this one function: `listCast` is what the viewer may cast (GET /api/cast), `resolveCast` turns ids or names into everything a feature needs.
// Rulings applied as written, nothing new: a synth is governed by `maySeeSynth` (companion use, `synths.of_me`, `synths.real_people`); adults may cast
// any household member, and casting one creates no synth; a child or teen is
// refused a real subject; `real` and the minor fact are derived at read time (`subjectFacts`).
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { ensureSubject, listSynths, synthById, synthFloor, type SynthRecord } from "@/lib/synths";
import { ensurePersonSubject, isSheetReference, listMediaSubjects, loadSubjectReferences, subjectFacts, subjectRowForPerson, subjectViewById, type MediaSubject, type SubjectWithRefs } from "@/lib/mediaSubjects";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { readCompanionPack } from "@/lib/companionPack";
import { lookSheetState } from "@/lib/castLookKey";
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
  look: { description: string; sheet_file_id: string | null; /** CREATOR-06: the sheet was built from pictures that have since changed; `captureLook` rebuilds it. */ sheet_stale: boolean; medium: "photo" | "stylised" | null };
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
/** Who is casting: the account and the turn's own band (speaker, surface, device). The strictest of the two decides, so an adult account on a turn a child
 *  speaks (a robot, a satellite) casts like that child. `gate` is the actor the synth gate sees: the account, or the account at the turn's lower band. */
interface CastViewer { actor: PersonRow; minor: boolean; turnOnly: boolean; gate: PersonRow }
function viewerOf(actor: PersonRow, band?: AgeBand | null): CastViewer {
  const accountMinor = isMinorBand(actor), turnMinor = !!band && band !== "adult";
  const turnOnly = turnMinor && !accountMinor;
  return { actor, minor: accountMinor || turnMinor, turnOnly, gate: turnOnly ? { ...actor, role: band as "child" | "teen" } : actor };
}
export const REAL_REFUSED_LINE = "Real-person subjects are not available for this profile yet. Ask a parent or admin if you need one.";

function refFiles(subject: MediaSubject | null) {
  const rows = (subject?.reference_ids ?? []).map((id) => db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).get()).filter((row): row is NonNullable<typeof row> => !!row);
  const sheet = [...rows].reverse().find((row) => isSheetReference(row.provenance));
  const plain = rows.find((row) => !isSheetReference(row.provenance));
  return { sheetId: sheet?.id ?? null, firstId: plain?.id ?? null, adultOnly: rows.some((row) => row.provenance.includes('"audience":"adult-only"')) };
}
const staleOf = (subject: MediaSubject | null, sheetId: string | null) => !!subject && !!sheetId && lookSheetState(subject.id).stale;
function synthEntry(synth: SynthRecord): CastEntry {
  const subject = synth.subject_id ? subjectViewById(synth.subject_id) : null;
  const files = refFiles(subject), facts = subjectFacts({ real: false, synthId: synth.id, personId: null });
  const source = readCompanionPack(synth.id)?.provenance as { source?: string } | undefined;
  const rest = (synth.persona as { animation?: { sheet?: { rest?: string } } }).animation?.sheet?.rest;
  return {
    id: subject?.id ?? synth.id, kind: "synth", subject_kind: "character", name: synth.persona.display_name, subject_id: subject?.id ?? null, synth_id: synth.id, person_id: null,
    look: { description: subject?.look ?? synth.persona.look_prompt ?? synth.persona.display_name, sheet_file_id: files.sheetId, sheet_stale: staleOf(subject, files.sheetId), medium: source?.source ? (source.source === "photo" ? "photo" : "stylised") : null },
    locked_description: subject?.locked_description ?? null, voice: subject?.voice ?? synth.persona.voice_id ?? null,
    avatar: { url: rest ? `/api/companions/${encodeURIComponent(synth.id)}/animation/${encodeURIComponent(rest)}` : null, seed: synth.id },
    real: facts.real, minor: facts.minor || (subject?.minor ?? false), audience: synthFloor(synth) === "adult" || files.adultOnly ? "adult-only" : "all-ages",
  };
}
function subjectEntry(subject: MediaSubject): CastEntry {
  const files = refFiles(subject);
  return {
    id: subject.id, kind: "subject", subject_kind: subject.kind, name: subject.name, subject_id: subject.id, synth_id: null, person_id: null,
    look: { description: subject.look, sheet_file_id: files.sheetId, sheet_stale: staleOf(subject, files.sheetId), medium: null }, locked_description: subject.locked_description, voice: subject.voice,
    avatar: { url: files.sheetId ?? files.firstId ? `/api/files/${files.firstId ?? files.sheetId}/content` : null, seed: null },
    real: subject.real, minor: subject.minor, audience: files.adultOnly ? "adult-only" : "all-ages",
  };
}
function memberEntry(person: PersonRow): CastEntry {
  const row = subjectRowForPerson(person.id), subject = row ? subjectViewById(row.id) : null, files = refFiles(subject);
  const facts = subjectFacts({ real: false, synthId: null, personId: person.id });
  return {
    id: subject?.id ?? person.id, kind: "member", subject_kind: "character", name: person.displayName, subject_id: subject?.id ?? null, synth_id: null, person_id: person.id,
    look: { description: subject?.look ?? person.displayName, sheet_file_id: facts.minor ? null : files.sheetId, sheet_stale: !facts.minor && staleOf(subject, files.sheetId), medium: "photo" }, locked_description: subject?.locked_description ?? null, voice: subject?.voice ?? null,
    avatar: { url: null, seed: person.avatarSeed }, real: facts.real, minor: facts.minor, audience: files.adultOnly ? "adult-only" : "all-ages",
  };
}
function householdPeople(): PersonRow[] { return db.select().from(people).where(and(isNull(people.deletedAt), eq(people.enabled, true))).all().filter((p) => p.role !== "guest" && !p.memorializedAt); }

/** What this viewer may cast: synths (the synth gate, band filtering included), saved subjects, and household members (adults only). */
export function listCast(actor: PersonRow, band?: AgeBand | null): CastEntry[] {
  if (actor.role === "guest") return [];
  const viewer = viewerOf(actor, band), minorViewer = viewer.minor;
  const entries: CastEntry[] = [];
  for (const synth of listSynths(viewer.gate)) {
    // An adult account on a minor's turn never reaches a likeness of a real person or a household member, whatever the account's own settings say.
    if (viewer.turnOnly && (synth.based_on.kind === "real_person" || synth.based_on.kind === "household_member")) continue;
    const entry = synthEntry(synth);
    if (viewer.turnOnly && entry.real) continue;
    entries.push(entry);
  }
  for (const subject of listMediaSubjects(actor)) {
    if (subject.synth_id || subject.person_id) continue;
    if (subject.real && minorViewer) continue;
    entries.push(subjectEntry(subject));
  }
  if (!minorViewer) for (const person of householdPeople()) entries.push(memberEntry(person));
  return minorViewer ? entries.filter((e) => e.audience !== "adult-only") : entries; // filtered, not labelled: an adult-only entry never reaches a minor
}
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.trim().toLocaleLowerCase();
function refusalFor(viewer: CastViewer, ref: string): string {
  const { actor } = viewer;
  const person = householdPeople().find((p) => p.id === ref || same(p.displayName, ref));
  if (person && person.id !== actor.id && viewer.minor) return REAL_REFUSED_LINE;
  return `"${ref}" is not in your cast list. Pick someone from the list and try again.`;
}
export interface CastContext { band?: AgeBand | null; temporary?: boolean }
export const TEMPORARY_CAST_LINE = "A temporary chat does not save anything, so someone new cannot be added to the cast here. Ask in a normal chat, or pick someone already saved.";
/** Ids or names to cast members, every one checked against what the viewer may cast (the turn's band counts, see `viewerOf`). The first cast of a synth or a
 *  household member makes its subject, but only after every ref has passed every gate: a refused call, and a temporary chat, write no row. */
export async function resolveCast(actor: PersonRow, refs: string[], context: CastContext = {}): Promise<CastResult> {
  const viewer = viewerOf(actor, context.band);
  const available = listCast(actor, context.band), refused: CastResult["refused"] = [], seen = new Set<string>(), hits: CastEntry[] = [];
  for (const ref of refs) {
    const byId = available.find((e) => e.id === ref || e.subject_id === ref || e.synth_id === ref || e.person_id === ref);
    const named = byId ? [] : available.filter((e) => same(e.name, ref));
    if (named.length > 1) { refused.push({ ref, ambiguous: true, line: `More than one cast member is called "${ref}". Pick the one you mean from the cast list.` }); continue; }
    const hit = byId ?? named[0];
    if (!hit) { refused.push({ ref, line: refusalFor(viewer, ref) }); continue; }
    if (seen.has(hit.id)) continue;
    if (hits.length >= MAX_CAST) { refused.push({ ref, line: `A cast can have at most ${MAX_CAST} members. Remove one and try again.` }); continue; }
    if (context.temporary === true && (hit.synth_id || hit.person_id) && !hit.subject_id) { refused.push({ ref, line: TEMPORARY_CAST_LINE }); continue; }
    seen.add(hit.id);
    hits.push(hit);
  }
  if (refused.length) return { members: [], refused }; // nothing is set up for a call that is refused
  const members: ResolvedCast[] = [];
  for (const hit of hits) {
    try {
      let synth: SynthRecord | null = null, subjectId = hit.subject_id;
      if (hit.synth_id) { synth = synthById(hit.synth_id); if (!synth) throw new Error("gone"); subjectId = await ensureSubject(synth); synth = synthById(hit.synth_id); }
      else if (hit.person_id && !subjectId) { const person = householdPeople().find((p) => p.id === hit.person_id); if (!person) throw new Error("gone"); subjectId = ensurePersonSubject(person).id; }
      const subject = subjectViewById(subjectId!); if (!subject) throw new Error("gone");
      const fresh = synth ? synthEntry(synth!) : hit.person_id ? memberEntry(householdPeople().find((p) => p.id === hit.person_id)!) : subjectEntry(subject);
      members.push({ ...fresh, subject_id: subject.id, subject, synth });
    } catch { refused.push({ ref: hit.id, line: `${hit.name} could not be set up as cast. Try again in a moment.` }); }
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
export async function castForTool(actor: PersonRow, args: Record<string, unknown>, context: CastContext = {}): Promise<CastForTool> {
  const refs = castRefsOf(args);
  if (refs === null) return { ok: false, line: NOT_IN_LIST("cast") };
  if (!refs.length) return { ok: true, members: [], subjects: [] };
  if (refs.length > MAX_CAST) return { ok: false, line: `A cast can have at most ${MAX_CAST} members. Remove one and try again.` };
  const bad = refs.find((ref) => !ref || ref.length > 120);
  if (bad !== undefined) return { ok: false, line: NOT_IN_LIST(bad || "that") };
  const result = await resolveCast(actor, refs, context);
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
/** Where a turn's `@` mentions may be used: a written chat turn of the person's own, never spoken, robot, satellite or shared screens, never a temporary chat. */
export interface MentionContext extends CastContext { surface?: string; spoken?: boolean; written?: boolean }
export function mentionsAllowed(context: MentionContext): boolean {
  return context.surface === "chat" && context.spoken !== true && context.temporary !== true && context.written !== false;
}
/** Picked cast ids kept only where mentions are allowed and the viewer (the turn's band counts) may cast them. */
export function keepCastIds(actor: PersonRow, ids: readonly string[], context: MentionContext): string[] {
  if (!mentionsAllowed(context)) return [];
  const allowed = new Set(listCast(actor, context.band).map((entry) => entry.id));
  return ids.filter((id, at) => allowed.has(id) && ids.indexOf(id) === at).slice(0, MAX_CAST);
}
/** The cast the composer sent as structured `@` mentions (type "cast"), kept only where the viewer may cast them (never trusted as sent) and only on a written chat turn. */
export function castMentionIds(actor: PersonRow, mentions: unknown, context: MentionContext = { surface: "chat" }): string[] {
  if (!Array.isArray(mentions) || !mentionsAllowed(context)) return [];
  const ids: string[] = [];
  for (const item of mentions.slice(0, 12)) {
    const mention = item as { id?: unknown; type?: unknown } | null;
    if (mention && mention.type === "cast" && typeof mention.id === "string") ids.push(mention.id);
  }
  return keepCastIds(actor, ids, context);
}
/** Whether any resolved member is adult-only: by its own entry (a synth's floor, its files) or by a reference file's mark. */
export function castIsAdultOnly(chosen: { members: ReadonlyArray<{ audience: string }>; subjects: ReadonlyArray<{ references: ReadonlyArray<{ audience: string }>; sheet?: { audience: string } | null }> }): boolean {
  return chosen.members.some((member) => member.audience === "adult-only") || chosen.subjects.some(({ references, sheet }) => [...references, ...(sheet ? [sheet] : [])].some((file) => file.audience === "adult-only"));
}
