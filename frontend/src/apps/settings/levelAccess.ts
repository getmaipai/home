// STACK-MODELS-HOME-01: the part of a level's slot that stays Home's after the Stack took every model choice: who may use the level and the options
// the level carries (`engines.<role>.tier.<tier>` = `{ model, options, who }`, spec `tier-slot`). The `model` in that record is no longer the household's
// choice (the Stack holds it, `lib/stackChoiceSnapshot.ts` reads it); it is written back as it was so a save here never changes a model.
import vocab from "@maipai/spec/vocab/resource-tiers.json";
import { SLOT_OPTIONS_READ } from "../../../../shared/tierSlotOptions";

export type SlotTier = "reduced" | "standard" | "boost" | "max";
export type SlotWho = "everyone" | "assigned" | "admins";
export interface SlotDraft { model: string; options: Record<string, boolean | number>; who: SlotWho }
export type SlotDrafts = Partial<Record<SlotTier, SlotDraft>>;
export interface OptionDef { id: string; type: "boolean" | "integer" | "number"; min?: number; max?: number; default: boolean | number; label: string; minors: boolean }

/** The Stack's feature id to Home's slot role and the spec's category: only these have levels Home keeps access for. */
export const ACCESS_FEATURES: ReadonlyArray<{ id: "chat" | "pictures" | "video" | "music" | "voice" | "coding"; role: string; category: string }> = [
  { id: "chat", role: "chat", category: "chat" },
  { id: "pictures", role: "image", category: "image" },
  { id: "video", role: "video", category: "video" },
  { id: "music", role: "music", category: "music" },
  { id: "voice", role: "tts", category: "voice" },
  { id: "coding", role: "coding", category: "coding" },
];
/** The household switches that gate who a made-content level is for (the old "Adult gate" block of the details sheet). */
export const GATE_KEYS: Record<string, string[]> = { pictures: ["generation.adults", "generation.kids"], video: ["generation.video.adult_adapters"], music: ["generation.music.enabled"] };

export const slotKey = (role: string, tier: SlotTier) => `engines.${role}.tier.${tier}`;
/** The options a slot of this category may carry that something reads (`SLOT_OPTIONS_READ`): the sheet offers no switch that does nothing. */
export const optionDefs = (category: string): OptionDef[] => ((vocab.categories.find((c) => c.id === category)?.options ?? []) as OptionDef[]).filter((def) => (SLOT_OPTIONS_READ[category] ?? []).includes(def.id));
const whoDefault = (tier: SlotTier): SlotWho => (vocab.who_default as Record<string, SlotWho>)[tier] ?? "everyone";

/** The stored value of a slot key read as a draft; anything unreadable reads as the tier's default slot. */
export function draftOf(stored: unknown, tier: SlotTier): SlotDraft {
  const fallback: SlotDraft = { model: tier === "reduced" ? "off" : "recommended", options: {}, who: whoDefault(tier) };
  if (!stored || typeof stored !== "object") return fallback;
  const value = stored as { model?: unknown; options?: unknown; who?: unknown };
  if (typeof value.model !== "string") return fallback;
  const who = value.who === "everyone" || value.who === "assigned" || value.who === "admins" ? value.who : fallback.who;
  const options: Record<string, boolean | number> = {};
  if (value.options && typeof value.options === "object") for (const [name, v] of Object.entries(value.options)) if (typeof v === "boolean" || typeof v === "number") options[name] = v;
  return { model: value.model, options, who };
}

/** The value to store. `who` is kept only when it differs from the tier's default, so a catalog change in defaults still applies. */
export function toStored(draft: SlotDraft, tier: SlotTier): { model: string; options: Record<string, boolean | number>; who?: SlotWho } {
  return { model: draft.model, options: draft.options, ...(draft.who !== whoDefault(tier) ? { who: draft.who } : {}) };
}

export const sameDraft = (a: SlotDraft, b: SlotDraft) => a.who === b.who && JSON.stringify(Object.entries(a.options).sort()) === JSON.stringify(Object.entries(b.options).sort());

/** Who choices a tier offers: Standard is for everyone; nobody may widen Max past the grant, so Max offers assigned people or admins. */
export function whoChoices(tier: SlotTier): SlotWho[] {
  return tier === "standard" ? ["everyone"] : tier === "max" || tier === "reduced" ? ["assigned", "admins"] : ["everyone", "assigned", "admins"];
}
