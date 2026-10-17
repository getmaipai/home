// IMGGEN-HOME-01 / IMGGEN-SAFE-01: who may make a picture, on which surface,
// with which adapters, and the two absolute lines checked before any job
// starts. Rule 0 of docs/design/RULES.md: age and surface gates outrank every
// other rule. Everything here is deterministic and runs before the Stack is
// asked; nothing in a household setting reaches the absolute lines.
//
// Who may make a picture (docs/design/image-generation-2026-10-17.md):
//   - an owner, admin or adult on their own written chat screen, when the
//     household has pictures on for adults (`generation.adults`, default on);
//   - never a child or a teen. Their switch exists in the design, but a
//     picture they would see needs a finished-picture check that is not built
//     (IMGGEN-SAFE-01), so the answer is fixed at no until it is. The tool is
//     not offered to them and every route refuses them;
//   - never a guest, a spoken turn, a glance or shared screen (a TV), a robot
//     or a pod.
import { detectCsam } from "@maipai/spec/safety/ts/signals.js";
import type { AgeBand } from "@/lib/ageBand";
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { Surface } from "@/lib/turnShared";
import type { PersonRow } from "@/types";
import { getHouseholdSettingValue } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";

export const GENERATION_ADULTS_KEY = "generation.adults";
export const GENERATION_ADULT_ADAPTERS_KEY = "generation.adult_adapters";

export type PictureDenial = "guest" | "minor" | "spoken" | "shared_screen" | "household_off" | "temporary_unsupported";

export interface PictureAudience {
  actor: PersonRow;
  /** The band of the person speaking (the turn's plan band, or the signed-in person's own band on a route). */
  band: AgeBand;
  surface: Surface;
  surfaceClass: SurfaceClass;
  spoken: boolean;
}

export const PICTURE_DENIAL_LINE: Record<PictureDenial, string> = {
  guest: "Guests can't make pictures. Ask someone in the household to sign you in.",
  minor: "Making pictures is off for this profile. A parent can read why in Settings, Pictures and videos.",
  spoken: "Pictures can only be made in a written chat on your own screen.",
  shared_screen: "Pictures can only be made on your own screen, not a shared one.",
  household_off: "Making pictures is switched off for adults in this home. An admin can switch it on in Settings, Pictures and videos.",
  temporary_unsupported: "Pictures can't be made in this chat.",
};

/** The reply when a model proposes a picture on a turn that was never offered the tool (no picture model, a turn that cannot make one). */
export const PICTURE_NOT_HERE_LINE = "I can't make a picture here right now. It takes an adult on their own screen and a picture model on this computer.";

/** Why this person may not make a picture here, or null when they may. */
export function pictureDenial(input: PictureAudience): PictureDenial | null {
  if (input.actor.role === "guest") return "guest";
  if (input.band !== "adult" || speakerAgeBand(input.actor, new Date()) !== "adult") return "minor";
  if (input.spoken || input.surfaceClass !== "written") return input.surfaceClass === "glance" ? "shared_screen" : "spoken";
  if (input.surface !== "chat") return input.surface === "tv" ? "shared_screen" : "spoken";
  if (!householdAllowsAdults()) return "household_off";
  return null;
}

export function picturesAllowed(input: PictureAudience): boolean {
  return pictureDenial(input) === null;
}

/** `generation.adults`: the household switch for adults (default on). Read failures read as the default, never as a reason to block or to allow a minor. */
export function householdAllowsAdults(): boolean {
  try {
    return getHouseholdSettingValue(GENERATION_ADULTS_KEY) !== false;
  } catch {
    return true;
  }
}

/** `generation.adult_adapters`: "allowed" (default) or "restricted". */
export function adultAdaptersAllowed(): boolean {
  try {
    return getHouseholdSettingValue(GENERATION_ADULT_ADAPTERS_KEY) !== "restricted";
  } catch {
    return true;
  }
}

/** Which adapter audiences this person may use right now. Adult-only needs an allowed adult on a written, own-screen turn and the household not restricting them; everyone else gets only all-ages (and in practice nothing, since a person who may not make pictures never reaches this). */
export function adapterAudiencesFor(input: PictureAudience): Array<"all-ages" | "adult-only"> {
  if (!picturesAllowed(input)) return [];
  return adultAdaptersAllowed() ? ["all-ages", "adult-only"] : ["all-ages"];
}

// ---------------------------------------------------------------- absolute lines

export type PromptRefusal = "minor_sexual" | "real_person";

export const PROMPT_REFUSAL_LINE: Record<PromptRefusal, string> = {
  // Worded without the age and adult-content words the output floor itself watches for: the refusal must reach the person, not be refused in turn.
  minor_sexual: "I won't make that. Pictures that put a young person, or anyone who looks young, in an adult scene are never made here, whatever the settings. Change the request and try again.",
  real_person: "I won't make a picture of a real person's likeness, because they haven't agreed to it. Ask for an invented person, a character or a place instead.",
};

// Words that put a minor or a minor-looking person in a picture. A picture engine draws what it is told, so the
// check is wider than the chat floor's: "schoolgirl", "tiny", "petite" and "innocent" count here.
const MINOR_LOOKING = [
  "child", "children", "kid", "kids", "kiddo", "minor", "underage", "under age", "preteen", "pre teen", "tween", "teen", "teens", "teenager", "teenage",
  "toddler", "baby", "infant", "boy", "boys", "girl", "girls", "little girl", "little boy", "young girl", "young boy", "schoolgirl", "schoolboy", "school girl", "school boy",
  "loli", "lolita", "lolicon", "shota", "shotacon", "juvenile", "underaged", "teenaged", "teen aged", "young looking", "youthful looking", "youth", "youthful", "childlike", "child like", "childish", "babyface", "baby face", "flat chest", "flat chested", "petite", "tiny", "innocent", "prepubescent",
  "barely legal", "just turned 18", "freshman", "high school", "middle school", "elementary", "kindergarten", "grade school",
  "13 year", "14 year", "15 year", "16 year", "17 year", "12 year", "11 year", "10 year", "9 year", "8 year", "7 year", "6 year", "5 year", "4 year", "3 year", "2 year",
];
const SEXUAL = [
  "nude", "naked", "nudity", "topless", "bottomless", "undress", "undressed", "undressing", "lingerie", "underwear", "panties", "bra", "bikini", "thong", "cleavage", "breasts", "boobs", "nipples",
  "genital", "genitals", "vagina", "penis", "cock", "pussy", "buttocks", "crotch", "groin",
  "sex", "sexy", "sexual", "sexualized", "sexualised", "erotic", "erotica", "porn", "porno", "pornographic", "nsfw", "explicit", "lewd", "hentai", "ecchi", "fetish", "seductive", "provocative", "suggestive",
  "orgasm", "masturbat", "fellatio", "blowjob", "cumshot", "intercourse", "molest", "rape", "bondage", "kinky", "xxx", "r18", "uncensored", "spread legs", "legs spread",
];

// Plain ways to say a person has no clothes on without any of the words above ("two kids playing, no clothes"). Beside a
// minor or minor-looking term they cross the same line; alone they are ordinary (a shirtless man at the beach passes).
const UNCLOTHED = [
  "unclothed", "shirtless", "no clothes", "no clothing", "without clothes", "without clothing", "without a shirt", "clothes off", "clothing off", "stripped", "skinny dipping", "skinny dip",
  "bare chested", "bare skin", "bare bottom", "bare butt", "birthday suit", "au naturel", "wearing nothing", "not wearing anything", "not wearing any clothes",
];

// "14yo", "15 y o", "16-year-old", "12 years old": any age below 18 written with digits.
const MINOR_AGE_DIGITS = /\b(?:[1-9]|1[0-7])\s?(?:yo|y o|yr|yrs|year|years|yr old|yrs old)\b/;

function normalise(text: string): string {
  return ` ${text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}
function hasWord(haystack: string, term: string): boolean {
  const needle = ` ${term} `;
  if (haystack.includes(needle)) return true;
  // A stem such as "masturbat" or "molest" matches the start of a word.
  return term.length >= 6 && haystack.includes(` ${term}`);
}

/** The absolute line on a minor, applied to every picture request for every person, with no setting that reaches it. A sexual term anywhere beside a minor or minor-looking term refuses, however far apart they are: the request is short and over-refusing it costs a rephrase, under-refusing it costs a child. The chat floor's own `detectCsam` runs first. */
export function promptViolatesMinorLine(prompt: string): boolean {
  if (detectCsam(prompt).matched.length > 0) return true;
  const text = normalise(prompt);
  const sexual = SEXUAL.some((term) => hasWord(text, term)) || UNCLOTHED.some((term) => hasWord(text, term));
  if (!sexual) return false;
  return MINOR_LOOKING.some((term) => hasWord(text, term)) || MINOR_AGE_DIGITS.test(text);
}

/** The prompt-level refusal, or null when the request may proceed. `depictsRealPerson` is the model's own statement in the tool call that the person asked for the likeness of a real, named or identifiable person; there is no word list of names, and the Stack refuses likeness adapters at import. */
export function refusePrompt(prompt: string, flags: { depictsRealPerson?: boolean } = {}): PromptRefusal | null {
  if (promptViolatesMinorLine(prompt)) return "minor_sexual";
  if (flags.depictsRealPerson === true) return "real_person";
  return null;
}

/** Whether the words ask for sexual content at all (used where the picture may show a real person: an uploaded photo is never changed into that). */
export function mentionsSexualContent(text: string): boolean {
  const normalised = normalise(text);
  return SEXUAL.some((term) => hasWord(normalised, term));
}

const UNDRESSING = /\b(?:remove|removing|removes|take|taking|takes|strip|stripping|get|getting|pull|pulling|lift|lifting)\b[^.]{0,40}\b(?:clothes|clothing|clothed|shirt|blouse|dress|top|bra|pants|trousers|skirt|underwear|swimsuit|swimwear|bikini|outfit|robe|towel)\b|\b(?:without|no)\s+(?:clothes|clothing|a shirt|a top|a bra|underwear)\b|\b(?:shirtless|topless|bottomless|naked|nude|undressed|see through|bare chest|bare skin|bare breasts)\b/;

/** Words that undress or sexualize a person in a picture: a stricter reading than `mentionsSexualContent`, used where the picture is a photo that may show a real person. A word list cannot catch every phrasing, which is why it is paired with the rule that an uploaded photo is only ever changed in ways that leave the person clothed, and is named as a limit in docs/design/image-engine-2026-10-17.md. */
export function asksToUndress(text: string): boolean {
  const normalised = normalise(text).trim();
  return mentionsSexualContent(text) || UNDRESSING.test(normalised);
}
