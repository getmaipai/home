// IMGGEN-QUALITY-01 (owner ruling 2026-10-17): the person-facing picture choice. "Quick" is FLUX.2 Klein 4B (about 4 s) and
// the default; "Detailed" is Z-Image-Turbo (13 to 30 s, finer detail, the large community library of styles). The words
// "Klein" and "Z-Image" never reach a person outside the Details disclosure; this file is the one place that maps the two.
// Rule 0 is untouched: the age and surface gates ran before anything here.
import { householdPictureQuality } from "./policy";
import type { StackImageStatus } from "./stack";

export type PictureQuality = "quick" | "detailed";
export const QUICK_MODEL = "flux2-klein-4b";
export const DETAILED_MODEL = "z-image-turbo";

export const qualityOfModel = (model: string | null | undefined): PictureQuality | null => (model === DETAILED_MODEL ? "detailed" : model === QUICK_MODEL ? "quick" : null);
export const isPictureQuality = (value: unknown): value is PictureQuality => value === "quick" || value === "detailed";

/** Why the quality is not the one that was wanted, as a code the tool turns into one sentence for the model to relay. */
export type QualityNote = "detailed_not_installed" | "style_needs_detailed" | "style_needs_quick" | null;

export interface QualityChoice {
  quality: PictureQuality;
  /** The Stack model to name; undefined lets the Stack use its own default (Quick). */
  model?: string;
  note: QualityNote;
  /** True when the person or the model asked for Detailed outright or a style needs it, so the reply should say so. */
  announce: boolean;
}

/** Whether Detailed can run here now: the model is installed and this computer's tier can run it. */
export function detailedReady(engine: Pick<StackImageStatus, "models"> | null): boolean {
  const model = engine?.models.find((m) => m.id === DETAILED_MODEL);
  return Boolean(model && model.installed && model.available !== false);
}

/**
 * The quality for one picture. A style (LoRA) is made for one model, so it decides: a style made for the detailed model makes
 * the picture Detailed on its own (and says so), a style made for the quick one keeps it Quick. With no style, the request's own
 * choice wins, else the household's setting; Detailed that is not installed falls back to Quick with a note.
 */
export function chooseQuality(input: { requested?: PictureQuality | undefined; style?: { base_model: string } | null; engine: Pick<StackImageStatus, "models"> | null; household?: PictureQuality }): QualityChoice {
  const wanted = input.requested ?? input.household ?? householdPictureQuality();
  const base = qualityOfModel(input.style?.base_model);
  if (input.style && base) {
    if (base === "detailed") return { quality: "detailed", model: DETAILED_MODEL, note: wanted === "detailed" ? null : "style_needs_detailed", announce: true };
    return { quality: "quick", model: QUICK_MODEL, note: input.requested === "detailed" ? "style_needs_quick" : null, announce: false };
  }
  if (wanted === "detailed") {
    if (detailedReady(input.engine)) return { quality: "detailed", model: DETAILED_MODEL, note: null, announce: input.requested === "detailed" };
    return { quality: "quick", note: "detailed_not_installed", announce: false };
  }
  return { quality: "quick", note: null, announce: false };
}

/** The line the model relays for a quality note (plain words, no model names). */
export const QUALITY_NOTE_LINE: Record<Exclude<QualityNote, null>, string> = {
  detailed_not_installed: "Detailed pictures are not on this computer yet, so this one was made Quick. If they want Detailed, tell them an admin can get it in Settings, Pictures and videos.",
  style_needs_detailed: "That style only works with Detailed pictures, so this one is Detailed and takes a little longer. Say so in one short sentence.",
  style_needs_quick: "That style only works with Quick pictures, so this one was made Quick.",
};
