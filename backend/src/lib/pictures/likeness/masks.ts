import sharp from "sharp";
import { stackSegment, type SegmentPoint } from "./stackSegment";
import type { Face } from "./faces";

export interface MaskImage { data: Uint8Array; width: number; height: number }
export async function grayMask(png: Uint8Array, width?: number, height?: number): Promise<MaskImage> {
  const { data, info } = await sharp(png).resize(width && height ? { width, height, fit: "fill" } : undefined).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}
export async function encodeMask(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer());
}
export function morphology(input: Uint8Array, width: number, height: number, radius: number, mode: "dilate" | "erode"): Uint8Array {
  if (input.length !== width * height) throw new Error("mask dimensions do not match");
  if (radius <= 0) return input.slice();
  const out = new Uint8Array(input.length), r2 = radius * radius;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = mode === "erode" ? 255 : 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const xx = x + dx, yy = y + dy;
      const pixel = xx < 0 || xx >= width || yy < 0 || yy >= height ? 0 : input[yy * width + xx]!;
      value = mode === "dilate" ? Math.max(value, pixel) : Math.min(value, pixel);
    }
    out[y * width + x] = value;
  }
  return out;
}
export function union(...masks: Uint8Array[]): Uint8Array { const out = masks[0]?.slice() ?? new Uint8Array(); for (const mask of masks.slice(1)) { if (mask.length !== out.length) throw new Error("mask dimensions do not match"); for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i]!, mask[i]!); } return out; }
export function subtract(a: Uint8Array, b: Uint8Array): Uint8Array { if (a.length !== b.length) throw new Error("mask dimensions do not match"); return Uint8Array.from(a, (v, i) => Math.max(0, v - b[i]!)); }
export function invert(a: Uint8Array): Uint8Array { return Uint8Array.from(a, v => 255 - v); }
export function ellipse(width: number, height: number, cx: number, cy: number, rx: number, ry: number): Uint8Array { const out = new Uint8Array(width * height); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) out[y * width + x] = 255; return out; }
function coords(face: Face) { const [x, y, w, h] = face.bbox; return { x, y, w, h, cx: x + w / 2 }; }
export function faceOval(face: Face, expand: number, width: number, height: number): Uint8Array { const { x, y, w, h } = coords(face); return ellipse(width, height, x + w / 2, y + h / 2, w * (0.62 + expand), h * (0.62 + expand)); }
async function segmentMask(png: Uint8Array, prompt: { box: [number, number, number, number]; points: SegmentPoint[] }, width: number, height: number): Promise<Uint8Array> { const response = await stackSegment(png, prompt); return (await grayMask(response.mask, width, height)).data; }
export async function personSilhouette(png: Uint8Array, face: Face, others: Face[] = []): Promise<Uint8Array> {
  const { width, height } = await sharp(png).metadata(); if (!width || !height) throw new Error("Picture dimensions are unavailable.");
  const { x, y, w, h, cx } = coords(face);
  const box: [number, number, number, number] = [Math.max(0, x - 1.6 * w), Math.max(0, y - 0.45 * h), Math.min(width, x + 2.6 * w), Math.min(height, y + 7 * h)];
  const points: SegmentPoint[] = [[cx, y + h * 0.55], [cx, Math.min(height - 2, y + h * 1.9)], [Math.max(1, cx - w), Math.min(height - 2, y + h * 2.4)], [Math.min(width - 2, cx + w), Math.min(height - 2, y + h * 2.4)], [cx, Math.min(height - 2, y + h * 3.4)]].map(([px, py]) => ({ x: px!, y: py!, label: 1 }));
  for (const other of others) points.push({ x: other.bbox[0] + other.bbox[2] / 2, y: other.bbox[1] + other.bbox[3] * 0.55, label: 0 });
  return segmentMask(png, { box, points }, width, height);
}
export async function headMask(png: Uint8Array, face: Face): Promise<Uint8Array> {
  const { width, height } = await sharp(png).metadata(); if (!width || !height) throw new Error("Picture dimensions are unavailable.");
  const { x, y, w, h } = coords(face), box: [number, number, number, number] = [Math.max(0, x - 0.3 * w), Math.max(0, y - 0.55 * h), Math.min(width, x + 1.3 * w), Math.min(height, y + 1.1 * h)];
  const points: SegmentPoint[] = [face.rightEye, face.leftEye, face.nose, face.rightMouth, face.leftMouth].map(([px, py]) => ({ x: px, y: py, label: 1 }));
  points.push({ x: x + w / 2, y: Math.max(0, y - 0.18 * h), label: 1 }, { x: x + w / 2, y: y + h * 0.9, label: 1 });
  const mask = await segmentMask(png, { box, points }, width, height);
  const chin = Math.min(height, Math.trunc(y + h * 1.04)); mask.fill(0, chin * width);
  const oval = faceOval(face, 0, width, height); oval.fill(0, chin * width);
  return union(mask, oval);
}
export async function outfitMask(silhouette: Uint8Array, head: Uint8Array, width: number, height: number): Promise<Uint8Array> { return subtract(morphology(silhouette, width, height, 7, "dilate"), head); }
export async function backgroundMask(silhouette: Uint8Array, head: Uint8Array, width: number, height: number): Promise<Uint8Array> { return invert(union(morphology(silhouette, width, height, 2, "erode"), morphology(head, width, height, 3, "dilate"))); }
export async function smileMask(faces: Face[], width: number, height: number): Promise<Uint8Array> { return union(...faces.map(face => { const { x, y, w, h } = coords(face); return ellipse(width, height, x + w / 2, y + h / 2, w * 0.75, h * 0.75); })); }
