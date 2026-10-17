// LIKENESS-01: the one decision about a request that makes something look like a household adult. Run at the policy
// node, at the tool, at every route, and again while the job waits (jobGuard.ts). The age and surface gate comes first
// and is the picture policy's own: a request that is not an adult on their own written chat screen (a child, a teen,
// a guest, a spoken turn, a shared screen) never reaches this decision at all. Nothing here makes anything more
// permissive than an adult picture already is: the second switch (adult content) exists only to keep a person's likeness
// out of adult-only requests unless they said it may be there.
import { pictureDenial, asksToUndress, type PictureAudience } from "@/lib/pictures/policy";
import { consentState, subjectEligibility, type SubjectWhy } from "./consent";
import type { PersonRow } from "@/types";

export type LikenessWay = "style" | "photo";
export type LikenessMedium = "picture" | "video";
export type LikenessDenial = "requester" | "no_subject" | "subject_minor" | "subject_unknown" | "consent_off" | "adult_content_off";

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
  unknown: "I can only make something that looks like an adult who lives in this household and has agreed to it. I couldn't find that person here.",
  gone: "I can only make something that looks like an adult who lives in this household and has agreed to it. That person isn't here any more.",
  guest: "I can only make something that looks like an adult who lives in this household and has agreed to it. A guest can't be made.",
  minor: "I never make a picture or video that looks like a child or a teen. I can only make one that looks like an adult in this household who has agreed to it.",
  memorial: "I can only make something that looks like an adult who lives in this household and has agreed to it. That profile is a memorial.",
};

export const LIKENESS_LINES = {
  requester: "Pictures and videos that look like a person can only be made by an adult on their own screen.",
  no_subject: "Say which adult in this household it should look like, and make sure they have agreed. I won't make a picture or video of someone else.",
  consent_off: (name: string) => `${name} hasn't agreed to pictures, videos or styles that look like them. They can turn that on in their own Settings, Pictures and videos. I made nothing.`,
  adult_content_off: (name: string) => `${name} has agreed to pictures and videos that look like them, but not to adult content. They can change that in their own Settings, Pictures and videos. I made nothing.`,
} as const;

/** Whether a request is an adult-content one: its words undress or sexualise someone (the same stricter reading the photo editor applies to a photo), or it also applies an adult-only style other than the likeness itself. A word list cannot catch every phrasing; the negative prompt below, the output being the requester's own and the subject's notification are the other half. */
export function isAdultContentRequest(input: { text: string; otherAdultOnlyStyle?: boolean }): boolean {
  return input.otherAdultOnlyStyle === true || asksToUndress(input.text);
}

/** Words added to the engine's negative prompt for every request that looks like a person whose second switch is off. Belt and braces beside the refusal above. */
export const NO_ADULT_CONTENT_NEGATIVE = "nude, naked, nudity, topless, nsfw, explicit, sexual, lingerie, underwear";

/** May this request make something that looks like this person? */
export function decideLikeness(ask: LikenessAsk): LikenessDecision {
  if (pictureDenial(ask.requester) !== null) return { ok: false, denial: "requester", line: LIKENESS_LINES.requester };
  if (!ask.subjectPersonId) return { ok: false, denial: "no_subject", line: LIKENESS_LINES.no_subject };
  const eligible = subjectEligibility(ask.subjectPersonId);
  if (!eligible.ok) return { ok: false, denial: eligible.why === "minor" ? "subject_minor" : "subject_unknown", line: SUBJECT_LINES[eligible.why] };
  const subject = eligible.person;
  const self = subject.id === ask.requester.actor.id;
  // A person making something that looks like themselves needs no one's agreement but their own.
  if (self) return { ok: true, subject, self };
  const consent = consentState(subject.id);
  if (!consent.adults) return { ok: false, denial: "consent_off", line: LIKENESS_LINES.consent_off(subjectName(subject)) };
  if (ask.adultContent && !consent.adultContent) return { ok: false, denial: "adult_content_off", line: LIKENESS_LINES.adult_content_off(subjectName(subject)) };
  return { ok: true, subject, self };
}
