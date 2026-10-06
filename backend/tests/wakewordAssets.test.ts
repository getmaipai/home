import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import {
  WAKEWORD_ALL_ASSETS,
  areWakewordAssetsInstalled,
  ensureWakewordAssets,
  isWakewordAssetInstalled,
  wakewordAssetPath,
} from "@/lib/wakewordAssets";
import { wakewordDir } from "@/lib/paths";
import { settingsValues } from "@/db/schema";
import { db } from "@/db";
import { WAKEWORD_SETTING_KEY } from "@/settings/wakewordKeys";

function installPlaceholderAssets() {
  mkdirSync(wakewordDir, { recursive: true });
  for (const asset of WAKEWORD_ALL_ASSETS) writeFileSync(wakewordAssetPath(asset.file), "placeholder");
}

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

  test("the stock detector is available only when every local inference asset is installed", () => {
    expect(areWakewordAssetsInstalled()).toBe(false);
    installPlaceholderAssets();
    expect(areWakewordAssetsInstalled()).toBe(true);
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
    const body = (await res.json()) as { detectors: { id: string; file: string }[]; installed: boolean };
    expect(body.detectors.some((d) => d.id === "hey_jarvis" && d.file === "hey_jarvis_v0.1.onnx")).toBe(true);
    expect(body.installed).toBe(false);
  });
});

describe("device wake-word setting safety", () => {
  test("asset absence hides the registry key; installing assets reveals one default-off device value", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const absent = await owner.get("/api/settings/registry");
    expect((await absent.json() as { key: string }[]).some((entry) => entry.key === WAKEWORD_SETTING_KEY)).toBe(false);

    installPlaceholderAssets();
    const registry = await owner.get("/api/settings/registry");
    expect((await registry.json() as { key: string }[]).some((entry) => entry.key === WAKEWORD_SETTING_KEY)).toBe(true);
    const values = await owner.get("/api/settings?scope=device:browser-1234567890ab");
    expect(values.status).toBe(200);
    const setting = (await values.json() as { key: string; value: unknown; source: string }[]).find((entry) => entry.key === WAKEWORD_SETTING_KEY);
    expect(setting).toMatchObject({ value: false, source: "default" });
  });

  test("a child cannot read or flip the device opt-in through the backend routes; an adult can", async () => {
    installPlaceholderAssets();
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const childCreated = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const childId = (await childCreated.json() as { id: string }).id;
    const child = new TestClient();
    await child.post("/api/auth/select", { personId: childId });

    const adultCreated = await owner.post("/api/people", { displayName: "Riff", role: "adult", secret: "0000" });
    const adultId = (await adultCreated.json() as { id: string }).id;
    const adult = new TestClient();
    await adult.post("/api/auth/select", { personId: adultId });
    await adult.post("/api/auth/verify-secret", { personId: adultId, secret: "0000" });

    const scope = "device:browser-1234567890ab";
    const write = { scope, key: WAKEWORD_SETTING_KEY, value: true };
    expect((await child.get(`/api/settings?scope=${scope}`)).status).toBe(403);
    expect((await child.request("/api/settings", { method: "PUT", body: write })).status).toBe(403);
    expect(db.select().from(settingsValues).where(eq(settingsValues.scope, scope)).all()).toEqual([]);

    const adultPut = await adult.request("/api/settings", { method: "PUT", body: write });
    expect(adultPut.status).toBe(200);
    const adultRead = await adult.get(`/api/settings?scope=${scope}`);
    const adultSettings = await adultRead.json() as { key: string; value: unknown }[];
    expect(adultSettings.find((entry) => entry.key === WAKEWORD_SETTING_KEY)?.value).toBe(true);
    expect(adultSettings.map((entry) => entry.key)).toEqual([WAKEWORD_SETTING_KEY]);
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
