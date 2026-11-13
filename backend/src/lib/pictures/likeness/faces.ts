// Likeness recognition uses Home's pinned YuNet and SFace ONNX models.
// Pixel decoding/alignment and the pure YuNet/SFace preprocessing live in shared/vision.
// @ts-ignore - onnxruntime-web has no resolvable declarations in Bun's bundle
import * as ort from "onnxruntime-web";
import type { InferenceSession } from "onnxruntime-web";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { VISION_FACE_DETECTOR, VISION_FACE_EMBEDDER, faceAssetPath } from "@/lib/visionAssets";
import { decodeYunetOutputs, type DetectedFace } from "../../../../../shared/vision/faceDetect";
import { alignCrop } from "../../../../../shared/vision/faceAlign";
import { toEmbedBlob } from "../../../../../shared/vision/faceEmbed";

export type Face = DetectedFace & { score: number };
export type FacesUnavailable = { ok: false; kind: "FacesUnavailable"; line: string };
export type FaceResult<T> = { ok: true; value: T } | FacesUnavailable;
const UNAVAILABLE_LINE = "Face recognition is not available because its models are not installed.";
const DETECTOR_THRESHOLD = 0.6;
const NMS_THRESHOLD = 0.3;
const IDLE_MS = 60_000;
let detector: Promise<InferenceSession> | null = null;
let embedder: Promise<InferenceSession> | null = null;
let detectorIdle: ReturnType<typeof setTimeout> | null = null;
let embedderIdle: ReturnType<typeof setTimeout> | null = null;

function unavailable(): FacesUnavailable { return { ok: false, kind: "FacesUnavailable", line: UNAVAILABLE_LINE }; }
function releaseLater(which: "detector" | "embedder"): void {
  const timer = which === "detector" ? detectorIdle : embedderIdle;
  if (timer) clearTimeout(timer);
  const next = setTimeout(() => {
    const pending = which === "detector" ? detector : embedder;
    if (which === "detector") detector = null; else embedder = null;
    if (which === "detector") detectorIdle = null; else embedderIdle = null;
    void pending?.then((session) => session.release()).catch(() => {});
  }, IDLE_MS);
  if (which === "detector") detectorIdle = next; else embedderIdle = next;
}
async function getSession(which: "detector" | "embedder"): Promise<InferenceSession | null> {
  const asset = which === "detector" ? VISION_FACE_DETECTOR : VISION_FACE_EMBEDDER;
  const path = faceAssetPath(asset);
  if (!existsSync(path)) return null;
  let current = which === "detector" ? detector : embedder;
  if (!current) {
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "fatal";
    current = ort.InferenceSession.create(new Uint8Array(readFileSync(path)), { executionProviders: ["wasm"] });
    if (which === "detector") detector = current; else embedder = current;
  }
  try {
    const session = await current;
    releaseLater(which);
    return session;
  } catch {
    if (which === "detector") detector = null; else embedder = null;
    return null;
  }
}
async function pixels(png: Uint8Array): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const result = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(result.data), width: result.info.width, height: result.info.height };
}
export async function detectFaces(png: Uint8Array): Promise<FaceResult<Face[]>> {
  const session = await getSession("detector");
  if (!session) return unavailable();
  try {
    const { rgba, width, height } = await pixels(png);
    const paddedWidth = Math.ceil(width / 32) * 32;
    const paddedHeight = Math.ceil(height / 32) * 32;
    const padded = new Uint8ClampedArray(paddedWidth * paddedHeight * 4);
    for (let y = 0; y < height; y++) padded.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * paddedWidth * 4);
    const plane = paddedWidth * paddedHeight;
    const blob = new Float32Array(plane * 3);
    for (let p = 0; p < plane; p++) { const i = p * 4; blob[p] = padded[i + 2]!; blob[plane + p] = padded[i + 1]!; blob[plane * 2 + p] = padded[i]!; }
    const output = await session.run({ input: new ort.Tensor("float32", blob, [1, 3, paddedHeight, paddedWidth]) });
    const tensors: Record<string, Float32Array> = {};
    for (const [name, tensor] of Object.entries(output)) tensors[name] = tensor.data as Float32Array;
    const decoded = decodeYunetOutputs(tensors, paddedWidth, DETECTOR_THRESHOLD, NMS_THRESHOLD);
    return { ok: true, value: decoded.map((face, index) => ({ ...face, score: scoreForFace(tensors, paddedWidth, face, index) })) };
  } catch { return unavailable(); }
}
// decodeYunetOutputs already applies score ranking; expose the retained score by matching the closest decoded anchor.
function scoreForFace(outputs: Record<string, Float32Array>, paddedWidth: number, face: DetectedFace, _index: number): number {
  let best = 0;
  for (const stride of [8, 16, 32]) {
    const cls = outputs[`cls_${stride}`]!, obj = outputs[`obj_${stride}`]!, boxes = outputs[`bbox_${stride}`]!;
    const cols = Math.floor(paddedWidth / stride);
    for (let idx = 0; idx < cls.length; idx++) {
      const score = Math.sqrt(Math.max(0, cls[idx]!) * Math.max(0, obj[idx]!));
      if (score <= best) continue;
      const col = idx % cols, row = Math.floor(idx / cols), at = idx * 4;
      const w = Math.exp(boxes[at + 2]!) * stride, h = Math.exp(boxes[at + 3]!) * stride;
      const x = (col + boxes[at]!) * stride - w / 2, y = (row + boxes[at + 1]!) * stride - h / 2;
      if (Math.abs(x - face.bbox[0]) < 0.01 && Math.abs(y - face.bbox[1]) < 0.01) best = score;
    }
  }
  return best;
}
export async function embedFace(png: Uint8Array, face: Face): Promise<FaceResult<Float32Array>> {
  const session = await getSession("embedder");
  if (!session) return unavailable();
  try {
    const { rgba, width, height } = await pixels(png);
    const points = [face.rightEye, face.leftEye, face.nose, face.rightMouth, face.leftMouth];
    const crop = alignCrop(rgba, width, height, points);
    const input = new ort.Tensor("float32", toEmbedBlob(crop), [1, 3, 112, 112]);
    const result = await session.run({ data: input });
    const features = result.fc1?.data;
    if (!(features instanceof Float32Array) || features.length < 128) return unavailable();
    return { ok: true, value: features.slice(0, 128) };
  } catch { return unavailable(); }
}
export function faceCosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! * a[i]!; bb += b[i]! * b[i]!; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
