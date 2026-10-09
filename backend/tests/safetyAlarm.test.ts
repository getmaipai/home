import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, notificationDeliveries, people, safetyAlarms } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { __resetHomeAssistantEventsForTests, __setHomeAssistantEventAdaptersForTests } from "@/lib/integrations/homeAssistant";
import { __setSafetyAlarmDebounceForTests, applyRobotAlarmAction, refreshSafetyAlarmSensors } from "@/lib/safetyAlarm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit("close", {}); }
  emit(type: string, event: { data?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  message(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}

beforeEach(() => resetDb());
afterEach(() => __resetHomeAssistantEventsForTests());

async function setupHousehold() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const adult = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const childResponse = await client.post("/api/people", { displayName: "Rin", role: "child" });
  const childId = (await childResponse.json() as { id: string }).id;
  const robot = issueDeviceToken(adult.id, "robot", "Alarm robot");
  setHouseholdSettingValue("home.base_url", "http://homeassistant.local:8123");
  setHouseholdSettingValue("home.access_token", "test-ha-token");
  setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify([{ entityId: "binary_sensor.kitchen_smoke", area: "Kitchen", kind: "smoke" }]));
  return { adult, childId, robotId: robot.deviceId };
}

function connectedSocket(ws: FakeSocket) {
  ws.emit("open", {});
  ws.message({ type: "auth_required" });
  ws.message({ type: "auth_ok" });
  ws.message({ type: "result", id: 1, success: true });
}

function sensorChange(state: "on" | "off") {
  return { type: "event", event: { event_type: "state_changed", data: {
    entity_id: "binary_sensor.kitchen_smoke",
    old_state: { entity_id: "binary_sensor.kitchen_smoke", state: state === "on" ? "off" : "on", attributes: {} },
    new_state: { entity_id: "binary_sensor.kitchen_smoke", state, attributes: {} },
  } } };
}

describe("the deterministic safety alarm", () => {
  test("a flap inside debounce raises nothing; a steady on makes one adult notification and one robot command", async () => {
    const { adult, childId, robotId } = await setupHousehold();
    const ws = new FakeSocket();
    let reads = 0;
    __setSafetyAlarmDebounceForTests(20);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: ++reads === 1 ? "off" : "on", attributes: {} }) });
    refreshSafetyAlarmSensors();
    connectedSocket(ws);
    await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(sensorChange("on"));
    ws.message(sensorChange("off"));
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(db.select().from(safetyAlarms).all()).toHaveLength(0);
    ws.message(sensorChange("on"));
    await new Promise((resolve) => setTimeout(resolve, 35));
    ws.message(sensorChange("on"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const alarms = db.select().from(safetyAlarms).all();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ sensorId: "binary_sensor.kitchen_smoke", area: "Kitchen", kind: "smoke", state: "active" });
    expect(db.select().from(notificationDeliveries).all().filter((row) => row.typeId === "safety.alarm").map((row) => row.recipientId)).toEqual([adult.id]);
    const commands = db.select().from(deviceCommands).all().filter((row) => row.kind === "alarm");
    expect(commands).toHaveLength(1);
    expect(commands[0]!.deviceId).toBe(robotId);
    expect(JSON.parse(commands[0]!.payload)).toEqual({ alarm_id: alarms[0]!.id, area: "Kitchen", kind: "smoke", state: "active" });
    const childResult = applyRobotAlarmAction(robotId, alarms[0]!.id, "acknowledge", { person: childId, basis: "voice", level: "confirmed" });
    expect(childResult).toMatchObject({ ok: false, status: 403 });
    expect(db.select().from(safetyAlarms).get()?.state).toBe("active");
    const adultResult = applyRobotAlarmAction(robotId, alarms[0]!.id, "acknowledge", { person: adult.id, basis: "voice", level: "confirmed" });
    expect(adultResult).toEqual({ ok: true, state: "cleared" });
    expect(db.select().from(safetyAlarms).get()?.state).toBe("acknowledged");
    expect(db.select().from(deviceCommands).all().filter((row) => row.kind === "alarm")).toHaveLength(2);
  });

  test("an HA clear sends a cleared alarm and false alarm is logged as a terminal state", async () => {
    const { adult } = await setupHousehold();
    const ws = new FakeSocket();
    let state: "off" | "on" = "off";
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state, attributes: {} }) });
    refreshSafetyAlarmSensors();
    connectedSocket(ws);
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = "on";
    ws.message(sensorChange("on"));
    await new Promise((resolve) => setTimeout(resolve, 15));
    const alarm = db.select().from(safetyAlarms).get()!;
    state = "off";
    ws.message(sensorChange("off"));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.id, alarm.id)).get()?.state).toBe("cleared");
    state = "on";
    ws.message(sensorChange("on"));
    await new Promise((resolve) => setTimeout(resolve, 15));
    const next = db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).get()!;
    expect(applyAlarmAction(adult.id, next.id, "false_alarm")).toEqual({ ok: true, state: "false_alarm" });
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.id, next.id)).get()?.state).toBe("false_alarm");
  });
});
