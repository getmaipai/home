import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, createHash, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firmwareFlashManifestSigningPayload } from "@maipai/spec/records/ts/validate.js";
import { decryptFile } from "@/lib/backupCrypto";
import { robotHostDataDir, __setRobotHostReleaseForTests, createRobotHost, getRobotHostRecord } from "@/lib/robotHost";
import { saveEncryptedFlashBackup, verifyStackChanManifest, verifiedFlashPart } from "@/lib/stackchanInstall";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setBotReleaseForTests } from "@/lib/botRelease";
import { TestClient } from "./client";
import { db } from "@/db";
import { devices, deviceTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { FLASH_BACKUP_MAX_BYTES } from "@/lib/stackchanInstall";
import { dataDir as homeDataDir } from "@/lib/paths";

const dataDir = robotHostDataDir("device-stacktest");
const temps: string[] = [];

beforeEach(() => {
  resetDb();
  setHouseholdSettingValue("home.robots.enabled", true);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
});
afterEach(async () => {
  __setRobotHostReleaseForTests(null); __setBotReleaseForTests({ fetch: null, pin: null });
  const { stopRobotHosts, __resetRobotHostsForTests } = await import("@/lib/robotHost");
  await stopRobotHosts(); __resetRobotHostsForTests();
  rmSync(dataDir, { recursive: true, force: true }); for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function signedManifest() {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const manifest = {
    id: "stackchan-test",
    name: "StackChan",
    version: "test",
    builds: [{ chipFamily: "ESP32-S3" as const, parts: [{ path: "app.bin", offset: 0x10000, size: 3, sha256: createHash("sha256").update(Buffer.from([1, 2, 3])).digest("hex") }] }],
    flash_size: "16MB",
    provenance: "test",
    created_at: "2026-10-20T00:00:00Z",
    hlc: "1792454400000:0:stackchan01",
    signature: { keyid: createHash("sha256").update(der.subarray(-32)).digest("hex").slice(0, 16), sig: "" },
  };
  manifest.signature.sig = sign(null, firmwareFlashManifestSigningPayload(manifest), pair.privateKey).toString("base64");
  return { manifest, key: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey: pair.privateKey };
}

const roots = join(robotHostDataDir("device-stacktest"), "..", "..");
async function owner(): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient(); const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, id: ((await res.json()) as { person: { id: string } }).person.id };
}
async function member(client: TestClient): Promise<TestClient> {
  const created = (await (await client.post("/api/people", { displayName: "Willow", role: "adult", secret: "0000" })).json()) as { id: string };
  const m = new TestClient(); await m.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" }); return m;
}
function provisionRelease(mode: "ok" | "fail" = "ok"): string {
  const dir = mkdtempSync(join(tmpdir(), "stackchan-launcher-")); temps.push(dir);
  const launcher = join(dir, "bot/bin/maipai-bot-host"); mkdirSync(join(dir, "bot/bin"), { recursive: true });
  writeFileSync(launcher, `#!/bin/sh
if [ "$1" = "provision" ] && [ "$2" = "enroll-image" ]; then
  if [ "${mode}" = "fail" ]; then echo 'The robot app could not write the image. Try again.' >&2; exit 1; fi
  while [ "$1" != "--out" ]; do shift; done
  case "$2" in *.bin) ;; *) echo 'The real NVS generator accepts only a .bin output file.' >&2; exit 1;; esac
  printf 'NVS-TEST-CODE-abc' > "$2"; chmod 600 "$2"
  echo '{"code_id":"c1","expires_at":"2026-10-21T00:00:00Z"}'; exit 0
fi
if [ "$1" = "provision" ] && [ "$2" = "revoke-enroll" ]; then touch "${dir}/revoked"; exit 0; fi
exit 0
`);
  chmodSync(launcher, 0o755); __setRobotHostReleaseForTests(async () => ({ dir })); return dir;
}
function firmwareAsset(badSignature = false) {
  const { manifest, key, privateKey } = signedManifest();
  if (badSignature) manifest.signature.sig = Buffer.alloc(64).toString("base64");
  const part = Buffer.from([1, 2, 3]);
  const tarDir = mkdtempSync(join(tmpdir(), "stackchan-fw-src-")); temps.push(tarDir);
  writeFileSync(join(tarDir, "flash-manifest.json"), JSON.stringify(manifest)); writeFileSync(join(tarDir, "app.bin"), part);
  const proc = Bun.spawn(["tar", "-czf", "-", "-C", tarDir, "flash-manifest.json", "app.bin"], { stdout: "pipe" });
  const bytesPromise = new Response(proc.stdout).arrayBuffer();
  return { manifest, key, privateKey, bytesPromise };
}
/** Serves the firmware tarball plus a SHA256SUMS signed by the same key, as a real release would. */
function releaseFetch(bytes: Uint8Array, privateKey: KeyObject) {
  const sums = `${createHash("sha256").update(bytes).digest("hex")}  stackchan.tar.gz\n`;
  const signed = { sha256: createHash("sha256").update(sums).digest("hex") };
  const envelope = JSON.stringify({ signed, signatures: [{ keyid: "test", sig: sign(null, Buffer.from(JSON.stringify(signed)), privateKey).toString("base64") }] });
  return async (url: string | URL | Request) => String(url).endsWith("SHA256SUMS.sig.json") ? new Response(envelope) : String(url).endsWith("SHA256SUMS") ? new Response(sums) : new Response(bytes);
}
function pinForFirmware(bytes: Uint8Array, key: string) {
  return { version: "77.1.0", repo: "getmaipai/bot", assets: {}, firmware: { stackchan: { name: "stackchan.tar.gz", sha256: createHash("sha256").update(bytes).digest("hex") } }, signing_keys: [key] };
}

describe("StackChan install integrity and backup", () => {
  test("refuses a bad manifest signature and a part that differs from its signed hash", () => {
    const { manifest, key } = signedManifest();
    expect(verifyStackChanManifest(manifest, [key]).signature.sig).toBe(manifest.signature.sig);
    const bad = { ...manifest, signature: { ...manifest.signature, sig: Buffer.alloc(64).toString("base64") } };
    expect(() => verifyStackChanManifest(bad, [key])).toThrow("could not be verified");
    const release = mkdtempSync(join(tmpdir(), "stackchan-part-test-")); temps.push(release);
    writeFileSync(join(release, "app.bin"), Buffer.from([9, 9, 9]));
    expect(() => verifiedFlashPart(manifest as never, release, "app.bin")).toThrow("did not match");
    expect(verifiedFlashPart(manifest as never, release, "outside.bin")).toBeNull();
  });

  test("stores only encrypted backup bytes and decrypts with the household backup key", async () => {
    const clear = Buffer.from("StackChan full flash test image");
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(clear); controller.close(); } });
    await saveEncryptedFlashBackup("device-stacktest", stream);
    const encrypted = join(dataDir, "flash-backup.bin.enc");
    expect(readFileSync(encrypted).equals(clear)).toBe(false);
    const restoredDir = mkdtempSync(join(tmpdir(), "stackchan-restore-test-")); temps.push(restoredDir);
    const restored = join(restoredDir, "restored.bin");
    await decryptFile(encrypted, restored);
    expect(readFileSync(restored)).toEqual(clear);
  });

  test("routes deliver signed firmware parts and reject bad signatures, unknown parts, and disk tampering", async () => {
    const { client } = await owner();
    const fixture = firmwareAsset(); const bytes = new Uint8Array(await fixture.bytesPromise);
    __setBotReleaseForTests({ pin: pinForFirmware(bytes, fixture.key), fetch: releaseFetch(bytes, fixture.privateKey) });
    const manifest = await client.get("/api/robots/stackchan/flash-manifest"); expect(manifest.status).toBe(200);
    const part = await client.get("/api/robots/stackchan/flash-parts/app.bin"); expect(part.status).toBe(200); expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await client.get("/api/robots/stackchan/flash-parts/absent.bin")).status).toBe(404);
    const actualInstalled = join(homeDataDir, "robots/firmware/77.1.0-stackchan/app.bin");
    writeFileSync(actualInstalled, Buffer.from([9, 9, 9]));
    expect((await client.get("/api/robots/stackchan/flash-parts/app.bin")).status).toBe(502);
    // A distinct pin version forces a fresh install of the bad-signature set.
    const bad = firmwareAsset(true); const badBytes = new Uint8Array(await bad.bytesPromise);
    __setBotReleaseForTests({ pin: { ...pinForFirmware(badBytes, bad.key), version: "77.2.0" }, fetch: releaseFetch(badBytes, bad.privateKey) });
    expect((await client.get("/api/robots/stackchan/flash-manifest")).status).toBe(502);
  });

  test("enroll-image returns private bytes, records the code id, and cleans its temporary image", async () => {
    const { client, id } = await owner(); provisionRelease();
    const host = await createRobotHost({ label: "Rivet", personId: id });
    db.insert(deviceTokens).values({ id: "token-id", deviceId: host.deviceId, personId: id, tokenHash: "hash", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), lastSeenAt: null }).run();
    const res = await client.post(`/api/robots/hosts/${host.deviceId}/enroll-image`);
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("no-store"); expect(res.headers.get("content-type")).toContain("application/octet-stream");
    const bytes = Buffer.from(await res.arrayBuffer()); expect(bytes.toString()).toBe("NVS-TEST-CODE-abc");
    expect(getRobotHostRecord(host.deviceId)?.enrollCodeId).toBe("c1");
    expect(readdirSync(join(homeDataDir, "robots", host.deviceId)).filter((name) => name.startsWith("enroll-") && name.endsWith(".bin"))).toEqual([]);
    expect(bytes.toString()).not.toContain("token-id");
    expect(JSON.stringify(await (await client.get(`/api/robots/hosts/${host.deviceId}/install-status`)).json())).not.toContain("token-id");
  });

  test("a second enroll-image revokes the earlier code first", async () => {
    const { client, id } = await owner(); const release = provisionRelease();
    const host = await createRobotHost({ label: "Rivet", personId: id });
    expect((await client.post(`/api/robots/hosts/${host.deviceId}/enroll-image`)).status).toBe(200);
    expect(existsSync(join(release, "revoked"))).toBe(false);
    expect((await client.post(`/api/robots/hosts/${host.deviceId}/enroll-image`)).status).toBe(200);
    expect(existsSync(join(release, "revoked"))).toBe(true);
  });

  test("enrollment process error is returned without adding another try-again", async () => {
    const { client, id } = await owner(); provisionRelease("fail"); const host = await createRobotHost({ label: "Rivet", personId: id });
    expect(await (await client.post(`/api/robots/hosts/${host.deviceId}/enroll-image`)).json()).toEqual({ error: "The robot app could not write the image. Try again." });
  });

  test("cancel-install revokes an unseen robot and refuses one that has connected", async () => {
    const { client, id } = await owner(); const release = provisionRelease(); const host = await createRobotHost({ label: "Rivet", personId: id });
    const record = getRobotHostRecord(host.deviceId)!; writeFileSync(join(homeDataDir, "robots", host.deviceId, "host.json"), JSON.stringify({ ...record, enrollCodeId: "c1" }));
    const res = await client.post(`/api/robots/hosts/${host.deviceId}/cancel-install`); expect(res.status).toBe(200); expect(existsSync(join(release, "revoked"))).toBe(true);
    expect(db.select().from(devices).where(eq(devices.id, host.deviceId)).get()).toBeUndefined();
    const seen = await createRobotHost({ label: "Bruno", personId: id });
    db.update(devices).set({ lastSeenAt: new Date().toISOString() }).where(eq(devices.id, seen.deviceId)).run();
    expect((await client.post(`/api/robots/hosts/${seen.deviceId}/cancel-install`)).status).toBe(409);
  });

  test("every StackChan route is forbidden when Robots is off and for a member", async () => {
    const { client } = await owner(); const m = await member(client);
    const paths = [
      ["GET", "/api/robots/stackchan/flash-manifest"], ["GET", "/api/robots/stackchan/flash-parts/x"],
      ["POST", "/api/robots/hosts/device-nope/flash-backup"], ["POST", "/api/robots/hosts/device-nope/enroll-image"],
      ["POST", "/api/robots/hosts/device-nope/cancel-install"], ["GET", "/api/robots/hosts/device-nope/install-status"],
    ] as const;
    for (const [method, path] of paths) {
      setHouseholdSettingValue("home.robots.enabled", false);
      const off = await client.request(path, { method }); expect(off.status).toBe(403);
      setHouseholdSettingValue("home.robots.enabled", true);
      expect((await m.request(path, { method })).status).toBe(403);
    }
  });

  test("oversized flash backup returns 413 and removes plain temp files", async () => {
    const { client, id } = await owner(); provisionRelease(); const host = await createRobotHost({ label: "Rivet", personId: id });
    const tooBig = new Uint8Array(FLASH_BACKUP_MAX_BYTES + 1);
    const res = await client.postBytes(`/api/robots/hosts/${host.deviceId}/flash-backup`, tooBig, "application/octet-stream");
    expect(res.status).toBe(413); expect(readdirSync(join(homeDataDir, "robots", host.deviceId)).filter((name) => name.startsWith("flash-backup-") && name.endsWith(".tmp"))).toEqual([]);
  });
});
