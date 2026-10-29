import sharp from "sharp";

export interface Frame { zoom: number; x: number; y: number }
/** Crop a PNG around a fractional centre. Coordinates clamp to the image edges. */
export async function cropToFrame(png: Uint8Array, frame: Frame): Promise<Uint8Array> {
  if (!Number.isFinite(frame.zoom) || frame.zoom < 1 || frame.zoom > 4 || !Number.isFinite(frame.x) || !Number.isFinite(frame.y)) throw new Error("The picture frame is invalid.");
  const meta = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  if (!meta.width || !meta.height) throw new Error("That picture could not be read.");
  const width = Math.max(1, Math.round(meta.width / frame.zoom)), height = Math.max(1, Math.round(meta.height / frame.zoom));
  const x = Math.round(Math.max(0, Math.min(1, frame.x)) * meta.width - width / 2), y = Math.round(Math.max(0, Math.min(1, frame.y)) * meta.height - height / 2);
  return new Uint8Array(await sharp(png).extract({ left: Math.max(0, Math.min(meta.width - width, x)), top: Math.max(0, Math.min(meta.height - height, y)), width, height }).png().toBuffer());
}
