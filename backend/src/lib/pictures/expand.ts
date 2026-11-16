// CREATOR-17 Expand: the shape of a bigger canvas around a picture, and the mask that lets the picture engine fill only the new area.
// Pure geometry first (so every shape can be tested without an engine), then one function that draws the canvas and the mask.
// The original is only ever scaled down (when the canvas would be bigger than the engine takes), never cropped, and it sits in the middle.
import sharp from "sharp";

export const EXPAND_SHAPES = ["16:9", "9:16", "4:5", "1:1"] as const;
export type ExpandShape = (typeof EXPAND_SHAPES)[number];

export const EXPAND_BASE_PROMPT = "Continue the scene naturally into the new area";
export const EXPAND_NEEDS_ENGINE = "Expanding needs the picture editor engine. Turn it on in Settings, AI and models, then try again.";
export const EXPAND_SAME_SHAPE = "That picture is already that shape. Choose a different shape.";

export interface ExpandLimits { maxSide?: number; maxMegapixels?: number; step?: number }
export interface ExpandGeometry {
  canvasWidth: number; canvasHeight: number;
  /** The original as placed on the canvas (scaled down only when the canvas would be too big). */
  placedWidth: number; placedHeight: number; left: number; top: number;
  /** The overlap ring: how far the fill reaches back into the original from each edge that meets new area. */
  ring: number;
  /** The part of the original the fill must leave alone: a rectangle inside the placed original. */
  keep: { x: number; y: number; width: number; height: number };
  /** False when the picture already has this shape, so there is no new area to fill. */
  grows: boolean;
}

export function isExpandShape(value: unknown): value is ExpandShape {
  return typeof value === "string" && (EXPAND_SHAPES as readonly string[]).includes(value);
}

const ratioOf = (shape: ExpandShape): number => { const [a, b] = shape.split(":").map(Number); return a! / b!; };

/** The canvas of the target shape that holds the whole picture, with the picture centred. */
export function expandGeometry(width: number, height: number, shape: ExpandShape, limits: ExpandLimits = {}): ExpandGeometry {
  const step = Math.max(1, limits.step ?? 16);
  const maxSide = limits.maxSide ?? 2048;
  const r = ratioOf(shape);
  // The smallest canvas of this shape that holds the picture at full size.
  const fullW = width / height > r ? width : height * r;
  const fullH = width / height > r ? width / r : height;
  let scale = Math.min(1, maxSide / Math.max(fullW, fullH));
  if (limits.maxMegapixels) scale = Math.min(scale, Math.sqrt((limits.maxMegapixels * 1_000_000) / (fullW * fullH)));
  const up = (n: number) => Math.max(step, Math.ceil(n / step) * step);
  const canvasWidth = up(fullW * scale);
  const canvasHeight = up(fullH * scale);
  const placedWidth = Math.min(canvasWidth, Math.max(1, Math.round(width * scale)));
  const placedHeight = Math.min(canvasHeight, Math.max(1, Math.round(height * scale)));
  const left = Math.floor((canvasWidth - placedWidth) / 2);
  const top = Math.floor((canvasHeight - placedHeight) / 2);
  const ring = Math.max(4, Math.round(Math.min(canvasWidth, canvasHeight) * 0.02));
  const insetLeft = left > 0 ? ring : 0;
  const insetTop = top > 0 ? ring : 0;
  const insetRight = canvasWidth - (left + placedWidth) > 0 ? ring : 0;
  const insetBottom = canvasHeight - (top + placedHeight) > 0 ? ring : 0;
  const keep = { x: left + insetLeft, y: top + insetTop, width: Math.max(1, placedWidth - insetLeft - insetRight), height: Math.max(1, placedHeight - insetTop - insetBottom) };
  const grows = (fullW * fullH) / (width * height) >= 1.01;
  return { canvasWidth, canvasHeight, placedWidth, placedHeight, left, top, ring, keep, grows };
}

/** One byte per pixel: 255 where the engine may paint (the new area and the ring), 0 where the original stays as it is. */
export function expandMaskPixels(g: ExpandGeometry): Uint8Array {
  const pixels = new Uint8Array(g.canvasWidth * g.canvasHeight).fill(255);
  for (let y = g.keep.y; y < g.keep.y + g.keep.height; y += 1) pixels.fill(0, y * g.canvasWidth + g.keep.x, y * g.canvasWidth + g.keep.x + g.keep.width);
  return pixels;
}

export interface ExpandPlan extends ExpandGeometry { canvas: Uint8Array; mask: Uint8Array }

/** Draws the canvas (the original centred on neutral grey) and the mask as PNGs, for the picture engine's masked fill. */
export async function planExpand(bytes: Uint8Array, shape: ExpandShape, limits: ExpandLimits = {}): Promise<ExpandPlan> {
  const meta = await sharp(bytes).rotate().metadata();
  if (!meta.width || !meta.height) throw new Error("The picture has no size.");
  const g = expandGeometry(meta.width, meta.height, shape, limits);
  const placed = await sharp(bytes).rotate().resize(g.placedWidth, g.placedHeight, { fit: "fill" }).ensureAlpha().png().toBuffer();
  const canvas = await sharp({ create: { width: g.canvasWidth, height: g.canvasHeight, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .composite([{ input: placed, left: g.left, top: g.top }]).png().toBuffer();
  const mask = await sharp(Buffer.from(expandMaskPixels(g)), { raw: { width: g.canvasWidth, height: g.canvasHeight, channels: 1 } }).png().toBuffer();
  return { ...g, canvas: new Uint8Array(canvas), mask: new Uint8Array(mask) };
}
