// TIER-HOME-02: who may use which resource tier, in one place (docs/design/resource-tiers-2026-10-27.md sections 3a, 6, 10).
// AGE-ROUTING-REMOVE-01 (RULES.md C3, C7, E2, E6): nothing here is chosen by age. Boost, Max and thinking are access items of the person's pass
// (`tier.boost:<work>`, `tier.max:<work>`, `tier.max:*`, `thinking`): the role gives defaults, an admin's override or a grant changes them.
// The age and surface gates still run first and a tier never loosens them: a person whose lane (`laneOf`, the stricter of the turn's band and
// the made-content ceiling) is not the adult lane runs chat, music, voice and video at Standard until the Stack serves a minor's parts list (E6;
// Home writes no minors mark and compares no part id), and pictures at Standard on the child lane. A guest is Standard whatever their controls say.
import { TierSlot } from "@maipai/spec/gen/ts/tier-slot.js";
import vocab from "@maipai/spec/vocab/resource-tiers.json" with { type: "json" };
import { optionsForBand, checkTierSlotOptions, type TierOptionValue } from "@maipai/spec/records/ts/tierSlot.js";
import type { AgeBand } from "@/lib/ageBand";
import { passForBandDefaults, passForPerson, passForSurface } from "@/lib/filter/pass";
import { laneOf } from "@/lib/pictures/lane";
import { getHouseholdSettingSource, getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import { isOwnerOrAdmin } from "@/lib/access";
import { peekPictureEngineStatus } from "@/lib/pictures/ready";

export type Tier = "standard" | "boost" | "max";
export type TierCategory = "chat" | "image" | "video" | "music" | "voice";
export type TierWho = "everyone" | "assigned" | "admins";
/** Why a request was lowered: `no_boost_access` and `no_max_access` (the pass lacks the item), `no_minor_part` (a minor's lane runs Standard until the Stack serves a minor's parts list), `slot_off`, `not_for_this_person` (a guest, or the slot's Who can use it). */
export type TierNote = "no_max_access" | "no_boost_access" | "no_minor_part" | "slot_off" | "not_for_this_person";

const LADDER: readonly Tier[] = ["standard", "boost", "max"];
const ROLE_OF_CATEGORY: Record<TierCategory, string> = { chat: "chat", image: "image", video: "video", music: "music", voice: "tts" };
export const TIER_GRANT = "tier.max";
export const tierGrantFor = (category: TierCategory) => `tier.max:${category}`;
export const isTier = (value: unknown): value is Tier => value === "standard" || value === "boost" || value === "max";
export const slotKey = (category: TierCategory, tier: Tier | "reduced") => `engines.${ROLE_OF_CATEGORY[category]}.tier.${tier}`;

export interface SlotRecord { model: string; options: Record<string, TierOptionValue>; who: TierWho }

/** The slot's stored record with the tier's default `who`; an unreadable value reads as the default slot, never as a reason to allow more. */
export function readSlot(category: TierCategory, tier: Tier | "reduced"): SlotRecord {
  const fallback: SlotRecord = { model: tier === "reduced" ? "off" : "recommended", options: {}, who: vocab.who_default[tier] as TierWho };
  try {
    const parsed = TierSlot.safeParse(getHouseholdSettingValue(slotKey(category, tier)));
    if (!parsed.success || checkTierSlotOptions(category, parsed.data.options).length > 0) return fallback;
    return { model: parsed.data.model, options: parsed.data.options, who: parsed.data.who ?? fallback.who };
  } catch {
    return fallback;
  }
}

/** Set one slot's model (a catalog id, `recommended` or `off`), keeping its options and Who can use it. The one writer of a slot's model: the AI card, the setup wizard and the one-time copy of the old picture keys (tierSlotMigration.ts) all come here. */
export function writeSlotModel(category: TierCategory, tier: Tier, model: string): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  const slot = readSlot(category, tier);
  if (slot.model === model && getHouseholdSettingSource(slotKey(category, tier)) !== undefined) return { ok: true };
  const written = setHouseholdSettingValue(slotKey(category, tier), { model, options: slot.options, ...(getHouseholdSettingSource(slotKey(category, tier)) ? { who: slot.who } : {}) });
  return written.ok ? { ok: true } : { ok: false, status: written.status, error: written.error };
}

export const slotIsOff = (category: TierCategory, tier: Tier): boolean => tier !== "standard" && readSlot(category, tier).model === "off";

/** A person the pass can be read for; `controls` matters only for a guest (who never holds Max), so a caller holding only an id and role may leave it out. */
type AccessPerson = Pick<PersonRow, "id" | "role"> & Partial<Pick<PersonRow, "controls">>;
/** The access set a tier read uses: the person's own pass, or, with the turn's band, the pass of that surface (an unconfirmed speaker gets the surface band's defaults, design record 5a). */
function accessOf(person: AccessPerson, band?: AgeBand): ReadonlySet<string> {
  const actor = { id: person.id, role: person.role, controls: person.controls ?? null };
  return (band ? passForSurface({ actor, band }) : passForPerson(actor)).access;
}
export const boostItem = (category: TierCategory): string => `tier.boost:${category}`;
const accessHoldsMax = (access: ReadonlySet<string>, category: TierCategory): boolean => access.has(tierGrantFor(category)) || access.has("tier.max:*");

/** Whether the pass holds Max for this category: the role's own (an owner or admin), an admin's override or an allowed `tier.max` grant (`pass.ts` maps both onto the access items). A guest never holds Max. */
export function holdsMax(person: AccessPerson, category: TierCategory, band?: AgeBand): boolean {
  if (person.role === "guest") return false;
  return accessHoldsMax(accessOf(person, band), category);
}

export interface TierDeps {
  holdsMax: (category: TierCategory) => boolean;
  /** Whether the pass holds Boost for this category; a caller with no pass to read leaves it out (open). */
  holdsBoost?: (category: TierCategory) => boolean;
  slotOff: (category: TierCategory, tier: Tier) => boolean;
  who: (category: TierCategory, tier: Tier) => TierWho;
}

export interface TierChoice { tier: Tier; note: TierNote | null }

/** The tier a request actually runs at: the requested one, lowered by the lane (minor parts), the guest role, the pass's Boost and Max items, a switched-off slot and the slot's Who can use it. */
export function clampTier(input: { person: Pick<PersonRow, "id" | "role">; band: AgeBand; category: TierCategory; requested: Tier }, deps: TierDeps): TierChoice {
  const { band, category } = input;
  let tier = input.requested;
  let note: TierNote | null = null;
  const lower = (to: Tier, why: TierNote) => { if (LADDER.indexOf(to) < LADDER.indexOf(tier)) { tier = to; note ??= why; } };
  // E6: a level whose slot part is not on a minor's list is not offered to a minor. Home has no list (E1: it writes no minors mark, E2: it compares no part id),
  // so a minor's chat, music, voice and video run at Standard. Pictures keep today's teen picture lane; the child lane is Standard (kids lane, Quick only).
  const lane = laneOf({ actor: input.person as PersonRow, band });
  if (lane !== "adult" && !(category === "image" && lane === "teen")) lower("standard", "no_minor_part");
  if (input.person.role === "guest") lower("standard", "not_for_this_person");
  if (tier === "max" && !deps.holdsMax(category)) lower("boost", "no_max_access");
  if (tier === "boost" && deps.holdsBoost && !deps.holdsBoost(category)) lower("standard", "no_boost_access");
  while (tier !== "standard" && deps.slotOff(category, tier)) lower(LADDER[LADDER.indexOf(tier) - 1]!, "slot_off");
  const admin = isOwnerOrAdmin(input.person);
  // Max is opened by the pass alone (the slot's default `who` for Max is "admins" because the access starts with them); Boost follows its slot's `who`.
  while (tier === "boost") {
    const who = deps.who(category, tier);
    const allowed = who === "everyone" || admin || (who === "assigned" && deps.holdsMax(category));
    if (allowed) break;
    lower(LADDER[LADDER.indexOf(tier) - 1]!, "not_for_this_person");
  }
  return { tier, note };
}

/** `clampTier` against the pass of the surface the request came from (`band`, the turn's band; the person's own pass when a caller has none) and the household's slot records. */
export function authorizeTier(input: { person: PersonRow; category: TierCategory; requested: Tier; band?: AgeBand }): TierChoice {
  const band = input.band ?? passForPerson(input.person).band;
  const access = accessOf(input.person, band);
  return clampTier({ person: input.person, band, category: input.category, requested: input.requested }, {
    holdsMax: (category) => input.person.role !== "guest" && accessHoldsMax(access, category),
    holdsBoost: (category) => access.has(boostItem(category)),
    slotOff: slotIsOff,
    who: (category, tier) => readSlot(category, tier).who,
  });
}

/** What a slot's options are read against: a pass (its `access` holds `thinking` or not). A bare band stands for that band's role-default pass, for a caller that has no person (tests). */
export type SlotReader = Pick<ReturnType<typeof passForPerson>, "access"> | AgeBand;
const accessOfReader = (reader: SlotReader): ReadonlySet<string> => (typeof reader === "string" ? passForBandDefaults(reader).access : reader.access);

/** The highest level the reader's pass holds in this category (Max, Boost or Standard): the cap a job's saved slot is read under when the job is sent. */
export function tierCeiling(reader: SlotReader, category: TierCategory): Tier {
  const access = accessOfReader(reader);
  return accessHoldsMax(access, category) ? "max" : access.has(boostItem(category)) ? "boost" : "standard";
}

/** The options a slot runs with for this reader: a person whose pass lacks `thinking` never receives a thinking option (RULES.md C3, chat rules 2 and 8; the spec's minor defaults). */
export function slotOptionsFor(category: TierCategory, tier: Tier, reader: SlotReader): Record<string, TierOptionValue> {
  return optionsForBand(category, readSlot(category, tier).options, accessOfReader(reader).has("thinking") ? "adult" : "teen");
}

/** What a job queued at `requested` runs with right now (TIER-HOME-04): the saved slot's model and options. */
export interface SlotRun {
  /** The level it really runs at: a level whose slot is switched off is made at the level below it, down to Standard. */
  tier: Tier;
  lowered: boolean;
  /** The slot's model id; null when it is `recommended` (the resolver's own pick) or the level is Standard (Standard's model is the role's own choice). */
  model: string | null;
  options: Record<string, TierOptionValue>;
}

/**
 * The ONE place a saved slot record (`engines.<role>.tier.<tier>`) is turned into what a job runs with. Every category's Stack request is built from
 * this, read when the job is sent, so changing a level's model in the AI and models dialog changes the next job at that level and an `off` level
 * makes the job at Standard (the dialog's consequence text). Age gates ran before this and are not loosened: a person whose pass lacks `thinking` gets the options' defaults.
 */
export function slotRun(category: TierCategory, requested: Tier, reader: SlotReader): SlotRun {
  let tier = requested;
  while (tier !== "standard" && slotIsOff(category, tier)) tier = LADDER[LADDER.indexOf(tier) - 1]!;
  const slot = readSlot(category, tier);
  return { tier, lowered: tier !== requested, model: tier === "standard" || slot.model === "recommended" || slot.model === "off" ? null : slot.model, options: slotOptionsFor(category, tier, reader) };
}

/** Quick is Standard and Detailed is Boost. A person who may not use Boost here gets Quick, whatever was asked or the household default says. */
export function allowedQuality(person: PersonRow, category: TierCategory, quality: "quick" | "detailed", band?: AgeBand): "quick" | "detailed" {
  if (quality === "quick") return quality;
  return authorizeTier({ person, category, requested: "boost", ...(band ? { band } : {}) }).tier === "standard" ? "quick" : "detailed";
}

/** The Stack's recommended Max picture model (Stack catalog, `GET /stack/v1/tiers/candidates?category=pictures`): Max's `recommended` slot resolves to it while it is installed. */
export const RECOMMENDED_MAX_IMAGE_MODEL = "qwen-image-2512-q8";
const imageModelInstalled = (id: string): boolean => Boolean(peekPictureEngineStatus()?.models.find((m) => m.id === id && m.installed && m.available !== false));

/**
 * The model the Max slot resolves to, or null when Max does not exist on this computer: an admin pinned a model of its own, or (pictures only)
 * the slot is `recommended` and the Stack's recommended Max model is installed. A slot equal to Boost's model is not a Max.
 */
export function maxModel(category: TierCategory): string | null {
  const slot = readSlot(category, "max");
  if (slot.model === "off") return null;
  if (slot.model === "recommended") return category === "image" && imageModelInstalled(RECOMMENDED_MAX_IMAGE_MODEL) ? RECOMMENDED_MAX_IMAGE_MODEL : null;
  return slot.model === readSlot(category, "boost").model ? null : slot.model;
}
/** Max exists for a category only when its Max slot resolves to a model (`maxModel`); the recommended Max is empty until the evaluations fill it, except pictures with Qwen-Image installed. */
export function maxAvailable(category: TierCategory, capabilityFits?: boolean): boolean {
  if (capabilityFits === false) return false;
  return maxModel(category) !== null;
}
/** The chat Reduced switch (`engines.chat.tier.reduced`); off is its default. */
export const chatMayGoReduced = (): boolean => readSlot("chat", "reduced").model !== "off";
/** Whether this person is shown a Max control on a card: they hold Max, their band reaches it, the slot is on and a Max model exists. */
export function maxOffered(person: PersonRow, category: TierCategory, band?: AgeBand, available: boolean = maxAvailable(category)): boolean {
  return available && authorizeTier({ person, category, requested: "max", ...(band ? { band } : {}) }).tier === "max";
}
/**
 * The tier a generating job is queued at (TIER-WIRE-01): the allowed tier `tierArgument` returned, kept only when the job really runs the better
 * maker (a Quick result is Standard) and Max only when a Max model exists here (otherwise the job runs at Boost, as the line told the person).
 * The household queue reads it from `request.tier`; nothing here loosens an age or surface gate.
 */
export function jobTier(category: TierCategory, tier: Tier | undefined, quality: "quick" | "detailed"): Tier {
  if (!tier || tier === "standard" || quality === "quick") return "standard";
  return tier === "max" && !maxAvailable(category) ? "boost" : tier;
}

export const MAX_NEEDS_ADMIN_LINE = "Max needs an admin's OK. Ask an admin.";
/** TIER-REDUCED-01: a Max job whose peak needs the room chat holds, while the "Let big jobs simplify chat" switch is off. */
export const MAX_NEEDS_REDUCED_OFF_LINE = "Max would need to simplify chat, which is switched off, so this one is made at Boost.";
export const MAX_NOT_ON_THIS_COMPUTER_LINE = "Max is not available on this computer yet, so this one is made at Boost.";

/**
 * The typed `tier` argument of a generating tool (TIER-HOME-03): which quality it maps to and one sentence for the model to relay when the
 * request was lowered. Max maps to Boost's maker until a Max slot exists on this computer (`maxAvailable`); a person outside the adult lane is lowered without
 * a line, because they are never shown a Max control (resource-tiers section 8).
 */
export function tierArgument(input: { person: PersonRow; category: TierCategory; arg: unknown; band?: AgeBand; maxAvailable?: boolean; capabilityFits?: boolean }): { quality: "quick" | "detailed" | undefined; tier: Tier | undefined; line: string | null } {
  if (!isTier(input.arg)) return { quality: undefined, tier: undefined, line: null };
  const band = input.band ?? passForPerson(input.person).band;
  const available = input.maxAvailable ?? maxAvailable(input.category, input.capabilityFits);
  const choice = authorizeTier({ person: input.person, category: input.category, requested: input.arg, band });
  let line: string | null = null;
  // The admin line is for a person in the adult lane whose pass lacks Max; a child-band surface and a teen are lowered without a line (rule 0, C10).
  if (choice.note === "no_max_access" && laneOf({ actor: input.person, band }) === "adult") line = MAX_NEEDS_ADMIN_LINE;
  else if (choice.tier === "max" && !available) line = MAX_NOT_ON_THIS_COMPUTER_LINE;
  const effective: Tier = choice.tier === "max" && !available ? "boost" : choice.tier;
  return { quality: effective === "standard" ? "quick" : "detailed", tier: choice.tier, line };
}
