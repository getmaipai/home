// ROBOT-HOST-01 part B: Home runs each hosted StackChan's Bot app as its own sidecar.
// The data directory is <data dir>/robots/<deviceId>/ with host.json (0600): ports leased once and kept forever,
// plus a single-use pairing secret (only its sha256 is stored) that lets the Bot app pair without a code.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { createHostedRobot, deleteDevice, getDeviceById, listDevicesByKind } from "@/lib/devices";
import { deviceHasToken } from "@/lib/deviceTokens";
import { ensureBotRelease } from "@/lib/botRelease";
import { getSidecar, registerSidecar, startSidecar, stopSidecar, unregisterSidecar } from "@/lib/sidecars";
import { robotsEnabled } from "@/lib/robots";
import { homePort } from "@/lib/ports";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import type { StatusApp } from "@/lib/statusApps";

export type HostPorts = { voice: number; avatar: number; vision: number };
type HostRecord = { deviceId: string; label: string; personId: string; ports: HostPorts; secretHash?: string; createdAt: string };

const roots = join(dataDir, "robots");
const configs = new Map<string, HostRecord>();
const sidecarId = (deviceId: string): string => `robot-host:${deviceId}`;
const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

let releaseForTests: (() => Promise<{ dir: string }>) | null = null;
/** Test-only: replaces the Bot app release lookup with a stand-in directory. */
export function __setRobotHostReleaseForTests(fn: (() => Promise<{ dir: string }>) | null): void { releaseForTests = fn; }
/** Test-only: forgets the in-memory host map, as a fresh process would. */
export function __resetRobotHostsForTests(): void { configs.clear(); }

function validId(id: string): boolean { return /^device-[a-z0-9]+$/.test(id); }
function hostPath(id: string): string {
  if (!validId(id)) throw new Error("That is not a robot device id.");
  return join(roots, id, "host.json");
}
function readHost(id: string): HostRecord | null {
  try { return JSON.parse(readFileSync(hostPath(id), "utf8")) as HostRecord; } catch { return null; }
}
function writeHost(host: HostRecord): void {
  const file = hostPath(host.deviceId);
  mkdirSync(join(roots, host.deviceId), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(host, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}
function writeSecret(host: HostRecord): void {
  const secret = randomBytes(32).toString("hex");
  host.secretHash = sha256(secret).toString("hex");
  writeHost(host);
  const file = join(roots, host.deviceId, "pairing-secret");
  writeFileSync(file, secret, { mode: 0o600 });
  chmodSync(file, 0o600);
}
async function choosePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function tcpConnects(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1500);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}
function statusApp(host: HostRecord): StatusApp {
  return { id: sidecarId(host.deviceId), name: `Robot brain for ${host.label}`, needs: [] };
}

async function raisePortIssue(host: HostRecord, port: number | null): Promise<void> {
  const which = port === null ? "One of its ports is" : `Port ${port} is`;
  await raiseIssue({
    source: sidecarId(host.deviceId), key: "port-in-use", severity: "error",
    title: `Robot brain for ${host.label} can't start`,
    detail: `${which} in use by another program. Close that program or restart the computer, then try again.`,
    fix: null,
  });
}
/** A stopped host's process may take a moment to release its ports; waits for that, never kills anything. */
async function waitForOwnPortsToClear(host: HostRecord, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && (await firstPortInUse(host)) !== null) await new Promise((r) => setTimeout(r, 100));
}
async function firstPortInUse(host: HostRecord): Promise<number | null> {
  for (const port of Object.values(host.ports)) if (await tcpConnects(port)) return port;
  return null;
}

function register(host: HostRecord, releaseDir: string): void {
  configs.set(host.deviceId, host);
  const id = sidecarId(host.deviceId);
  // Registering again would drop the entry that tracks a running process, so an existing declaration is reused.
  if (getSidecar(id)) return;
  registerSidecar({
    id,
    label: `Robot brain for ${host.label}`,
    backupMode: "include",
    command: [
      join(releaseDir, "bot/bin/maipai-bot-host"), "run",
      "--data-dir", join(roots, host.deviceId),
      "--hub-url", `http://127.0.0.1:${homePort()}`,
      "--voice-port", String(host.ports.voice), "--avatar-port", String(host.ports.avatar), "--vision-port", String(host.ports.vision),
      "--label", host.label,
    ],
    // Healthy means the voice port accepts a connection. No port is given to the sidecar: it never frees a port by killing its holder.
    healthCheck: () => tcpConnects(host.ports.voice),
    // Exit 75 is the Bot app's "a port is taken by another program" code.
    onFailure: async (reason) => {
      if (!/\bcode 75\b/.test(reason)) return false;
      await raisePortIssue(host, await firstPortInUse(host));
      return true;
    },
    onHealthy: () => resolveIssue(sidecarId(host.deviceId), "port-in-use"),
  });
}

async function setup(host: HostRecord): Promise<void> {
  if (!robotsEnabled()) return;
  const id = sidecarId(host.deviceId);
  const state = getSidecar(id)?.status;
  if (state === "running" || state === "starting") return;
  await waitForOwnPortsToClear(host, 3000);
  const taken = await firstPortInUse(host);
  if (taken !== null) { await raisePortIssue(host, taken); return; }
  const release = await (releaseForTests ?? ensureBotRelease)();
  // The first start of a host whose device has no token yet gets a fresh single-use secret.
  if (!deviceHasToken(host.deviceId)) writeSecret(host);
  register(host, release.dir);
  await startSidecar(id);
}

export async function createRobotHost({ label, personId }: { label: string; personId: string }): Promise<{ deviceId: string; ports: HostPorts }> {
  if (!robotsEnabled()) throw new Error("Robots are turned off on this home.");
  const cleanLabel = label.trim().slice(0, 60) || "StackChan";
  // The release comes first so a failed download leaves no half-made robot behind.
  await (releaseForTests ?? ensureBotRelease)();
  const device = createHostedRobot(cleanLabel, personId);
  try {
    const reserved = new Set<number>();
    const lease = async (): Promise<number> => { let port: number; do { port = await choosePort(); } while (reserved.has(port)); reserved.add(port); return port; };
    const ports = { voice: await lease(), avatar: await lease(), vision: await lease() };
    const host: HostRecord = { deviceId: device.id, label: device.name, personId, ports, createdAt: new Date().toISOString() };
    writeHost(host);
    configs.set(host.deviceId, host);
    await setup(host);
    return { deviceId: device.id, ports };
  } catch (error) {
    await forgetRobotHost(device.id);
    deleteDevice(device.id, personId);
    throw error;
  }
}

/** Boot and Robots-on: starts every host whose device still exists. Never throws; one bad host does not stop the rest. */
export async function startRobotHosts(): Promise<void> {
  if (!robotsEnabled() || !existsSync(roots)) return;
  for (const entry of readdirSync(roots, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    const host = readHost(entry.name);
    if (!host || !getDeviceById(host.deviceId)) continue;
    configs.set(host.deviceId, host);
    try { await setup(host); }
    catch (error) {
      await raiseIssue({
        source: sidecarId(host.deviceId), key: "port-in-use", severity: "error",
        title: `Robot brain for ${host.label} can't start`,
        detail: `Home could not prepare the robot app (${(error as Error).message}). Check the internet connection, then turn Robots off and on again.`,
        fix: null,
      });
    }
  }
}
export async function stopRobotHosts(): Promise<void> {
  for (const [id, host] of configs) {
    await stopSidecar(sidecarId(id));
    await waitForOwnPortsToClear(host, 3000);
  }
}
export async function forgetRobotHost(deviceId: string): Promise<void> {
  if (!validId(deviceId)) throw new Error("That is not a robot device id.");
  const id = sidecarId(deviceId);
  const host = configs.get(deviceId);
  await stopSidecar(id);
  if (host) await waitForOwnPortsToClear(host, 3000);
  unregisterSidecar(id);
  configs.delete(deviceId);
  resolveIssue(id, "port-in-use");
  resolveIssue(`sidecar:${id}`, "crashed");
  const dir = join(roots, deviceId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
export function listRobotHostStatusApps(): StatusApp[] {
  const persisted = existsSync(roots)
    ? readdirSync(roots, { withFileTypes: true }).filter((x) => x.isDirectory() && validId(x.name)).map((x) => readHost(x.name)).filter((x): x is HostRecord => !!x && !!getDeviceById(x.deviceId))
    : [];
  return persisted.map(statusApp);
}

/** Checks a Quick Connect pairing secret. A match never approves by itself: the caller consumes it once its request exists. */
export function matchHostedRobotSecret(input: { kind: string; pairingSecret?: string }): { personId: string; existingDeviceId: string } | null {
  if (!robotsEnabled() || input.kind !== "robot" || !input.pairingSecret) return null;
  const actual = sha256(input.pairingSecret);
  for (const device of listDevicesByKind("robot")) {
    if (!validId(device.id)) continue;
    const host = readHost(device.id);
    if (!host?.secretHash) continue;
    const expected = Buffer.from(host.secretHash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) continue;
    return { personId: device.personId, existingDeviceId: device.id };
  }
  return null;
}
/** Single use: removes the stored hash so the same secret never matches again. */
export function consumeHostedRobotSecret(deviceId: string): void {
  const host = readHost(deviceId);
  if (!host) return;
  delete host.secretHash;
  writeHost(host);
}
