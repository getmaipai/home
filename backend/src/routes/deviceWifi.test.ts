import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { deviceCommands, devices, people, sessions } from "@/db/schema";
import { devicesRoutes } from "@/routes/devices";
import { OpenAPIHono } from "@hono/zod-openapi";
import { recordRobotCheckin, forgetRobotCheckin } from "@/lib/robotCheckin";
import { deviceCommandWebSocket, sendEphemeralDeviceCommand } from "@/lib/deviceCommands";
import { setValue } from "@/lib/settings";
import { __resetDeviceCommandsForTests } from "@/lib/deviceCommands";
import { resetDb } from "../../tests/reset-db";

const SAMPLE_PW = "sample-wifi-pw";

const app = new OpenAPIHono();
app.route("/api/devices", devicesRoutes);
const now = new Date().toISOString();
function person(id: string, role: string): string {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `token-${id}`;
  db.insert(sessions).values({ id: `session-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}
const owner = "wifi-owner";
const robotId = "wifi-robot";
let ownerToken: string;
function robot(): void {
  db.insert(devices).values({ id: robotId, kind: "robot", name: "Robot", personId: owner, capabilities: "[]", watermarks: "{}", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
}
function checkin(overrides: Record<string, unknown> = {}): void {
  recordRobotCheckin(robotId, {
    device_id: robotId, board: "test", online: true, last_seen: now, connected_since: null, ip: null, firmware_version: null, bot_version: null,
    rssi: null, signal: null, free_heap_internal: null, free_heap_min: null, psram_free: null, boot_reason: null, crash_resets: null, battery_level: null, charging: null,
    ...overrides,
  } as never, owner);
}
async function send(token: string, body: unknown): Promise<Response> {
  return app.request(`http://localhost/api/devices/${robotId}/wifi`, { method: "POST", headers: { cookie: `session=${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { resetDb(); ownerToken = person(owner, "owner"); robot(); });
afterEach(() => { console.log = originalLog; console.error = originalError; forgetRobotCheckin(robotId); resetDb(); });
const originalLog = console.log;
const originalError = console.error;

test("refuses non-admin roles", async () => {
  for (const role of ["child", "teen", "guest", "adult"]) {
    const token = person(`wifi-${role}`, role);
    const response = await send(token, { action: "add", ssid: "Home", password: SAMPLE_PW });
    expect(response.status).toBe(403);
    expect((await response.json() as { error: string }).error).toBe("Only an admin can change a robot's Wi-Fi.");
  }
});
test("forget sends a durable command containing only the SSID and unknown names return 404", async () => {
  checkin({ wifi_saved: ["Home"] });
  expect((await send(ownerToken, { action: "forget", ssid: "Missing" })).status).toBe(404);
  expect((await send(ownerToken, { action: "forget", ssid: "Home" })).status).toBe(202);
  const rows = db.select().from(deviceCommands).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("wifi_forget");
  expect(JSON.parse(rows[0]!.payload)).toEqual({ ssid: "Home" });
});
test("add refuses an unencrypted link, a full list, and an offline robot", async () => {
  checkin({ wifi_saved: [], link_encrypted: false });
  expect((await send(ownerToken, { action: "add", ssid: "Home", password: SAMPLE_PW })).status).toBe(409);
  checkin({ wifi_saved: Array.from({ length: 10 }, (_, i) => `Net${i}`), link_encrypted: true });
  expect((await send(ownerToken, { action: "add", ssid: "New", password: SAMPLE_PW })).status).toBe(409);
  checkin({ wifi_saved: [], link_encrypted: true, online: false });
  expect((await send(ownerToken, { action: "add", ssid: "New", password: SAMPLE_PW })).status).toBe(409);
});
test("encrypted add sends without a row, response or log containing the password", async () => {
  const distinctiveTestSecret = "sample-no-log-needle";
  checkin({ wifi_saved: [], link_encrypted: true, online: true });
  const logs: string[] = [];
  console.log = (...values: unknown[]) => logs.push(values.join(" "));
  console.error = (...values: unknown[]) => logs.push(values.join(" "));
  const response = await send(ownerToken, { action: "add", ssid: "Home", password: distinctiveTestSecret });
  const responseText = await response.text();
  expect(response.status).toBe(409); // No active device channel was opened by this HTTP test.
  expect(responseText).not.toContain(distinctiveTestSecret);
  expect(logs.join("\n")).not.toContain(distinctiveTestSecret);
  expect(db.select().from(deviceCommands).all()).toHaveLength(0);
});

test("ephemeral sender transmits a validated add to the live socket without a command row", () => {
  setValue(db.select().from(people).all().find((row) => row.id === owner)!, "household", "home.robots.enabled", true);
  const sent: string[] = [];
  const events = deviceCommandWebSocket(robotId);
  events.onOpen?.({} as never, { readyState: 1, send: (value: string) => sent.push(value), close: () => {} } as never);
  const distinctiveTestSecret = "FixtureSocketPass-5Tp";
  expect(sendEphemeralDeviceCommand(robotId, "wifi_add", { ssid: "Home", password: distinctiveTestSecret }, 60_000)).toBe(true);
  expect(sent.some((message) => message.includes(distinctiveTestSecret))).toBe(true);
  expect(db.select().from(deviceCommands).all().some((row) => row.kind === "wifi_add")).toBe(false);
  __resetDeviceCommandsForTests();
});
