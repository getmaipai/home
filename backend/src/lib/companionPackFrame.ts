// The pack's one shared frame (companion-maker-2026-11-10, "one frame"). The Stack's media.companion_clip crops a clip around its own
// opaque bounding box, so clips of one character would differ in framing. Instead the maker defines ONE square crop of the keyed rest
// picture (`PackFrame`, in the green source's pixels) and applies it to every clip (as a crop in the clip's pixels), to the rest
// picture, to the mouth frames and to the emotion poses, all scaled to 480x480.
import sharp from "sharp";
import { keyOut } from "@/lib/companionLook";

/** The desktop tier's frame size; the Stack makes the 320 phone twin from the same crop. */
export const PACK_FRAME_PX = 480;
/** The same rule as the Stack's companionCrop (stack/backend/src/media/companionClip.ts): opaque means alpha above 16, the square is the larger side of the box times 1.06, centred on the box. */
export const PACK_FRAME_MARGIN = 1.06;
export const PACK_FRAME_ALPHA = 16;

export interface PackFrame { x: number; y: number; size: number }
export interface Dims { width: number; height: number }

/** Moves a square inside a picture (and shrinks it when the picture is smaller than the square). */
export function clampSquare(f: PackFrame, width: number, height: number): PackFrame {
  const size = Math.max(1, Math.min(Math.round(f.size), width, height));
  return { x: Math.max(0, Math.min(Math.round(f.x), width - size)), y: Math.max(0, Math.min(Math.round(f.y), height - size)), size };
}

/** The square around the opaque box (rule above), clamped inside the picture; no opaque pixel gives the largest centred square. */
export function frameOfBox(box: { minX: number; minY: number; maxX: number; maxY: number } | null, width: number, height: number): PackFrame {
  if (!box) { const size = Math.min(width, height); return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size }; }
  const side = Math.max(box.maxX - box.minX + 1, box.maxY - box.minY + 1), size = Math.ceil(side * PACK_FRAME_MARGIN);
  const cx = (box.minX + box.maxX + 1) / 2, cy = (box.minY + box.maxY + 1) / 2;
  return clampSquare({ x: cx - size / 2, y: cy - size / 2, size }, width, height);
}

/** The aspect (width over height) the pack's clips are made at: LTX-2.5 Max's 1024x576 (the standard model's 768x448 is within 4 percent, and the band is cut from the frame's height, so either clip size fits). The start picture of a clip is a band of the rest picture of this aspect, so there are no bars round it. */
export const PACK_CLIP_ASPECT = 1024 / 576;
/** How far above the head the band starts, as a share of the band height. */
export const PACK_HEADSHOT_TOP = 0.1;

/**
 * The pack frame as a HEADSHOT: the band across the whole picture at the clips' aspect, starting a little above the head, and the square in its
 * middle (the band's height on each side). Clips are made from this band without bars (a square picture sitting in a wide frame made the video
 * model zoom in and out, found on the first real pack), so the frame is exactly the middle of every clip. The band reaches from the head to the
 * upper chest: nothing below it is ever shown. No opaque pixel gives the largest centred square.
 */
export function headshotFrame(box: { minX: number; minY: number; maxX: number; maxY: number } | null, width: number, height: number): PackFrame {
  if (!box) return frameOfBox(null, width, height);
  const size = Math.max(1, Math.min(Math.round(width / PACK_CLIP_ASPECT), height, width));
  const cx = (box.minX + box.maxX + 1) / 2;
  return clampSquare({ x: cx - size / 2, y: box.minY - PACK_HEADSHOT_TOP * size, size }, width, height);
}

/** The band of a picture a clip is made from: the frame's height, as wide as the clip's aspect needs, centred on the frame and kept inside the picture. */
export function bandOfFrame(frame: PackFrame, source: Dims, clip: Dims): { x: number; y: number; width: number; height: number } {
  const width = Math.min(source.width, Math.max(frame.size, Math.round(frame.size * clip.width / clip.height)));
  const height = Math.min(source.height, Math.round(width * clip.height / clip.width));
  return { x: Math.max(0, Math.min(Math.round(frame.x + frame.size / 2 - width / 2), source.width - width)), y: Math.max(0, Math.min(Math.round(frame.y), source.height - height)), width, height };
}

/** The pack frame in the clip's pixels when the clip was made from `bandOfFrame` scaled to the clip: the square in the middle of the clip. */
export function frameInBand(frame: PackFrame, band: { x: number; y: number; width: number; height: number }, clip: Dims): PackFrame {
  const sx = clip.width / band.width, sy = clip.height / band.height;
  return clampSquare({ x: (frame.x - band.x) * sx, y: (frame.y - band.y) * sy, size: frame.size * sy }, clip.width, clip.height);
}

/** The bounding box of the opaque pixels of an RGBA buffer. */
export function opaqueBox(rgba: Uint8Array, width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3]! > PACK_FRAME_ALPHA) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** The pack frame of a picture on the key colour: key it out, then take the square around what is left. Also returns the picture's size. */
export async function packFrameOfSource(png: Uint8Array, keyHex: string): Promise<{ frame: PackFrame; size: Dims }> {
  const keyed = await keyOut(png, keyHex);
  const raw = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { frame: headshotFrame(opaqueBox(raw.data, raw.info.width, raw.info.height), raw.info.width, raw.info.height), size: { width: raw.info.width, height: raw.info.height } };
}

/**
 * The pack frame in a video clip's source pixels. The clip was made from the rest picture fitted whole into the clip size (contain, key colour
 * around it): scale s = min(clipW / restW, clipH / restH), the picture is drawn round(rest * s) in size and centred with floor offsets.
 * x = offX + frame.x * s, y = offY + frame.y * s, size = frame.size * s, rounded and clamped inside the clip.
 */
export function frameInClip(frame: PackFrame, rest: Dims, clip: Dims): PackFrame {
  const s = Math.min(clip.width / rest.width, clip.height / rest.height);
  const drawnW = Math.round(rest.width * s), drawnH = Math.round(rest.height * s);
  const offX = Math.floor((clip.width - drawnW) / 2), offY = Math.floor((clip.height - drawnH) / 2);
  return clampSquare({ x: offX + frame.x * s, y: offY + frame.y * s, size: frame.size * s }, clip.width, clip.height);
}

/** The frame (in source pixels) for another picture that is the source at another size (an edit may return a different size). */
export function frameForImage(frame: PackFrame, source: Dims, image: Dims): PackFrame {
  if (image.width === source.width && image.height === source.height) return frame;
  const sx = image.width / source.width, sy = image.height / source.height, s = Math.min(sx, sy);
  return clampSquare({ x: frame.x * sx, y: frame.y * sy, size: frame.size * s }, image.width, image.height);
}

/** One point in an image's pixels to the pack frame: x' = (x - frame.x) * 480 / frame.size (same for y). `image` is the size of the picture the point is in, `source` the size the frame is defined in. */
export function packPoint(frame: PackFrame, source: Dims, image: Dims, point: readonly number[]): number[] {
  const sx = source.width / image.width, sy = source.height / image.height, k = PACK_FRAME_PX / frame.size;
  return [(point[0]! * sx - frame.x) * k, (point[1]! * sy - frame.y) * k, ...point.slice(2)];
}

const isPoint = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === "number");
/** Face landmarks (lists of [x, y] points, any other field untouched) into the pack frame. */
export function packLandmarks<T extends Record<string, unknown>>(landmarks: T, frame: PackFrame, source: Dims, image: Dims): T {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(landmarks)) out[name] = Array.isArray(value) && value.length > 0 && value.every(isPoint) ? (value as number[][]).map((p) => packPoint(frame, source, image, p)) : value;
  return out as T;
}

/** The picture cropped by the frame and scaled to 480x480 (lanczos, RGBA, alpha kept); `source` is the size the frame is defined in. */
export async function cropToPack(bytes: Uint8Array, frame: PackFrame, source: Dims): Promise<Uint8Array> {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error("A picture could not be read.");
  const f = frameForImage(frame, source, { width: meta.width, height: meta.height });
  return new Uint8Array(await sharp(bytes).ensureAlpha().extract({ left: f.x, top: f.y, width: f.size, height: f.size }).resize(PACK_FRAME_PX, PACK_FRAME_PX, { fit: "fill", kernel: "lanczos3" }).png().toBuffer());
}

/** The size of a picture's pixels. */
export async function sizeOf(bytes: Uint8Array): Promise<Dims> {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error("A picture could not be read.");
  return { width: meta.width, height: meta.height };
}
