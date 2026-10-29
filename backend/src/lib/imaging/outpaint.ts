import sharp from "sharp";
import { subjectBounds } from "./subject";

/**
 * Drawing the body for a picture the frame cut off, without letting the picture model redraw the face.
 *
 * The cut-off picture is shrunk to natural head proportions and set on a plain canvas; the model paints only the empty area
 * (a masked edit), and then the person's own head is laid back over the result with a soft lower edge. The model blends in
 * its own space and does not promise to keep the pixels it was told to keep, so the real face is restored afterwards.
 * Every editor that has a cut-off picture can use this (the companion creator today, the chat image editor next).
 */
export const OUTPAINT_CANVAS = 1024;
const GREY = 217;
const ALPHA_KEEP = 8;

export interface BodyCanvas {
  /** The cut-off picture on a plain grey canvas. */
  canvas: Uint8Array;
  /** White where the model may paint, black where the picture already is (and the band above it). */
  mask: Uint8Array;
  /** The person's head as a transparent layer the size of the canvas, fading out below the chin. */
  head: Uint8Array;
}

/**
 * How much of the canvas the visible part of the person fills, and where the chin sits in it. A head and shoulders is about a fifth of a
 * standing person's height and a waist-up about a third; a picture that is nearly all face (the last row is mostly neck and chin, not shirt) is smaller still.
 */
function proportions(edges: readonly string[], faceDominant: boolean): { height: number; fadeStart: number; fadeEnd: number } | null {
  if (!edges.includes("bottom")) return null;
  const sides = edges.includes("left") || edges.includes("right");
  if (!sides) return { height: 0.34, fadeStart: 0.4, fadeEnd: 0.56 };
  return faceDominant ? { height: 0.13, fadeStart: 0.78, fadeEnd: 0.9 } : { height: 0.19, fadeStart: 0.72, fadeEnd: 0.88 };
}

/** Whether the bottom row of the visible picture is mostly bare (a face and neck) rather than a spread of shoulders. */
async function nearlyAllFace(source: Uint8Array, bounds: { left: number; top: number; width: number; height: number }): Promise<boolean> {
  const { data, info } = await sharp(source, { limitInputPixels: 40_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const row = bounds.top + bounds.height - 1; let covered = 0;
  for (let x = bounds.left; x < bounds.left + bounds.width; x++) if (data[(row * info.width + x) * 4 + 3]! > ALPHA_KEEP) covered++;
  return covered / bounds.width < 0.55;
}

/** The canvas, mask and head layer for a cut-off picture, or null when this method does not apply (the bottom is not cut off). */
export async function planBodyCanvas(source: Uint8Array, edges: readonly string[]): Promise<BodyCanvas | null> {
  const bounds = edges.includes("bottom") ? await subjectBounds(source) : null;
  const shape = bounds ? proportions(edges, await nearlyAllFace(source, bounds)) : null;
  if (!shape || !bounds) return null;
  const size = OUTPAINT_CANVAS;
  let height = Math.round(size * shape.height), width = Math.round(bounds.width * height / bounds.height);
  if (width > size * 0.6) { width = Math.round(size * 0.6); height = Math.round(bounds.height * width / bounds.width); }
  const left = Math.round((size - width) / 2), top = Math.round(size * 0.06);
  const placed = await sharp(source, { limitInputPixels: 40_000_000 }).extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();

  const canvas = await sharp({ create: { width: size, height: size, channels: 3, background: { r: GREY, g: GREY, b: GREY } } })
    .composite([{ input: placed, raw: { width, height, channels: 4 }, left, top }]).png().toBuffer();

  const mask = Buffer.alloc(size * size, 255);
  const layer = Buffer.alloc(size * size * 4);
  // Above the picture nothing is drawn: a model given room there paints a second head.
  mask.fill(0, 0, Math.min(size, top + 1) * size);
  for (let y = 0; y < height; y++) {
    const down = Math.max(0, Math.min(1, (shape.fadeEnd - y / height) / (shape.fadeEnd - shape.fadeStart)));
    for (let x = 0; x < width; x++) {
      // The head is the middle of the picture, above the chin: its sides (the shoulders) are painted again so no box of the old shirt shows.
      const across = Math.max(0, Math.min(1, Math.min(x / width - 0.12, 0.88 - x / width) / 0.08));
      const at = (y * width + x) * 4, alpha = placed[at + 3]!, target = (top + y) * size + left + x, weight = down * across;
      if (alpha > ALPHA_KEEP && weight > 0.5) mask[target] = 0;
      layer[target * 4] = placed[at]!; layer[target * 4 + 1] = placed[at + 1]!; layer[target * 4 + 2] = placed[at + 2]!;
      layer[target * 4 + 3] = Math.round(alpha * weight);
    }
  }
  return {
    canvas: new Uint8Array(canvas),
    mask: new Uint8Array(await sharp(mask, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer()),
    head: new Uint8Array(await sharp(layer, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()),
  };
}

/** Lays the person's own head back over the model's result. */
export async function pasteHead(drawn: Uint8Array, head: Uint8Array): Promise<Uint8Array> {
  const size = OUTPAINT_CANVAS;
  const base = await sharp(Buffer.from(drawn), { limitInputPixels: 40_000_000 }).resize(size, size, { fit: "fill" }).ensureAlpha().toBuffer();
  return new Uint8Array(await sharp(base).composite([{ input: Buffer.from(head) }]).png().toBuffer());
}
