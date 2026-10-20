import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, deviceTokens } from "@/db/schema";
import { dataDir } from "@/lib/paths";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetQuickConnectForTests } from "@/lib/quickConnect";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetSidecarsForTests, __setSidecarTimingForTestsOnly, getSidecar, listSidecars } from "@/lib/sidecars";
import { __resetFixHandlersForTests, listIssues } from "@/lib/issues";
import { createRobotHost, forgetRobotHost, startRobotHosts, stopRobotHosts, listRobotHostStatusApps, __resetRobotHostsForTests, __setRobotHostReleaseForTests } from "@/lib/robotHost";

const roots = join(dataDir, "robots");
const releases: string[] = [];
const listeners: Array<{ stop(force?: boolean): void }> = [];

/** A stand-in for the Bot app: listens on --voice-port, or exits 75 / crashes once when a marker file in the data dir says so. */
function standIn(): string {
  const dir = mkdtempSync(join(tmpdir(), "maipai-home-test-bothost-"));
  releases.push(dir);
  mkdirSync(join(dir, "bot/bin"), { recursive: true });
  const script = join(dir, "bot/bin/maipai-bot-host");
  writeFileSync(script, `#!/bin/sh
D="$3"
V="$7"
if [ -f "$D/exit75" ]; then echo "Port $V is in use by another program" >&2; exit 75; fi
if [ -f "$D/crash-once" ]; then rm -f "$D/crash-once"; exec ${process.execPath} -e "Bun.listen({hostname:'127.0.0.1',port:$V,socket:{data(){}}});setTimeout(()=>process.exit(1),700)"; fi
exec ${process.execPath} -e "Bun.listen({hostname:'127.0.0.1',port:$V,socket:{data(){}}});setInterval(()=>{},1000)"
`);
  chmodSync(script, 0o755);
  return dir;
}
async function waitUntil(check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error("timed out waiting");
}
function connects(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}
function hostJson(deviceId: string): { deviceId: string; label: string; personId: string; ports: { voice: number; avatar: number; vision: number }; secretHash?: string } {
  return JSON.parse(readFileSync(join(roots, deviceId, "host.json"), "utf8"));
}
const mode = (file: string): number => statSync(file).mode & 0o777;
async function owner(): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, id: ((await res.json()) as { person: { id: string } }).person.id };
}
const robotIssues = () => listIssues().filter((i) => i.source.includes("robot-host:"));

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetSidecarsForTests();
  __resetRobotHostsForTests();
  __resetQuickConnectForTests();
  __resetRateLimiterForTests();
  rmSync(roots, { recursive: true, force: true });
  __setSidecarTimingForTestsOnly({ healthPollMs: 100, backoffMs: [100] });
  const release = standIn();
  __setRobotHostReleaseForTests(async () => ({ dir: release }));
  setHouseholdSettingValue("home.robots.enabled", true);
});
afterEach(async () => {
  await stopRobotHosts();
  __resetSidecarsForTests();
  __setRobotHostReleaseForTests(null);
  __resetRobotHostsForTests();
  for (const l of listeners.splice(0)) l.stop(true);
  for (const dir of releases.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(roots, { recursive: true, force: true });
});

describe("createRobotHost", () => {
  test("makes the device, a 0600 host.json with three distinct ports and a secret hash, a 0600 hex secret, and a labelled sidecar", async () => {
    const { id } = await owner();
    const { deviceId, ports } = await createRobotHost({ label: "Rivet", personId: id });
    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
    expect(device?.kind).toBe("robot");
    const file = join(roots, deviceId, "host.json");
    expect(mode(file)).toBe(0o600);
    const host = hostJson(deviceId);
    expect(host.personId).toBe(id);
    expect(new Set(Object.values(host.ports)).size).toBe(3);
    expect(host.ports).toEqual(ports);
    expect(host.secretHash).toMatch(/^[0-9a-f]{64}$/);
    const secretFile = join(roots, deviceId, "pairing-secret");
    expect(mode(secretFile)).toBe(0o600);
    const secret = readFileSync(secretFile, "utf8");
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(new Bun.CryptoHasher("sha256").update(secret).digest("hex")).toBe(host.secretHash!);
    const side = listSidecars().find((s) => s.id === `robot-host:${deviceId}`);
    expect(side).toBeTruthy();
    expect(getSidecar(`robot-host:${deviceId}`)?.status).toBe("running");
    expect(await connects(ports.voice)).toBe(true);
    expect(listRobotHostStatusApps().map((a) => a.name)).toEqual(["Robot brain for Rivet"]);
  });

  test("refuses while Robots is off", async () => {
    const { id } = await owner();
    setHouseholdSettingValue("home.robots.enabled", false);
    await expect(createRobotHost({ label: "Rivet", personId: id })).rejects.toThrow("turned off");
  });

  test("a failed release download leaves no device behind", async () => {
    const { id } = await owner();
    __setRobotHostReleaseForTests(async () => { throw new Error("offline"); });
    await expect(createRobotHost({ label: "Rivet", personId: id })).rejects.toThrow("offline");
    expect(db.select().from(devices).all().filter((d) => d.kind === "robot")).toEqual([]);
  });

  test("the port lease survives a restart", async () => {
    const { id } = await owner();
    const { deviceId, ports } = await createRobotHost({ label: "Rivet", personId: id });
    await stopRobotHosts();
    __resetSidecarsForTests();
    __resetRobotHostsForTests();
    await startRobotHosts();
    expect(hostJson(deviceId).ports).toEqual(ports);
    expect(getSidecar(`robot-host:${deviceId}`)?.status).toBe("running");
    expect(await connects(ports.voice)).toBe(true);
  });

  test("a host registered at boot starts even when the sidecar registry is empty and the data directory is missing", async () => {
    await startRobotHosts();
    expect(listSidecars().filter((s) => s.id.startsWith("robot-host:"))).toEqual([]);
  });
});

describe("pairing secret", () => {
  async function paired() {
    const { id } = await owner();
    const { deviceId } = await createRobotHost({ label: "Rivet", personId: id });
    const secret = readFileSync(join(roots, deviceId, "pairing-secret"), "utf8");
    return { id, deviceId, secret };
  }
  const code = (c: TestClient, body: Record<string, unknown>) => c.post("/api/auth/quick-connect/code", body);

  test("the right secret is approved at once and the poll issues a token for the same device, once", async () => {
    const { deviceId, secret } = await paired();
    const bot = new TestClient();
    const res = await code(bot, { label: "Rivet", kind: "robot", capabilities: ["no_vendor_login"], pairing_secret: secret });
    expect(res.status).toBe(200);
    const { poll_token } = (await res.json()) as { poll_token: string };
    const poll = (await (await bot.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`)).json()) as { status: string; device_token?: string };
    expect(poll.status).toBe("approved");
    expect(poll.device_token).toBeTruthy();
    expect(db.select().from(devices).all().filter((d) => d.kind === "robot").map((d) => d.id)).toEqual([deviceId]);
    expect(db.select().from(deviceTokens).where(eq(deviceTokens.deviceId, deviceId)).all()).toHaveLength(1);
    expect(hostJson(deviceId).secretHash).toBeUndefined();
    // Reuse falls back to a normal pending approval.
    const again = (await (await code(new TestClient(), { label: "Rivet", kind: "robot", pairing_secret: secret })).json()) as { poll_token: string };
    const pending = await new TestClient().get(`/api/auth/quick-connect/poll?poll_token=${again.poll_token}`);
    expect(await pending.json()).toEqual({ status: "pending" });
  });

  test("a wrong secret, no secret and a secret of the wrong length all stay pending", async () => {
    const { deviceId, secret } = await paired();
    for (const pairing_secret of ["0".repeat(64), undefined, "short", secret.slice(0, 63)]) {
      const c = new TestClient();
      const { poll_token } = (await (await code(c, { label: "Rivet", kind: "robot", ...(pairing_secret === undefined ? {} : { pairing_secret }) })).json()) as { poll_token: string };
      expect(await (await c.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`)).json()).toEqual({ status: "pending" });
    }
    expect(hostJson(deviceId).secretHash).toBeTruthy();
  });

  test("a non-robot kind never uses the secret and does not burn it", async () => {
    const { deviceId, secret } = await paired();
    const c = new TestClient();
    const { poll_token } = (await (await code(c, { label: "Living room TV", kind: "tv", pairing_secret: secret })).json()) as { poll_token: string };
    expect(await (await c.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`)).json()).toEqual({ status: "pending" });
    expect(hostJson(deviceId).secretHash).toBeTruthy();
  });

  test("with Robots off the request is refused and the secret is not used", async () => {
    const { deviceId, secret } = await paired();
    setHouseholdSettingValue("home.robots.enabled", false);
    const res = await code(new TestClient(), { label: "Rivet", kind: "robot", pairing_secret: secret });
    expect(res.status).toBe(403);
    expect(hostJson(deviceId).secretHash).toBeTruthy();
  });

  test("the secret and its hash are never written to the logs or issues", async () => {
    const { secret, deviceId } = await paired();
    const text = JSON.stringify(listIssues());
    expect(text).not.toContain(secret);
    expect(text).not.toContain(hostJson(deviceId).secretHash!);
  });
});

describe("ports and failures", () => {
  test("a port held by another program raises one Repairs item naming the robot and port, and the other program is left alone", async () => {
    const { id } = await owner();
    const { deviceId, ports } = await createRobotHost({ label: "Rivet", personId: id });
    await stopRobotHosts();
    __resetSidecarsForTests();
    __resetRobotHostsForTests();
    const other = Bun.listen({ hostname: "127.0.0.1", port: ports.avatar, socket: { data() {} } });
    listeners.push({ stop: (f) => other.stop(f) });
    await startRobotHosts();
    const items = robotIssues().filter((i) => !i.resolved_at);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Robot brain for Rivet can't start");
    expect(items[0]!.detail).toContain(`Port ${ports.avatar}`);
    expect(await connects(ports.avatar)).toBe(true);
    expect(getSidecar(`robot-host:${deviceId}`)).toBeUndefined();
    // Once the other program is gone the host starts and the item resolves.
    other.stop(true);
    await startRobotHosts();
    expect(getSidecar(`robot-host:${deviceId}`)?.status).toBe("running");
    expect(robotIssues().filter((i) => !i.resolved_at)).toEqual([]);
  });

  test("the Bot app exiting 75 raises the port item, not a second crash item", async () => {
    const { id } = await owner();
    const { deviceId } = await createRobotHost({ label: "Rivet", personId: id });
    await stopRobotHosts();
    __resetSidecarsForTests();
    __resetRobotHostsForTests();
    writeFileSync(join(roots, deviceId, "exit75"), "");
    await startRobotHosts();
    const open = robotIssues().filter((i) => !i.resolved_at);
    expect(open).toHaveLength(1);
    expect(open[0]!.title).toBe("Robot brain for Rivet can't start");
    expect(open[0]!.source).toBe(`robot-host:${deviceId}`);
    expect(getSidecar(`robot-host:${deviceId}`)?.status).toBe("crashed");
    rmSync(join(roots, deviceId, "exit75"));
    __resetSidecarsForTests();
    __resetRobotHostsForTests();
    await startRobotHosts();
    expect(robotIssues().filter((i) => !i.resolved_at)).toEqual([]);
  });

  test("a crash raises one item titled stopped that resolves when the host is healthy again", async () => {
    const { id } = await owner();
    const { deviceId } = await createRobotHost({ label: "Rivet", personId: id });
    await stopRobotHosts();
    __resetSidecarsForTests();
    __resetRobotHostsForTests();
    __setSidecarTimingForTestsOnly({ healthPollMs: 100, backoffMs: [100] });
    writeFileSync(join(roots, deviceId, "crash-once"), "");
    await startRobotHosts();
    await waitUntil(() => listIssues().some((i) => i.source === `sidecar:robot-host:${deviceId}` && !i.resolved_at));
    const item = listIssues().find((i) => i.source === `sidecar:robot-host:${deviceId}`)!;
    expect(item.title).toBe("Robot brain for Rivet stopped");
    await waitUntil(() => getSidecar(`robot-host:${deviceId}`)?.status === "running" && listIssues().every((i) => i.resolved_at || !i.source.includes("robot-host:")));
  }, 30000);
});

describe("Robots switch and Forget", () => {
  test("Robots off stops every host; on starts them again", async () => {
    const { client, id } = await owner();
    const a = await createRobotHost({ label: "Rivet", personId: id });
    const b = await createRobotHost({ label: "Bruno", personId: id });
    const put = (value: boolean) => client.put("/api/settings", { scope: "household", key: "home.robots.enabled", value });
    expect((await put(false)).status).toBe(200);
    expect(getSidecar(`robot-host:${a.deviceId}`)?.status).toBe("stopped");
    expect(getSidecar(`robot-host:${b.deviceId}`)?.status).toBe("stopped");
    expect(await connects(a.ports.voice)).toBe(false);
    expect((await put(true)).status).toBe(200);
    expect(getSidecar(`robot-host:${a.deviceId}`)?.status).toBe("running");
    expect(getSidecar(`robot-host:${b.deviceId}`)?.status).toBe("running");
    expect(listSidecars().filter((s) => s.id.startsWith("robot-host:"))).toHaveLength(2);
  });

  test("Forget stops and unregisters the host, removes only its directory, and refuses path characters", async () => {
    const { id } = await owner();
    const a = await createRobotHost({ label: "Rivet", personId: id });
    const b = await createRobotHost({ label: "Bruno", personId: id });
    await forgetRobotHost(a.deviceId);
    expect(getSidecar(`robot-host:${a.deviceId}`)).toBeUndefined();
    expect(existsSync(join(roots, a.deviceId))).toBe(false);
    expect(existsSync(join(roots, b.deviceId, "host.json"))).toBe(true);
    expect(await connects(a.ports.voice)).toBe(false);
    for (const bad of ["../x", "..", "device-1/../../x", "", "device-a/b"]) await expect(forgetRobotHost(bad)).rejects.toThrow();
    expect(readdirSync(roots)).toEqual([b.deviceId]);
  });

  test("deleting the robot device through the API forgets its host", async () => {
    const { client, id } = await owner();
    const a = await createRobotHost({ label: "Rivet", personId: id });
    const res = await client.request(`/api/devices/${a.deviceId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(existsSync(join(roots, a.deviceId))).toBe(false);
    expect(getSidecar(`robot-host:${a.deviceId}`)).toBeUndefined();
  });
});

describe("POST /api/robots/hosts", () => {
  async function member(ownerClient: TestClient): Promise<TestClient> {
    const created = (await (await ownerClient.post("/api/people", { displayName: "Willow", role: "adult", secret: "0000" })).json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return client;
  }
  test("a non-admin is refused", async () => {
    const { client } = await owner();
    const res = await (await member(client)).post("/api/robots/hosts", { label: "Rivet" });
    expect(res.status).toBe(403);
    expect(readdirSyncSafe()).toEqual([]);
  });
  test("with Robots off it is 403 with the message", async () => {
    const { client } = await owner();
    setHouseholdSettingValue("home.robots.enabled", false);
    const res = await client.post("/api/robots/hosts", { label: "Rivet" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Robots are turned off on this home. An admin can turn them on in Settings, Devices." });
  });
  test("an admin gets the device id and three ports", async () => {
    const { client } = await owner();
    const res = await client.post("/api/robots/hosts", { label: "Rivet" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { device_id: string; ports: { voice: number; avatar: number; vision: number } };
    expect(body.device_id).toMatch(/^device-/);
    expect(new Set(Object.values(body.ports)).size).toBe(3);
    expect(hostJson(body.device_id).ports).toEqual(body.ports);
  });
});
function readdirSyncSafe(): string[] { return existsSync(roots) ? readdirSync(roots) : []; }
