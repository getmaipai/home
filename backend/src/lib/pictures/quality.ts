// IMGGEN-QUALITY-01 / H3-SLOTS-HOME-01 / MODELPACK-HOME-02: Quick and Detailed stay as person-facing levels (the level only changes the Stack's
// window). Home names no picture model: the Stack picks the part that serves a picture (`catalog.ts` reads its jobs catalog), and whether that part
// spells words is the catalog's `capabilities.text`, not a list here. A style made for a model that was removed (2026-11-16) gets the plain line
// below. Rule 0 is untouched: the age and surface gates ran before anything here.
export type PictureQuality = "quick" | "detailed";
/** Models that no longer exist on this computer. Matched only to refuse or to ignore an old saved pick; never offered. */
const REMOVED_PICTURE_MODELS: ReadonlySet<string> = new Set(["flux2-klein-4b", "ernie-image-turbo", "z-image-turbo"]);
export const isRemovedPictureModel = (model: string | null | undefined): boolean => Boolean(model && REMOVED_PICTURE_MODELS.has(model));
/** What a person is told when something they asked for needs a picture model that was removed. */
export const REMOVED_MODEL_LINE = "That picture maker is no longer on this computer. Home makes pictures with its one picture model now. Try again without that choice, or pick a different style.";
/** Until media_template.words_blanks ships in the spec, these blank names mark exact picture text. */
export const PICTURE_WORD_BLANKS = new Set(["headline", "title", "text", "caption", "tagline", "words", "name_text"]);

export const isPictureQuality = (value: unknown): value is PictureQuality => value === "quick" || value === "detailed";

/** Why the quality is not the one that was wanted, as a code the tool turns into one sentence for the model to relay. */
export type QualityNote = "detailed_off" | "style_needs_detailed" | "style_needs_quick" | null;

export interface QualityChoice {
  quality: PictureQuality;
  note: QualityNote;
  /** True when the person or the model asked for Detailed outright, so the reply should say so. */
  announce: boolean;
  /** Set when a style was made for a removed model: no picture is made, the person gets REMOVED_MODEL_LINE. */
  removed?: true;
}

/** Detailed is a level of the one model, not a second model, so there is nothing separate to switch to. */
export function detailedReady(_engine: unknown): boolean {
  return false;
}

/** The quality for one picture. A style made for a removed model cannot run (`removed`); everything else is Quick, and the Stack picks the part. */
export function chooseQuality(input: { requested?: PictureQuality | undefined; style?: { base_model: string } | null; household?: PictureQuality }): QualityChoice {
  if (input.style && isRemovedPictureModel(input.style.base_model)) return { quality: "quick", note: null, announce: false, removed: true };
  return { quality: "quick", note: null, announce: false };
}

/** The line the model relays for a quality note (plain words, no model names). */
export const QUALITY_NOTE_LINE: Record<Exclude<QualityNote, null>, string> = {
  detailed_off: "Detailed pictures are turned off, so this one was made Quick. If they want Detailed, tell them an admin can turn it on in Settings, AI and models.",
  style_needs_detailed: "That style only works with Detailed pictures, so this one is Detailed and takes a little longer. Say so in one short sentence.",
  style_needs_quick: "That style only works with Quick pictures, so this one was made Quick.",
};

/** The person's own request, without the sentences the picture tool adds to what it sends (TEXT-PIC-01 words, TEXT-PIC-02 no-text line). */
export function plainPrompt(prompt: string): string {
  return prompt
    .replace(/\s*Show this text on the picture, spelled exactly as written:(?:\s*"[^"]*"\s*,?)+\.?/g, "")
    .replace(/\s*No text, no letters, no words, no logos anywhere in the picture\.?/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();
}

/** The plain wait for a level, from how long its recent finished pictures took (milliseconds each, newest first). Fewer than 3 samples: nothing to say (null). Under a minute rounds to 5 seconds, above it to the minute. */
export function typicalWait(msList: readonly number[]): string | null {
  const list = msList.filter((ms) => Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
  if (list.length < 3) return null;
  const mid = Math.floor(list.length / 2);
  const seconds = (list.length % 2 ? list[mid]! : (list[mid - 1]! + list[mid]!) / 2) / 1000;
  if (seconds < 57.5) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} seconds.`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
