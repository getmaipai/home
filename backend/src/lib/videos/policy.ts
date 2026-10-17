// VIDEO-GEN-04: who may make a video, on which surface, with which LoRAs, and the absolute lines checked before
// any job starts. Rule 0 of docs/design/RULES.md: age and surface gates outrank every other rule. The age and
// surface half is the picture policy's (pictures/policy.ts: one definition), minus the picture household switch;
// the video household switch (`generation.video.enabled`) is this file's. Nothing in a household setting reaches
// the absolute lines.
//
// Who may make a video (docs/design/video-generation-2026-10-17.md, section 10):
//   - an owner, admin or adult on their own written chat screen, when the household has video on for adults
//     (`generation.video.enabled`, default on) and the Stack's video role is installed;
//   - never a child or a teen: video is off for every minor and no setting turns it on. The tool is not offered to
//     them and every route refuses them;
//   - never a guest, a spoken turn, a glance or shared screen (a TV), a robot or a pod.
import { getHouseholdSettingValue } from "@/lib/settings";
import { pictureDenial, promptViolatesMinorLine, refusePrompt, type PictureAudience, type PromptRefusal } from "@/lib/pictures/policy";
import { CHILD_CONTENT_LINE, TEEN_CONTENT_LINE, laneOf, type Lane } from "@/lib/pictures/lane";

export const VIDEO_ENABLED_KEY = "generation.video.enabled";
export const VIDEO_ADULT_ADAPTERS_KEY = "generation.video.adult_adapters";

export type VideoAudience = PictureAudience;
export type VideoDenial = "guest" | "minor" | "spoken" | "shared_screen" | "household_off";

export const VIDEO_DENIAL_LINE: Record<VideoDenial, string> = {
  guest: "Guests can't make videos. Ask someone in the household to sign you in.",
  minor: "Making videos is off for this profile. A parent can turn it on in Settings, Pictures and videos.",
  spoken: "Videos can only be made in a written chat on your own screen.",
  shared_screen: "Videos can only be made on your own screen, not a shared one.",
  household_off: "Making videos is switched off for adults in this home. An admin can switch it on in Settings, Pictures and videos.",
};

/** The reply when a model proposes a video on a turn that was never offered the tool (no video model, a turn that cannot make one). */
export const VIDEO_NOT_HERE_LINE = "I can't make a video here right now. It takes an adult on their own screen and a video model on this computer.";

/** `generation.video.enabled`: the household switch for adults (default on). A read failure reads as the default, never as a reason to allow a minor. */
export function householdAllowsVideo(): boolean {
  try {
    return getHouseholdSettingValue(VIDEO_ENABLED_KEY) !== false;
  } catch {
    return true;
  }
}

/** `generation.video.adult_adapters`: "allowed" (default) or "restricted". */
export function adultVideoAdaptersAllowed(): boolean {
  try {
    return getHouseholdSettingValue(VIDEO_ADULT_ADAPTERS_KEY) !== "restricted";
  } catch {
    return true;
  }
}

/** Why this person may not make a video here, or null when they may. The age and surface gate is the picture policy's, so the two can never drift apart. */
export function videoDenial(input: VideoAudience): VideoDenial | null {
  const base = pictureDenial(input);
  if (base === "guest" || base === "minor" || base === "spoken" || base === "shared_screen") return base;
  return householdAllowsVideo() ? null : "household_off";
}

export function videosAllowed(input: VideoAudience): boolean {
  return videoDenial(input) === null;
}

/** Which LoRA classes this person may use right now. Adult-only needs an allowed adult on a written, own-screen turn and the household not restricting them. */
export function videoAdapterAudiencesFor(input: VideoAudience): Array<"all-ages" | "adult-only"> {
  if (!videosAllowed(input)) return [];
  if (laneOf(input) !== "adult") return ["all-ages"];
  return adultVideoAdaptersAllowed() ? ["all-ages", "adult-only"] : ["all-ages"];
}

/** The audience the Stack is told: `adult` only for an allowed adult whose household lets adults use adult-only LoRAs, else `all-ages` (the Stack's second lock). */
export function stackAudienceFor(input: VideoAudience): "all-ages" | "adult" {
  return videoAdapterAudiencesFor(input).includes("adult-only") ? "adult" : "all-ages";
}

// ---------------------------------------------------------------- absolute lines

export const VIDEO_REFUSAL_LINE: Record<PromptRefusal, string> = {
  minor_sexual: "I can't make that. Videos of children in sexual situations are never allowed.",
  real_person: "I won't make a video of a real person's likeness, because they haven't agreed to it. Ask for an invented person, a character or a place instead.",
  teen_content: TEEN_CONTENT_LINE,
  child_content: CHILD_CONTENT_LINE,
};

/** The prompt-level refusal, or null when the request may proceed. The minor line is the picture policy's check (one list), applied to the clip's prompt for everyone. `depictsRealPerson` is the model's own statement in the tool call; there is no word list of names. */
export function refuseVideoPrompt(prompt: string, flags: { depictsRealPerson?: boolean; lane?: Lane } = {}): PromptRefusal | null {
  return refusePrompt(prompt, flags);
}
