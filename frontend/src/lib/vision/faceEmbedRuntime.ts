import { tensorFor, type OnnxInferenceSession } from "@/lib/onnx/session-runtime";
import { CROP_SIZE } from "../../../../shared/vision/faceAlign";

export { EMBEDDING_DIM, toEmbedBlob } from "../../../../shared/vision/faceEmbed";
import { EMBEDDING_DIM, toEmbedBlob } from "../../../../shared/vision/faceEmbed";

export async function runSfaceEmbedding(session: OnnxInferenceSession, alignedRgba: Uint8ClampedArray): Promise<Float32Array> {
  const input = await tensorFor(toEmbedBlob(alignedRgba), [1, 3, CROP_SIZE, CROP_SIZE]);
  const outputs = await session.run({ data: input });
  const features = outputs.fc1?.data;
  if (!(features instanceof Float32Array) || features.length < EMBEDDING_DIM) {
    throw new Error("SFace output fc1 must contain 128 float values");
  }
  return features.slice(0, EMBEDDING_DIM);
}
