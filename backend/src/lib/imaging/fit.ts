import sharp from "sharp";
import { subjectBounds } from "./subject";

/** Where the subject sits in the frame: `zoom` scales it relative to the normal fit (1 to 4), `x` and `y` are its centre as 0 to 1 fractions of the frame (0.5 is centred). A subject moved past the frame edge is cut by the frame. */
export interface Placement { zoom: number; x: number; y: number }
export interface FitOptions { size: number; marginPercent: number; placement?: Placement }
export async function fitToFrame(png: Uint8Array, options: FitOptions): Promise<Uint8Array> {
  const bounds = await subjectBounds(png);
  if (!bounds) throw new Error("That picture has no visible subject.");
  const contentSize = Math.round(options.size * (1 - 2 * options.marginPercent / 100));
  if (contentSize < 1 || options.size < 1) throw new Error("The picture frame size is invalid.");
  const placement = options.placement, zoom = placement ? Math.max(1, Math.min(4, Number.isFinite(placement.zoom) ? placement.zoom : 1)) : 1;
  const fx = placement && Number.isFinite(placement.x) ? Math.max(0, Math.min(1, placement.x)) : 0.5, fy = placement && Number.isFinite(placement.y) ? Math.max(0, Math.min(1, placement.y)) : 0.5;
  const target = Math.max(1, Math.round(contentSize * zoom));
  let fitted = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).extract(bounds).resize(target, target, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(fitted).metadata(), width = meta.width ?? target, height = meta.height ?? target;
  let left = Math.round(fx * options.size - width / 2), top = Math.round(fy * options.size - height / 2);
  // sharp cannot composite outside the canvas: cut the picture to the part that lands inside the frame.
  const cutLeft = Math.max(0, -left), cutTop = Math.max(0, -top), cutRight = Math.max(0, left + width - options.size), cutBottom = Math.max(0, top + height - options.size);
  if (cutLeft + cutRight >= width || cutTop + cutBottom >= height) throw new Error("The character is moved out of the picture. Move it back into the frame.");
  if (cutLeft || cutTop || cutRight || cutBottom) { fitted = await sharp(fitted).extract({ left: cutLeft, top: cutTop, width: width - cutLeft - cutRight, height: height - cutTop - cutBottom }).png().toBuffer(); left += cutLeft; top += cutTop; }
  return new Uint8Array(await sharp({ create: { width: options.size, height: options.size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: fitted, left, top }]).png().toBuffer());
}
