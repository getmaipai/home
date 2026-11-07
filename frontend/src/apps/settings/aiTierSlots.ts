// TIER-HOME-04: the pure side of the slot dialogs on AI and models. One draft per tier of a category (Standard, Boost, Max and, for chat,
// Reduced); a slot record is `{ model, options, who }` (spec `tier-slot`), where `model` is a candidate id, `recommended` or `off`. The
// on/off switch of a mode is the slot's `off` value, so there is one definition (resource-tiers section 3a rule 7). The per-category Boost and
// Max switches live here and nowhere else (RULES.md S4).
import { i18n } from "@lingui/core";
import vocab from "@maipai/spec/vocab/resource-tiers.json";
import type { AiJobId } from "../../../../shared/aiChoices";
import { MAX_RECOMMENDED_LABEL, SLOT_LEVELS_READ, SLOT_OPTIONS_READ } from "../../../../shared/tierSlotOptions";

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
/** The options a slot of this category may carry that something reads (`SLOT_OPTIONS_READ`): the dialog offers no switch that does nothing. */
export const optionDefs = (category: string): OptionDef[] => ((vocab.categories.find((c) => c.id === category)?.options ?? []) as OptionDef[]).filter((def) => (SLOT_OPTIONS_READ[category] ?? []).includes(def.id));
const whoDefault = (tier: SlotTier): SlotWho => (vocab.who_default as Record<string, SlotWho>)[tier] ?? "everyone";

/** Tiers an admin can configure for a category: the levels something reads (`SLOT_LEVELS_READ`). Reduced is the system's own, offered only for chat as "Let big jobs simplify chat". */
export const configurableTiers = (job: AiJobId): SlotTier[] => {
  const category = TIERED_JOBS[job]?.category ?? "";
  const levels: SlotTier[] = [...(SLOT_LEVELS_READ[category] ?? ["standard"])];
  return job === "chat" ? [...levels, "reduced"] : levels;
};

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
  const levels = configurableTiers(job);
  if (levels.includes("boost") && !isOn(drafts.boost)) lines.push(i18n._({ id: "Boost is off for {name}. A request for Boost is made at Standard, and Boost jobs not yet started are made at Standard.", message: "Boost is off for {name}. A request for Boost is made at Standard, and Boost jobs not yet started are made at Standard.", values: { name } }));
  if (levels.includes("max") && !isOn(drafts.max)) lines.push(i18n._({ id: "Max is off for {name}. Nobody can start a Max window for it, including admins. A Max job already running finishes.", message: "Max is off for {name}. Nobody can start a Max window for it, including admins. A Max job already running finishes.", values: { name } }));
  if (job === "chat" && !isOn(drafts.reduced)) lines.push(i18n._({ id: "Big jobs will not simplify chat, so a Max job that needs more room than the rest leaves is not offered.", message: "Big jobs will not simplify chat, so a Max job that needs more room than the rest leaves is not offered." }));
  if (levels.includes("boost") && isOn(drafts.boost) && drafts.boost.model !== "recommended" && drafts.boost.model === drafts.standard.model && JSON.stringify(drafts.boost.options) === JSON.stringify(drafts.standard.options)) lines.push(i18n._({ id: "Boost is the same as Standard, so Boost will be hidden.", message: "Boost is the same as Standard, so Boost will be hidden." }));
  return lines;
}

/** The one line under a row on AI and models: what each level is, in words. A person's name or an app's name never appears (making-space note section 9); Max says who holds it. */
export function levelsLine(drafts: SlotDrafts, job: AiJobId, models: ReadonlyArray<{ id: string; label: string }>): string {
  const name = (d: SlotDraft) => !isOn(d) ? i18n._({ id: "off", message: "off" }) : d.model === "recommended" ? i18n._({ id: "recommended", message: "recommended" }) : models.find((m) => m.id === d.model)?.label ?? i18n._({ id: "your pick", message: "your pick" });
  const levels = configurableTiers(job);
  const parts = [i18n._({ id: "Standard: {model}", message: "Standard: {model}", values: { model: name(drafts.standard) } })];
  if (levels.includes("boost")) parts.push(i18n._({ id: "Boost: {model}", message: "Boost: {model}", values: { model: name(drafts.boost) } }));
  if (levels.includes("max")) parts.push(!isOn(drafts.max) ? i18n._({ id: "Max: off", message: "Max: off" }) : drafts.max.model === "recommended" ? (MAX_RECOMMENDED_LABEL[TIERED_JOBS[job]?.category ?? ""] ? i18n._({ id: "Max: recommended", message: "Max: recommended" }) : i18n._({ id: "Max: no model of its own yet", message: "Max: no model of its own yet" })) : i18n._({ id: "Max: {model}", message: "Max: {model}", values: { model: name(drafts.max) } }));
  if (job === "chat") parts.push(isOn(drafts.reduced) ? i18n._({ id: "Simplify chat for big jobs: on", message: "Simplify chat for big jobs: on" }) : i18n._({ id: "Simplify chat for big jobs: off", message: "Simplify chat for big jobs: off" }));
  return `${parts.join(" · ")}.${levels.includes("max") ? i18n._({ id: " Max is for admins and anyone an admin assigns.", message: " Max is for admins and anyone an admin assigns." }) : ""}`;
}

export const familyNote = (): string => i18n._({ id: "Models in one family keep the same look and voice at every level, and switch faster.", message: "Models in one family keep the same look and voice at every level, and switch faster." });
export interface PickOption { id: string; label: string; description: string; blockedReason: string | null }
export interface PickGroup { family: string; /** Null when the job's own list is shown with no family to name. */ heading: string | null; options: PickOption[] }

const FAMILY_TITLE: Record<string, string> = { muse: "Muse", qwen3: "Qwen3", "qwen3.8": "Qwen3.8", ornith: "Ornith", ernie: "ERNIE", klein: "FLUX.2 Klein", "z-image": "Z-Image", wan: "Wan", ltx: "LTX", "ace-step": "ACE-Step", chatterbox: "Chatterbox", pocket: "Pocket" };
const titleOf = (family: string) => FAMILY_TITLE[family] ?? family.replace(/(^|[-_ ])(\w)/g, (_m, sep: string, ch: string) => (sep ? " " : "") + ch.toUpperCase());

/** The Stack's candidates for one level, grouped by family in the order the Stack lists them. A candidate that does not fit says why in the Stack's own sentence; one that does fit says its memory and whether the figure is measured. */
export function groupByFamily(candidates: ReadonlyArray<{ id: string; label: string; family: string; peak_bytes: number; verified: boolean; fits: boolean; refusal: string | null }>, size: (bytes: number) => string): PickGroup[] {
  const groups: PickGroup[] = [];
  for (const candidate of candidates) {
    let group = groups.find((entry) => entry.family === candidate.family);
    if (!group) { group = { family: candidate.family, heading: titleOf(candidate.family), options: [] }; groups.push(group); }
    group.options.push({
      id: candidate.id, label: candidate.label,
      description: candidate.verified ? i18n._({ id: "Needs about {size} of memory.", message: "Needs about {size} of memory.", values: { size: size(candidate.peak_bytes) } }) : i18n._({ id: "Needs about {size} of memory (not measured here yet).", message: "Needs about {size} of memory (not measured here yet).", values: { size: size(candidate.peak_bytes) } }),
      blockedReason: candidate.fits ? null : candidate.refusal ?? i18n._({ id: "This does not fit this level on this computer.", message: "This does not fit this level on this computer." }),
    });
  }
  return groups;
}
