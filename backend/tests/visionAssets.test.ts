import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import {
  VISION_ALL_ASSETS,
  VISION_FOCAL_CROP,
  areVisionAssetsInstalled,
  ensureVisionAssets,
  faceAssetPath,
  isVisionAssetInstalled,
  removeVisionAssets,
  visionAssetPath,
} from "@/lib/visionAssets";
import { robotAssetPath } from "@/lib/robotAssets";
import { visionDir } from "@/lib/paths";

// The face files live in the robot asset store (one store); the old vision folder is a read-only fallback.
function installPlaceholderAssets() {
  for (const asset of VISION_ALL_ASSETS) {
    mkdirSync(dirname(robotAssetPath(asset.id)), { recursive: true });
    writeFileSync(robotAssetPath(asset.id), "placeholder");
  }
}
function installLegacyAssets() {
  mkdirSync(visionDir, { recursive: true });
  for (const asset of VISION_ALL_ASSETS) writeFileSync(visionAssetPath(asset.file), "legacy");
}

function installFocalAsset() {
  mkdirSync(visionDir, { recursive: true });
  writeFileSync(visionAssetPath(VISION_FOCAL_CROP.file), "placeholder");
}

beforeEach(() => resetDb());

// Like wakewordAssets.test.ts, pre-place placeholder files so the real
// download path's existsSync guard keeps this deterministic suite offline.
afterEach(() => {
  rmSync(visionDir, { recursive: true, force: true });
  for (const asset of VISION_ALL_ASSETS) rmSync(robotAssetPath(asset.id), { force: true });
});

describe("lib/visionAssets.ts", () => {
  test("Home's face code and the robot asset store resolve each face file to the same path", () => {
    for (const asset of VISION_ALL_ASSETS) {
      expect(faceAssetPath(asset)).toBe(robotAssetPath(asset.id));
      expect(robotAssetPath(asset.id)).not.toBe(visionAssetPath(asset.file));
    }
  });

  test("the pins come from the robot manifest, not a second list", () => {
    expect(VISION_ALL_ASSETS.map((asset) => asset.sha256)).toEqual(["ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"]);
  });

  test("an older hub with the files only in the vision folder keeps working, and the robot store wins once it has them", () => {
    installLegacyAssets();
    expect(areVisionAssetsInstalled()).toBe(true);
    expect(faceAssetPath(VISION_ALL_ASSETS[0]!)).toBe(visionAssetPath(VISION_ALL_ASSETS[0]!.file));
    installPlaceholderAssets();
    expect(faceAssetPath(VISION_ALL_ASSETS[0]!)).toBe(robotAssetPath(VISION_ALL_ASSETS[0]!.id));
    expect(existsSync(visionAssetPath(VISION_ALL_ASSETS[0]!.file))).toBe(true);
  });

  test("removing drops both copies", () => {
    installLegacyAssets();
    installPlaceholderAssets();
    removeVisionAssets();
    expect(areVisionAssetsInstalled()).toBe(false);
    expect(existsSync(visionAssetPath(VISION_ALL_ASSETS[0]!.file))).toBe(false);
  });

  test("reports assets absent before download and installed once their paths exist", () => {
    expect(isVisionAssetInstalled(VISION_ALL_ASSETS[0]!.file)).toBe(false);
    expect(areVisionAssetsInstalled()).toBe(false);
    installPlaceholderAssets();
    expect(areVisionAssetsInstalled()).toBe(true);
  });

  test("ensureVisionAssets skips the network when both files are already present", async () => {
    installPlaceholderAssets();
    await ensureVisionAssets();
    expect(areVisionAssetsInstalled()).toBe(true);
    expect(readFileSync(robotAssetPath(VISION_ALL_ASSETS[0]!.id), "utf8")).toBe("placeholder");
  });
});

describe("GET /api/vision/models", () => {
  test("requires a signed-in person", async () => {
    expect((await new TestClient().get("/api/vision/models")).status).toBe(401);
  });

  test("lists YuNet and SFace with the FACE-01 model id before download", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/vision/models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      detectors: [
        { id: "yunet-2026may", label: "YuNet face detector (May 2026)", file: "face_detection_yunet_2026may.onnx" },
        { id: "sface-2021dec", label: "OpenCV SFace (December 2021)", file: "face_recognition_sface_2021dec.onnx" },
      ],
      installed: false,
    });
  });
});

describe("GET /api/vision/model/:file", () => {
  test("requires a signed-in person", async () => {
    expect((await new TestClient().get("/api/vision/model/face_detection_yunet_2026may.onnx")).status).toBe(401);
  });

  test("an unknown file name returns 404", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    expect((await owner.get("/api/vision/model/not-a-model.onnx")).status).toBe(404);
  });

  test("the focal crop model is auth protected and served from its pinned local file", async () => {
    expect((await new TestClient().get(`/api/vision/model/${VISION_FOCAL_CROP.file}`)).status).toBe(401);
    installFocalAsset();
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get(`/api/vision/model/${VISION_FOCAL_CROP.file}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("placeholder");
  });

  test("serves a known asset's bytes as an octet stream once installed", async () => {
    installPlaceholderAssets();
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/vision/model/face_detection_yunet_2026may.onnx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("placeholder");
  });
});
