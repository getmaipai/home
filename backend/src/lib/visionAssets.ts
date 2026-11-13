import { existsSync, rmSync, statSync } from "node:fs";
import { singleflight } from "@maipai/core/src/singleflight";
import { ensureRobotAssetIds, removeRobotAssetIds, robotAssetById, robotAssetPath } from "@/lib/robotAssets";
import { visionAssetPath, type VisionAsset } from "@/lib/visionFocalAsset";

export { VISION_FOCAL_CROP, ensureFocalCropAsset, visionAssetPath, type VisionAsset } from "@/lib/visionFocalAsset";

// The two face files have ONE store: the robot asset store (lib/robotAssets.ts, spec/assets/robot-assets.json, <data>/models/robot-assets). The manifest is the
// only place their file names, URLs, sizes, checksums and licences are written; Home's face code, the browser route and the robot route all read the same file.
// The old Home vision folder (<data>/vision-models) is read as a fallback only, for a hub that fetched them there before; nothing is ever written to it for these two.
export const FACE_DETECTOR_ASSET_ID = "yunet-2026may";
export const FACE_EMBEDDER_ASSET_ID = "sface-2021dec";

export interface FaceAsset extends VisionAsset { id: string; bytes: number; licence: string }

function faceAsset(id: string): FaceAsset {
  const pin = robotAssetById(id);
  if (!pin) throw new Error(`The robot asset list has no entry ${id}. Update the pinned @maipai/spec so it lists the face finder files.`);
  return { id, file: pin.file, url: pin.source_url, sha256: pin.sha256, bytes: pin.bytes, licence: pin.licence };
}

export const VISION_FACE_DETECTOR: FaceAsset = faceAsset(FACE_DETECTOR_ASSET_ID);
export const VISION_FACE_EMBEDDER: FaceAsset = faceAsset(FACE_EMBEDDER_ASSET_ID);
export const VISION_ALL_ASSETS: FaceAsset[] = [VISION_FACE_DETECTOR, VISION_FACE_EMBEDDER];

/** Where Home reads one face file: the robot store's copy, else a copy an older Home left in the vision folder, else the robot store's path (absent). */
export function faceAssetPath(asset: FaceAsset): string {
  const stored = robotAssetPath(asset.id);
  if (existsSync(stored)) return stored;
  const legacy = visionAssetPath(asset.file);
  return existsSync(legacy) ? legacy : stored;
}

export function isVisionAssetInstalled(file: string): boolean {
  const asset = VISION_ALL_ASSETS.find((candidate) => candidate.file === file);
  return asset ? existsSync(faceAssetPath(asset)) : false;
}

export function areVisionAssetsInstalled(): boolean {
  return VISION_ALL_ASSETS.every((asset) => existsSync(faceAssetPath(asset)));
}

let installing = false;
let lastFailure: string | null = null;

/** Makes both face files present through the robot asset mechanism (pinned URL, sha256 and size checked, one download job per file). Files already in either
 * folder are left alone. Concurrent requests share one run. */
export const ensureVisionAssets = singleflight(async (): Promise<void> => {
  installing = true;
  try {
    const missing = VISION_ALL_ASSETS.filter((asset) => !existsSync(faceAssetPath(asset)));
    if (missing.length > 0) await ensureRobotAssetIds(missing.map((asset) => asset.id));
    lastFailure = null;
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : "The download stopped.";
    throw error;
  } finally { installing = false; }
});

// The face finder row as the install wizard and Settings, AI and models list it: the same two files the robot gets, with sizes and licences read from the
// robot asset manifest. Home never fetches them silently for the sheet maker: an admin's install or remove action runs ensureVisionAssets / removeVisionAssets.
export const FACE_FINDER_NAME = "Face finder and matcher";
export const FACE_FINDER_BYTES: Readonly<Record<string, number>> = { [VISION_FACE_DETECTOR.file]: VISION_FACE_DETECTOR.bytes, [VISION_FACE_EMBEDDER.file]: VISION_FACE_EMBEDDER.bytes };
export const FACE_FINDER_LICENCE = `${VISION_FACE_DETECTOR.licence} (YuNet) and ${VISION_FACE_EMBEDDER.licence} (SFace)`;
export const FACE_FINDER_SOURCE = "huggingface.co and github.com (OpenCV Zoo)";

export function faceFinderDescription(): string {
  return `Tells people apart in pictures so each person gets their own panel in a reference sheet. Two small files, 38.9 MB together. Licence: ${FACE_FINDER_LICENCE}. Comes from ${FACE_FINDER_SOURCE}, checked against a fixed checksum.`;
}

/** What the AI pages show for the face files: whether both are on this computer, their size, and a download in flight or the last failure. */
export function faceFinderState(): { installed: boolean; bytes: number; installing: boolean; failure: string | null } {
  const bytes = VISION_ALL_ASSETS.reduce((total, asset) => {
    try { return total + statSync(faceAssetPath(asset)).size; } catch { return total + (FACE_FINDER_BYTES[asset.file] ?? 0); }
  }, 0);
  return { installed: areVisionAssetsInstalled(), bytes, installing, failure: installing ? null : lastFailure ? "The face finder files did not download. Check that this computer is online, then try again." : null };
}

/** Removes the two face files from the robot asset store and from the old vision folder (an admin's explicit remove, so nothing is left to read as a fallback).
 * A face feature or a reference sheet that needs them says so until an admin installs them again; a robot that asks for them makes the hub fetch them again. */
export function removeVisionAssets(): void {
  removeRobotAssetIds(VISION_ALL_ASSETS.map((asset) => asset.id));
  for (const asset of VISION_ALL_ASSETS) rmSync(visionAssetPath(asset.file), { force: true });
  lastFailure = null;
}
