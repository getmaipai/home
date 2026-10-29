import sharp from "sharp";
import { subjectBounds } from "./subject";

export interface FitOptions { size: number; marginPercent: number }
export async function fitToFrame(png: Uint8Array, options: FitOptions): Promise<Uint8Array> {
  const bounds = await subjectBounds(png);
  if (!bounds) throw new Error("That picture has no visible subject.");
  const contentSize = Math.round(options.size * (1 - 2 * options.marginPercent / 100));
  if (contentSize < 1 || options.size < 1) throw new Error("The picture frame size is invalid.");
  const fitted = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).extract(bounds).resize(contentSize, contentSize, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(fitted).metadata();
  return new Uint8Array(await sharp({ create: { width: options.size, height: options.size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: fitted, left: Math.round((options.size - (meta.width ?? contentSize)) / 2), top: Math.round((options.size - (meta.height ?? contentSize)) / 2) }]).png().toBuffer());
}
