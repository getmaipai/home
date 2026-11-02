// VIDEO-LTX-01 (owner ruling 2026-10-17): the person-facing video choice, the SAME plain words as pictures (lib/pictures/quality.ts).
// "Quick" is the silent five second clip (about two minutes, can start from a picture) and the default; "Detailed" makes a sound
// track with spoken words in the same pass, up to ten seconds, about a minute to two (measured: it is not slower than Quick), starts
// from words only for now, and has the large community library of styles. The words "Wan",
// "FastWan", "LTX" and "Gemma" never reach a person outside the Details disclosure; this file is the one place that maps the two
// to the Stack. Rule 0 is untouched: the age and surface gates ran before anything here, and the finished-clip age check runs on
// every clip of either kind.
import { householdVideoQuality } from "./policy";
import type { StackLtx25Profile, StackVideoStatus } from "./stack";

export type VideoQuality = "quick" | "detailed";
/** The base model a Stack LoRA record names for each kind. */
export const QUICK_BASE = "wan2.2-ti2v-5b";
export const DETAILED_BASE = "ltx-2.3";
export const QUICK_MAX_SECONDS = 5;
export const DETAILED_MAX_SECONDS = 10;
/** VIDEO-TIERS-01: LTX-2.5 with sound. Adults only; no LoRA (the Stack answers 422 to one). A picture start needs the Stack's `image_to_video` flag (VIDEO-INPUTS-01), read by `ltx25PictureReady`. */
export const LTX25_MODEL = "ltx25-q8";
/** LTX25-MAX-01: the Max level of LTX-2.5 (bf16, 1024x576, up to 10 s, sound). Adults who hold Max only; no LoRA; a picture start needs `ltx25MaxPictureReady`. */
export const LTX25_MAX_MODEL = "ltx25-max";
/** The Max size and ceiling used until the Stack's own `max` profile says otherwise (a profile can only lower the ceiling). */
export const LTX25_MAX_DEFAULTS = { landscape: "1024x576", portrait: "576x1024", max_seconds: 10 };
/** Which model makes a clip: Wan (silent), LTX-2.3 (sound), LTX-2.5 (sound) or LTX-2.5 Max (sound). */
export type VideoMaker = "wan" | "ltx23" | "ltx25" | "ltx25max";
/** The true LTX-2.5 sizes (the engine rounds heights to a multiple of 64; docs/design/video-tiers-2026-11-02.md section 3) and ceilings, used when the Stack's own `profiles` are missing. Standard is 512x256 for 10 s; Boost 768x448 for 5 s (640x320 is the smaller Boost size). */
export const LTX25_DEFAULTS: Record<"standard" | "boost", { landscape: string; portrait: string; max_seconds: number }> = {
  standard: { landscape: "512x256", portrait: "256x512", max_seconds: 10 },
  boost: { landscape: "768x448", portrait: "448x768", max_seconds: 5 },
};

export const isVideoQuality = (value: unknown): value is VideoQuality => value === "quick" || value === "detailed";
export const qualityOfBase = (base: string | null | undefined): VideoQuality | null => (base === DETAILED_BASE ? "detailed" : base === QUICK_BASE ? "quick" : null);
/** The ceiling of each level. Wan: 5 s. LTX-2.3 (Boost): 10 s. LTX-2.5: Standard 10 s, Boost 5 s for now. The one definition; every length in Home reads it. A Stack profile's own `max_seconds` lowers it. */
export function maxSecondsFor(quality: VideoQuality, maker: VideoMaker = quality === "detailed" ? "ltx23" : "wan", engine?: Pick<StackVideoStatus, "qualities"> | null): number {
  if (maker === "wan") return QUICK_MAX_SECONDS;
  if (maker === "ltx23") return DETAILED_MAX_SECONDS;
  if (maker === "ltx25max") return Math.min(LTX25_MAX_DEFAULTS.max_seconds, ltx25MaxProfile(engine ?? null)?.max_seconds ?? Infinity);
  const level = quality === "detailed" ? "boost" : "standard";
  return Math.min(LTX25_DEFAULTS[level].max_seconds, ltx25Profile(engine ?? null, level)?.max_seconds ?? Infinity);
}

/** The sizes of each kind (the Stack's defaults for landscape and its tall shape). */
export const VIDEO_SIZES_BY_QUALITY: Record<VideoQuality, { landscape: string; portrait: string }> = {
  quick: { landscape: "832x480", portrait: "480x832" },
  detailed: { landscape: "768x448", portrait: "448x768" },
};

/** Whether LTX-2.5 can run here now: the Stack reports `qualities.ltx25.ready`. */
export function ltx25VideoReady(engine: Pick<StackVideoStatus, "qualities"> | null): boolean {
  return engine?.qualities?.ltx25?.ready === true;
}
/** Whether LTX-2.5 Max can run here now: the Stack reports `qualities.ltx25max.ready` exactly `true` (pack installed, runtime in place). */
export function ltx25MaxReady(engine: Pick<StackVideoStatus, "qualities"> | null): boolean {
  return engine?.qualities?.ltx25max?.ready === true;
}
/** VIDEO-INPUTS-01: the Stack says an LTX-2.5 Standard or Boost clip can start from a picture (`qualities.ltx25.image_to_video` exactly `true`). Read from the Stack, never assumed. */
export function ltx25PictureReady(engine: Pick<StackVideoStatus, "qualities"> | null): boolean {
  return ltx25VideoReady(engine) && engine?.qualities?.ltx25?.image_to_video === true;
}
/** The same for Max (`qualities.ltx25max.image_to_video` exactly `true`). */
export function ltx25MaxPictureReady(engine: Pick<StackVideoStatus, "qualities"> | null): boolean {
  return ltx25MaxReady(engine) && engine?.qualities?.ltx25max?.image_to_video === true;
}
/** A second picture can end a clip of this maker (`end_image` exactly `true` on its quality). Used only after the End frame bench passes (VIDEO-INPUTS-03). */
export function ltx25EndPictureReady(engine: Pick<StackVideoStatus, "qualities"> | null, max = false): boolean {
  return (max ? ltx25MaxPictureReady(engine) && engine?.qualities?.ltx25max?.end_image === true : ltx25PictureReady(engine) && engine?.qualities?.ltx25?.end_image === true);
}
/** The Stack's `max` profile, or null when it lists none. */
export function ltx25MaxProfile(engine: Pick<StackVideoStatus, "qualities"> | null): StackLtx25Profile | null {
  return (engine?.qualities?.ltx25max?.profiles ?? []).find((p) => p.name === "max") ?? null;
}
/** The Stack's profile for a level (the larger Boost size when it lists two), or null when it lists none. */
export function ltx25Profile(engine: Pick<StackVideoStatus, "qualities"> | null, level: "standard" | "boost"): StackLtx25Profile | null {
  const fits = (engine?.qualities?.ltx25?.profiles ?? []).filter((p) => p.name === level);
  return fits.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}
/** The size to ask for: LTX-2.5's true size from the Stack's profile (else the table above); the older makers keep their own. */
export function videoSizeFor(maker: VideoMaker, quality: VideoQuality, portrait: boolean, engine?: Pick<StackVideoStatus, "qualities"> | null): string {
  if (maker === "ltx25max") {
    const profile = ltx25MaxProfile(engine ?? null);
    if (profile) return portrait ? `${profile.height}x${profile.width}` : `${profile.width}x${profile.height}`;
    return LTX25_MAX_DEFAULTS[portrait ? "portrait" : "landscape"];
  }
  if (maker !== "ltx25") return VIDEO_SIZES_BY_QUALITY[quality][portrait ? "portrait" : "landscape"];
  const level = quality === "detailed" ? "boost" : "standard";
  const profile = ltx25Profile(engine ?? null, level);
  if (profile) return portrait ? `${profile.height}x${profile.width}` : `${profile.width}x${profile.height}`;
  return LTX25_DEFAULTS[level][portrait ? "portrait" : "landscape"];
}
/** The maker of an adult's clip by the model id the request carries. */
export const makerOfModel = (model: string | null | undefined, quality: VideoQuality): VideoMaker => (model === LTX25_MODEL ? "ltx25" : model === LTX25_MAX_MODEL ? "ltx25max" : quality === "detailed" ? "ltx23" : "wan");

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
  /** Which model makes it (VIDEO-TIERS-01): LTX-2.5 only for an adult, from words, when the Stack says it is ready. */
  maker: VideoMaker;
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
export function chooseVideoQuality(input: { requested?: VideoQuality | undefined; style?: { base_model: string } | null; seconds?: number | undefined; engine: StackVideoStatus | null; household?: VideoQuality; /** The clip starts from a picture: Detailed can take it only when the Stack says so (`qualities.detailed.image_to_video`). */ hasPicture?: boolean; /** A teen or a child: Quick and nothing else, whatever was asked (the job starter enforces it again). */ quickOnly?: boolean; /** An adult: the only lane LTX-2.5 serves (a teen or a child never gets it, rules 0, 8 and 10). */ adultLane?: boolean; /** LTX25-MAX-01: Max was asked for and the person holds it (the caller read the grant); used only with a ready Max engine, words only. */ max?: boolean }): VideoQualityChoice {
  const asked = typeof input.seconds === "number" && Number.isFinite(input.seconds) ? Math.round(input.seconds) : undefined;
  const base = qualityOfBase(input.style?.base_model);
  const quickOk = quickVideoReady(input.engine);
  const detailedOk = detailedVideoReady(input.engine);
  // VIDEO-TIERS-01: LTX-2.5 serves an adult's clip made from words (no style; no picture unless the Stack says it can start from one) when the Stack says it is ready. Standard is then
  // 10 s with sound and Boost 5 s with sound; anything else keeps today's models exactly.
  // VIDEO-INPUTS-01: a picture start rides the same models once the Stack reports `image_to_video` for them; an older Stack keeps pictures on the old makers.
  const ltx25Ok = input.adultLane === true && (!input.hasPicture || ltx25PictureReady(input.engine)) && !input.style && ltx25VideoReady(input.engine);
  const ltx25MaxOk = input.max === true && input.adultLane === true && (!input.hasPicture || ltx25MaxPictureReady(input.engine)) && !input.style && ltx25MaxReady(input.engine);
  const fit = (quality: VideoQuality, note: VideoQualityNote, announce: boolean, maker: VideoMaker = quality === "detailed" ? "ltx23" : "wan"): VideoQualityChoice => {
    const ceiling = maxSecondsFor(quality, maker, input.engine);
    const seconds = Math.max(1, Math.min(ceiling, asked ?? 5));
    return { quality, maker, seconds, note, announce, shortened: asked !== undefined && asked > ceiling };
  };
  if (ltx25MaxOk) return fit("detailed", null, true, "ltx25max");
  if (input.quickOnly && !ltx25Ok) return fit("quick", null, false);
  if (input.style && base) {
    if (base === "detailed") return fit("detailed", input.requested === "quick" ? "style_needs_detailed" : null, true);
    return fit("quick", input.requested === "detailed" ? "style_needs_quick" : null, false);
  }
  if (ltx25Ok) {
    // A length past Boost's five seconds is a Standard clip (10 s) unless Boost was asked for outright.
    const level: VideoQuality = input.quickOnly ? "quick" : input.requested ?? (asked !== undefined && asked > maxSecondsFor("detailed", "ltx25", input.engine) ? "quick" : input.household ?? householdVideoQuality());
    return fit(level, null, input.requested === "detailed", "ltx25");
  }
  const wanted = input.requested ?? (asked !== undefined && asked > QUICK_MAX_SECONDS ? "detailed" : input.household ?? householdVideoQuality());
  // A picture starts a Quick clip only on a Stack that does not say Detailed can start from one (VIDEO-LTX-02); the household's own default stays quiet, a request for Detailed is told why not.
  // VIDEO-TIERS-01: with LTX-2.5 ready, an adult's picture clip says why it is silent, since the Standard level now has sound from words.
  const pictureLtx25 = input.hasPicture && input.adultLane === true && ltx25VideoReady(input.engine);
  if (input.hasPicture && wanted === "detailed" && input.engine?.qualities?.detailed.image_to_video !== true) return fit("quick", input.requested === "detailed" || (asked !== undefined && asked > QUICK_MAX_SECONDS) || pictureLtx25 ? "picture_needs_quick" : null, false);
  if (pictureLtx25 && wanted === "quick") return fit("quick", "picture_needs_quick", false);
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
export function etaWords(quality: VideoQuality, seconds: number, maker: VideoMaker = quality === "detailed" ? "ltx23" : "wan"): string {
  // LTX-2.5 (measured: Standard 10 s about 43 s, Boost 5 s 42 to 74 s).
  if (maker === "ltx25max") return "about four minutes";
  if (maker === "ltx25") return "about a minute";
  if (quality === "quick") return "about two minutes";
  return seconds <= 5 ? "about a minute" : "about two minutes";
}
