import { afterEach, beforeEach, expect, test } from "bun:test";
import { db } from "@/db";
import { devices, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { pollRobotOffline, __resetRobotOfflineWatchForTests, __setRobotOfflineHubStartForTests, __setRobotOfflineNotifierForTests, ROBOT_OFFLINE_AFTER_MS } from "@/lib/robotOfflineWatch";
import { recordRobotCheckin, forgetRobotCheckin, type RobotCheckin } from "@/lib/robotCheckin";
import { NOTIFICATION_TYPES } from "@/lib/notificationTypes";
import { resetDb } from "../../tests/reset-db";

const start = Date.parse("2026-10-23T12:00:00.000Z");
const sent: Array<{ type: string; name: string }> = [];
function addPerson(): void {
  const now = new Date(start).toISOString();
  db.insert(people).values({ id: "person-admin-offline", displayName: "Admin", role: "admin", avatarSeed: "admin", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
}
function addRobot(lastSeenAt: string | null): string {
  const row = { id: "device-robot-offline", kind: "robot", name: "Rivet", area: null, capabilities: "[]", personId: "person-admin-offline", offlineScope: "[]", watermarks: "{}", lastSeenAt, offlineNotifiedAt: null, createdAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString(), hlc: "1:0:test" };
  const created = issueDeviceToken(row.personId, "robot", row.name, []);
  db.update(devices).set({ lastSeenAt, offlineNotifiedAt: null }).where(eq(devices.id, created.deviceId)).run();
  return created.deviceId;
}

beforeEach(() => {
  resetDb(); sent.length = 0; addPerson();
  __resetRobotOfflineWatchForTests(start);
  __setRobotOfflineNotifierForTests(async (type, vars = {}) => { sent.push({ type, name: vars.name ?? "" }); });
});
afterEach(() => { __resetRobotOfflineWatchForTests(); resetDb(); });

test("robot.offline is a passive, in-app admin notice that cannot be disabled", () => {
  expect(NOTIFICATION_TYPES.find((type) => type.id === "robot.offline")).toMatchObject({ level: "passive", audience: "admins", template: "{name} has been offline for 10 minutes.", configurable: false, defaultChannels: ["in_app"], toast: true });
});

test("notifies once at ten minutes and does not repeat during the outage", async () => {
  addRobot(new Date(start).toISOString());
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS - 1);
  expect(sent).toHaveLength(0);
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS);
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS * 2);
  expect(sent).toEqual([{ type: "robot.offline", name: "Rivet" }]);
});

test("never-seen robots do not notify", async () => {
  addRobot(null);
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS * 3);
  expect(sent).toHaveLength(0);
});

test("hub start grants a fresh ten minute reconnect window", async () => {
  addRobot(new Date(start - ROBOT_OFFLINE_AFTER_MS * 3).toISOString());
  __setRobotOfflineHubStartForTests(start);
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS - 1);
  expect(sent).toHaveLength(0);
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS);
  expect(sent).toHaveLength(1);
});

test("clears the one-shot marker when the robot returns", async () => {
  const id = addRobot(new Date(start).toISOString());
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS);
  const seenAt = new Date(start + ROBOT_OFFLINE_AFTER_MS + 1).toISOString();
  db.update(devices).set({ lastSeenAt: seenAt }).where(eq(devices.id, id)).run();
  recordRobotCheckin(id, { device_id: id, board: "test", online: true, last_seen: seenAt, connected_since: seenAt, ip: null, firmware_version: null, bot_version: null, rssi: null, signal: null, free_heap_internal: null, free_heap_min: null, psram_free: null, boot_reason: null, crash_resets: null, battery_level: null, charging: null } satisfies RobotCheckin, "test");
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS + 1);
  const row = db.select().from(devices).where(eq(devices.id, id)).get();
  expect(row?.offlineNotifiedAt).toBeNull();
  forgetRobotCheckin(id);
});

test("the durable marker prevents another notice after a watcher restart", async () => {
  addRobot(new Date(start).toISOString());
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS);
  __resetRobotOfflineWatchForTests(start + ROBOT_OFFLINE_AFTER_MS);
  __setRobotOfflineNotifierForTests(async (type, vars = {}) => { sent.push({ type, name: vars.name ?? "" }); });
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS * 2);
  expect(sent).toHaveLength(1);
});

test("a notice that failed to go out is tried again on the next poll", async () => {
  addRobot(new Date(start).toISOString());
  let fail = true;
  __setRobotOfflineNotifierForTests(async (type, vars = {}) => { if (fail) throw new Error("busy"); sent.push({ type, name: vars.name ?? "" }); });
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS);
  expect(sent).toHaveLength(0);
  fail = false;
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS + 60_000);
  expect(sent).toEqual([{ type: "robot.offline", name: "Rivet" }]);
});

test("the body's own calls do not make a powered-off unit look alive", async () => {
  const id = addRobot(new Date(start + ROBOT_OFFLINE_AFTER_MS).toISOString()); // the body touched last_seen just now
  recordRobotCheckin(id, { device_id: id, board: "test", online: false, last_seen: new Date(start).toISOString(), connected_since: null, ip: null, firmware_version: null, bot_version: null, rssi: null, signal: null, free_heap_internal: null, free_heap_min: null, psram_free: null, boot_reason: null, crash_resets: null, battery_level: null, charging: null } satisfies RobotCheckin, "test");
  await pollRobotOffline(start + ROBOT_OFFLINE_AFTER_MS);
  expect(sent).toHaveLength(1);
  forgetRobotCheckin(id);
});
