// TIER-HOME-04: the pure side of the slot dialogs on AI and models. One draft per tier of a category (Standard, Boost, Max and, for chat,
// Reduced); a slot record is `{ model, options, who }` (spec `tier-slot`), where `model` is a candidate id, `recommended` or `off`. The
// on/off switch of a mode is the slot's `off` value, so there is one definition (resource-tiers section 3a rule 7). The per-category Boost and
// Max switches live here and nowhere else (RULES.md S4).
import vocab from "@maipai/spec/vocab/resource-tiers.json";
import type { AiJobId } from "../../../../shared/aiChoices";

export type SlotTier = "reduced" | "standard" | "boost" | "max";
export type SlotWho = "everyone" | "assigned" | "admins";
export interface SlotDraft { model: string; options: Record<string, boolean | number>; who: SlotWho }
export type SlotDrafts = Record<SlotTier, SlotDraft>;

export interface OptionDef { id: string; type: "boolean" | "integer" | "number"; min?: number; max?: number; default: boolean | number; label: string; minors: boolean }

/** The category (spec id) and engine role of each job that has levels. Pictures Boost is the former Detailed switch, so that job has no row of its own here. */
export const TIERED_JOBS: Partial<Record<AiJobId, { category: string; role: string }>> = {
  chat: { category: "chat", role: "chat" },
  pictures: { category: "image", role: "image" },
  videos: { category: "video", role: "video" },
  music: { category: "music", role: "music" },
  voice: { category: "voice", role: "tts" },
};

export const slotKey = (role: string, tier: SlotTier) => `engines.${role}.tier.${tier}`;
export const optionDefs = (category: string): OptionDef[] => (vocab.categories.find((c) => c.id === category)?.options ?? []) as OptionDef[];
const whoDefault = (tier: SlotTier): SlotWho => (vocab.who_default as Record<string, SlotWho>)[tier] ?? "everyone";

/** Tiers an admin can configure for a category. Reduced is the system's own, offered only for chat as "Let big jobs simplify chat". */
export const configurableTiers = (job: AiJobId): SlotTier[] => (job === "chat" ? ["standard", "boost", "max", "reduced"] : ["standard", "boost", "max"]);

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

export const isOn = (draft: SlotDraft) => draft.model !== "off";

/** Flip a mode. Turning it on returns to the recommended model; turning it off keeps nothing but `off` (the model stays installed). */
export function withOn(draft: SlotDraft, on: boolean): SlotDraft {
  return on ? { ...draft, model: draft.model === "off" ? "recommended" : draft.model } : { ...draft, model: "off" };
}

/** The value to store. `who` is kept only when it differs from the tier's default, so a catalog change in defaults still applies. */
export function toStored(draft: SlotDraft, tier: SlotTier): { model: string; options: Record<string, boolean | number>; who?: SlotWho } {
  return { model: draft.model, options: draft.options, ...(draft.who !== whoDefault(tier) ? { who: draft.who } : {}) };
}

export const sameDraft = (a: SlotDraft, b: SlotDraft) => a.model === b.model && a.who === b.who && JSON.stringify(Object.entries(a.options).sort()) === JSON.stringify(Object.entries(b.options).sort());

/** Who choices a tier offers: Standard is for everyone; nobody may widen Max past the grant, so Max offers assigned people or admins. */
export function whoChoices(tier: SlotTier): SlotWho[] {
  return tier === "standard" ? ["everyone"] : tier === "max" || tier === "reduced" ? ["assigned", "admins"] : ["everyone", "assigned", "admins"];
}

/** The consequence of the current drafts, in the words the dialog shows before saving. `{name}` is the job's title. */
export function consequences(drafts: SlotDrafts, job: AiJobId, title: string): string[] {
  const lines: string[] = [];
  const name = title.toLowerCase();
  if (!isOn(drafts.boost)) lines.push(`Boost is off for ${name}. A request for Boost is made at Standard, and Boost jobs not yet started are made at Standard.`);
  if (!isOn(drafts.max)) lines.push(`Max is off for ${name}. Nobody can start a Max window for it, including admins. A Max job already running finishes.`);
  if (job === "chat" && !isOn(drafts.reduced)) lines.push("Big jobs will not simplify chat, so a Max job that needs more room than the rest leaves is not offered.");
  if (isOn(drafts.boost) && drafts.boost.model !== "recommended" && drafts.boost.model === drafts.standard.model && JSON.stringify(drafts.boost.options) === JSON.stringify(drafts.standard.options)) lines.push("Boost is the same as Standard, so Boost will be hidden.");
  return lines;
}

/** The one line under a row on AI and models: what each level is, in words. A person's name or an app's name never appears (making-space note section 9); Max says who holds it. */
export function levelsLine(drafts: SlotDrafts, job: AiJobId, models: ReadonlyArray<{ id: string; label: string }>): string {
  const name = (d: SlotDraft) => !isOn(d) ? "off" : d.model === "recommended" ? "recommended" : models.find((m) => m.id === d.model)?.label ?? "your pick";
  const parts = [`Standard: ${name(drafts.standard)}`, `Boost: ${name(drafts.boost)}`];
  parts.push(!isOn(drafts.max) ? "Max: off" : drafts.max.model === "recommended" ? "Max: no model of its own yet" : `Max: ${name(drafts.max)}`);
  if (job === "chat") parts.push(`Simplify chat for big jobs: ${isOn(drafts.reduced) ? "on" : "off"}`);
  return `${parts.join(" · ")}. Max is for admins and anyone an admin assigns.`;
}
