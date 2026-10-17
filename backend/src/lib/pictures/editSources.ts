// IMGEDIT-01 (built on LIKENESS-01): what a picture the person wants changed is, as far as the Stack must be told, and
// whether it may be changed at all. One function for every door into a generative edit (the editor's Comment, the chat
// tool): the picture is one this home made (its own), one made to look like a household adult (decided again with
// them), an upload that shows no one (checked by the household's own picture-reading model), or an upload that shows
// exactly one household adult who agreed (named by the person, checked, and given a signed proof). Anything else is
// refused with a sentence that says what to do. Nothing here asks the Stack; the caller attaches the answer to its request.
import { preparePhotoUse } from "@/lib/likeness/apply";
import { photoShowsNoPerson, singleAdultPhoto } from "@/lib/likeness/inspector";
import { subjectEligibility } from "@/lib/likeness/consent";
import type { JobLikeness } from "@/lib/likeness/guard";
import type { UseSource } from "@/lib/likeness/uses";
import type { PictureAudience } from "./policy";

export type EditImageSource = "generated" | "uploaded" | "household_photo";

export interface PrepareEditSourceInput {
  audience: PictureAudience;
  bytes: Uint8Array;
  /** The picture is one this home's picture engine made (Home marked it so; a file name proves nothing). */
  generated: boolean;
  /** The household adult a generated picture was made to look like, from its provenance, or null. */
  rootLikeness: string | null;
  /** The household adult the person says an upload shows (already resolved to an id), or null. */
  declaredSubjectId: string | null;
  /** Everything the person asked for in words, for the adult-content reading. */
  text: string;
  source: UseSource;
}

export type EditSourcePrep =
  | { ok: true; imageSource: EditImageSource; proof?: string; likeness?: JobLikeness; subjectId: string | null }
  | { ok: false; status: 403 | 422; code: string; line: string };

export const SUBJECT_NOT_ALLOWED_LINE = "I can only change a photo of an adult who lives in this household and has agreed. Choose that adult from the list, or a photo with no one in it.";

export async function prepareEditSource(input: PrepareEditSourceInput): Promise<EditSourcePrep> {
  const declared = input.rootLikeness ?? input.declaredSubjectId;
  if (!declared && input.generated) return { ok: true, imageSource: "generated", subjectId: null };
  if (!declared) {
    const verdict = await photoShowsNoPerson(input.bytes);
    if (!verdict.ok) return { ok: false, status: 422, code: verdict.reason === "unavailable" ? "photo_check_unavailable" : "photo_has_person", line: verdict.line };
    return { ok: true, imageSource: "uploaded", subjectId: null };
  }
  if (!subjectEligibility(declared).ok) return { ok: false, status: 422, code: "subject_not_allowed", line: SUBJECT_NOT_ALLOWED_LINE };
  if (!input.rootLikeness) {
    const verdict = await singleAdultPhoto(input.bytes);
    if (!verdict.ok) return { ok: false, status: 422, code: verdict.reason === "unavailable" ? "photo_check_unavailable" : "photo_not_single_adult", line: verdict.line };
  }
  const prep = await preparePhotoUse({ medium: "picture", audience: input.audience, declaredSubjectId: declared, bytes: input.bytes, text: input.text, source: input.source });
  if (prep.kind === "refused") return { ok: false, status: 403, code: "likeness_refused", line: prep.line };
  return { ok: true, imageSource: "household_photo", proof: prep.proof, likeness: prep.job, subjectId: prep.subjectId };
}
