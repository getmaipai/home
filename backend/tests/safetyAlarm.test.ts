import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, notificationDeliveries, notificationHolds, people, safetyAlarms } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { __resetHomeAssistantEventsForTests, __setHomeAssistantEventAdaptersForTests } from "@/lib/integrations/homeAssistant";
import { __resetSafetyAlarmForTests, __setSafetyAlarmClockForTests, __setSafetyAlarmDebounceForTests, applyAlarmAction, applyRobotAlarmAction, initSafetyAlarm, refreshSafetyAlarmSensors } from "@/lib/safetyAlarm";
import { __resetForTests as clearSuppression } from "@/lib/sceneSuppression";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  addEventListener(type: string, listener: (event: { data?: string }) => void) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit("close", {}); }
  emit(type: string, event: { data?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  message(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}

beforeEach(() => { __resetSafetyAlarmForTests(); clearSuppression(); __resetHomeAssistantEventsForTests(); resetDb(); });

async function setupHousehold() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const adult = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const childId = (await (await client.post("/api/people", { displayName: "Rin", role: "child" })).json() as { id: string }).id;
  const robot = issueDeviceToken(adult.id, "robot", "Alarm robot");
  setHouseholdSettingValue("home.base_url", "http://192.168.1.2:8123");
  setHouseholdSettingValue("home.access_token", "test-ha-token");
  setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify([{ entityId: "binary_sensor.kitchen_smoke", area: "Kitchen", kind: "smoke" }]));
  return { adult, childId, robotId: robot.deviceId };
}

function connect(ws: FakeSocket) {
  ws.emit("open", {}); ws.message({ type: "auth_required" }); ws.message({ type: "auth_ok" }); ws.message({ type: "result", id: 1, success: true });
}
function change(state: "on" | "off") {
  return { type: "event", event: { event_type: "state_changed", data: { entity_id: "binary_sensor.kitchen_smoke", old_state: { entity_id: "binary_sensor.kitchen_smoke", state: state === "on" ? "off" : "on", attributes: {} }, new_state: { entity_id: "binary_sensor.kitchen_smoke", state, attributes: {} } } } };
}

describe("deterministic safety alarm path", () => {
  test("alarm module contains no model, TTS, turn, or package-host client", () => {
    const source = readFileSync(new URL("../src/lib/safetyAlarm.ts", import.meta.url), "utf8");
    const suppression = readFileSync(new URL("../src/lib/sceneSuppression.ts", import.meta.url), "utf8");
    for (const input of [source, suppression]) expect(input).not.toMatch(/from\s+["'][^"']*(?:llm|model|tts|packageHost|turnMachine|sceneTool)[^"']*["']/i);
  });

  test("flapping inside debounce raises nothing; steady on alerts each adult once and commands each robot once", async () => {
    const { adult, childId, robotId } = await setupHousehold();
    const ws = new FakeSocket(); let reads = 0;
    __setSafetyAlarmDebounceForTests(15);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: ++reads === 1 ? "off" : "on", attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(change("on")); ws.message(change("off")); await new Promise((resolve) => setTimeout(resolve, 25));
    expect(db.select().from(safetyAlarms).all()).toHaveLength(0);
    ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 25));
    const alarm = db.select().from(safetyAlarms).get()!;
    expect(alarm).toMatchObject({ area: "Kitchen", kind: "smoke", state: "active" });
    expect(db.select().from(notificationDeliveries).all().filter((row) => row.typeId === "safety.alarm").map((row) => row.recipientId)).toEqual([adult.id]);
    expect(db.select().from(deviceCommands).all().filter((row) => row.kind === "alarm")).toHaveLength(1);
    db.update(people).set({ role: "child", birthdate: `${new Date().getFullYear() - 8}-01-01` }).where(eq(people.id, childId)).run();
    expect(applyAlarmAction(childId, alarm.id, "acknowledge")).toMatchObject({ ok: false, status: 403 });
    expect(db.select().from(safetyAlarms).get()?.state).toBe("active");
    expect(applyAlarmAction(adult.id, alarm.id, "acknowledge")).toEqual({ ok: true, state: "cleared" });
    expect(db.select().from(deviceCommands).all().filter((row) => row.kind === "alarm")).toHaveLength(2);
    expect(robotId).toBeTruthy();
  });

  test("the alarm bypasses quiet hours; HA clear ends it and an admin false alarm is audited", async () => {
    const { adult } = await setupHousehold();
    const ws = new FakeSocket(); let state: "off" | "on" = "off";
    setHouseholdSettingValue("household.quiet_hours.from", "00:00");
    setHouseholdSettingValue("household.quiet_hours.to", "23:59");
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state, attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    state = "on"; ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const alarm = db.select().from(safetyAlarms).get()!;
    expect(alarm.state).toBe("active");
    expect(db.select().from(notificationDeliveries).all().filter((row) => row.typeId === "safety.alarm")).toHaveLength(1);
    expect(applyAlarmAction(adult.id, alarm.id, "acknowledge")).toEqual({ ok: true, state: "cleared" });
    const dismissalNotices = db.select().from(notificationDeliveries).all().filter((row) => row.typeId === "safety.alarm_dismissed");
    const heldNotices = db.select().from(notificationHolds).all().filter((row) => row.typeId === "safety.alarm_dismissed");
    expect(dismissalNotices.length + heldNotices.length).toBe(1);
    expect(dismissalNotices[0]?.text ?? heldNotices[0]?.text).toContain("Kitchen");
    expect(dismissalNotices[0]?.text ?? heldNotices[0]?.text).not.toContain("Sage");
    state = "off"; ws.message(change("off"));
    state = "on"; ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all()).toHaveLength(0);
    expect(applyAlarmAction(adult.id, alarm.id, "false_alarm")).toMatchObject({ ok: false, status: 404 });
  });

  test("a different kind is not suppressed by an acknowledged smoke alarm", async () => {
    const { adult } = await setupHousehold();
    setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify([
      { entityId: "binary_sensor.kitchen_smoke", area: "Kitchen", kind: "smoke" },
      { entityId: "binary_sensor.co", area: "Kitchen", kind: "carbon_monoxide" },
    ]));
    const ws = new FakeSocket();
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: "on", attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const smoke = db.select().from(safetyAlarms).get()!;
    applyAlarmAction(adult.id, smoke.id, "acknowledge");
    ws.message({ type: "event", event: { event_type: "state_changed", data: { entity_id: "binary_sensor.co", old_state: { entity_id: "binary_sensor.co", state: "off", attributes: {} }, new_state: { entity_id: "binary_sensor.co", state: "on", attributes: {} } } } });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).get()?.kind).toBe("carbon_monoxide");
  });

  test("a second smoke sensor agreeing during a household hold re-alerts once", async () => {
    const { adult } = await setupHousehold();
    setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify([
      { entityId: "binary_sensor.kitchen_smoke", area: "Kitchen", kind: "smoke" },
      { entityId: "binary_sensor.hall_smoke", area: "Hall", kind: "smoke" },
    ]));
    const ws = new FakeSocket();
    __setSafetyAlarmDebounceForTests(5);
    let sensorStates: Record<string, "on" | "off"> = { "binary_sensor.kitchen_smoke": "on", "binary_sensor.hall_smoke": "off" };
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: sensorStates[entityId] ?? "off", attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    sensorStates["binary_sensor.kitchen_smoke"] = "on";
    ws.message({ type: "event", event: { event_type: "state_changed", data: { entity_id: "binary_sensor.kitchen_smoke", old_state: { entity_id: "binary_sensor.kitchen_smoke", state: "off", attributes: {} }, new_state: { entity_id: "binary_sensor.kitchen_smoke", state: "on", attributes: {} } } } }); await new Promise((resolve) => setTimeout(resolve, 15));
    const first = db.select().from(safetyAlarms).get()!;
    applyAlarmAction(adult.id, first.id, "acknowledge");
    sensorStates["binary_sensor.hall_smoke"] = "on";
    const other = (state: "on" | "off") => ({ type: "event", event: { event_type: "state_changed", data: { entity_id: "binary_sensor.hall_smoke", old_state: { entity_id: "binary_sensor.hall_smoke", state: "off", attributes: {} }, new_state: { entity_id: "binary_sensor.hall_smoke", state, attributes: {} } } } });
    ws.message(other("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all()).toHaveLength(1);
    // The acknowledged alarm plus the one re-alert from the second sensor agreeing.
    expect(db.select().from(safetyAlarms).all()).toHaveLength(2);
    // Once only: a third change on the same held kind does not raise another.
    ws.message(other("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    expect(db.select().from(safetyAlarms).all()).toHaveLength(2);
  });

  test("hold expiry re-alerts once only while the sensor remains on", async () => {
    const { adult } = await setupHousehold();
    const ws = new FakeSocket();
    let now = Date.now();
    let state: "on" | "off" = "on";
    __setSafetyAlarmClockForTests(() => now);
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state, attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const alarm = db.select().from(safetyAlarms).get()!;
    applyAlarmAction(adult.id, alarm.id, "acknowledge");
    state = "on";
    now += 15 * 60_000;
    initSafetyAlarm();
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all()).toHaveLength(1);
    __resetSafetyAlarmForTests(); clearSuppression();

    const secondWs = new FakeSocket();
    state = "off";
    now = Date.now();
    __setSafetyAlarmClockForTests(() => now);
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => secondWs as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state, attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(secondWs); await new Promise((resolve) => setTimeout(resolve, 0));
    secondWs.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const secondAlarm = db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).get()!;
    applyAlarmAction(adult.id, secondAlarm.id, "acknowledge");
    state = "off";
    now += 15 * 60_000;
    initSafetyAlarm();
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all()).toHaveLength(0);
  });

  test("restart clears the in-memory hold and the same sensor alerts normally", async () => {
    const { adult } = await setupHousehold();
    const ws = new FakeSocket();
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: "on", attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const alarm = db.select().from(safetyAlarms).get()!;
    applyAlarmAction(adult.id, alarm.id, "acknowledge");
    expect(db.select().from(safetyAlarms).all()).toHaveLength(1);
    __resetSafetyAlarmForTests(); clearSuppression();
    const fresh = new FakeSocket();
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => fresh as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: "on", attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(fresh); await new Promise((resolve) => setTimeout(resolve, 0));
    fresh.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all()).toHaveLength(1);
  });

  test("a failed sensor read at hold expiry is retried, never lost", async () => {
    const { adult } = await setupHousehold();
    const ws = new FakeSocket();
    let now = Date.now();
    let failReads = 0;
    __setSafetyAlarmClockForTests(() => now);
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => {
      if (failReads > 0) { failReads--; throw new Error("hub unreachable"); }
      return { entity_id: entityId, state: "on", attributes: {} };
    } });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const alarm = db.select().from(safetyAlarms).get()!;
    applyAlarmAction(adult.id, alarm.id, "acknowledge");
    now += 15 * 60_000;
    failReads = 1;
    initSafetyAlarm();
    await new Promise((resolve) => setTimeout(resolve, 2_150));
    // The first read failed, the next tick read "on": the sensor still alarms.
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all()).toHaveLength(1);
  });

  test("quiet_here silences only that robot while the household alarm stays active", async () => {
    const { adult, childId, robotId } = await setupHousehold();
    const ws = new FakeSocket();
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: "on", attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const alarm = db.select().from(safetyAlarms).get()!;
    db.update(people).set({ role: "child", birthdate: `${new Date().getFullYear() - 8}-01-01` }).where(eq(people.id, childId)).run();
    const childRobotId = issueDeviceToken(childId, "robot", "Rin robot").deviceId;
    // A3: quiet_here is for a person's OWN device. A child cannot quiet an adult's robot.
    expect(applyRobotAlarmAction(robotId, alarm.id, "quiet_here", { person: childId, basis: "voice", level: "confirmed" })).toMatchObject({ ok: false, status: 403 });
    expect(applyRobotAlarmAction(childRobotId, alarm.id, "quiet_here", { person: childId, basis: "voice", level: "confirmed" })).toEqual({ ok: true, state: "quiet_here" });
    expect(applyRobotAlarmAction(childRobotId, alarm.id, "quiet_here", { person: childId, basis: "claimed", level: "confirmed" })).toMatchObject({ ok: false, status: 403 });
    expect(applyAlarmAction(childId, alarm.id, "acknowledge")).toMatchObject({ ok: false, status: 403 });
    expect(db.select().from(safetyAlarms).get()?.state).toBe("active");
    expect(JSON.parse(db.select().from(safetyAlarms).get()!.quietedDevices)).toEqual([childRobotId]);
  });
});
