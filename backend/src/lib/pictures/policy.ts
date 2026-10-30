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
import { readSlot, slotIsOff } from "@/lib/tiers";
// Registers the mirror from the legacy Quick and Detailed keys into the slots this file reads.
import "@/lib/tierSlotMigration";
import { speakerAgeBand } from "@/lib/ageBand";
import { mentionsSexualWord, minorSexualMatch, mixedScriptMinorCue, normalise } from "@/lib/pictures/minorLine";
import { CHILD_CONTENT_LINE, TEEN_CONTENT_LINE, childPromptUnsafe, kidLaneOn, laneOf, teenPromptUnsafe, type Lane } from "@/lib/pictures/lane";


export const GENERATION_ADULTS_KEY = "generation.adults";
export const GENERATION_ADULT_ADAPTERS_KEY = "generation.adult_adapters";
/** REALPEOPLE-MODEL-2026-10-25: ends the tool result of a started picture job. The job is already running, so the answering round must confirm it and not refuse in prose after the fact (measured: the tool was called, then the reply said it could not). */
export const PICTURE_STARTED_CONFIRM_NOTE = "The request is allowed and the picture is already being made: confirm that and do not refuse, warn or suggest something else.";

export const GENERATION_PICTURE_QUALITY_KEY = "generation.picture_quality";

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
  minor: "Making pictures is off for this profile. A parent can turn it on in Settings, Pictures, videos and music.",
  spoken: "Pictures can only be made in a written chat on your own screen.",
  shared_screen: "Pictures can only be made on your own screen, not a shared one.",
  household_off: "Making pictures is switched off for adults in this home. An admin can switch it on in Settings, Pictures, videos and music.",
  temporary_unsupported: "Pictures can't be made in this chat.",
};

/** The reply when a model proposes a picture on a turn that was never offered the tool (no picture model, a turn that cannot make one). */
export const PICTURE_NOT_HERE_LINE = "I can't make a picture here right now. It takes an adult on their own screen and a picture model on this computer.";

/** Why this person may not make a picture here, or null when they may. */
export function pictureDenial(input: PictureAudience): PictureDenial | null {
  if (input.actor.role === "guest") return "guest";
  // The lane is the stricter of the turn's band and the person's own (lane.ts). A teen may make pictures (nothing adult), a child
  // only in the cartoon lane (on by default, off with the home switch or the child's own); an adult needs the adult household switch.
  const lane = laneOf(input);
  if (lane === "child" && !kidLaneOn(input.actor)) return "minor";
  if (input.spoken || input.surfaceClass !== "written") return input.surfaceClass === "glance" ? "shared_screen" : "spoken";
  if (input.surface !== "chat") return input.surface === "tv" ? "shared_screen" : "spoken";
  if (lane === "adult" && !householdAllowsAdults()) return "household_off";
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

/** `generation.picture_quality`: "quick" (default) or "detailed". Read failures read as quick, the fast one. */
export function householdPictureQuality(): "quick" | "detailed" {
  try {
    return getHouseholdSettingValue(GENERATION_PICTURE_QUALITY_KEY) === "detailed" ? "detailed" : "quick";
  } catch {
    return "quick";
  }
}

/** The picture Standard slot (`engines.image.tier.standard`; migrated from `generation.picture_quick_model`): "ernie" (default) or "klein", the model behind Quick pictures. */
export function householdQuickModel(): "ernie" | "klein" {
  try {
    return readSlot("image", "standard").model === "flux2-klein-4b" ? "klein" : "ernie";
  } catch {
    return "ernie";
  }
}

/** The picture Boost slot is on (`engines.image.tier.boost`; migrated from `generation.picture_detailed.enabled`): the Detailed pictures switch on the AI and models page. On unless turned off. */
export function householdDetailedEnabled(): boolean {
  try {
    return !slotIsOff("image", "boost");
  } catch {
    return true;
  }
}

/** Which adapter audiences this person may use right now. Adult-only needs an allowed adult on a written, own-screen turn and the household not restricting them; everyone else gets only all-ages (and in practice nothing, since a person who may not make pictures never reaches this). */
export function adapterAudiencesFor(input: PictureAudience): Array<"all-ages" | "adult-only"> {
  if (!picturesAllowed(input)) return [];
  // A teen or a child is only ever offered all-ages styles, whatever the household says about adult-only ones.
  if (laneOf(input) !== "adult") return ["all-ages"];
  return adultAdaptersAllowed() ? ["all-ages", "adult-only"] : ["all-ages"];
}

// ---------------------------------------------------------------- absolute lines

export type PromptRefusal = "minor_sexual" | "teen_content" | "child_content";

export const PROMPT_REFUSAL_LINE: Record<PromptRefusal, string> = {
  minor_sexual: "I can't make that. Pictures of children in sexual situations are never allowed.",
  teen_content: TEEN_CONTENT_LINE,
  child_content: CHILD_CONTENT_LINE,
};

/** CSAM detection for adults and the stricter minor content floor for children and teens. */
export function promptViolatesMinorLine(prompt: string, lane?: Lane): boolean {
  if (detectCsam(prompt).matched.length > 0) return true;
  // Adults are held to the direct CSAM detector. The broader minor plus
  // sexual wording floor belongs to child and teen generation only.
  return lane !== "adult" && (minorSexualMatch(prompt) || mixedScriptMinorCue(prompt));
}

/** The prompt-level refusal, or null when the request may proceed. */
export function refusePrompt(prompt: string, flags: { lane?: Lane } = {}): PromptRefusal | null {
  if (promptViolatesMinorLine(prompt, flags.lane)) return "minor_sexual";
  // A child's or a teen's wording is held to their lane (one short line, never a lecture).
  if (flags.lane === "child") {
    if (childPromptUnsafe(prompt) || asksToUndress(prompt)) return "child_content";
    return null;
  }
  if (flags.lane === "teen") {
    if (teenPromptUnsafe(prompt) || asksToUndress(prompt)) return "teen_content";
  }
  // Adults are held only to CSAM prevention; the model decides other content.
  return null;
}

/** Whether the words ask for sexual content at all. */
export function mentionsSexualContent(text: string): boolean {
  return mentionsSexualWord(text);
}

const UNDRESSING = /\b(?:remove|removing|removes|take|taking|takes|strip|stripping|get|getting|pull|pulling|lift|lifting)\b[^.]{0,40}\b(?:clothes|clothing|clothed|shirt|blouse|dress|top|bra|pants|trousers|skirt|underwear|swimsuit|swimwear|bikini|outfit|robe|towel)\b|\b(?:without|no)\s+(?:clothes|clothing|a shirt|a top|a bra|underwear)\b|\b(?:shirtless|topless|bottomless|naked|nude|undressed|see through|bare chest|bare skin|bare breasts)\b/;

export function asksToUndress(text: string): boolean {
  const normalised = normalise(text).trim();
  // Include ordinary swimwear in strict kid lanes.
  return mentionsSexualContent(text) || UNDRESSING.test(normalised) || /\bbikini\b/.test(normalised);
}
