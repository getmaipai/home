// VIDEO-LORA-07 (docs/design/video-loras-2026-11-02.md section 15.1): the three-state adult check, decided from the SOURCE'S OWN DATA only. No keyword list reads a
// name, description or tag for words (RULES rule 0): a state comes from a flag, per-image levels, or the single Hugging Face tag `not-for-all-audiences`.
// The result is evidence for the `Lora.adult_check` field and for the browse lock; the access decision stays `audience`.
import type { Lora } from "@/lib/loras/store";

export type AdultCheck = NonNullable<Lora["adult_check"]>;
/** Civitai `nsfwLevel` values (from memory and the public image-rating scale, to be re-checked against a live response): 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX. A model level is a bit mask
 * (the reference shows 31), so any value of 4 or more contains an adult bit. */
export const CIVITAI_ADULT_LEVEL = 4;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export interface CivitaiCheckInput {
  /** The model's `nsfw` flag as returned; anything but a boolean counts as missing. */
  nsfw: unknown;
  /** The model's `nsfwLevel`, when returned. */
  nsfwLevel?: unknown;
  /** `images[].nsfwLevel` of the version the install will fetch (not the newest version). Null or empty when none came back. */
  imageLevels: readonly unknown[] | null;
  /** The response could not be read completely (a missing version, truncated JSON). */
  malformed?: boolean;
  /** The source reported it filtered the results for this viewer's region. */
  regionFiltered?: boolean;
}

export function classifyCivitai(input: CivitaiCheckInput, now = new Date().toISOString()): AdultCheck {
  const flag = typeof input.nsfw === "boolean" ? input.nsfw : null;
  const modelLevel = num(input.nsfwLevel);
  const raw = input.imageLevels ?? [];
  const levels = raw.map(num).filter((v): v is number => v !== null);
  const adultLevels = levels.filter((v) => v >= CIVITAI_ADULT_LEVEL).length;
  const base = { flag, levels_seen: levels.length, adult_levels: adultLevels, checked_at: now };
  // 1. Any one adult signal wins, even when the model's tags say safe.
  if (flag === true) return { state: "adult", basis: "source_flag", ...base };
  if (modelLevel !== null && modelLevel >= CIVITAI_ADULT_LEVEL) return { state: "adult", basis: "source_levels", ...base };
  if (adultLevels > 0) return { state: "adult", basis: "source_levels", ...base };
  // 2. Normal only when everything known is plainly safe.
  const everyPreviewSafe = raw.length > 0 && levels.length === raw.length && levels.every((v) => v === 1);
  const modelSafe = modelLevel === null || modelLevel === 1;
  if (!input.malformed && !input.regionFiltered && flag === false && everyPreviewSafe && modelSafe) return { state: "normal", basis: "source_levels", ...base };
  // 3. Everything else (no previews, a level 2, a missing level, a conflict, a bad or filtered response).
  return { state: "unknown", basis: flag === null && levels.length === 0 ? "none" : "source_levels", ...base };
}

/** Hugging Face publishes no per-image level. The one source field is the repo tag; it only ever raises. */
export function classifyHuggingFace(tags: unknown, now = new Date().toISOString()): AdultCheck {
  const adult = Array.isArray(tags) && tags.includes("not-for-all-audiences");
  return adult ? { state: "adult", basis: "source_tag", flag: true, levels_seen: 0, adult_levels: 0, checked_at: now } : { state: "unknown", basis: "none", flag: null, levels_seen: 0, adult_levels: 0, checked_at: now };
}

/** Trigger words as an admin would want them (Loki Doki loraTokens lesson): strip `<lora:name:weight>` syntax, split comma and newline dumps, drop control characters,
 * dedupe case-insensitively, cap length and count. */
export function cleanTriggerWords(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const text = entry.replace(/[\u0000-\u001f\u007f]/g, (c) => (c === "\n" ? "," : " ")).replace(/<lora:[^>]*>/gi, " ").replace(/<[^>]*>/g, " ");
    for (const piece of text.split(",")) {
      const word = piece.replace(/\s+/g, " ").trim().slice(0, 80);
      if (word && !out.some((w) => w.toLowerCase() === word.toLowerCase())) out.push(word);
    }
  }
  return out.slice(0, 12);
}
