// A test run never downloads the focal-crop model: framing a picture with the model missing returns no point and leaves the
// vision folder alone (the storage tests count what is in it).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { focalPointOf } from "@/lib/imaging/focal";
import { VISION_FOCAL_CROP, visionAssetPath } from "@/lib/visionFocalAsset";

describe("focal model in tests", () => {
  test("a missing model gives no point and starts no download", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).png().toBuffer());
    expect(await focalPointOf(png)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(visionAssetPath(VISION_FOCAL_CROP.file))).toBe(false);
  });
});
