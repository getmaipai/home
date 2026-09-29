import { tensorFor, type OnnxInferenceSession } from "@/lib/onnx/session-runtime";
import { CROP_SIZE } from "@/lib/vision/faceAlign";

export const EMBEDDING_DIM = 128;

export function toEmbedBlob(alignedRgba: Uint8ClampedArray): Float32Array {
  if (alignedRgba.length !== CROP_SIZE * CROP_SIZE * 4) {
    throw new Error(`expected a ${CROP_SIZE}x${CROP_SIZE} RGBA aligned crop`);
  }
  // alignCrop returns RGBA; SFace expects RGB after Python's BGR->RGB swap, so RGBA drops alpha and stays RGB, raw 0-255.
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

export async function runSfaceEmbedding(session: OnnxInferenceSession, alignedRgba: Uint8ClampedArray): Promise<Float32Array> {
  const input = await tensorFor(toEmbedBlob(alignedRgba), [1, 3, CROP_SIZE, CROP_SIZE]);
  const outputs = await session.run({ data: input });
  const features = outputs.fc1?.data;
  if (!(features instanceof Float32Array) || features.length < EMBEDDING_DIM) {
    throw new Error("SFace output fc1 must contain 128 float values");
  }
  return features.slice(0, EMBEDDING_DIM);
}
