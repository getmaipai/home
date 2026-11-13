// Junk removal for one person cut out of a photo of several people. The cut-out still carries slivers of the neighbour (a face fragment, a coat edge, a knee) and
// stray specks. The Stack's MASKED edit may change only a junk region; this person's face box is outside the editable mask, so the edit cannot reach it. Whatever the
// edit returns is used only to REMOVE: a pixel of the cut-out becomes transparent where the edit painted it white inside the junk region, and every other pixel stays
// the cut-out's own. The face is never redrawn, cleaned or beautified. Each cleanup is then checked (face pixels, face likeness, junk shrunk); if any check fails or
// the edit errors, the plain cut-out is kept and a plain sentence says so.
import sharp from "sharp";
import { morphology } from "@/lib/pictures/likeness/masks";
import { faceUntouched } from "@/lib/pictures/likeness/guard";

export interface Box { x: number; y: number; w: number; h: number }
export type Side = "left" | "right";

/** The checks a cleanup must pass, from the repo's likeness guard (SSIM) and face model (SFace cosine). */
export const JUNK = { faceSsim: 0.98, faceCosine: 0.95, maxRemovedShare: 0.4, specksShare: 0.015, faceKeep: 0.3, otherPad: 0.45, feather: 2 } as const;

export interface JunkRegion {
  /** 255 where the edit may change a pixel (junk and its surroundings), 0 elsewhere. Never overlaps the protected face. */
  editable: Uint8Array;
  /** 255 over this person's own face box, expanded generously. */
  protect: Uint8Array;
  /** How many opaque pixels of the cut-out lie inside the editable region. Zero means there is no junk to remove. */
  junkArea: number;
}

function fill(mask: Uint8Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) mask[y * width + x] = 255;
}

/** Opaque 4-connected components, largest first: returns a label per pixel (0 = transparent) and each component's size. */
function components(alpha: Uint8Array, width: number, height: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(width * height), sizes: number[] = [0], stack: number[] = [];
  for (let start = 0; start < label.length; start++) {
    if (alpha[start]! <= 128 || label[start]) continue;
    const id = sizes.length; let size = 0; stack.push(start); label[start] = id;
    while (stack.length) {
      const p = stack.pop()!; size++;
      const x = p % width, y = (p - x) / width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) if (q >= 0 && alpha[q]! > 128 && !label[q]) { label[q] = id; stack.push(q); }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Pure: where the junk can be, from the cut-out's opacity, this person's face box, the other faces found in the cut-out and the side(s) the neighbours were on.
 *  Junk = opaque pixels beyond this face on the neighbour's side, around any other face, and small disconnected specks; the own face box (expanded) is protected. */
export function deriveJunkRegion(input: { alpha: Uint8Array; width: number; height: number; own: Box; others: Box[]; neighbours: Side[] }): JunkRegion {
  const { alpha, width, height, own, others, neighbours } = input;
  if (alpha.length !== width * height) throw new Error("alpha dimensions do not match");
  const region = new Uint8Array(width * height);
  // The neighbour's coat and arm lean against this person's shoulder, so the band starts at this face's centre line; the protected face box is cut out of it below.
  const middle = own.x + own.w / 2;
  if (neighbours.includes("left")) fill(region, width, height, 0, 0, middle, height);
  if (neighbours.includes("right")) fill(region, width, height, middle, 0, width, height);
  for (const other of others) fill(region, width, height, other.x - other.w * JUNK.otherPad, other.y - other.h * JUNK.otherPad, other.x + other.w * (1 + JUNK.otherPad), other.y + other.h * (1 + JUNK.otherPad));
  const { label, sizes } = components(alpha, width, height);
  const largest = sizes.reduce((best, size, id) => (id > 0 && size > (sizes[best] ?? 0) ? id : best), 1);
  const specks = new Uint8Array(width * height);
  for (let p = 0; p < label.length; p++) { const id = label[p]!; if (id && id !== largest && sizes[id]! < (sizes[largest] ?? 0) * JUNK.specksShare) specks[p] = 255; }
  const nearSpecks = morphology(specks, width, height, 3, "dilate");
  for (let p = 0; p < region.length; p++) if (nearSpecks[p]) region[p] = 255;
  const protect = new Uint8Array(width * height);
  const keep = own.w * JUNK.faceKeep, keepUp = own.h * JUNK.faceKeep;
  fill(protect, width, height, own.x - keep, own.y - keepUp, own.x + own.w + keep, own.y + own.h + keep);
  const editable = new Uint8Array(width * height);
  let junkArea = 0;
  // Only where the cut-out is opaque (plus a small margin so the edit sees the edge); transparent corners are never part of the junk.
  const near = morphology(Uint8Array.from(alpha, (a) => (a > 128 ? 255 : 0)), width, height, 3, "dilate");
  for (let p = 0; p < editable.length; p++) {
    if (!region[p] || protect[p] || !near[p]) continue;
    editable[p] = 255;
    if (alpha[p]! > 128) junkArea++;
  }
  return { editable, protect, junkArea };
}

export interface JunkTools {
  /** Boxes of the faces in a picture. */
  findFaces(bytes: Uint8Array, mediaType: string): Promise<Box[]>;
  /** One masked edit: 255 in `mask` may change, everything else is kept; returns the picture as PNG. */
  editMasked(png: Uint8Array, mask: Uint8Array, width: number, height: number, prompt: string): Promise<Uint8Array>;
  /** SFace cosine between the face of `before` and the face of `after` (both at `face`), or null when it cannot be measured. */
  faceSimilarity(before: Uint8Array, after: Uint8Array, face: Box): Promise<number | null>;
}

export const JUNK_PROMPT = "Remove only the leftover pieces of other people and stray specks from this cut-out of one person: any part of another person such as a face fragment, hair, a hand, an arm, a knee, a leg or the edge of a coat, and any small stray marks. Paint everything you remove plain white. Do not change the main person at all, and do not redraw, retouch, sharpen or clean their face, hair or clothes.";

async function flat(cut: Buffer): Promise<{ png: Buffer; width: number; height: number; alpha: Uint8Array; rgb: Uint8Array }> {
  const { data, info } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height), rgb = new Uint8Array(info.width * info.height * 3);
  for (let p = 0; p < alpha.length; p++) {
    const a = data[p * 4 + 3]! / 255; alpha[p] = data[p * 4 + 3]!;
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(data[p * 4 + c]! * a + 255 * (1 - a));
  }
  const png = await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  return { png, width: info.width, height: info.height, alpha, rgb };
}
const gray = (rgb: Uint8Array, count: number) => { const g = new Uint8Array(count); for (let p = 0; p < count; p++) g[p] = Math.round(0.299 * rgb[p * 3]! + 0.587 * rgb[p * 3 + 1]! + 0.114 * rgb[p * 3 + 2]!); return g; };
const openArea = (alpha: Uint8Array, mask: Uint8Array) => { let n = 0; for (let p = 0; p < alpha.length; p++) if (mask[p] && alpha[p]! > 128) n++; return n; };

export type JunkOutcome = { kind: "cleaned"; png: Buffer; faceSsim: number; faceCosine: number; junkBefore: number; junkAfter: number } | { kind: "kept"; reason: "no_junk" | "no_face" } | { kind: "failed"; reason: string };

/** Cleans one split-out person. Never throws: any trouble is a `failed` outcome and the caller keeps the plain cut-out. */
export async function cleanJunk(cut: Buffer, neighbours: Side[], tools: JunkTools): Promise<JunkOutcome> {
  try {
    const src = await flat(cut);
    const found = (await tools.findFaces(new Uint8Array(src.png), "image/png").catch(() => [])).filter((f) => f.w * f.h > 0).sort((a, b) => b.w * b.h - a.w * a.h);
    const own = found[0];
    if (!own) return { kind: "kept", reason: "no_face" };
    const others = found.slice(1).filter((f) => f.x + f.w <= own.x || f.x >= own.x + own.w || f.y + f.h <= own.y || f.y >= own.y + own.h);
    const region = deriveJunkRegion({ alpha: src.alpha, width: src.width, height: src.height, own, others, neighbours });
    if (region.junkArea === 0) return { kind: "kept", reason: "no_junk" };
    const edited = await sharp(Buffer.from(await tools.editMasked(new Uint8Array(src.png), region.editable, src.width, src.height, JUNK_PROMPT))).resize(src.width, src.height, { fit: "fill" }).removeAlpha().raw().toBuffer();
    // Removal only: inside the editable region a pixel the edit painted white becomes transparent; every other pixel is the cut-out's own.
    const out = Buffer.alloc(src.width * src.height * 4);
    const { data: orig } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    orig.copy(out);
    const finalAlpha = new Uint8Array(src.alpha);
    for (let p = 0; p < finalAlpha.length; p++) {
      if (!region.editable[p] || src.alpha[p]! <= 128) continue;
      if (edited[p * 3]! > 235 && edited[p * 3 + 1]! > 235 && edited[p * 3 + 2]! > 235 && !(src.rgb[p * 3]! > 235 && src.rgb[p * 3 + 1]! > 235 && src.rgb[p * 3 + 2]! > 235)) { out[p * 4 + 3] = 0; finalAlpha[p] = 0; }
    }
    const junkAfter = openArea(finalAlpha, region.editable);
    if (junkAfter >= region.junkArea) return { kind: "failed", reason: "The leftover pieces were not removed." };
    let total = 0; for (const a of src.alpha) if (a > 128) total++;
    if ((region.junkArea - junkAfter) / total > JUNK.maxRemovedShare) return { kind: "failed", reason: "The cleanup removed too much of the person." };
    const png = await sharp(out, { raw: { width: src.width, height: src.height, channels: 4 } }).png().toBuffer();
    // Checks against the pre-cleanup cut-out, on the same canvas (before trimming): the face region and the face's likeness.
    const after = await flat(png);
    const ssim = faceUntouched(gray(src.rgb, src.width * src.height), gray(after.rgb, src.width * src.height), { bbox: [own.x, own.y, own.w, own.h] }, src.width, src.height);
    if (ssim < JUNK.faceSsim) return { kind: "failed", reason: "The face changed." };
    const cosine = await tools.faceSimilarity(new Uint8Array(src.png), new Uint8Array(after.png), own).catch(() => null);
    if (cosine === null || cosine < JUNK.faceCosine) return { kind: "failed", reason: cosine === null ? "The face could not be checked." : "The face changed." };
    return { kind: "cleaned", png: await sharp(png).trim({ threshold: 5 }).png().toBuffer(), faceSsim: ssim, faceCosine: cosine, junkBefore: region.junkArea, junkAfter };
  } catch (error) {
    if (process.env.JUNK_DEBUG) console.error(error);
    return { kind: "failed", reason: "The cleanup could not be made." };
  }
}
