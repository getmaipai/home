// DISMISS-01c: the scene tool's dismiss action against a REAL sounding sensor alarm (the deterministic alarm path).
// The model supplies no alarm id, kind, device or duration: code finds the alarm and acts as the turn's own speaker.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, safetyAlarms } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { __resetHomeAssistantEventsForTests, __setHomeAssistantEventAdaptersForTests } from "@/lib/integrations/homeAssistant";
import { __resetSafetyAlarmForTests, __setSafetyAlarmDebounceForTests, refreshSafetyAlarmSensors } from "@/lib/safetyAlarm";
import { __resetForTests as clearSuppression, isSuppressed } from "@/lib/sceneSuppression";
import { runSceneTool } from "@/lib/sceneTool";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

class FakeSocket {
  readyState = 1;
  listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  addEventListener(type: string, listener: (event: { data?: string }) => void) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
  send() {}
  close() { this.readyState = 3; this.emit("close", {}); }
  emit(type: string, event: { data?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  message(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}
function connect(ws: FakeSocket) {
  ws.emit("open", {}); ws.message({ type: "auth_required" }); ws.message({ type: "auth_ok" }); ws.message({ type: "result", id: 1, success: true });
}
const smokeOn = { type: "event", event: { event_type: "state_changed", data: { entity_id: "binary_sensor.kitchen_smoke", old_state: { entity_id: "binary_sensor.kitchen_smoke", state: "off", attributes: {} }, new_state: { entity_id: "binary_sensor.kitchen_smoke", state: "on", attributes: {} } } } };

beforeEach(() => { __resetSafetyAlarmForTests(); clearSuppression(); __resetHomeAssistantEventsForTests(); resetDb(); });

async function soundingAlarm() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const adult = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as unknown as PersonRow;
  const childId = (await (await client.post("/api/people", { displayName: "Rin", role: "child" })).json() as { id: string }).id;
  db.update(people).set({ role: "child", birthdate: `${new Date().getFullYear() - 8}-01-01` }).where(eq(people.id, childId)).run();
  const child = db.select().from(people).where(eq(people.id, childId)).get()! as unknown as PersonRow;
  const childRobotId = issueDeviceToken(childId, "robot", "Rin robot").deviceId;
  const adultRobotId = issueDeviceToken(adult.id, "robot", "Sage robot").deviceId;
  setHouseholdSettingValue("home.base_url", "http://192.168.1.2:8123");
  setHouseholdSettingValue("home.access_token", "test-ha-token");
  setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify([{ entityId: "binary_sensor.kitchen_smoke", area: "Kitchen", kind: "smoke" }]));
  const ws = new FakeSocket();
  __setSafetyAlarmDebounceForTests(5);
  __setHomeAssistantEventAdaptersForTests({ socket: () => ws as never, readState: async (_settings, entityId) => ({ entity_id: entityId, state: "on", attributes: {} }) });
  refreshSafetyAlarmSensors(); connect(ws); await new Promise((resolve) => setTimeout(resolve, 0));
  ws.message(smokeOn); await new Promise((resolve) => setTimeout(resolve, 15));
  const alarm = db.select().from(safetyAlarms).get()!;
  expect(alarm.state).toBe("active");
  return { adult, child, childRobotId, adultRobotId, alarmId: alarm.id };
}
const call = (actor: PersonRow, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => runSceneTool({
  actor, args, callId: "c1", conversationId: "conv", roster: [actor], surface: "chat", actorBand: actor.role === "child" ? "child" : "adult", observe: () => undefined, ...extra,
} as Parameters<typeof runSceneTool>[0]);
const state = () => db.select().from(safetyAlarms).get()!.state;

describe("DISMISS-01c: the scene tool against a sounding sensor alarm", () => {
  test("a confirmed adult's dismiss with no kind acknowledges the sounding alarm; forged selectors are ignored", async () => {
    const { adult, alarmId } = await soundingAlarm();
    const result = call(adult, { action: "dismiss", reason: "handled", alarmId: "alarm-forged", kind: undefined, device: "robot-x", minutes: 600 });
    expect(result.result.reply.text).toContain("acknowledged");
    expect(state()).toBe("acknowledged");
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.id, alarmId)).get()?.state).toBe("acknowledged");
    // The hold is the table's 15 minutes for that one sensor, whatever the model sent; the stored result names no kind, room or person.
    expect(JSON.stringify(result)).not.toMatch(/smoke|Kitchen|person-|alarm-/i);
  });

  test("a heard-sound dismissal never acknowledges a sounding hardware alarm", async () => {
    const { adult } = await soundingAlarm();
    call(adult, { action: "dismiss", reason: "other", kind: "dog_bark", scope: "self" });
    expect(state()).toBe("active");
    expect(isSuppressed({ kind: "dog_bark", personId: adult.id, now: Date.now() })).toBe(true);
  });

  test("false_alarm is not reachable from the tool", async () => {
    const { adult } = await soundingAlarm();
    const result = call(adult, { action: "dismiss", reason: "false_alarm" });
    expect(result.result.reply.text).toContain("can't mark a sensor alarm as a false alarm");
    expect(state()).toBe("active");
  });

  test("a child on chat cannot dismiss the alarm; a child on a robot quiets only their own robot, never the household alarm", async () => {
    const { child, childRobotId } = await soundingAlarm();
    const onChat = call(child, { action: "dismiss", reason: "handled" });
    expect(onChat.result.reply.text).toContain("couldn't dismiss");
    expect(state()).toBe("active");
    const onRobot = call(child, { action: "dismiss", reason: "handled" }, { surface: "robot", deviceId: childRobotId, speakerEvidence: { person: child.id, basis: "voice", level: "confirmed" } });
    expect(onRobot.result.reply.text).toContain("for you only");
    expect(state()).toBe("active");
  });

  test("with no alarm sounding and no kind, dismiss does nothing and says so", async () => {
    const { adult, alarmId } = await soundingAlarm();
    db.update(safetyAlarms).set({ state: "cleared" }).where(eq(safetyAlarms.id, alarmId)).run();
    const result = call(adult, { action: "dismiss", reason: "handled" });
    expect(result.result.reply.text).toContain("isn't one active alarm");
  });

  test("on a robot the SPEAKER acts, not the robot's owner: a child or an unknown speaker cannot quiet or acknowledge as the parent", async () => {
    const { adult, child, adultRobotId } = await soundingAlarm();
    // The turn's account actor on the parent's robot is the parent; the speaker evidence says it is the child.
    const asChild = call(adult, { action: "dismiss", reason: "handled" }, { surface: "robot", deviceId: adultRobotId, actorBand: "child", speakerEvidence: { person: child.id, basis: "voice", level: "confirmed" } });
    expect(asChild.result.reply.text).toContain("couldn't dismiss");
    expect(state()).toBe("active");
    // No confirmed evidence at all (an unknown voice): nothing changes and it says it cannot tell who is asking.
    const unknown = call(adult, { action: "dismiss", reason: "handled" }, { surface: "robot", deviceId: adultRobotId, actorBand: "child", speakerEvidence: null });
    expect(unknown.result.reply.text).toContain("can't tell who is asking");
    expect(state()).toBe("active");
    // An unknown speaker cannot set a self hold as the owner either.
    const hold = call(adult, { action: "dismiss", reason: "other", kind: "dog_bark" }, { surface: "robot", deviceId: adultRobotId, actorBand: "child", speakerEvidence: { person: null, basis: "unknown", level: "unknown" } });
    expect(hold.result.reply.text).toContain("can't tell who is asking");
    expect(isSuppressed({ kind: "dog_bark", personId: adult.id, now: Date.now() })).toBe(false);
  });

  test("the confirmed adult speaking at their own robot acknowledges", async () => {
    const { adult, adultRobotId } = await soundingAlarm();
    const result = call(adult, { action: "dismiss", reason: "handled" }, { surface: "robot", deviceId: adultRobotId, actorBand: "adult", speakerEvidence: { person: adult.id, basis: "voice", level: "confirmed" } });
    expect(result.result.reply.text).toContain("acknowledged for everyone");
    expect(state()).toBe("acknowledged");
  });

  test("with two alarms sounding it refuses to guess which one is meant", async () => {
    const { adult } = await soundingAlarm();
    const at = new Date().toISOString();
    db.insert(safetyAlarms).values({ id: "alarm-second", sensorId: "binary_sensor.hall_smoke", area: "Hall", kind: "smoke", state: "active", startedAt: at, updatedAt: at, endedAt: null, endedByPersonId: null, quietedDevices: "[]" }).run();
    const result = call(adult, { action: "dismiss", reason: "handled" });
    expect(result.result.reply.text).toContain("More than one alarm");
    expect(db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all()).toHaveLength(2);
  });
});
