import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, notificationDeliveries, people, safetyAlarms } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { __resetHomeAssistantEventsForTests, __setHomeAssistantEventAdaptersForTests } from "@/lib/integrations/homeAssistant";
import { __resetSafetyAlarmForTests, __setSafetyAlarmDebounceForTests, applyAlarmAction, refreshSafetyAlarmSensors } from "@/lib/safetyAlarm";
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

beforeEach(() => { __resetSafetyAlarmForTests(); __resetHomeAssistantEventsForTests(); resetDb(); });

async function setupHousehold() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const adult = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const childId = (await (await client.post("/api/people", { displayName: "Rin", role: "child" })).json() as { id: string }).id;
  const robot = issueDeviceToken(adult.id, "robot", "Alarm robot");
  setHouseholdSettingValue("home.base_url", "http://homeassistant.local:8123");
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
    expect(source).not.toMatch(/from\s+["'][^"']*(?:llm|model|tts|packageHost|turnMachine)[^"']*["']/i);
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
    db.update(people).set({ role: "adult", birthdate: `${new Date().getFullYear() - 8}-01-01` }).where(eq(people.id, childId)).run();
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
    state = "off"; ws.message(change("off"));
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.id, alarm.id)).get()?.state).toBe("cleared");
    state = "on"; ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const next = db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).get()!;
    expect(applyAlarmAction(adult.id, next.id, "false_alarm")).toEqual({ ok: true, state: "false_alarm" });
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.id, next.id)).get()?.state).toBe("false_alarm");
  });

  test("quiet_here silences only that robot while the household alarm stays active", async () => {
    const { adult, robotId } = await setupHousehold();
    const ws = new FakeSocket();
    __setSafetyAlarmDebounceForTests(5);
    __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: "on", attributes: {} }) });
    refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
    ws.message(change("on")); await new Promise((resolve) => setTimeout(resolve, 15));
    const alarm = db.select().from(safetyAlarms).get()!;
    expect(applyAlarmAction(adult.id, alarm.id, "quiet_here", robotId)).toEqual({ ok: true, state: "quiet_here" });
    expect(db.select().from(safetyAlarms).get()?.state).toBe("active");
    expect(JSON.parse(db.select().from(safetyAlarms).get()!.quietedDevices)).toEqual([robotId]);
  });
});
