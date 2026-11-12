// FILM-REAL-11: the views a photo does not show, drawn for the reference sheet. A candid photo of a man gives one angle; the sheet wants a clean front view and
// a side view, and an object wants an angled view. Each is made by the Stack's image-edit model from ONE subject's own cut-out as its reference, on a plain
// white background. The caller hands this module one person at a time: a photo of several people is split first (sheetMaker), because a view drawn from a
// picture that holds two people merges them (the first live chat gave a man a woman's long hair, 2026-11-12). A drawn clean front of a person is kept only when
// its face matches the photo's face (SFace, the likeness guard's); a drawn view that fails the check is dropped and the sheet keeps the photo alone. Places are
// never redrawn.
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
    // The face models are ensured by the sheet maker's face finder before any view is drawn.
    const faces = async (bytes: Uint8Array) => { const png = new Uint8Array(await sharp(Buffer.from(bytes)).png().toBuffer()); const found = await detectFaces(png); const best = found.ok ? [...found.value].sort((x, y) => y.bbox[2] * y.bbox[3] - x.bbox[2] * x.bbox[3])[0] : undefined; const embedded = best ? await embedFace(png, best) : null; return embedded?.ok ? embedded.value : null; };
    const [one, two] = await Promise.all([faces(a), faces(b)]);
    return one && two ? faceCosine(one, two) : null;
  },
};

/** The views to draw for one picture's role, as [label, instruction, whether a face check applies]. */
export function viewPlan(role: PictureRole): Array<{ view: string; instruction: string; faceCheck: boolean }> {
  if (role === "actor") return [
    { view: "Clean Front View", faceCheck: true, instruction: `The same person facing the camera straight on with a relaxed neutral expression, same face, hair, glasses and clothing as the reference, head and shoulders, ${WHITE}.` },
    { view: "Side View", faceCheck: false, instruction: `The same person seen in profile from the left, same face, hair, glasses and clothing as the reference, head and shoulders, ${WHITE}.` },
  ];
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
