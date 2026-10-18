// VIDEO-LTX-01 (owner ruling 2026-10-17): the person-facing video choice, the SAME plain words as pictures (lib/pictures/quality.ts).
// "Quick" is the silent five second clip (about two minutes, can start from a picture) and the default; "Detailed" makes a sound
// track with spoken words in the same pass, up to ten seconds, about a minute to two (measured: it is not slower than Quick), starts
// from words only for now, and has the large community library of styles. The words "Wan",
// "FastWan", "LTX" and "Gemma" never reach a person outside the Details disclosure; this file is the one place that maps the two
// to the Stack. Rule 0 is untouched: the age and surface gates ran before anything here, and the finished-clip age check runs on
// every clip of either kind.
import { householdVideoQuality } from "./policy";
import type { StackVideoStatus } from "./stack";

export type VideoQuality = "quick" | "detailed";
/** The base model a Stack LoRA record names for each kind. */
export const QUICK_BASE = "wan2.2-ti2v-5b";
export const DETAILED_BASE = "ltx-2.3";
export const QUICK_MAX_SECONDS = 5;
export const DETAILED_MAX_SECONDS = 10;

export const isVideoQuality = (value: unknown): value is VideoQuality => value === "quick" || value === "detailed";
export const qualityOfBase = (base: string | null | undefined): VideoQuality | null => (base === DETAILED_BASE ? "detailed" : base === QUICK_BASE ? "quick" : null);
export const maxSecondsFor = (quality: VideoQuality): number => (quality === "detailed" ? DETAILED_MAX_SECONDS : QUICK_MAX_SECONDS);

/** The sizes of each kind (the Stack's defaults for landscape and its tall shape). */
export const VIDEO_SIZES_BY_QUALITY: Record<VideoQuality, { landscape: string; portrait: string }> = {
  quick: { landscape: "832x480", portrait: "480x832" },
  detailed: { landscape: "768x448", portrait: "448x768" },
};

/** Whether Detailed can run here now: the Stack lists it as installed and this computer's tier can run it. */
export function detailedVideoReady(engine: Pick<StackVideoStatus, "qualities"> | null): boolean {
  const detailed = engine?.qualities?.detailed;
  return Boolean(detailed && detailed.installed && detailed.available);
}
/** Whether Quick can run here now. An older Stack (no `qualities`) is Quick only, judged by its own state. */
export function quickVideoReady(engine: StackVideoStatus | null): boolean {
  if (!engine) return false;
  if (engine.qualities) return engine.qualities.quick.installed && engine.qualities.quick.available;
  return engine.state !== "unsupported" && engine.state !== "off" && engine.state !== "not-installed" && engine.available !== false;
}

/** Why the video is not the kind that was wanted, as a code the tool turns into one sentence for the model to relay. */
export type VideoQualityNote = "detailed_not_installed" | "quick_not_installed" | "style_needs_detailed" | "style_needs_quick" | "picture_needs_quick" | null;

export interface VideoQualityChoice {
  quality: VideoQuality;
  /** The seconds to ask for, held to the kind's ceiling. */
  seconds: number;
  note: VideoQualityNote;
  /** True when Detailed was asked for outright, or a style needs it, or the length needs it: the reply says so. */
  announce: boolean;
  /** The length asked for was cut to fit this kind. */
  shortened: boolean;
}

/**
 * The kind for one video. A style (LoRA) is made for one model, so it decides. With no style, a length past five seconds needs
 * Detailed (a fact of the models, not a reading of words), else the request's own choice, else the household's setting. Detailed
 * that is not installed falls back to Quick with a note and the five second ceiling.
 */
export function chooseVideoQuality(input: { requested?: VideoQuality | undefined; style?: { base_model: string } | null; seconds?: number | undefined; engine: StackVideoStatus | null; household?: VideoQuality; /** The clip starts from a picture: Detailed can take it only when the Stack says so (`qualities.detailed.image_to_video`). */ hasPicture?: boolean; /** A teen or a child: Quick and nothing else, whatever was asked (the job starter enforces it again). */ quickOnly?: boolean }): VideoQualityChoice {
  const asked = typeof input.seconds === "number" && Number.isFinite(input.seconds) ? Math.round(input.seconds) : undefined;
  const base = qualityOfBase(input.style?.base_model);
  const quickOk = quickVideoReady(input.engine);
  const detailedOk = detailedVideoReady(input.engine);
  const fit = (quality: VideoQuality, note: VideoQualityNote, announce: boolean): VideoQualityChoice => {
    const ceiling = maxSecondsFor(quality);
    const seconds = Math.max(1, Math.min(ceiling, asked ?? 5));
    return { quality, seconds, note, announce, shortened: asked !== undefined && asked > ceiling };
  };
  if (input.quickOnly) return fit("quick", null, false);
  if (input.style && base) {
    if (base === "detailed") return fit("detailed", input.requested === "quick" ? "style_needs_detailed" : null, true);
    return fit("quick", input.requested === "detailed" ? "style_needs_quick" : null, false);
  }
  const wanted = input.requested ?? (asked !== undefined && asked > QUICK_MAX_SECONDS ? "detailed" : input.household ?? householdVideoQuality());
  // A picture starts a Quick clip only on a Stack that does not say Detailed can start from one (VIDEO-LTX-02); the household's own default stays quiet, a request for Detailed is told why not.
  if (input.hasPicture && wanted === "detailed" && input.engine?.qualities?.detailed.image_to_video !== true) return fit("quick", input.requested === "detailed" || (asked !== undefined && asked > QUICK_MAX_SECONDS) ? "picture_needs_quick" : null, false);
  if (wanted === "detailed") {
    if (detailedOk) return fit("detailed", null, input.requested === "detailed" || (asked !== undefined && asked > QUICK_MAX_SECONDS));
    return fit("quick", "detailed_not_installed", false);
  }
  if (!quickOk && detailedOk) return fit("detailed", "quick_not_installed", true);
  return fit("quick", null, false);
}

/** The line the model relays for a quality note (plain words, no model names). */
export const VIDEO_QUALITY_NOTE_LINE: Record<Exclude<VideoQualityNote, null>, string> = {
  detailed_not_installed: "Detailed videos, the ones with sound and speech, are not on this computer yet, so this one was made Quick: 5 seconds at most, with no sound. If they want Detailed, tell them an admin can get it in Settings, Models and storage.",
  quick_not_installed: "Quick videos are not on this computer, so this one is Detailed, with sound.",
  style_needs_detailed: "That style only works with Detailed videos, so this one is Detailed, with sound.",
  style_needs_quick: "That style only works with Quick videos, so this one was made Quick, with no sound.",
  picture_needs_quick: "A video that starts from a picture is always a Quick one for now, so it has no sound and is at most 5 seconds. If they want sound or speech, offer to make a Detailed video from words instead.",
};

/** How long a video takes, in the person's words, by kind and length (measured on the Studio: Quick about two minutes; Detailed 42 to 49 s for 5 s, 65 to 81 s for 8 to 10 s, a little more the first time a worker loads the model). */
export function etaWords(quality: VideoQuality, seconds: number): string {
  if (quality === "quick") return "about two minutes";
  return seconds <= 5 ? "about a minute" : "about two minutes";
}
