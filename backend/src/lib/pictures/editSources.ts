// Source validation for generative edits. Home checks uploaded pixels for the
// CSAM boundary and applies the child's own-photo rule; it does not classify
// or gate a photo because of the person's identity or likeness.
import type { PictureAudience } from "./policy";
import { screenInputImage, viewerOf } from "./ageCheck";

export type EditImageSource = "generated" | "uploaded";

export interface PrepareEditSourceInput {
  audience: PictureAudience;
  bytes: Uint8Array;
  generated: boolean;
  text: string;
}

export type EditSourcePrep =
  | { ok: true; imageSource: EditImageSource }
  | { ok: false; status: 422; code: string; line: string };

export async function prepareEditSource(input: PrepareEditSourceInput): Promise<EditSourcePrep> {
  if (!input.generated) {
    const screen = await screenInputImage(input.bytes, input.text, viewerOf(input.audience.actor, input.audience.band));
    if (!screen.ok) return { ok: false, status: 422, code: screen.code, line: screen.line };
  }
  return { ok: true, imageSource: input.generated ? "generated" : "uploaded" };
}
