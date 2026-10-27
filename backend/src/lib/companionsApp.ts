// COMPANIONS-APP-01 (docs/design/companions-app-2026-10-21.md): what the Companions app shows about each companion, and who may see
// or pick it. The catalog is `PERSONAS` plus each companion package's manifest; nothing here is stored. The age rule is the robot
// rule's own (`companionFits`): a child sees child companions, a teen child and teen, an adult all.
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { conversations, people } from "@/db/schema";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { listDevicesByKind } from "@/lib/devices";
import { loadManifestOnly } from "@/lib/plugins";
import { PERSONAS, resolvePersona, type Persona } from "@/lib/persona";
import { companionFits, robotCompanionOf, robotControlsOf } from "@/lib/robotCompanion";
import { companionsAllowed } from "@/lib/companions";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { getHouseholdCompanion, householdCompanionAuthorId, listHouseholdCompanionIds } from "@/lib/householdCompanions";
import type { PersonRow } from "@/types";
import { readLook } from "@/lib/companionLook";

const FORMALITY: Record<Persona["formality"], string> = {
  casual: "Talks like a friend.",
  neutral: "Plain and polite.",
  formal: "Careful and proper.",
};
const COMPLEXITY: Record<Persona["complexity"], string> = {
  simple: "Short, simple words.",
  standard: "Everyday words.",
  advanced: "Rich, detailed words.",
};
const ENGAGEMENT: Record<Persona["engagement"], string> = {
  brief: "Keeps it short and moves on.",
  balanced: "Asks a follow-up now and then.",
  curious: "Asks you things back and wants to know more.",
};
const FILLER: Record<Persona["filler_density"], string> = {
  none: "No filler words.",
  light: "A few casual words, like \"honestly\".",
  frequent: "Lots of casual chatter.",
};

// DYNAMIC-COMPANION-01: an "all" companion adapts to whoever it speaks to; only a teen or adult companion is a type of its own.
const TYPE_LABEL: Record<Persona["audience"], string> = { all: "Companion for everyone", teen: "Teen companion", adult: "Adult companion" };
const WHO_CAN_USE: Record<AgeBand, string> = {
  child: "Anyone in the family, including kids. It adapts to their age.",
  teen: "Teens and adults.",
  adult: "Adults only.",
};

export interface Dial { label: string; value: string }
export interface CompanionCard {
  id: string;
  name: string;
  type: AgeBand;
  type_label: string;
  tagline: string;
  who_can_use: string;
  dials: Dial[];
  voice: string;
  is_default: boolean;
  is_household: boolean;
  portrait: string | null;
  status: string;
  chats: number;
}
export interface CompanionDetail extends CompanionCard {
  about: string;
  pronouns: string | null;
  interests: string[];
  examples: string[];
  /** The voice setting the page plays and shows: the companion's own voice, else the one this person hears. */
  voice_value: string;
  voice_is_own: boolean;
  /** Admins only: the household voice setting for this companion ("default" when none). */
  voice_setting: string | null;
  /** Admins only: the people and robots using this companion. */
  used_by: { people: Array<{ id: string; name: string }>; robots: Array<{ id: string; name: string }> } | null;
}

function dialsOf(persona: Persona): Dial[] {
  return [
    { label: "How it talks", value: FORMALITY[persona.formality] },
    { label: "Word choice", value: COMPLEXITY[persona.complexity] },
    { label: "Questions back", value: ENGAGEMENT[persona.engagement] },
    { label: "Casual chatter", value: FILLER[persona.filler_density] },
  ];
}

function manifestOf(id: string) {
  const loaded = loadManifestOnly(id);
  return loaded.ok && loaded.value.kind === "companion" ? loaded.value : getHouseholdCompanion(id);
}

/** The person's chosen companion id. A choice the person's type no longer allows reads as the plain default, like the turn does. */
export function currentCompanionId(person: PersonRow): string {
  const band = speakerAgeBand(person, new Date());
  const picked = resolvePersona(getPersonSettingValue(person, "persona.active_id"));
  return companionFits(band, picked.floor) ? picked.id : "default";
}

/** Whether this person may see and pick this companion. */
export function mayUseCompanion(person: PersonRow, persona: Persona): boolean {
  return companionAreaOn(person) && companionFits(speakerAgeBand(person, new Date()), persona.floor);
}

/** The household switch that turns companions off for a person (`companions.allowed`). */
export function companionAreaOn(person: PersonRow): boolean {
  return companionsAllowed(person.id);
}

/** Whether this signed-in person may create a household companion draft. */
export function canCreateCompanion(person: PersonRow, admin = false): boolean {
  return admin || speakerAgeBand(person, new Date()) === "adult";
}

function voiceLabel(value: string, own: boolean): string {
  if (own) return `Its own voice (${value})`;
  return "The voice you chose in Settings";
}

export function cardOf(person: PersonRow, persona: Persona): CompanionCard {
  const manifest = manifestOf(persona.id);
  const household = Boolean(getHouseholdCompanion(persona.id));
  const look = household ? readLook(persona.id) : null;
  const portrait = look?.rest && look.versions.some((version) => version.id === look.rest) ? `${persona.id}/${look.rest}` : null;
  const own = Boolean(manifest?.companion?.voice_id);
  const isDefault = currentCompanionId(person) === persona.id;
  const ownChats = db.select().from(conversations).where(and(eq(conversations.personId, person.id), ne(conversations.status, "deleted"))).all();
  const chats = ownChats.filter((conversation) => conversation.companionId === persona.id || (isDefault && conversation.companionId === null)).length;
  return {
    id: persona.id,
    name: persona.display_name,
    type: persona.floor,
    type_label: TYPE_LABEL[persona.audience],
    tagline: manifest?.companion?.tagline ?? manifest?.description ?? "",
    who_can_use: WHO_CAN_USE[persona.floor],
    dials: dialsOf(persona),
    voice: voiceLabel(manifest?.companion?.voice_id ?? "", own),
    is_default: isDefault,
    chats,
    is_household: household,
    portrait,
    status: manifest?.companion?.status ?? "ready",
  };
}

export function listCompanionCards(person: PersonRow, admin = false): CompanionCard[] {
  if (!companionAreaOn(person)) return [];
  const usable = PERSONAS.filter((persona) => mayUseCompanion(person, persona));
  const stored = getPersonSettingValue(person, "companions.enabled");
  const held = Array.isArray(stored) && stored.every((id) => typeof id === "string") ? new Set(stored) : new Set(usable.map((persona) => persona.id));
  const defaultId = currentCompanionId(person);
  held.add(defaultId);
  held.add("default");
  for (const id of listHouseholdCompanionIds()) {
    const household = getHouseholdCompanion(id);
    if (household?.companion && householdCompanionAuthorId(id) === person.id) held.add(id);
  }
  const cards = usable.filter((persona) => held.has(persona.id)).map((persona) => cardOf(person, persona));
  const seen = new Set(cards.map((card) => card.id));
  if (admin || speakerAgeBand(person, new Date()) === "adult") {
    for (const id of listHouseholdCompanionIds()) {
      if (seen.has(id)) continue;
      const manifest = getHouseholdCompanion(id);
      if (!manifest?.companion || manifest.companion.status !== "draft" || seen.has(id)) continue;
      if (!admin && householdCompanionAuthorId(id) !== person.id) continue;
      const c = manifest.companion;
      cards.push({ id, name: c.display_name, type: "adult", type_label: TYPE_LABEL.adult, tagline: c.tagline ?? "", who_can_use: WHO_CAN_USE.adult,
        dials: [{ label: "How it talks", value: FORMALITY[c.formality] }, { label: "Word choice", value: COMPLEXITY[c.complexity] }, { label: "Questions back", value: ENGAGEMENT[c.engagement] }, { label: "Casual chatter", value: FILLER[c.filler_density] }],
        voice: voiceLabel(c.voice_id ?? "", Boolean(c.voice_id)), is_default: false, is_household: true, portrait: null, status: "draft", chats: 0 });
    }
  }
  return cards;
}

/** Companion ids this person currently holds, materializing the legacy unset state as all usable ids. */
export function heldCompanionIds(person: PersonRow): string[] {
  return listCompanionCards(person).map((card) => card.id);
}

/** Companion cards available to add, excluding the person's held set. */
export function discoverCompanionCards(person: PersonRow): CompanionCard[] {
  if (speakerAgeBand(person, new Date()) === "child" || !companionAreaOn(person)) return [];
  const held = new Set(heldCompanionIds(person));
  const cards = PERSONAS.filter((persona) => mayUseCompanion(person, persona) && !held.has(persona.id)).map((persona) => cardOf(person, persona));
  for (const id of listHouseholdCompanionIds()) {
    if (held.has(id)) continue;
    const manifest = getHouseholdCompanion(id)?.companion;
    if (!manifest || manifest.status !== "ready") continue;
    const persona = PERSONAS.find((candidate) => candidate.id === id);
    if (!persona || !mayUseCompanion(person, persona)) continue;
    cards.push(cardOf(person, persona));
  }
  return cards;
}

export function companionDetail(person: PersonRow, persona: Persona, admin: boolean): CompanionDetail {
  const manifest = manifestOf(persona.id);
  const spec = manifest?.companion;
  const chosen = getHouseholdSettingValue(companionVoiceKey(persona.id));
  const householdVoice = typeof chosen === "string" && chosen && chosen !== "default" ? chosen : null;
  const ownVoice = householdVoice ?? spec?.voice_id ?? undefined;
  const voiceValue = voiceForSpeech({ actor: person, ...(ownVoice ? { companionVoice: ownVoice } : {}) });
  return {
    ...cardOf(person, persona),
    about: spec?.backstory ?? manifest?.description ?? "",
    pronouns: spec?.pronouns ?? null,
    interests: [...(spec?.interests ?? [])],
    examples: [...(persona.examples ?? [])],
    voice_value: voiceValue,
    voice_is_own: Boolean(ownVoice),
    voice_setting: admin ? householdVoice ?? "default" : null,
    used_by: admin ? usersOf(persona.id) : null,
  };
}

function usersOf(companionId: string): NonNullable<CompanionDetail["used_by"]> {
  const rows = db.select().from(people).where(isNull(people.deletedAt)).all() as PersonRow[];
  const named = rows.filter((row) => currentCompanionId(row) === companionId).map((row) => ({ id: row.id, name: row.displayName }));
  const robots = listDevicesByKind("robot").filter((device) => robotCompanionOf(device.id)?.id === companionId).map((device) => ({ id: device.id, name: device.name }));
  return { people: named, robots };
}

/** Admins only: each robot, its controls and its companion, for the page's Robots panel. */
export function robotAssignments(): Array<{ id: string; name: string; controls: AgeBand; companion_id: string; companion_name: string | null }> {
  return listDevicesByKind("robot").map((device) => {
    const companion = robotCompanionOf(device.id);
    return { id: device.id, name: device.name, controls: robotControlsOf(device.id), companion_id: companion?.id ?? "", companion_name: companion?.name ?? null };
  });
}

/** A plain refusal when this person may not pick this companion, else null. */
export function pickRefusal(person: PersonRow, persona: Persona): string | null {
  if (!companionAreaOn(person)) return "Companions are turned off for you. Ask an owner or admin to turn them on.";
  if (!companionFits(speakerAgeBand(person, new Date()), persona.floor)) {
    return `${persona.display_name} is a ${persona.audience} companion and is not one you can pick. Choose one from your list.`;
  }
  return null;
}

/** The settings writer's check for `persona.active_id`: the companion must fit the type of the person whose setting it is, whoever writes
 * it. A plain refusal, or null. */
export function personaWriteRefusal(scope: string, value: unknown): string | null {
  const match = /^person:([a-z0-9-]+)$/.exec(scope);
  if (!match || typeof value !== "string") return null;
  const persona = PERSONAS.find((candidate) => candidate.id === value);
  const target = db.select().from(people).where(eq(people.id, match[1]!)).get() as PersonRow | undefined;
  if (!persona || !target) return null;
  return companionFits(speakerAgeBand(target, new Date()), persona.floor) ? null : pickRefusal(target, persona);
}
