import { tensorFor, type OnnxInferenceSession } from "@/lib/onnx/session-runtime";
import { decodeYunetOutputs, type DetectedFace } from "@/lib/vision/faceDetect";

export function padToStride(
  frameRgba: Uint8ClampedArray,
  width: number,
  height: number,
  stride = 32,
): { padded: Uint8ClampedArray; paddedWidth: number; paddedHeight: number } {
  if (frameRgba.length !== width * height * 4) throw new Error("frameRgba length must equal width * height * 4");
  if (!Number.isInteger(stride) || stride <= 0) throw new Error("stride must be a positive integer");
  const paddedWidth = Math.ceil(width / stride) * stride;
  const paddedHeight = Math.ceil(height / stride) * stride;
  const padded = new Uint8ClampedArray(paddedWidth * paddedHeight * 4);
  for (let y = 0; y < height; y += 1) {
    padded.set(frameRgba.subarray(y * width * 4, (y + 1) * width * 4), y * paddedWidth * 4);
  }
  return { padded, paddedWidth, paddedHeight };
}

export function toNchwBlob(paddedRgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  if (paddedRgba.length !== width * height * 4) throw new Error("paddedRgba length must equal width * height * 4");
  // Canvas frames are RGBA; YuNet's daemon contract is BGR. Convert here, then CHW, retaining raw 0-255 values.
  const plane = width * height;
  const blob = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const src = pixel * 4;
    blob[pixel] = paddedRgba[src + 2]!;
    blob[plane + pixel] = paddedRgba[src + 1]!;
    blob[plane * 2 + pixel] = paddedRgba[src]!;
  }
  return blob;
}

export async function runYunetDetection(
  session: OnnxInferenceSession,
  frameRgba: Uint8ClampedArray,
  width: number,
  height: number,
  scoreThreshold: number,
  nmsThreshold: number,
): Promise<DetectedFace[]> {
  const { padded, paddedWidth, paddedHeight } = padToStride(frameRgba, width, height);
  const input = await tensorFor(toNchwBlob(padded, paddedWidth, paddedHeight), [1, 3, paddedHeight, paddedWidth]);
  const result = await session.run({ input });
  const outputs: Record<string, Float32Array> = {};
  for (const [name, tensor] of Object.entries(result)) outputs[name] = tensor.data as Float32Array;
  return decodeYunetOutputs(outputs, paddedWidth, scoreThreshold, nmsThreshold);
}
