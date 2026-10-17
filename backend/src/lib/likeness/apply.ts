// LIKENESS-01: the steps every entry point takes before a picture or video that looks like a household adult is asked of
// the Stack (the chat tools, the card routes that make another one, the photo editor): resolve who it looks like, decide
// (age and surface gate, the subject is an adult, consent is on, the second switch for adult content), make sure the Stack
// trusts Home's key, and sign a proof for that one thing. The caller attaches the proof to its Stack request and, once the
// Stack has the job, calls `recordLikenessUse`. Nothing here asks the model anything.
import { isAdultContentRequest, decideLikeness, LIKENESS_LINES, NO_ADULT_CONTENT_NEGATIVE, subjectName, type LikenessMedium } from "./decide";
import { consentState } from "./consent";
import { ensureStackTrust, mintProof, photoBind, PROOF_TTL_SECONDS } from "./proof";
import { getStyleSubject, type StyleMedium } from "./adapters";
import type { JobLikeness } from "./guard";
import type { PictureAudience } from "@/lib/pictures/policy";
import type { UseSource } from "./uses";

export interface StyleRef { id: string; name: string; likeness_subject?: string | null }

export type LikenessPrep =
  | { kind: "none" }
  | { kind: "refused"; why: "real_person" | "likeness"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; adultContent: boolean; proof: string; job: JobLikeness; negativePrompt: string | null };

export const STYLE_REMOVED_LINE = "That style looked like a person who has taken back their agreement, so it was removed. I made nothing.";

/** Who a saved style looks like: Home's record of the answer given when it was added, else what the Stack's own record says. Null for an ordinary style. */
export function subjectOfStyle(medium: StyleMedium, style: StyleRef): { subjectId: string | null; removed: boolean } {
  const record = getStyleSubject(medium, style.id);
  if (record && record.state !== "active") return { subjectId: record.subjectPersonId, removed: true };
  return { subjectId: record?.subjectPersonId ?? style.likeness_subject ?? null, removed: false };
}

export interface StyleInput {
  medium: LikenessMedium;
  audience: PictureAudience;
  /** The style the request will apply, or null for none. */
  style: StyleRef | null;
  /** Everything the person asked for in words: the prompt and the style name. */
  text: string;
  /** The model's own statement that the person asked for a real, named or identifiable person. */
  depictsRealPerson: boolean;
  source: UseSource;
}

/** The likeness decision for a request that applies (or names) a style. */
export async function prepareStyleUse(input: StyleInput): Promise<LikenessPrep> {
  const { subjectId, removed } = input.style ? subjectOfStyle(input.medium, input.style) : { subjectId: null, removed: false };
  if (!input.style || !subjectId) {
    // No style of a person: a request for a real person's likeness is refused, as it has always been.
    return input.depictsRealPerson ? { kind: "refused", why: "real_person", line: "" } : { kind: "none" };
  }
  if (removed) return { kind: "refused", why: "likeness", line: STYLE_REMOVED_LINE };
  const adultContent = isAdultContentRequest({ text: input.text });
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: subjectId, adultContent });
  if (!decision.ok) return { kind: "refused", why: "likeness", line: decision.line };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", why: "likeness", line: trust.line };
  const requester = input.audience.actor;
  const consent = consentState(decision.subject.id);
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self, adultContent,
    proof: mintProof({ purpose: "style_use", subject: decision.subject.id, requester: requester.id, bind: input.style.id }),
    job: { subject: decision.subject.id, requester: requester.id, way: "style", adult_content: adultContent },
    // Beside the refusal above: unless the person agreed to adult content (or it is themselves), the engine is told to keep it out.
    negativePrompt: decision.self || consent.adultContent ? null : NO_ADULT_CONTENT_NEGATIVE,
  };
}

export type PhotoPrep =
  | { kind: "refused"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; adultContent: boolean; proof: string; job: JobLikeness; negativePrompt: string | null };

export interface PhotoInput {
  medium: LikenessMedium;
  audience: PictureAudience;
  /** The household adult the requester says is in the photo. */
  declaredSubjectId: string | null;
  bytes: Uint8Array;
  text: string;
  source: UseSource;
}

/** The likeness decision for a request that starts from a photo of a declared household adult. The photo itself is checked separately (inspector.ts singleAdultPhoto), by the caller, before this. */
export const PHOTO_ADULT_LINE = "I never turn a photo of a real person into adult content, whoever it is and whatever they agreed to. I can make something else from the photo.";

export async function preparePhotoUse(input: PhotoInput): Promise<PhotoPrep> {
  // The rule the photo editor already has: a photo of a real person is only ever changed in ways that leave them clothed. The second consent switch is for styles (synthetic pictures), never for a real photo.
  const adultContent = isAdultContentRequest({ text: input.text });
  if (adultContent) return { kind: "refused", line: PHOTO_ADULT_LINE };
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: input.declaredSubjectId, adultContent });
  if (!decision.ok) return { kind: "refused", line: decision.line };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", line: trust.line };
  const consent = consentState(decision.subject.id);
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self, adultContent,
    proof: mintProof({ purpose: "photo", subject: decision.subject.id, requester: input.audience.actor.id, bind: photoBind(input.bytes) }),
    job: { subject: decision.subject.id, requester: input.audience.actor.id, way: "photo", adult_content: adultContent },
    negativePrompt: decision.self || consent.adultContent ? null : NO_ADULT_CONTENT_NEGATIVE,
  };
}

export { LIKENESS_LINES, PROOF_TTL_SECONDS };
