import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { createHostedRobot, getDeviceById } from "@/lib/devices";
import { getRobotCheckin, recordRobotCheckin } from "@/lib/robotCheckin";
import { getDeviceSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const robotsDir = join(dataDir, "robots");
let deviceId = "";
let owner: TestClient;
let robot: TestClient;

function payload(overrides: Record<string, unknown> = {}) {
  return { device_id: deviceId, board: "m5stack-stack-chan", online: true, last_seen: "2026-10-21T12:00:00.000Z", connected_since: "2026-10-21T11:59:00.000Z", ip: "192.168.1.8", firmware_version: "0.2.24", bot_version: "0.2.24", rssi: -48, signal: "strong", free_heap_internal: 10000, free_heap_min: 9000, psram_free: 20000, boot_reason: 1, crash_resets: 0, battery_level: 87, charging: false, ...overrides };
}

beforeEach(async () => {
  resetDb();
  rmSync(robotsDir, { recursive: true, force: true });
  owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" });
  const personId = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Owner")).get()!.id;
  setHouseholdSettingValue("home.robots.enabled", true);
  const device = createHostedRobot("Checkin robot", personId);
  deviceId = device.id;
  mkdirSync(join(robotsDir, deviceId), { recursive: true });
  writeFileSync(join(robotsDir, deviceId, "host.json"), JSON.stringify({ deviceId, label: device.name, personId, ports: { voice: 10001, avatar: 10002, vision: 10003 }, createdAt: new Date().toISOString() }));
  const { token } = issueDeviceToken(personId, "robot", "Checkin robot", ["no_vendor_login"], deviceId);
  robot = new TestClient();
  await robot.post("/api/auth/devices/redeem", { token });
});

afterEach(() => rmSync(robotsDir, { recursive: true, force: true }));

describe("robot check-in", () => {
  test("accepts authenticated check-in, refreshes last seen, and records reported firmware", async () => {
    const response = await robot.put("/api/devices/me/checkin", payload());
    expect(response.status).toBe(204);
    expect(getDeviceById(deviceId)?.lastSeenAt).not.toBeNull();
    expect(getDeviceSettingValue(deviceId, "robot.firmware.installed")).toMatchObject({ version: "0.2.24" });
    const software = await owner.get(`/api/robots/hosts/${deviceId}/software`);
    expect(await software.json()).toMatchObject({ checkin: { online: true, ip: "192.168.1.8", signal: "strong", battery: { level: 87 }, heap: { internal: 10000 } } });
  });

  test("accepts the unit's MAC as its own id and reports body-offline or stale reports offline", async () => {
    expect((await robot.put("/api/devices/me/checkin", payload({ device_id: "aa:bb:cc:dd:ee:ff" }))).status).toBe(204);
    recordRobotCheckin(deviceId, payload({ online: false, firmware_version: null }) as Parameters<typeof recordRobotCheckin>[1], deviceId);
    expect(getRobotCheckin(deviceId)?.online).toBe(false);
    expect(getRobotCheckin(deviceId, Date.now() + 150_000)?.online).toBe(false);
  });

  test("an offline report with no device id, an unknown signal word or a float reading is still accepted", async () => {
    const odd = payload({ device_id: null, online: false, signal: "good", rssi: -39.5, battery_level: 101 });
    expect((await robot.put("/api/devices/me/checkin", odd)).status).toBe(204);
    expect(getRobotCheckin(deviceId)).toMatchObject({ online: false, signal: null, rssi: null, battery_level: null });
  });
});
