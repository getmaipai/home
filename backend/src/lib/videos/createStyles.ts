// VIDEO-LORA-09 (docs/design/video-loras-2026-11-02.md 6.2 and 6.4): the Styles and Characters chips of the Create page's prompt bar, built for one person from
// the one read path (`readLoras`, so what they may see is `loraAccess`, never a copy) and the Stack's own LoRA report. The page JSON holds none of it. A style
// the person may not see is not here; adult-only ones are one lock tile on the Styles chip until their unlock proof is live (the host refetches the page when
// the lock changes, and this runs again with the proof). The words each card adds come from `buildPromptPlan`, the same function that builds the prompt.
import { readLoras } from "@/lib/loras/access";
import { loraUsable } from "@/lib/loras/access";
import type { Lora } from "@/lib/loras/store";
import { MAX_NEEDS_ADMIN_LINE } from "@/lib/tiers";
import { LTX25_MAX_MODEL, LTX25_MODEL } from "./quality";
import { ltx25LorasSupported } from "./loraWire";
import { addedForLine, buildPromptPlan } from "@/lib/loras/promptPlan";
import type { StackVideoStatus } from "./stack";
import type { PersonRow } from "@/types";

export type StyleTier = "standard" | "boost" | "max";

/** The levels at which the Stack reports it can use a style (Standard and Boost ride the same model). */
export function styleTiersOf(engine: StackVideoStatus | null): StyleTier[] {
  const tiers: StyleTier[] = [];
  if (ltx25LorasSupported(engine, LTX25_MODEL)) tiers.push("standard", "boost");
  if (ltx25LorasSupported(engine, LTX25_MAX_MODEL)) tiers.push("max");
  return tiers;
}

/** The one plain line shown under the cards while the chip cannot be used, in the person's words (never a model or a size). */
export function styleDisabledLine(supported: readonly StyleTier[], offered: readonly StyleTier[]): string {
  if (supported.length === 0) return "Styles can't be used on this computer yet.";
  const reachable = supported.filter((t) => offered.includes(t));
  if (reachable.length === 0) return supported.every((t) => t === "max") ? `Styles are for Max for now. ${MAX_NEEDS_ADMIN_LINE}` : "Styles can't be used at this level yet.";
  const names = reachable.map((t) => ({ standard: "Standard", boost: "Boost", max: "Max" })[t]);
  return `Styles work at ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}. Choose ${names.length > 1 ? "one of those levels" : "that level"} to use one.`;
}

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The card's one line: what it does and what it adds to the words (design 6.1.6, "Added for Clay look (2 phrases)"). Nothing is added invisibly. */
export function styleNote(lora: Lora): string {
  const plan = buildPromptPlan({ words: "", styles: [lora], negativePrompt: "none" });
  const lines = plan.ok ? plan.lines : [];
  const added = addedForLine(lines);
  const phrases = lines.flatMap((l) => l.phrases.map((p) => p.text));
  const what = lora.description.trim() !== "" ? lora.description.trim() : `Uses the ${lora.name} style.`;
  return cut(added === "" ? `${what} It adds no words.` : `${what} ${added}: ${phrases.join(", ")}.`, 300);
}

export interface StyleChipsInput { person: PersonRow; engine: StackVideoStatus | null; /** The levels this person's tier segment offers. */ offered: readonly StyleTier[] }

/** The chips (Styles, Characters, Strength) for this person, or none when there is nothing to choose and nothing locked. */
export function styleChips({ person, engine, offered }: StyleChipsInput): Array<Record<string, unknown>> {
  const { items, locked } = readLoras(person, "own_written", { media: "video" });
  // A style appears here only when it can ride the newest model: that is where the Stack reports LoRA support (older bases are the chat tool's).
  const usable = items.filter((l) => loraUsable(l) && l.compatible_with.includes("ltx-2.5"));
  const styles = usable.filter((l) => l.kind !== "character");
  const characters = usable.filter((l) => l.kind === "character");
  if (styles.length === 0 && characters.length === 0 && !locked) return [];
  const supported = styleTiersOf(engine);
  const reachable = supported.filter((t) => offered.includes(t));
  const gate = reachable.length > 0 ? { enabled_tiers: reachable, disabled_reason: styleDisabledLine(supported, offered) } : { disabled_reason: styleDisabledLine(supported, offered) };
  // `private`: the id of a style (an adult-only one included) never reaches the address, a link or the history.
  const group = { variant: "cards", presentation: "popover", group: "Style", default: "none", quiet_value: "none", private: true, ...gate };
  const option = (lora: Lora) => ({ value: lora.id, label: cut(lora.name, 40), note: styleNote(lora) });
  const chips: Array<Record<string, unknown>> = [];
  if (styles.length > 0 || locked) chips.push({ state: "style", label: "Styles", ...group, ...(locked ? { locked: true } : {}), options: [{ value: "none", label: "No style" }, ...styles.slice(0, 23).map(option)] });
  if (characters.length > 0) chips.push({ state: "character", label: "Characters", ...group, options: [{ value: "none", label: "No character" }, ...characters.slice(0, 23).map(option)] });
  if (styles.length > 0 || characters.length > 0) {
    chips.push({ state: "strength", label: "Strength", presentation: "popover", group: "Style", default: "normal", quiet_value: "normal", ...gate, options: [{ value: "less", label: "Less" }, { value: "normal", label: "Normal" }, { value: "more", label: "More" }] });
  }
  return chips;
}
