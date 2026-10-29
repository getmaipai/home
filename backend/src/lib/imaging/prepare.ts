import sharp from "sharp";
import { findSubject } from "./subject";
import { fitToFrame, type FitOptions } from "./fit";
import { imagingTargets } from "./targets";

export type PrepareStep = "upscale" | "remove_background" | "find_subject" | "fit";
export interface PrepareOptions extends FitOptions {
  upscaleBelowShortSide?: number;
  upscale?: (bytes: Uint8Array) => Promise<Uint8Array>;
  removeBackground?: (bytes: Uint8Array) => Promise<Uint8Array>;
  fit?: (png: Uint8Array, options: FitOptions) => Promise<Uint8Array>;
}
export async function preparePicture(bytes: Uint8Array, options: PrepareOptions = imagingTargets.portrait): Promise<{ bytes: Uint8Array; steps: PrepareStep[] }> {
  let current: Uint8Array<ArrayBufferLike> = new Uint8Array(bytes); const steps: PrepareStep[] = [];
  let meta = await sharp(current, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  if (!meta.width || !meta.height) throw new Error("That picture could not be read. Use a PNG, JPEG or WebP picture and try again.");
  const threshold = options.upscaleBelowShortSide ?? options.size;
  if (Math.min(meta.width, meta.height) < threshold) {
    if (!options.upscale) throw new Error("The upscaler isn't installed. Install it from the engine's model list, then try again.");
    current = await options.upscale(current); steps.push("upscale");
    meta = await sharp(current, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  }
  let transparent = false;
  if (meta.hasAlpha) {
    try { transparent = (await sharp(current).stats()).channels[3]?.min !== 255; } catch { /* decode at fit gives the caller's normal error */ }
  }
  if (!transparent) {
    if (!options.removeBackground) throw new Error("The background remover isn't installed. Install it from the engine's model list, then try again.");
    current = await options.removeBackground(current); steps.push("remove_background");
  }
  const subject = await findSubject(current); steps.push("find_subject");
  if (!subject.bounds) throw new Error("That picture has no visible subject.");
  current = await (options.fit ?? fitToFrame)(current, options); steps.push("fit");
  return { bytes: current, steps };
}
