// FILM-REAL-11: the views a photo does not show, drawn for the reference sheet. An object gets an angled view, made by the Stack's image-edit model from
// the person's own cut-out as its reference, on a plain white background. People are never redrawn: a drawn side view changed a real man's hair and look
// in the first live chat (2026-11-12), and the face check (SFace, the likeness guard's) covers only the face, not the hair, clothing or build. The face-check
// hook stays for a later verified path. Places are never redrawn, and a view is never drawn for a picture whose face or text the model cannot be held to.
import sharp from "sharp";
import type { PictureRole } from "@/lib/pictures/roles";
import { detectFaces, embedFace, faceCosine } from "@/lib/pictures/likeness/faces";
import { submitEdit, waitPicture } from "@/lib/pictures/stack";

export interface DrawnView { view: string; image: Uint8Array; verified: boolean }
export interface ViewTools {
  /** One edit of the reference picture by the image-edit model: the new picture's PNG bytes, or null when it could not be made. */
  editView(reference: { bytes: Uint8Array; mediaType: string }, instruction: string): Promise<Uint8Array | null>;
  /** Cosine similarity of the main faces in two pictures (SFace), or null when either has no readable face. */
  faceMatch(a: Uint8Array, b: Uint8Array): Promise<number | null>;
}

/** The lowest SFace cosine at which a drawn front view still counts as the same person (the published same-person threshold is about 0.36). */
export const FACE_MATCH_MIN = 0.4;
const WHITE = "on a plain white studio background, sharp photograph, no text";

export const realViewTools: ViewTools = {
  async editView(reference, instruction) {
    try {
      const form = new FormData();
      form.append("image", new File([new Uint8Array(reference.bytes)], "picture", { type: reference.mediaType }));
      form.append("operation", "edit");
      form.append("instruction", instruction);
      form.append("image_source", "uploaded");
      form.append("timeout_ms", "1");
      const submitted = await submitEdit(form);
      return (await waitPicture(submitted.job)).bytes;
    } catch { return null; }
  },
  async faceMatch(a, b) {
    const faces = async (bytes: Uint8Array) => { const png = new Uint8Array(await sharp(Buffer.from(bytes)).png().toBuffer()); const found = await detectFaces(png); const best = found.ok ? [...found.value].sort((x, y) => y.bbox[2] * y.bbox[3] - x.bbox[2] * x.bbox[3])[0] : undefined; const embedded = best ? await embedFace(png, best) : null; return embedded?.ok ? embedded.value : null; };
    const [one, two] = await Promise.all([faces(a), faces(b)]);
    return one && two ? faceCosine(one, two) : null;
  },
};

/** The views to draw for one picture's role, as [label, instruction, whether a face check applies]. */
export function viewPlan(role: PictureRole): Array<{ view: string; instruction: string; faceCheck: boolean }> {
  // A person is never redrawn: a drawn side view or clean front changed a real man's hair and look in the first live chat (2026-11-12), and the face check
  // covers only the face, not the hair, clothing or build. A person's panels come from their own photo alone (cut-out and face close-up).
  if (role === "actor") return [];
  if (role === "product" || role === "prop") return [
    { view: "Angled View", faceCheck: false, instruction: `The same object turned to a three-quarter angle, identical design, shape, materials and colours as the reference, ${WHITE}.` },
  ];
  return [];
}

/** Draws the missing views of one cut-out picture. A view that cannot be made, or whose face fails the check, is left out. */
export async function drawViews(role: PictureRole, original: { bytes: Uint8Array; mediaType: string }, tools: ViewTools = realViewTools): Promise<DrawnView[]> {
  const drawn: DrawnView[] = [];
  for (const plan of viewPlan(role)) {
    const image = await tools.editView(original, plan.instruction).catch(() => null);
    if (!image) continue;
    if (plan.faceCheck) {
      const match = await tools.faceMatch(original.bytes, image).catch(() => null);
      if (match === null || match < FACE_MATCH_MIN) continue;
    }
    drawn.push({ view: plan.view, image, verified: plan.faceCheck });
  }
  return drawn;
}
