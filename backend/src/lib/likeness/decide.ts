// One decision for every request that uses a bound household likeness. The
// requester gate, living adult subject check and household option are kept
// together so tools and queued jobs cannot skip a check.
import { pictureDenial, asksToUndress, type PictureAudience } from "@/lib/pictures/policy";
import { getHouseholdSettingValue } from "@/lib/settings";
import { laneOf } from "@/lib/pictures/lane";
import { householdAdults, subjectEligibility, type SubjectWhy } from "./resolve";
import type { PersonRow } from "@/types";

export type LikenessWay = "style" | "photo";
export type LikenessMedium = "picture" | "video";
export type LikenessDenial = "requester" | "no_subject" | "subject_minor" | "subject_unknown" | "household_off" | "adult_content_other_subject";

export interface LikenessAsk {
  requester: PictureAudience;
  subjectPersonId: string | null | undefined;
  adultContent: boolean;
}

export type LikenessDecision =
  | { ok: true; subject: PersonRow; self: boolean }
  | { ok: false; denial: LikenessDenial; line: string };

export function subjectName(person: PersonRow): string { return person.nickname?.trim() || person.displayName; }

export const ADULT_CONTENT_OTHER_SUBJECT_LINE = "Adult pictures of another person need their yes each time, and that is coming soon. Ask for something else, or an invented character.";

const SUBJECT_LINES: Record<SubjectWhy, string> = {
  unknown: "I can only make something that looks like a living adult in this household. I couldn't find that person here.",
  gone: "I can only make something that looks like a living adult in this household. That person isn't here any more.",
  guest: "I can only make something that looks like a living adult in this household. A guest can't be a subject.",
  minor: "I never make a picture or video that looks like a child or a teen.",
  memorial: "I can only make something that looks like a living adult in this household. That profile is a memorial.",
};

export const LIKENESS_LINES = {
  requester: "Pictures and videos that look like another person can only be made by an adult on their own written screen.",
  no_subject: "Say which adult in this household it should look like. I won't make a picture or video of someone else.",
  household_off: "Pictures and videos of people in this household are switched off. An admin can switch them on in Settings.",
  adult_content_other_subject: ADULT_CONTENT_OTHER_SUBJECT_LINE,
} as const;

export const HOUSEHOLD_LIKENESS_KEY = "generation.household_likeness";
/** Engine-side protection for another adult's likeness until per-use approval ships. */
export const NO_ADULT_CONTENT_NEGATIVE = "nude, naked, nudity, topless, nsfw, explicit, sexual, lingerie, underwear";

/** Default-on household option from the shared settings registry. */
export function householdLikenessOn(): boolean {
  try { return getHouseholdSettingValue(HOUSEHOLD_LIKENESS_KEY) !== false; } catch { return true; }
}

export function isAdultContentRequest(input: { text: string; otherAdultOnlyStyle?: boolean }): boolean {
  return input.otherAdultOnlyStyle === true || asksToUndress(input.text);
}

export function decideLikeness(ask: LikenessAsk): LikenessDecision {
  if (pictureDenial(ask.requester) !== null || laneOf(ask.requester) !== "adult") return { ok: false, denial: "requester", line: LIKENESS_LINES.requester };
  if (!ask.subjectPersonId) return { ok: false, denial: "no_subject", line: LIKENESS_LINES.no_subject };
  const eligible = subjectEligibility(ask.subjectPersonId);
  if (!eligible.ok) return { ok: false, denial: eligible.why === "minor" ? "subject_minor" : "subject_unknown", line: SUBJECT_LINES[eligible.why] };
  const subject = eligible.person;
  const self = subject.id === ask.requester.actor.id;
  if (!self && !householdLikenessOn()) return { ok: false, denial: "household_off", line: LIKENESS_LINES.household_off };
  if (!self && ask.adultContent) return { ok: false, denial: "adult_content_other_subject", line: ADULT_CONTENT_OTHER_SUBJECT_LINE };
  return { ok: true, subject, self };
}

export { householdAdults, subjectEligibility };
