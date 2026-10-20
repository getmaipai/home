import { createHash, createPublicKey, verify } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { FirmwareFlashManifest } from "@maipai/spec/gen/ts/firmware-flash-manifest.js";
import { firmwareFlashManifestSigningPayload, validateFirmwareFlashManifest } from "@maipai/spec/records/ts/validate.js";
import { botReleaseSigningKeys, ensureStackChanFirmware } from "@/lib/botRelease";
import { detectLanIps, listHubEndpoints } from "@/lib/hubEndpoints";
import { encryptFile } from "@/lib/backupCrypto";
import { getRobotHostRecord, robotHostDataDir, robotHostRelease, updateRobotHostRecord } from "@/lib/robotHost";

export const FLASH_BACKUP_BYTES = 16 * 1024 * 1024;
export const FLASH_BACKUP_MAX_BYTES = FLASH_BACKUP_BYTES + 64 * 1024;
export type FlashManifest = ReturnType<typeof FirmwareFlashManifest.parse>;

function signingKeyMatches(keyPem: string, keyid: string): boolean {
  try {
    const publicKey = createPublicKey(keyPem);
    const raw = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    return createHash("sha256").update(raw.subarray(-32)).digest("hex").slice(0, 16) === keyid;
  } catch { return false; }
}

export function verifyStackChanManifest(value: unknown, keys: string[]): FlashManifest {
  const manifest = FirmwareFlashManifest.parse(value);
  const issues = validateFirmwareFlashManifest(manifest);
  const key = keys.find((candidate) => signingKeyMatches(candidate, manifest.signature.keyid));
  const validSignature = !!key && verify(null, firmwareFlashManifestSigningPayload(manifest), createPublicKey(key), Buffer.from(manifest.signature.sig, "base64"));
  if (issues.length || !validSignature) throw new Error("The StackChan flash manifest could not be verified.");
  return manifest;
}

export async function verifiedStackChanManifest(): Promise<{ manifest: FlashManifest; releaseDir: string }> {
  const firmware = await ensureStackChanFirmware();
  const value: unknown = JSON.parse(readFileSync(join(firmware.dir, "flash-manifest.json"), "utf8"));
  const manifest = verifyStackChanManifest(value, botReleaseSigningKeys());
  return { manifest, releaseDir: firmware.dir };
}

export function verifiedFlashPart(manifest: FlashManifest, releaseDir: string, partPath: string): Buffer | null {
  const part = manifest.builds.flatMap((build) => build.parts).find((item) => item.path === partPath);
  if (!part) return null;
  const file = resolve(releaseDir, part.path);
  if (!file.startsWith(`${resolve(releaseDir)}${sep}`)) throw new Error("The StackChan flash part path is unsafe.");
  const bytes = readFileSync(file);
  if (bytes.length !== part.size || createHash("sha256").update(bytes).digest("hex") !== part.sha256) throw new Error("A StackChan flash part did not match its signed manifest.");
  return bytes;
}

export async function saveEncryptedFlashBackup(deviceId: string, body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) throw new Error("The flash backup was empty. Reconnect the StackChan and try again.");
  const dir = robotHostDataDir(deviceId);
  const plain = join(dir, `flash-backup-${crypto.randomUUID()}.tmp`);
  const encrypted = join(dir, "flash-backup.bin.enc");
  let total = 0;
  try {
    const file = Bun.file(plain);
    const writer = file.writer();
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > FLASH_BACKUP_MAX_BYTES) throw new Error("The flash backup is larger than expected. Disconnect the robot, plug it back in, then try again.");
        writer.write(value);
      }
    } finally {
      reader.releaseLock();
      await writer.end();
    }
    chmodSync(plain, 0o600);
    try { await encryptFile(plain, encrypted); }
    catch { throw new Error("Home could not save the flash backup. Check that the disk has free space, then try again."); }
  } finally { rmSync(plain, { force: true }); }
}

/** Runs the Bot app's provision command without blocking the event loop; a run past `timeoutMs` is killed. */
async function runProvision(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  const release = await robotHostRelease();
  const proc = Bun.spawn([join(release.dir, "bot", "bin", "maipai-bot-host"), "provision", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}

export async function makeEnrollImage(deviceId: string): Promise<Buffer> {
  const host = getRobotHostRecord(deviceId);
  if (!host) throw new Error("This robot host could not be found. Remove the robot and try the install again.");
  const ips = detectLanIps();
  const endpoint = (await listHubEndpoints()).find((item) => item.kind === "lan" && ips.includes(new URL(item.url).hostname));
  const lanHost = endpoint ? new URL(endpoint.url).hostname : ips[0];
  if (!lanHost) throw new Error("Home could not find a LAN address for the robot. Connect Home to the same Wi-Fi network, then try again.");
  // A retried install would otherwise leave the earlier single-use code valid until it expires.
  await revokeEnrollment(deviceId);
  // The NVS generator in the shipped bot app writes only files named *.bin.
  const out = join(robotHostDataDir(deviceId), `enroll-${crypto.randomUUID()}.bin`);
  try {
    const proc = await runProvision([
      "enroll-image", "--data-dir", robotHostDataDir(deviceId), "--ws-url", `ws://${lanHost}:${host.ports.voice}`,
      "--avatar-url", `http://${lanHost}:${host.ports.avatar}`, "--out", out,
    ], 60_000);
    if (proc.code !== 0) {
      const reason = proc.stderr.trim();
      throw new Error(reason || "The robot app could not make its enrollment image. Check Repairs, then try again.");
    }
    const lines = proc.stdout.trim().split(/\r?\n/);
    const invalid = "The robot app returned an invalid enrollment receipt. Update Home, then try again.";
    if (lines.length !== 1) throw new Error(invalid);
    let receipt: { code_id?: unknown; expires_at?: unknown };
    try { receipt = JSON.parse(lines[0]!) as typeof receipt; } catch { throw new Error(invalid); }
    if (typeof receipt.code_id !== "string" || typeof receipt.expires_at !== "string" || !existsSync(out)) throw new Error(invalid);
    chmodSync(out, 0o600);
    const bytes = readFileSync(out);
    if (bytes.length === 0) throw new Error("The robot app made an empty enrollment image. Try again.");
    updateRobotHostRecord(deviceId, { enrollCodeId: receipt.code_id });
    return bytes;
  } finally { rmSync(out, { force: true }); }
}

export async function revokeEnrollment(deviceId: string): Promise<void> {
  const host = getRobotHostRecord(deviceId);
  if (!host) return;
  if (!host.enrollCodeId) return;
  const proc = await runProvision(["revoke-enroll", "--data-dir", robotHostDataDir(deviceId), "--code-id", host.enrollCodeId], 30_000);
  if (proc.code !== 0) throw new Error("The enrollment code could not be revoked. Check Repairs, then try again before disconnecting the robot.");
}
