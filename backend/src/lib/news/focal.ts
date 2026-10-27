// The focal point of a News picture, found once on the hub when the picture is stored (NEWS-FOCAL-01).
//
// It runs the same FocalNet saliency model the kit's in-browser analyser ran (`VISION_FOCAL_CROP`), under onnxruntime-web's WASM
// provider as sileroVad.ts does, on the 1280 pixel WebP the cache keeps. The result is the weighted centre of the importance map as a
// percentage of the picture, plus the picture's width over height; the card carries it and the screen crops with it at once, so a
// picture never waits on a model download in the browser and never moves after it shows. A missing model is not a failure: the
// download starts in the background and the picture has no focal point (a centred crop) until a later one is stored.
// @ts-ignore - no resolvable .d.ts for the ort-web ESM bundle under Bun
import * as ort from "onnxruntime-web";
import type { InferenceSession } from "onnxruntime-web";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { VISION_FOCAL_CROP, ensureFocalCropAsset, visionAssetPath } from "@/lib/visionFocalAsset";

export interface FocalPoint { x: number; y: number; aspect: number }

const SIZE = 256;
const GRID = 64;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise: Promise<InferenceSession> | null = null;
let loadFailed = false;
let queue: Promise<unknown> = Promise.resolve();

async function session(): Promise<InferenceSession | null> {
  if (loadFailed) return null;
  const path = visionAssetPath(VISION_FOCAL_CROP.file);
  if (!existsSync(path)) {
    void ensureFocalCropAsset().catch((error) => console.warn(`[news] focal model download failed (${(error as Error).message})`));
    return null;
  }
  try {
    if (!sessionPromise) {
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = "fatal";
      sessionPromise = ort.InferenceSession.create(new Uint8Array(readFileSync(path)), { executionProviders: ["wasm"] });
    }
    return await sessionPromise;
  } catch (error) {
    loadFailed = true;
    console.warn(`[news] focal model failed to load (${(error as Error).message}); pictures are cropped from the centre`);
    return null;
  }
}

let override: ((bytes: Uint8Array) => Promise<FocalPoint | null>) | null = null;
/** Test seam: stands in for the model (null puts it back). */
export function __setNewsFocalForTests(fn: ((bytes: Uint8Array) => Promise<FocalPoint | null>) | null): void {
  override = fn;
  sessionPromise = null;
  loadFailed = false;
}

/** The weighted centre of a 64 by 64 importance map after the letterbox is removed (as the kit's `restoreFocalMap` does). */
export function focalCentre(map: Float32Array, width: number, height: number): FocalPoint | null {
  if (map.length !== GRID * GRID || width < 1 || height < 1) return null;
  const scale = Math.min(SIZE / width, SIZE / height);
  const contentWidth = Math.max(1, Math.round(width * scale));
  const contentHeight = Math.max(1, Math.round(height * scale));
  const left = Math.floor((SIZE - contentWidth) / 2);
  const top = Math.floor((SIZE - contentHeight) / 2);
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    // The map cell's centre in input pixels; cells outside the picture are the black border and weigh nothing.
    const px = (x + 0.5) * (SIZE / GRID);
    const py = (y + 0.5) * (SIZE / GRID);
    if (px < left || px > left + contentWidth || py < top || py > top + contentHeight) continue;
    const raw = map[y * GRID + x]!;
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    total += value;
    sumX += value * (px - left) / contentWidth;
    sumY += value * (py - top) / contentHeight;
  }
  if (!total) return null;
  const round = (n: number): number => Math.round(Math.max(0, Math.min(100, n * 100)) * 10) / 10;
  return { x: round(sumX / total), y: round(sumY / total), aspect: Math.round((width / height) * 1000) / 1000 };
}

async function analyse(bytes: Uint8Array): Promise<FocalPoint | null> {
  const model = await session();
  if (!model) return null;
  const meta = await sharp(bytes).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return null;
  const scale = Math.min(SIZE / width, SIZE / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgb = await sharp(bytes).resize({ width: w, height: h, fit: "fill" }).removeAlpha().raw().toBuffer();
  const left = Math.floor((SIZE - w) / 2);
  const top = Math.floor((SIZE - h) / 2);
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = (y * w + x) * 3;
    const dest = (top + y) * SIZE + left + x;
    for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + dest] = ((rgb[at + c]! / 255) - MEAN[c]!) / STD[c]!;
  }
  const output = await model.run({ image: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  const map = output.importance?.data;
  if (!(map instanceof Float32Array)) return null;
  return focalCentre(map, width, height);
}

/** The focal point of a stored picture, or null when the model is not installed or the picture cannot be read. One at a time. */
export function focalPointOf(bytes: Uint8Array): Promise<FocalPoint | null> {
  if (override) return override(bytes);
  const run = queue.then(() => analyse(bytes)).catch(() => null);
  queue = run;
  return run;
}
