import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import {
  VISION_ALL_ASSETS,
  areVisionAssetsInstalled,
  ensureVisionAssets,
  isVisionAssetInstalled,
  visionAssetPath,
} from "@/lib/visionAssets";
import { visionDir } from "@/lib/paths";

function installPlaceholderAssets() {
  mkdirSync(visionDir, { recursive: true });
  for (const asset of VISION_ALL_ASSETS) writeFileSync(visionAssetPath(asset.file), "placeholder");
}

beforeEach(() => resetDb());

// Like wakewordAssets.test.ts, pre-place placeholder files so the real
// download path's existsSync guard keeps this deterministic suite offline.
afterEach(() => rmSync(visionDir, { recursive: true, force: true }));

describe("lib/visionAssets.ts", () => {
  test("visionAssetPath resolves under the vision model directory", () => {
    expect(visionAssetPath(VISION_ALL_ASSETS[0]!.file)).toBe(`${visionDir}/${VISION_ALL_ASSETS[0]!.file}`);
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
