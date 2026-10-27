import { join } from "node:path";
import { downloadUrl } from "@/lib/modelDownload";
import { visionDir } from "@/lib/paths";
import { singleflight } from "@maipai/core/src/singleflight";

// The image-framing model and the path helper live apart from the face models in visionAssets.ts: news framing
// (lib/news/focal.ts) is on the picture path, and VISION-02c (tests/turnMachine/pictureParts.test.ts) fails
// if anything on that path can reach a file that deals with faces. Nothing here imports face code.

export interface VisionAsset {
  file: string;
  url: string;
  sha256: string;
}

export function visionAssetPath(file: string): string {
  return join(visionDir, file);
}

/** General visual-saliency model used for image framing. Kept separate so loading it does not also download face models. */
export const VISION_FOCAL_CROP: VisionAsset = {
  file: "focalnet.onnx",
  url: "https://huggingface.co/appwrite/focalnet/resolve/f114d602b055aa1955f23a591a161336517789c4/focalnet.onnx",
  sha256: "87becceb269a2973c359df789783be49a9f840f47170a015d3776d7c4145a2ce",
};

export const ensureFocalCropAsset = singleflight(async (): Promise<void> => {
  await downloadUrl(VISION_FOCAL_CROP.url, visionAssetPath(VISION_FOCAL_CROP.file), { expectedSha256: VISION_FOCAL_CROP.sha256, expectedBytes: 20_184_361 });
});
