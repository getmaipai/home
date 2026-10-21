import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { createHostedRobot } from "@/lib/devices";
import { setHouseholdSettingValue } from "@/lib/settings";
import { compareSemver, robotSoftwareStatus } from "@/lib/robotSoftware";
import { botReleaseVersion } from "@/lib/botRelease";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const robotsDir = join(dataDir, "robots");
let deviceId = "";
let owner: TestClient;

beforeEach(async () => {
  resetDb();
  rmSync(robotsDir, { recursive: true, force: true });
  owner = new TestClient();
  const setup = await owner.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" });
  const { person } = await setup.json() as { person: { id: string } };
  setHouseholdSettingValue("home.robots.enabled", true);
  const device = createHostedRobot("Test robot", person.id);
  deviceId = device.id;
  mkdirSync(join(robotsDir, deviceId), { recursive: true });
  writeFileSync(join(robotsDir, deviceId, "host.json"), JSON.stringify({ deviceId, label: device.name, personId: person.id, ports: { voice: 10001, avatar: 10002, vision: 10003 }, createdAt: new Date().toISOString() }));
});

afterEach(() => rmSync(robotsDir, { recursive: true, force: true }));

describe("robot software versions", () => {
  test("compares numeric semantic versions and prerelease numbers", () => {
    expect(compareSemver("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
  });

  test("returns firmware and Bot status for current, old, missing and stopped versions", () => {
    const ready = "0.2.24";
    const stamp = { version: ready, at: "2026-10-21T12:00:00.000Z" };
    expect(robotSoftwareStatus({ installed: stamp, running: ready, available: ready })).toEqual({ firmware: { installed: stamp, available: ready, status: "up_to_date" }, bot: { running: ready, available: ready, status: "up_to_date" } });
    expect(robotSoftwareStatus({ installed: { ...stamp, version: "0.2.9" }, running: "0.2.9", available: ready })).toMatchObject({ firmware: { status: "update_available" }, bot: { status: "restart_needed" } });
    expect(robotSoftwareStatus({ installed: null, running: null, available: ready })).toMatchObject({ firmware: { status: "unknown" }, bot: { status: "unknown" } });
    expect(robotSoftwareStatus({ installed: { ...stamp, version: "0.3.0" }, running: "0.3.0", available: ready })).toMatchObject({ firmware: { status: "unknown" }, bot: { status: "unknown" } });
  });

  test("requires owner or admin, records only the pinned firmware version, and returns the software shape", async () => {
    const anonymous = await new TestClient().get(`/api/robots/hosts/${deviceId}/software`);
    expect(anonymous.status).toBe(401);
    const bad = await owner.post(`/api/robots/hosts/${deviceId}/firmware-installed`, { version: "0.2.9" });
    expect(bad.status).toBe(400);
    const genericWrite = await owner.put("/api/settings", { scope: `device:${deviceId}`, key: "robot.firmware.installed", value: "tamper" });
    expect(genericWrite.status).toBe(403);
    const saved = await owner.post(`/api/robots/hosts/${deviceId}/firmware-installed`, { version: botReleaseVersion() });
    expect(saved.status).toBe(200);
    const response = await owner.get(`/api/robots/hosts/${deviceId}/software`);
    expect(response.status).toBe(200);
    const value = await response.json() as { firmware: { installed: { version: string; at: string } | null; available: string; status: string }; bot: { running: string | null; available: string; status: string } };
    expect(value.firmware.installed?.version).toBe(botReleaseVersion());
    expect(value.firmware.installed?.at).toMatch(/^\d{4}-/);
    expect(value.firmware.available).toBe(botReleaseVersion());
    expect(value.firmware.status).toBe("up_to_date");
    expect(value.bot).toEqual({ running: null, available: botReleaseVersion(), status: "unknown" });
  });
});
