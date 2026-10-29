import sharp from "sharp";
import { focalPointOf, type FocalPoint } from "./focal";

export interface SubjectBounds { left: number; top: number; width: number; height: number }
const ALPHA_THRESHOLD = 8;
export type ClippedEdge = "left" | "right" | "top" | "bottom";
export async function clippedEdges(png: Uint8Array, thresholdPercent = 1): Promise<Record<ClippedEdge, boolean>> {
  const bounds = await subjectBounds(png);
  const { width, height } = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  const empty = { left: false, right: false, top: false, bottom: false };
  if (!bounds || !width || !height) return empty;
  const bandX = Math.max(1, Math.ceil(width * thresholdPercent / 100)), bandY = Math.max(1, Math.ceil(height * thresholdPercent / 100));
  return { left: bounds.left < bandX, right: bounds.left + bounds.width > width - bandX, top: bounds.top < bandY, bottom: bounds.top + bounds.height > height - bandY };
}
export async function subjectBounds(png: Uint8Array): Promise<SubjectBounds | null> {
  const { data, info } = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3]! <= ALPHA_THRESHOLD) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left || bottom < top ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}
export async function findSubject(bytes: Uint8Array): Promise<{ bounds: SubjectBounds | null; focal: FocalPoint | null }> {
  const [bounds, focal] = await Promise.all([subjectBounds(bytes), focalPointOf(bytes)]);
  return { bounds, focal };
}
