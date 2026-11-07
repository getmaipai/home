import { Synth, type Synth as SynthShape } from "@maipai/spec/gen/ts/synth.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";
import { listPackageIds, loadManifestOnly } from "@/lib/plugins";
import { getHouseholdCompanion, householdCompanionAuthorId, listHouseholdCompanionIds, copyBundledCompanion, copyHouseholdCompanion, createHouseholdCompanion, updateHouseholdCompanionSynth } from "@/lib/householdCompanions";
import { personaFromManifest, reloadPersonas, type Persona } from "@/lib/persona";
import { companionFloor } from "@/lib/robotCompanion";
import { mayUseCompanion, pickRefusal } from "@/lib/companionsApp";
import { getPersonSettingValue, getSettingValueForPerson, setValue } from "@/lib/settings";
import { canManage } from "@/lib/personLifecycle";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { nextHlc } from "@/lib/hlc";
import { registerCastSynthGate } from "@/lib/mediaProductions";

export type SynthRecord = SynthShape;
type Companion = NonNullable<PackageManifest["companion"]>;
export type SynthWriteResult = { ok: true; value: { id: string; manifest: PackageManifest; companion: Companion; synth: SynthRecord } } | { ok: false; status?: 400 | 403 | 404; error: string };
const synthCache = new Map<string, { signature: string; value: SynthRecord }>();

function manifestOf(id: string): PackageManifest | null {
  const household = getHouseholdCompanion(id);
  if (household) return household;
  const loaded = loadManifestOnly(id);
  return loaded.ok && loaded.value.kind === "companion" && loaded.value.companion ? loaded.value : null;
}
function ownerId(): string | null { return db.select({ id: people.id }).from(people).where(and(eq(people.role, "owner"), isNull(people.deletedAt))).get()?.id ?? null; }
function synthFor(manifest: PackageManifest, id: string): SynthRecord | null {
  if (!manifest.companion) return null;
  const now = new Date().toISOString();
  const raw = manifest.synth ?? { based_on: { kind: "none" as const, person_id: null, name: null, refresh: "7d" as const, minor: false }, life: { enabled: true, seed: "" }, subject_id: null, pins: { dials: [], examples: [] }, phrase_sources: {}, forked_from: null, private_to: null, owner_person_id: ownerId() ?? "person-unknown", provenance: "catalog:companion", created_at: now, updated_at: now, hlc: nextHlc() };
  const result = { id, persona: manifest.companion, ...raw };
  const parsed = (awaitSynthSchema()).safeParse(result);
  return parsed.success ? parsed.data : null;
}
function awaitSynthSchema() { return Synth; }
export function synthById(id: string): SynthRecord | null {
  const manifest = manifestOf(id);
  if (!manifest) { synthCache.delete(id); return null; }
  const signature = JSON.stringify(manifest), cached = synthCache.get(id);
  if (cached?.signature === signature) return cached.value;
  const value = synthFor(manifest, id);
  if (value) synthCache.set(id, { signature, value }); else synthCache.delete(id);
  return value;
}
export function synthPersona(synth: SynthRecord): Persona | null {
  const manifest = manifestOf(synth.id);
  if (!manifest) return null;
  return personaFromManifest(synth.id, { ...manifest, companion: synth.persona }, true);
}
export function synthFloor(synth: SynthRecord): AgeBand { return companionFloor(synth.persona.audience ?? "adult"); }
function personById(id: string): PersonRow | null { return db.select().from(people).where(and(eq(people.id, id), isNull(people.deletedAt))).get() ?? null; }
export function ownerActor(synth: SynthRecord): PersonRow | null {
  const person = personById(synth.owner_person_id);
  return person && person.enabled && !person.memorializedAt ? person : null;
}

// THE one gate (architect, 2026-11-07): applies companion use, private fork oversight, and the two subject consent settings.
export function maySeeSynth(actor: PersonRow, synth: SynthRecord, now = new Date()): boolean {
  const persona = synthPersona(synth);
  if (!persona || !mayUseCompanion(actor, persona)) return false;
  if (synth.private_to && synth.private_to !== actor.id) {
    const privateOwner = personById(synth.private_to);
    if (!privateOwner || !canManage(actor, privateOwner) || speakerAgeBand(privateOwner, now) === "adult") return false;
  }
  if (synth.based_on.kind === "household_member" && synth.based_on.person_id) {
    if (getSettingValueForPerson(synth.based_on.person_id, "synths.of_me") === false) return false;
  }
  if (synth.based_on.kind === "real_person" && speakerAgeBand(actor, now) !== "adult") {
    // A child or teen reaches a real-person synth only at "all", or at "ask" once a parent's yes put the id in the lasting-yes list.
    const mode = getPersonSettingValue(actor, "synths.real_people");
    if (mode === "all") return true;
    if (mode !== "ask") return false;
    const allowed = getPersonSettingValue(actor, "synths.real_people_allowed");
    return Array.isArray(allowed) && allowed.includes(synth.id);
  }
  return true;
}
export function getSynth(actor: PersonRow, id: string): SynthRecord | null {
  const synth = synthById(id);
  return synth && maySeeSynth(actor, synth) ? synth : null;
}
export function listSynths(actor: PersonRow): SynthRecord[] {
  return [...new Set([...listPackageIds(), ...listHouseholdCompanionIds()])]
    .map((id) => synthById(id)).filter((synth): synth is SynthRecord => !!synth && maySeeSynth(actor, synth))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
function deniedUse(actor: PersonRow, synth: SynthRecord): string {
  const base = synthPersona(synth);
  return (base && pickRefusal(actor, base)) || "You cannot use this companion. Ask a parent or admin to check its settings.";
}
function stampSynth(id: string, persona: Companion, base: Partial<Synth>, owner: string, provenance: string): SynthRecord {
  const now = new Date().toISOString();
  return Synth.parse({ id, persona, based_on: base.based_on ?? { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: base.life ?? { enabled: true, seed: "" }, subject_id: base.subject_id ?? null, pins: base.pins ?? { dials: [], examples: [] }, phrase_sources: base.phrase_sources ?? {}, forked_from: base.forked_from ?? null, private_to: base.private_to ?? null, owner_person_id: owner, provenance, created_at: base.created_at ?? now, updated_at: now, hlc: nextHlc() });
}
function synthBlock(synth: SynthRecord): NonNullable<PackageManifest["synth"]> { const { id: _id, persona: _persona, ...block } = synth; return block; }
export async function createSynth(actor: PersonRow, input: { persona: Companion; based_on: Synth["based_on"]; life: Synth["life"] }): Promise<SynthWriteResult> {
  if (speakerAgeBand(actor, new Date()) !== "adult" && input.based_on.kind !== "none") return { ok: false, status: 403, error: "Only an adult can base a synth on a real person. Make an invented one instead." };
  if (input.based_on.kind === "household_member" && input.based_on.person_id) {
    const member = personById(input.based_on.person_id);
    if (member && getSettingValueForPerson(member.id, "synths.of_me") === false) return { ok: false, status: 403, error: `${member.displayName} has turned off synths of them.` };
  }
  const persona = { ...input.persona, status: input.persona.status ?? "ready", audience: input.based_on.kind === "real_person" ? input.persona.audience ?? "adult" : input.persona.audience };
  const synth = stampSynth("hc-pending", persona, { based_on: input.based_on, life: { ...input.life, enabled: input.based_on.kind === "none" && input.life.enabled }, private_to: null, forked_from: null }, actor.id, "home:synth");
  const made = createHouseholdCompanion(persona, { display_name: actor.displayName, person_id: actor.id }, persona.audience ?? "adult", { synth: synthBlock(synth), companion: { audience: persona.audience ?? "adult", status: persona.status ?? "ready" } });
  if (!made.ok || !made.value.companion) return { ok: false, status: 400, error: made.ok ? "The synth could not be saved. Check its fields and try again." : made.error };
  const saved = synthFor(made.value, made.value.id);
  reloadPersonas();
  if (saved?.life.enabled) {
    const { writeOrigin } = await import("@/lib/talent/life");
    await writeOrigin(saved, actor);
  }
  return saved ? { ok: true, value: { id: made.value.id, manifest: made.value, companion: made.value.companion, synth: saved } } : { ok: false, status: 400, error: "The synth could not be saved. Check its fields and try again." };
}
export function updateSynth(actor: PersonRow, id: string, patch: Partial<Pick<SynthRecord, "persona" | "based_on" | "life" | "subject_id">>): SynthWriteResult {
  const current = synthById(id), manifest = manifestOf(id);
  if (!current || !manifest?.companion) return { ok: false, status: 404, error: "That synth could not be found. Check its ID and try again." };
  if (current.owner_person_id !== actor.id && actor.role !== "owner" && actor.role !== "admin") return { ok: false, status: 403, error: "Only the synth's maker or an admin can change it." };
  const next = stampSynth(id, patch.persona ?? current.persona, { ...current, ...patch, based_on: patch.based_on ?? current.based_on, life: patch.life ?? current.life }, current.owner_person_id, current.provenance);
  const result = updateHouseholdCompanionSynth(id, synthBlock(next), next.persona);
  return result.ok && result.value.companion ? { ok: true, value: { id, manifest: result.value, companion: result.value.companion, synth: next } } : { ok: false, status: 400, error: result.ok ? "The synth could not be saved. Check its fields and try again." : result.error };
}
export function forkSynth(actor: PersonRow, baseId: string): SynthWriteResult {
  const base = synthById(baseId);
  if (!base || !maySeeSynth(actor, base)) return { ok: false, status: 404, error: base ? deniedUse(actor, base) : "That synth could not be found. Check its ID and try again." };
  const author = { display_name: actor.displayName, person_id: actor.id };
  const forked = getHouseholdCompanion(baseId) ? copyHouseholdCompanion(baseId, author, { keepAudience: true, keepStatus: true, copyLook: true, synth: { ...synthBlock(base), forked_from: baseId, private_to: actor.id, owner_person_id: actor.id, based_on: base.based_on, life: base.life, pins: base.pins, subject_id: null } }) : copyBundledCompanion(baseId, author, { keepAudience: true, keepStatus: true, copyLook: true, synth: { ...synthBlock(base), forked_from: baseId, private_to: actor.id, owner_person_id: actor.id, based_on: base.based_on, life: base.life, pins: base.pins, subject_id: null } });
  if (!forked.ok) return { ok: false, status: 400, error: forked.error };
  if (!forked.value.companion) return { ok: false, status: 400, error: "The synth copy has no companion profile. Check the source and try again." };
  const synth = synthFor(forked.value, forked.value.id);
  if (!synth) return { ok: false, status: 400, error: "The synth copy could not be read. Try again." };
  synthCache.set(synth.id, { signature: JSON.stringify(forked.value), value: synth });
  reloadPersonas();
  const picked = setValue(actor, `person:${actor.id}`, "persona.active_id", synth.id);
  if (!picked.ok) return { ok: false, status: 400, error: `The synth was forked, but could not be selected. ${picked.error} Choose it again from your companions.` };
  return { ok: true, value: { id: synth.id, manifest: forked.value, companion: forked.value.companion, synth } };
}
export function shareFork(actor: PersonRow, id: string): SynthWriteResult {
  const current = synthById(id), manifest = manifestOf(id);
  if (!current || !manifest?.companion) return { ok: false, status: 404, error: "That synth could not be found. Check its ID and try again." };
  if (!maySeeSynth(actor, current)) return { ok: false, status: 404, error: "That synth could not be found. Check its ID and try again." };
  if (!current.forked_from) return { ok: false, status: 400, error: "Only a private fork can be shared. Fork a synth first." };
  const target = personById(current.owner_person_id);
  if (actor.id !== current.owner_person_id && !(target && canManage(actor, target) && speakerAgeBand(target, new Date()) !== "adult")) return { ok: false, status: 403, error: "Only the fork's owner or a manager of its minor owner can share it." };
  const next = stampSynth(id, current.persona, { ...current, private_to: null }, current.owner_person_id, current.provenance);
  const result = updateHouseholdCompanionSynth(id, synthBlock(next));
  return result.ok && result.value.companion ? { ok: true, value: { id, manifest: result.value, companion: result.value.companion, synth: next } } : { ok: false, status: 400, error: result.ok ? "The synth could not be saved. Check its fields and try again." : result.error };
}
export function isCompanionFork(id: string): boolean {
  const synth = synthById(id);
  if (!synth?.forked_from) return false;
  return db.select().from(people).where(isNull(people.deletedAt)).all().some((person) => getPersonSettingValue(person, "persona.active_id") === id);
}

// A production may cast a synth's subject when the actor may use the synth (TALENT-02; mediaProductions.ts never imports this module).
registerCastSynthGate((actor, synthId, subjectId) => { const synth = synthById(synthId); return !!synth && maySeeSynth(actor, synth) && synth.subject_id === subjectId; });
