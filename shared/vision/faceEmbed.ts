import { CROP_SIZE } from "./faceAlign";

export const EMBEDDING_DIM = 128;

/** Convert an aligned RGBA crop to raw RGB NCHW values for SFace. */
export function toEmbedBlob(alignedRgba: Uint8ClampedArray): Float32Array {
  if (alignedRgba.length !== CROP_SIZE * CROP_SIZE * 4) throw new Error(`expected a ${CROP_SIZE}x${CROP_SIZE} RGBA aligned crop`);
  const plane = CROP_SIZE * CROP_SIZE;
  const blob = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const src = pixel * 4;
    blob[pixel] = alignedRgba[src]!;
    blob[plane + pixel] = alignedRgba[src + 1]!;
    blob[plane * 2 + pixel] = alignedRgba[src + 2]!;
  }
  return blob;
}
