import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import {
  WAKEWORD_ALL_ASSETS,
  ensureWakewordAssets,
  isWakewordAssetInstalled,
  wakewordAssetPath,
} from "@/lib/wakewordAssets";
import { wakewordDir } from "@/lib/paths";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

// Deliberately never exercises a real download: the pinned URLs point at
// a real GitHub release (verified live, once, outside this suite - the
// same "trust modelDownloadJobs.ts's own real multi-GB pins without
// re-downloading them in CI" discipline this repo's other download-based
// modules already follow, per .github/CLAUDE.md > Testing standards'
// "deterministic and offline by default"). Every test here either checks
// pure path logic or pre-places a placeholder file so downloadUrl()'s own
// `if (existsSync(destPath)) return` short-circuit never reaches the
// network.
afterEach(() => {
  rmSync(wakewordDir, { recursive: true, force: true });
});

describe("lib/wakewordAssets.ts", () => {
  test("wakewordAssetPath resolves under the wakeword directory", () => {
    expect(wakewordAssetPath("melspectrogram.onnx")).toBe(`${wakewordDir}/melspectrogram.onnx`);
  });

  test("isWakewordAssetInstalled is false before anything is downloaded", () => {
    expect(isWakewordAssetInstalled("melspectrogram.onnx")).toBe(false);
  });

  test("isWakewordAssetInstalled is true once a file exists at the pinned path", () => {
    mkdirSync(wakewordDir, { recursive: true });
    writeFileSync(wakewordAssetPath("melspectrogram.onnx"), "placeholder");
    expect(isWakewordAssetInstalled("melspectrogram.onnx")).toBe(true);
  });

  test("ensureWakewordAssets never touches the network once every asset already exists", async () => {
    mkdirSync(wakewordDir, { recursive: true });
    for (const asset of WAKEWORD_ALL_ASSETS) {
      writeFileSync(wakewordAssetPath(asset.file), "placeholder");
    }
    // downloadUrl() skips entirely once destPath exists, with no
    // checksum re-verification - if this reached the network it would
    // hang/fail in the test sandbox rather than resolving instantly.
    await ensureWakewordAssets();
    for (const asset of WAKEWORD_ALL_ASSETS) {
      expect(isWakewordAssetInstalled(asset.file)).toBe(true);
    }
  });
});

describe("GET /api/voice/wakewords", () => {
  test("requires a signed-in person", async () => {
    const res = await new TestClient().get("/api/voice/wakewords");
    expect(res.status).toBe(401);
  });

  test("lists the stock hey_jarvis detector", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/voice/wakewords");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { detectors: { id: string; file: string }[] };
    expect(body.detectors.some((d) => d.id === "hey_jarvis" && d.file === "hey_jarvis_v0.1.onnx")).toBe(true);
  });
});

describe("GET /api/voice/wakeword/:file", () => {
  test("requires a signed-in person", async () => {
    const res = await new TestClient().get("/api/voice/wakeword/melspectrogram.onnx");
    expect(res.status).toBe(401);
  });

  test("an unknown file name is a clean 404, never a network attempt", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/voice/wakeword/../../etc/passwd");
    expect(res.status).toBe(404);
  });

  test("serves a known asset's real bytes once it's already on disk", async () => {
    mkdirSync(wakewordDir, { recursive: true });
    for (const asset of WAKEWORD_ALL_ASSETS) {
      writeFileSync(wakewordAssetPath(asset.file), `content for ${asset.file}`);
    }
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/voice/wakeword/melspectrogram.onnx");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("content for melspectrogram.onnx");
  });
});
