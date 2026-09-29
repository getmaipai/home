import { existsSync } from "node:fs";
import { join } from "node:path";
import { downloadUrl } from "@/lib/modelDownload";
import { visionDir } from "@/lib/paths";
import { singleflight } from "@maipai/core/src/singleflight";
import { SFACE_SHA256 } from "@/lib/faceModelPins";

export interface VisionAsset {
  file: string;
  url: string;
  sha256: string;
}

export const VISION_FACE_DETECTOR: VisionAsset = {
  file: "face_detection_yunet_2026may.onnx",
  url: "https://huggingface.co/pollen-robotics/face_detection_yunet_2026may/resolve/2b8e922362946a0db67e861bae0f77826980effd/face_detection_yunet_2026may.onnx",
  sha256: "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0",
};

export const VISION_FACE_EMBEDDER: VisionAsset = {
  file: "face_recognition_sface_2021dec.onnx",
  url: "https://media.githubusercontent.com/media/opencv/opencv_zoo/ba91a3b91d00d76e86540d4013f944bd6b514e39/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
  sha256: SFACE_SHA256,
};

export const VISION_ALL_ASSETS: VisionAsset[] = [VISION_FACE_DETECTOR, VISION_FACE_EMBEDDER];

export function visionAssetPath(file: string): string {
  return join(visionDir, file);
}

export function isVisionAssetInstalled(file: string): boolean {
  return existsSync(visionAssetPath(file));
}

export function areVisionAssetsInstalled(): boolean {
  return VISION_ALL_ASSETS.every((asset) => isVisionAssetInstalled(asset.file));
}

/** Downloads each pinned face model once. Concurrent model requests share
 * the same download so they cannot race on a destination's .part file. */
export const ensureVisionAssets = singleflight(async (): Promise<void> => {
  for (const asset of VISION_ALL_ASSETS) {
    await downloadUrl(asset.url, visionAssetPath(asset.file), { expectedSha256: asset.sha256 });
  }
});
