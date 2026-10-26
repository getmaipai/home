// LIKENESS-01: the one decision about a request that makes something look like a household member. Run at the policy
// node, at the tool, at every route, and again while the job waits (jobGuard.ts). The age and surface gate comes first
// and is the picture policy's own: a request that is not an adult on their own written chat screen (a child, a teen,
// a guest, a spoken turn, a shared screen) never reaches this decision at all. Nothing here makes anything more
// permissive than policy allows: only a requester may be the subject of adult content.
import { pictureDenial, asksToUndress, type PictureAudience } from "@/lib/pictures/policy";
import { isAdultSubject, subjectEligibility, type SubjectWhy } from "./eligibility";
import { laneOf } from "@/lib/pictures/lane";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

export type LikenessWay = "style" | "photo";
export type LikenessMedium = "picture" | "video";
export type LikenessDenial = "requester" | "no_subject" | "subject_minor" | "subject_unknown" | "household_off" | "adult_content_other";

export interface LikenessAsk {
  requester: PictureAudience;
  subjectPersonId: string | null | undefined;
  /** Whether the request is an adult-content one (see `isAdultContentRequest`). */
  adultContent: boolean;
}

export type LikenessDecision =
  | { ok: true; subject: PersonRow; self: boolean }
  | { ok: false; denial: LikenessDenial; line: string };

export function subjectName(person: PersonRow): string { return person.nickname?.trim() || person.displayName; }

const SUBJECT_LINES: Record<SubjectWhy, string> = {
  unknown: "I can only make something that looks like a living member of this household. I couldn't find that person. Choose someone in your family.",
  gone: "I can only make something that looks like a living member of this household. That person is no longer here. Choose someone in your family.",
  guest: "I can only make something that looks like a member of this household. Guests aren't eligible. Choose someone in your family.",
  memorial: "I can only make something that looks like a living member of this household. That profile is a memorial. Choose someone in your family.",
};

export const LIKENESS_LINES = {
  requester: "Pictures and videos that look like someone in your household are available on a written chat turn. Ask from your own written chat.",
  no_subject: "Say which member of this household it should look like. I won't make a picture or video of an unknown person.",
  household_off: "Pictures and videos of household members are turned off. Ask a household owner or admin to turn on the family likeness option in Settings.",
  adult_content_other: "I can't make adult content that looks like another household member. Use your own saved style, or choose a non-adult request.",
  adult_content_minor: "I never make adult content that looks like a child or teen. Choose an adult subject, or remove the adult content from your request.",
} as const;

/** Whether a request is adult content: its words ask to undress or sexualise someone, or it applies another adult-only style. */
export function isAdultContentRequest(input: { text: string; otherAdultOnlyStyle?: boolean }): boolean {
  return input.otherAdultOnlyStyle === true || asksToUndress(input.text);
}

export const NO_ADULT_CONTENT_NEGATIVE = "nude, naked, nudity, topless, nsfw, explicit, sexual, lingerie, underwear";

/** May this request make something that looks like this person? */
export function decideLikeness(ask: LikenessAsk): LikenessDecision {
  if (pictureDenial(ask.requester) !== null) return { ok: false, denial: "requester", line: LIKENESS_LINES.requester };
  if (laneOf(ask.requester) !== "adult") return { ok: false, denial: "requester", line: LIKENESS_LINES.requester };
  if (!ask.subjectPersonId) return { ok: false, denial: "no_subject", line: LIKENESS_LINES.no_subject };
  const eligible = subjectEligibility(ask.subjectPersonId);
  if (!eligible.ok) return { ok: false, denial: "subject_unknown", line: SUBJECT_LINES[eligible.why] };
  const subject = eligible.person;
  const self = subject.id === ask.requester.actor.id;
  if (ask.adultContent && !isAdultSubject(subject)) return { ok: false, denial: "subject_minor", line: LIKENESS_LINES.adult_content_minor };
  if (ask.adultContent && !self) return { ok: false, denial: "adult_content_other", line: LIKENESS_LINES.adult_content_other };
  let householdOn = false;
  try { householdOn = getHouseholdSettingValue("generation.household_likeness") === true; } catch { /* closed on settings read failure */ }
  if (!householdOn) return { ok: false, denial: "household_off", line: LIKENESS_LINES.household_off };
  return { ok: true, subject, self };
}
