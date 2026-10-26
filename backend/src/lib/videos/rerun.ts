// Prepares a Make another or Animate request. Uploaded source images are
// screened by Home's CSAM and age-specific checks. The model handles other
// content decisions, including likeness.
import type { PersonRow } from "@/types";
import type { VideoAudience } from "./policy";
import type { VideoAdapter } from "./adapters";
import { loadGeneratedReference, loadUploadedPhoto } from "./jobs";
import { screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";

export interface RerunInput {
  actor: PersonRow;
  audience: VideoAudience;
  conversationId: string;
  temporary: boolean;
  prompt: string;
  sourceFileId: string | null;
  adapters: readonly VideoAdapter[];
  styleIds: readonly string[];
}

export type RerunResult =
  | { ok: false; line: string; code: "reference" | "csam" }
  | { ok: true; image: string | undefined; imageSource: "generated" | "uploaded" | undefined; loras: Array<{ id: string; strength: number }>; width: number | null; height: number | null };

export async function prepareVideoRerun(input: RerunInput): Promise<RerunResult> {
  let image: string | undefined;
  let imageSource: "generated" | "uploaded" | undefined;
  let width: number | null = null;
  let height: number | null = null;
  if (input.sourceFileId) {
    const upload = loadUploadedPhoto(input.actor, input.conversationId, input.sourceFileId, input.temporary);
    if (upload.ok) {
      const screen = await screenInputImage(upload.bytes, input.prompt, viewerOf(input.actor, input.audience.band));
      if (!screen.ok) return { ok: false, line: screen.line, code: "csam" };
      image = upload.base64; imageSource = "uploaded"; width = upload.width; height = upload.height;
    } else {
      const ref = loadGeneratedReference(input.actor, input.conversationId, input.sourceFileId, input.temporary);
      if (!ref.ok) return { ok: false, line: ref.line, code: "reference" };
      image = ref.base64; imageSource = "generated"; width = ref.width; height = ref.height;
    }
  }
  const used = input.styleIds.flatMap((id) => { const adapter = input.adapters.find((a) => a.id === id); return adapter ? [adapter] : []; });
  return { ok: true, image, imageSource, loras: used.map((a) => ({ id: a.id, strength: a.strength_default })), width, height };
}
