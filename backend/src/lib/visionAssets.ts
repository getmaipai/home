import { existsSync, rmSync, statSync } from "node:fs";
import { downloadUrl } from "@/lib/modelDownload";
import { singleflight } from "@maipai/core/src/singleflight";
import { SFACE_SHA256 } from "@/lib/faceModelPins";
import { visionAssetPath, type VisionAsset } from "@/lib/visionFocalAsset";

export { VISION_FOCAL_CROP, ensureFocalCropAsset, visionAssetPath, type VisionAsset } from "@/lib/visionFocalAsset";

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

export function isVisionAssetInstalled(file: string): boolean {
  return existsSync(visionAssetPath(file));
}

export function areVisionAssetsInstalled(): boolean {
  return VISION_ALL_ASSETS.every((asset) => isVisionAssetInstalled(asset.file));
}

let installing = false;
let lastFailure: string | null = null;

/** Downloads each pinned face model once. Concurrent model requests share
 * the same download so they cannot race on a destination's .part file. */
export const ensureVisionAssets = singleflight(async (): Promise<void> => {
  installing = true;
  try {
    for (const asset of VISION_ALL_ASSETS) {
      await downloadUrl(asset.url, visionAssetPath(asset.file), { expectedSha256: asset.sha256 });
    }
    lastFailure = null;
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : "The download stopped.";
    throw error;
  } finally { installing = false; }
});

// The two pinned face files as the install wizard and Settings, AI and models list them. The sizes are the pinned files' exact byte counts (the same two
// files sit in the robot asset store); the licences are the ones the spec's robot-assets list records for them. Home never fetches them silently for the sheet
// maker: an admin's install or remove action runs ensureVisionAssets / removeVisionAssets.
export const FACE_FINDER_NAME = "Face finder and matcher";
export const FACE_FINDER_BYTES: Readonly<Record<string, number>> = { [VISION_FACE_DETECTOR.file]: 229_738, [VISION_FACE_EMBEDDER.file]: 38_696_353 };
export const FACE_FINDER_LICENCE = "MIT (YuNet) and Apache-2.0 (SFace)";
export const FACE_FINDER_SOURCE = "huggingface.co and github.com (OpenCV Zoo)";

export function faceFinderDescription(): string {
  return `Tells people apart in pictures so each person gets their own panel in a reference sheet. Two small files, 38.9 MB together. Licence: ${FACE_FINDER_LICENCE}. Comes from ${FACE_FINDER_SOURCE}, checked against a fixed checksum.`;
}

/** What the AI pages show for the face files: whether both are on this computer, their size, and a download in flight or the last failure. */
export function faceFinderState(): { installed: boolean; bytes: number; installing: boolean; failure: string | null } {
  const bytes = VISION_ALL_ASSETS.reduce((total, asset) => {
    try { return total + statSync(visionAssetPath(asset.file)).size; } catch { return total + (FACE_FINDER_BYTES[asset.file] ?? 0); }
  }, 0);
  return { installed: areVisionAssetsInstalled(), bytes, installing, failure: installing ? null : lastFailure ? "The face finder files did not download. Check that this computer is online, then try again." : null };
}

/** Removes the two face files. A face feature or a reference sheet that needs them says so until an admin installs them again. */
export function removeVisionAssets(): void {
  for (const asset of VISION_ALL_ASSETS) rmSync(visionAssetPath(asset.file), { force: true });
  lastFailure = null;
}
