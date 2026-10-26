// LIKENESS-01: the likeness half of a clip started from a route (Make another, Animate this picture). Same decision as the
// chat tool's (tool.ts): a picture made to look like a household adult, an attached photo of one, or a saved style of one
// is used only if that adult agrees now, the photo shows exactly them, and the Stack gets a proof signed for that one
// clip. A route is never a way around the tool's gates.
import { preparePhotoUse, prepareStylesUse } from "@/lib/likeness/apply";
import { singleAdultPhoto } from "@/lib/likeness/inspector";
import { subjectEligibility } from "@/lib/likeness/resolve";
import type { JobLikeness } from "@/lib/likeness/guard";
import type { PersonRow } from "@/types";
import type { VideoAudience } from "./policy";
import type { VideoAdapter } from "./adapters";
import { loadGeneratedReference, loadUploadedPhoto } from "./jobs";

export interface RerunInput {
  actor: PersonRow;
  audience: VideoAudience;
  conversationId: string;
  temporary: boolean;
  prompt: string;
  /** The picture the clip starts from, or null for words alone. */
  sourceFileId: string | null;
  /** What the earlier clip rested on, when this is "Make another". */
  prior?: JobLikeness | null;
  /** The household adult the person says is in an uploaded photo (the Animate picker). */
  declaredSubjectId?: string | null;
  /** The styles the person may still use (already filtered by audience and the household's switches). */
  adapters: readonly VideoAdapter[];
  /** The styles the earlier request used, by id. */
  styleIds: readonly string[];
}

export type RerunResult =
  | { ok: false; line: string; code: "reference" | "likeness" }
  | {
    ok: true;
    image: string | undefined;
    imageSource: "generated" | "household_photo" | undefined;
    consentProof: string | undefined;
    loras: Array<{ id: string; strength: number; likeness_proof?: string }>;
    likeness: JobLikeness | null;
    width: number | null;
    height: number | null;
    subject: { id: string; way: "style" | "photo" } | null;
  };

export async function prepareVideoRerun(input: RerunInput): Promise<RerunResult> {
  let image: string | undefined;
  let imageSource: "generated" | "household_photo" | undefined;
  let consentProof: string | undefined;
  let width: number | null = null;
  let height: number | null = null;
  let photo: Extract<Awaited<ReturnType<typeof preparePhotoUse>>, { kind: "likeness" }> | null = null;
  if (input.sourceFileId) {
    const wantsPhoto = input.prior?.way === "photo" || !!input.declaredSubjectId;
    const upload = wantsPhoto ? loadUploadedPhoto(input.actor, input.conversationId, input.sourceFileId, input.temporary) : null;
    if (upload?.ok) {
      const subjectId = input.declaredSubjectId ?? input.prior?.subject ?? null;
      if (!subjectId || !subjectEligibility(subjectId).ok) return { ok: false, line: "Say which adult in this household is in the photo. I won't animate a photo of anyone else.", code: "likeness" };
      // A fresh clip from a photo is checked again; a clip made again from the same stored photo was checked when it was first made, but the check is cheap and the photo is the same.
      const verdict = await singleAdultPhoto(upload.bytes);
      if (!verdict.ok) return { ok: false, line: verdict.line, code: "likeness" };
      const prep = await preparePhotoUse({ medium: "video", audience: input.audience, declaredSubjectId: subjectId, bytes: upload.bytes, source: "chat" });
      if (prep.kind === "refused") return { ok: false, line: prep.line, code: "likeness" };
      photo = prep; image = upload.base64; imageSource = "household_photo"; consentProof = prep.proof;
      width = upload.width; height = upload.height;
    } else {
      const ref = loadGeneratedReference(input.actor, input.conversationId, input.sourceFileId, input.temporary);
      if (!ref.ok) return { ok: false, line: ref.line, code: "reference" };
      image = ref.base64; imageSource = "generated"; width = ref.width; height = ref.height;
      if (ref.likenessSubject) {
        const prep = await preparePhotoUse({ medium: "video", audience: input.audience, declaredSubjectId: ref.likenessSubject, bytes: ref.bytes, source: "chat" });
        if (prep.kind === "refused") return { ok: false, line: prep.line, code: "likeness" };
        photo = prep; imageSource = "household_photo"; consentProof = prep.proof;
      }
    }
  }
  const used = input.styleIds.flatMap((id) => { const adapter = input.adapters.find((a) => a.id === id); return adapter ? [adapter] : []; });
  const stylePrep = await prepareStylesUse({ medium: "video", audience: input.audience, styles: used, source: "chat" });
  if (stylePrep.kind === "refused") return { ok: false, line: stylePrep.line, code: "likeness" };
  if (stylePrep.kind === "likeness" && photo && stylePrep.subjectId !== photo.subjectId) return { ok: false, line: "I can make something that looks like one person at a time. Use a style and a photo of the same adult, or leave one out.", code: "likeness" };
  const likeness: JobLikeness | null = stylePrep.kind === "likeness" ? stylePrep.job : photo ? photo.job : null;
  const subjectPrep = stylePrep.kind === "likeness" ? stylePrep : photo;
  return {
    ok: true, image, imageSource, consentProof,
    loras: used.map((a) => ({ id: a.id, strength: a.strength_default, ...(stylePrep.kind === "likeness" && stylePrep.proofs.has(a.id) ? { likeness_proof: stylePrep.proofs.get(a.id)! } : {}) })),
    likeness, width, height,
    subject: subjectPrep ? { id: subjectPrep.subjectId, way: photo ? "photo" : "style" } : null,
  };
}
