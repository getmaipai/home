import sharp from "sharp";
import { subjectBounds } from "./subject";

/**
 * Where the subject sits in the frame: `zoom` scales it relative to the normal fit (1 and up, no upper limit), `x` and `y` are its centre as fractions of the frame
 * (0.5 is centred; values from -1 to 2 move it past an edge, so a character can be pushed as far down or sideways as the person wants). A subject moved past
 * the frame edge is cut by the frame.
 */
export interface Placement { zoom: number; x: number; y: number }
export const PLACEMENT_ZOOM_MAX = 200;
export const PLACEMENT_POSITION_MIN = -1;
export const PLACEMENT_POSITION_MAX = 2;
export interface FitOptions { size: number; marginPercent: number; placement?: Placement }
const clampPosition = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? Math.max(PLACEMENT_POSITION_MIN, Math.min(PLACEMENT_POSITION_MAX, value)) : fallback;

export async function fitToFrame(png: Uint8Array, options: FitOptions): Promise<Uint8Array> {
  const bounds = await subjectBounds(png);
  if (!bounds) throw new Error("That picture has no visible subject.");
  const contentSize = Math.round(options.size * (1 - 2 * options.marginPercent / 100));
  if (contentSize < 1 || options.size < 1) throw new Error("The picture frame size is invalid.");
  const placement = options.placement, zoom = placement && Number.isFinite(placement.zoom) ? Math.max(1, Math.min(PLACEMENT_ZOOM_MAX, placement.zoom)) : 1;
  const fx = clampPosition(placement?.x, 0.5), fy = clampPosition(placement?.y, 0.5);
  // The subject is scaled to fit a target square and centred on (fx, fy); only the part that lands inside the frame is drawn, so a large zoom never builds a huge picture.
  const scale = Math.max(1, Math.round(contentSize * zoom)) / Math.max(bounds.width, bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale)), height = Math.max(1, Math.round(bounds.height * scale));
  const left = Math.round(fx * options.size - width / 2), top = Math.round(fy * options.size - height / 2);
  const cutLeft = Math.max(0, -left), cutTop = Math.max(0, -top);
  const visibleWidth = Math.min(width, options.size - left) - cutLeft, visibleHeight = Math.min(height, options.size - top) - cutTop;
  if (visibleWidth < 1 || visibleHeight < 1) throw new Error("The character is moved out of the picture. Move it back into the frame.");
  // The matching window of the original, with a pixel to spare, scaled to exactly the visible size.
  const sourceLeft = bounds.left + Math.min(bounds.width - 1, Math.floor(cutLeft / scale)), sourceTop = bounds.top + Math.min(bounds.height - 1, Math.floor(cutTop / scale));
  const sourceWidth = Math.max(1, Math.min(bounds.left + bounds.width - sourceLeft, Math.ceil(visibleWidth / scale) + 1)), sourceHeight = Math.max(1, Math.min(bounds.top + bounds.height - sourceTop, Math.ceil(visibleHeight / scale) + 1));
  const visible = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).extract({ left: sourceLeft, top: sourceTop, width: sourceWidth, height: sourceHeight }).resize(visibleWidth, visibleHeight, { fit: "fill" }).png().toBuffer();
  return new Uint8Array(await sharp({ create: { width: options.size, height: options.size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: visible, left: Math.max(0, left), top: Math.max(0, top) }]).png().toBuffer());
}
