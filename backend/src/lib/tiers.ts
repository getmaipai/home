// TIER-HOME-02: who may use which resource tier, in one place (docs/design/resource-tiers-2026-10-27.md sections 3a, 6, 10).
// Rule 0 and rule 8 of docs/design/RULES.md: age and surface gates ran before anything here, and a tier never loosens them.
// A minor's chat, video, music and voice stay Standard; a child's pictures stay Standard on the kids lane; a teen reaches Max pictures only
// through an admin's `tier.max:image` grant. Thinking options never reach a minor (spec `optionsForBand`).
import { TierSlot } from "@maipai/spec/gen/ts/tier-slot.js";
import vocab from "@maipai/spec/vocab/resource-tiers.json" with { type: "json" };
import { optionsForBand, checkTierSlotOptions, type TierOptionValue } from "@maipai/spec/records/ts/tierSlot.js";
import type { AgeBand } from "@/lib/ageBand";
import { speakerAgeBand } from "@/lib/ageBand";
import { personIsGranted } from "@/lib/grants";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

export type Tier = "standard" | "boost" | "max";
export type TierCategory = "chat" | "image" | "video" | "music" | "voice";
export type TierWho = "everyone" | "assigned" | "admins";
export type TierNote = "max_not_granted" | "minor_standard" | "slot_off" | "not_for_this_person";

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

export const slotIsOff = (category: TierCategory, tier: Tier): boolean => tier !== "standard" && readSlot(category, tier).model === "off";

/** An owner or admin holds Max by role; anyone else needs an allow grant, for every category or for this one. */
export function holdsMax(person: Pick<PersonRow, "id" | "role">, category: TierCategory): boolean {
  if (person.role === "owner" || person.role === "admin") return true;
  if (person.role === "child" || person.role === "guest") return false;
  // The bare grant is never a teen's: a teen holds Max only per category (grant-actions.json).
  return (person.role !== "teen" && personIsGranted(person.id, TIER_GRANT)) || personIsGranted(person.id, tierGrantFor(category));
}

/** The highest tier the age band can ever use in this category, whatever grants or slots say (RULES.md rules 0 and 8). */
export function bandCeiling(band: AgeBand, category: TierCategory): Tier {
  if (band === "adult") return "max";
  if (band === "child") return "standard";
  return category === "image" ? "max" : "standard";
}

export interface TierDeps {
  holdsMax: (category: TierCategory) => boolean;
  slotOff: (category: TierCategory, tier: Tier) => boolean;
  who: (category: TierCategory, tier: Tier) => TierWho;
}

export interface TierChoice { tier: Tier; note: TierNote | null }

/** The tier a request actually runs at: the requested one, lowered by the band's ceiling, the Max grant, a switched-off slot and the slot's Who can use it. */
export function clampTier(input: { person: Pick<PersonRow, "id" | "role">; band: AgeBand; category: TierCategory; requested: Tier }, deps: TierDeps): TierChoice {
  const { band, category } = input;
  let tier = input.requested;
  let note: TierNote | null = null;
  const lower = (to: Tier, why: TierNote) => { if (LADDER.indexOf(to) < LADDER.indexOf(tier)) { tier = to; note ??= why; } };
  lower(bandCeiling(band, category), "minor_standard");
  if (input.person.role === "guest") lower("standard", "not_for_this_person");
  if (tier === "max" && !deps.holdsMax(category)) lower("boost", "max_not_granted");
  while (tier !== "standard" && deps.slotOff(category, tier)) lower(LADDER[LADDER.indexOf(tier) - 1]!, "slot_off");
  const admin = input.person.role === "owner" || input.person.role === "admin";
  // Max is opened by the grant alone (the slot's default `who` for Max is "admins" because the grant starts with them); Boost follows its slot's `who`.
  while (tier === "boost") {
    const who = deps.who(category, tier);
    const allowed = who === "everyone" || admin || (who === "assigned" && deps.holdsMax(category) && band !== "child");
    if (allowed) break;
    lower(LADDER[LADDER.indexOf(tier) - 1]!, "not_for_this_person");
  }
  return { tier, note };
}

/** `clampTier` against the household's real grants and slot records. */
export function authorizeTier(input: { person: PersonRow; category: TierCategory; requested: Tier; band?: AgeBand }): TierChoice {
  const band = input.band ?? speakerAgeBand(input.person, new Date());
  return clampTier({ person: input.person, band, category: input.category, requested: input.requested }, {
    holdsMax: (category) => holdsMax(input.person, category),
    slotOff: slotIsOff,
    who: (category, tier) => readSlot(category, tier).who,
  });
}

/** The options a slot runs with for this band: a minor never receives a thinking option (RULES.md rules 2 and 8). */
export function slotOptionsFor(category: TierCategory, tier: Tier, band: AgeBand): Record<string, TierOptionValue> {
  return optionsForBand(category, readSlot(category, tier).options, band);
}

/** Quick is Standard and Detailed is Boost. A person who may not use Boost here gets Quick, whatever was asked or the household default says. */
export function allowedQuality(person: PersonRow, category: TierCategory, quality: "quick" | "detailed", band?: AgeBand): "quick" | "detailed" {
  if (quality === "quick") return quality;
  return authorizeTier({ person, category, requested: "boost", ...(band ? { band } : {}) }).tier === "standard" ? "quick" : "detailed";
}
