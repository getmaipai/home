import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { RobotAssetManifest, type RobotAssetManifest as RobotAsset } from "@maipai/spec/gen/ts/robot-asset-manifest.js";
import { db } from "@/db";
import { modelDownloadJobs } from "@/db/schema";
import { raiseIssue, resolveIssue, registerFixHandler } from "@/lib/issues";
import { downloadUrl } from "@/lib/modelDownload";
import { modelsDir } from "@/lib/paths";
import { SPEC_DIR } from "@/lib/specDir";

const MANIFEST_PATH = join(SPEC_DIR, "assets", "robot-assets.json");
const ASSET_DIR = join(modelsDir, "robot-assets");

export const ROBOT_ASSETS: RobotAsset[] = (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown[])
  .map((entry) => RobotAssetManifest.parse(entry));

function assetForId(id: string): RobotAsset | undefined {
  return ROBOT_ASSETS.find((asset) => asset.id === id);
}

export function robotAssetPath(id: string): string {
  const asset = assetForId(id);
  if (!asset) throw new Error(`unknown robot asset: ${id}`);
  return join(ASSET_DIR, asset.file);
}

export async function verifyRobotAssetFile(path: string, asset: RobotAsset): Promise<boolean> {
  if (!existsSync(path) || statSync(path).size !== asset.bytes) return false;
  const digest = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) digest.update(chunk);
  return digest.digest("hex") === asset.sha256;
}

export async function isRobotAssetAvailable(id: string): Promise<boolean> {
  const asset = assetForId(id);
  return asset ? verifyRobotAssetFile(robotAssetPath(id), asset) : false;
}

function setJob(id: string, status: string, phase: string, completedBytes: number, totalBytes: number, error: string | null = null): void {
  const modelId = `robot-asset:${id}`;
  const now = new Date().toISOString();
  const existing = db.select().from(modelDownloadJobs).where(eq(modelDownloadJobs.modelId, modelId)).get();
  if (existing) {
    db.update(modelDownloadJobs).set({ status, phase, completedBytes, totalBytes, error, updatedAt: now }).where(eq(modelDownloadJobs.modelId, modelId)).run();
  } else {
    db.insert(modelDownloadJobs).values({ modelId, status, phase, completedBytes, totalBytes, error, createdAt: now, updatedAt: now }).run();
  }
}

let downloadFlight: Promise<void> | null = null;

function registerRobotAssetRepairActions(): void {
  for (const asset of ROBOT_ASSETS) {
    registerFixHandler(`retry_robot_asset:${asset.id}`, async () => { await ensureRobotAssets(); });
  }
}

/** Fetch each base pin through the hub's shared checksum-verifying downloader. */
export function ensureRobotAssets(): Promise<void> {
  if (downloadFlight) return downloadFlight;
  registerRobotAssetRepairActions();
  downloadFlight = (async () => {
    mkdirSync(ASSET_DIR, { recursive: true });
    for (const asset of ROBOT_ASSETS) {
      const path = robotAssetPath(asset.id);
      try {
        if (await verifyRobotAssetFile(path, asset)) {
          setJob(asset.id, "ready", "ready", asset.bytes, asset.bytes);
          resolveIssue("robot-asset", `asset:${asset.id}`);
          continue;
        }
        rmSync(path, { force: true });
        setJob(asset.id, "downloading_model", "downloading robot asset", 0, asset.bytes);
        await downloadUrl(asset.source_url, path, {
          expectedSha256: asset.sha256,
          expectedBytes: asset.bytes,
          onProgress: (progress) => setJob(asset.id, "downloading_model", progress.status, progress.completedBytes, progress.totalBytes),
        });
        if (!(await verifyRobotAssetFile(path, asset))) throw new Error("downloaded asset failed its pinned integrity check");
        setJob(asset.id, "ready", "ready", asset.bytes, asset.bytes);
        resolveIssue("robot-asset", `asset:${asset.id}`);
      } catch (error) {
        const message = (error as Error).message;
        setJob(asset.id, "failed", "failed", 0, asset.bytes, message);
        await raiseIssue({
          source: "robot-asset",
          key: `asset:${asset.id}`,
          severity: "error",
          title: `MaiPai could not prepare a robot asset`,
          detail: `${asset.file}: ${message}`,
          fix: { label: "Retry asset download", action: `retry_robot_asset:${asset.id}` },
        });
      }
    }
  })().finally(() => { downloadFlight = null; });
  return downloadFlight;
}

/** Read and verify one file before returning any bytes to a device. The
 * returned buffer is the same content that was hashed, avoiding a
 * verification-to-stream race if a local file changes between those steps. */
export async function readVerifiedRobotAsset(asset: RobotAsset): Promise<Uint8Array | null> {
  registerRobotAssetRepairActions();
  const path = robotAssetPath(asset.id);
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength === asset.bytes && actualSha256 === asset.sha256) return bytes;
  rmSync(path, { force: true });
  setJob(asset.id, "failed", "asset failed checksum verification", 0, asset.bytes, "stored file failed pinned checksum verification");
  await raiseIssue({
    source: "robot-asset",
    key: `asset:${asset.id}`,
    severity: "error",
    title: "A robot asset needs repair",
    detail: `${asset.file} did not match its pinned size and SHA-256 and was removed from service.`,
    fix: { label: "Retry asset download", action: `retry_robot_asset:${asset.id}` },
  });
  return null;
}

export function robotAssetById(id: string): RobotAsset | undefined {
  return assetForId(id);
}
