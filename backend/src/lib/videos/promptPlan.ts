// VIDEO-LORA-09 (docs/design/video-loras-2026-11-02.md 6.1, docs/dev/loras.md): the ONE prompt plan. Create, the chat tools, Another take and continue all build the
// words and the strengths that go to the Stack here; no caller keeps a copy of the rules. It is a pure function (no database, no clock, no model): the
// input is the person's words, the chosen style records and the engine's report, the output is the final prompt, the negative text (only for an engine that
// reports NAG), the strengths and what was added, or one plain line saying why the styles cannot be applied. A style that cannot be applied fails the job
// with that line; it is never dropped silently (design 5.5).
import type { Lora } from "@/lib/loras/store";

/** What the person sees: Less, Normal or More (design 6.1.7). */
export type StyleStrength = "less" | "normal" | "more";
export const STYLE_STRENGTHS: readonly StyleStrength[] = ["less", "normal", "more"];
export const STRENGTH_FACTOR: Record<StyleStrength, number> = { less: 0.75, normal: 1, more: 1.25 };
/** No strength goes above this, whatever a record's own range says. */
export const STRENGTH_CEILING = 2;
export const MAX_STYLES = 2;
/** The most text the plan adds across all chosen styles (add-ins, avoid and say-instead, negative text). */
export const MAX_ADDED_CHARS = 400;

export const TWO_AT_A_TIME_LINE = "Two styles at a time is the most. Pick one or two, then try again.";
export const TWO_CHARACTERS_LINE = "Only one character style can be used in a clip. Keep one character and choose styles for the rest.";
export const TOO_MUCH_ADDED_LINE = "These styles add too much to your words together. Pick one, or shorten their added phrases in Settings, Styles.";
export const NO_BASE_LINE = "A style has no video type set yet. Ask an admin to set what it is for in Settings, Styles.";

export type StyleForPlan = Pick<Lora, "id" | "name" | "kind" | "trigger_words" | "trigger_position" | "positive_addins" | "negative_addins" | "avoid_as_positive" | "strength">;

export interface PromptPlanInput {
  /** What the person wrote. Kept byte for byte inside the prompt. */
  words: string;
  /** The chosen styles in the order the person chose them. */
  styles: readonly StyleForPlan[];
  strength?: StyleStrength | undefined;
  /** What the engine says about negative text: only "nag" sends it; anything else gets the say-instead words in the positive prompt. */
  negativePrompt?: "none" | "nag" | undefined;
}

export interface PlanLine {
  id: string;
  name: string;
  /** Exactly what this style added, after duplicates across styles were removed, each marked when it is a trigger word. */
  phrases: Array<{ text: string; trigger: boolean }>;
}

export type PromptPlan =
  | { ok: true; prompt: string; negative: string | null; loras: Array<{ id: string; strength: number }>; lines: PlanLine[]; /** Whether anything was added to the words. */ changed: boolean }
  | { ok: false; code: "too_many" | "two_characters" | "too_much_added"; line: string };

const key = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
const clean = (list: readonly string[]): string[] => list.map((t) => t.trim()).filter((t) => t !== "");

/** The numeric strength of a style at a level: the record's default times 0.75, 1 or 1.25, held between the record's own minimum and its maximum (never above 2). */
export function strengthFor(style: Pick<Lora, "strength">, level: StyleStrength | undefined): number {
  const wanted = style.strength.default * STRENGTH_FACTOR[level ?? "normal"];
  const high = Math.min(style.strength.max, STRENGTH_CEILING);
  const low = Math.min(style.strength.min, high);
  const held = Math.min(high, Math.max(low, wanted));
  return Math.round(held * 1000) / 1000;
}

/** Build the plan. See the header for the rules; the order of the output is: start triggers, the person's words, end triggers, add-ins, then say-instead words. */
export function buildPromptPlan(input: PromptPlanInput): PromptPlan {
  // The same style twice is one style.
  const seenIds = new Set<string>();
  const styles = input.styles.filter((s) => (seenIds.has(s.id) ? false : (seenIds.add(s.id), true)));
  if (styles.length > MAX_STYLES) return { ok: false, code: "too_many", line: TWO_AT_A_TIME_LINE };
  if (styles.filter((s) => s.kind === "character").length > 1) return { ok: false, code: "two_characters", line: TWO_CHARACTERS_LINE };
  if (styles.length === 0) return { ok: true, prompt: input.words, negative: null, loras: [], lines: [], changed: false };

  // A phrase is added once across every style, and never when the person already wrote it (letter case ignored).
  const taken = new Set<string>();
  const written = key(input.words);
  const novel = (text: string, fromWords: boolean): boolean => {
    const k = key(text);
    if (k === "" || taken.has(k) || (fromWords && written.includes(k))) return false;
    taken.add(k);
    return true;
  };
  const nag = input.negativePrompt === "nag";
  const lines: PlanLine[] = [];
  const start: string[] = [];
  const end: string[] = [];
  const addins: string[] = [];
  const negatives: string[] = [];
  let addedChars = 0;
  for (const style of styles) {
    const phrases: PlanLine["phrases"] = [];
    for (const word of clean(style.trigger_words)) {
      if (!novel(word, true)) continue;
      phrases.push({ text: word, trigger: true });
      (style.trigger_position === "end" ? end : start).push(word);
    }
    for (const phrase of clean(style.positive_addins)) {
      if (!novel(phrase, false)) continue;
      phrases.push({ text: phrase, trigger: false });
      addins.push(phrase);
      addedChars += phrase.length;
    }
    // Avoid with say instead: the engine's negative text when it has one (NAG), else the admin-written positive counterpart. Home never rewrites a "no X" itself.
    if (nag) {
      for (const phrase of clean(style.negative_addins)) {
        const k = `neg:${key(phrase)}`;
        if (taken.has(k)) continue;
        taken.add(k);
        negatives.push(phrase);
        addedChars += phrase.length;
      }
    } else {
      for (const phrase of clean(style.avoid_as_positive)) {
        if (!novel(phrase, false)) continue;
        phrases.push({ text: phrase, trigger: false });
        addins.push(phrase);
        addedChars += phrase.length;
      }
    }
    lines.push({ id: style.id, name: style.name, phrases });
  }
  if (addedChars > MAX_ADDED_CHARS) return { ok: false, code: "too_much_added", line: TOO_MUCH_ADDED_LINE };

  const trail = (words: string, parts: string[]): string => (parts.length === 0 ? words : `${words}${/[.!?]\s*$/.test(words) || words === "" ? " " : ", "}${parts.join(", ")}`);
  const lead = start.length === 0 ? input.words : `${start.join(", ")}, ${input.words}`;
  const prompt = trail(trail(lead, end), addins);
  const loras = styles.map((s) => ({ id: s.id, strength: strengthFor(s, input.strength) }));
  return { ok: true, prompt, negative: negatives.length > 0 ? negatives.join(", ") : null, loras, lines, changed: prompt !== input.words || negatives.length > 0 };
}

/** The one line under the prompt box: "Added for Clay look (2 phrases)". Empty when nothing was added. */
export function addedForLine(lines: readonly PlanLine[]): string {
  const parts = lines.filter((l) => l.phrases.length > 0).map((l) => `${l.name} (${l.phrases.length} ${l.phrases.length === 1 ? "phrase" : "phrases"})`);
  return parts.length === 0 ? "" : `Added for ${parts.join(" and ")}`;
}
