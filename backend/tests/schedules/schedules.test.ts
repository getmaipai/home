import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { grants, integrations, issues, people, scheduledJobs, scheduledTasks, toolAudit } from "@/db/schema";
import type { EffectivePermission } from "@/lib/house/access";
import { AUTOMATION_ID, AUTOMATION_TEXT, buildAutomationBody, createAutomation, deleteAutomation } from "@/lib/house/automations";
import { emitHouseConnected, emitScheduleRecheck, __clearHouseConnectHooksForTests, __clearScheduleRechecksForTests } from "@/lib/house/connectHooks";
import type { HouseEntity, HouseRegistryResult } from "@/lib/house/registry";
import type { JobRow } from "@/lib/scheduler";
import { fireHubDeviceTask } from "@/lib/schedules/executor";
import { __resetReconcileForTests, reconcileAllInstances, reconcileSchedules, registerScheduleReconcile, registerScheduleRecheck } from "@/lib/schedules/reconcile";
import { adminScheduleCount, cancelSchedule, createDeviceSchedule, listOwnSchedules, type ScheduleDeps } from "@/lib/schedules/store";
import { resetDb } from "../reset-db";
import { fakeHa, HOUSE_SETTINGS } from "./fakeHa";

const OWNER = "person-sagetestowner1";
const ADULT = "person-adulttestuser2";
const TEEN = "person-marlowteen0003";
const CHILD = "person-novachild00004";

const light = (id: string, name: string, extra: Partial<HouseEntity> = {}): HouseEntity => ({ id, name, kind: "light", area: "outside", state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null, ...extra });
const PORCH = light("light.porch", "Porch Lamp");
const HALL = light("light.hall", "Hall");
const LOCK = light("lock.front", "Front Door", { kind: "lock", sensitive: "lock" });
const GARAGE = light("cover.garage", "Garage", { kind: "cover", sensitive: "garage" });
const SWITCH = light("switch.lamp", "Reading Lamp", { kind: "switch" });
const SCENE = (members: string[]): HouseEntity => light("scene.evening", "Evening", { kind: "scene", sceneMembers: members });
let entities: HouseEntity[] = [];
const registry = async (): Promise<HouseRegistryResult> => ({ ok: true, areas: [{ id: "outside", name: "Outside" }], entities });

let grantedTo: Record<string, string[]> = {};
const permissionsOf = (personId: string): EffectivePermission[] => (grantedTo[personId] ?? []).flatMap((target) => (["see", "control"] as const).map((level) => ({ action: `house.${level}:default/entity:${target}`, effect: "allow" as const })));

function person(id: string, role: string): void {
  const now = "2026-11-06T00:00:00.000Z";
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:testnode" }).run();
}

let ha = fakeHa();
let consoleLines: string[] = [];
function deps(extra: Partial<ScheduleDeps> = {}): ScheduleDeps {
  return { house: { read: HOUSE_SETTINGS, fetch: ha.fetch }, loadRegistry: registry, permissionsOf, zoneOf: () => "America/New_York", now: () => new Date("2026-11-06T20:00:00.000Z"), ...extra };
}
const weekly = { time: "16:00", days: [1, 2, 3, 4, 5] };

beforeEach(() => {
  resetDb();
  db.delete(people).run();
  person(OWNER, "owner"); person(ADULT, "adult"); person(TEEN, "teen"); person(CHILD, "child");
  entities = [PORCH, HALL, LOCK, GARAGE, SWITCH, SCENE(["light.porch", "light.hall"])];
  grantedTo = { [ADULT]: ["light.porch", "light.hall", "switch.lamp", "scene.evening"], [TEEN]: ["light.porch"], [CHILD]: ["light.porch"] };
  ha = fakeHa();
  consoleLines = [];
  __resetReconcileForTests();
  __clearHouseConnectHooksForTests();
  __clearScheduleRechecksForTests();
});

async function createPorch(extra: Partial<Parameters<typeof createDeviceSchedule>[0]> = {}, d: ScheduleDeps = deps()) {
  return createDeviceSchedule({ person: { id: OWNER, role: "owner" }, kind: "device_action", targets: ["default/light.porch"], action: "turn_on", ...weekly, ...extra }, d);
}

describe("creating a device schedule", () => {
  test("makes one automation with the generic text, a random id, and no person or entity name in alias or description", async () => {
    const result = await createPorch();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.executor).toBe("home_assistant");
    expect(ha.automations.size).toBe(1);
    const [automationId, body] = [...ha.automations][0]!;
    expect(automationId).toMatch(AUTOMATION_ID);
    expect(automationId.slice("maipai_".length)).toHaveLength(16);
    expect(automationId).not.toContain(result.id.slice("sched-".length));
    expect(body.alias).toBe(AUTOMATION_TEXT);
    expect(body.description).toBe(AUTOMATION_TEXT);
    const wording = `${String(body.alias)} ${String(body.description)}`.toLowerCase();
    for (const forbidden of ["porch", "lamp", OWNER, "sage", "person-", "sched-", "light."]) expect(wording).not.toContain(forbidden);
    // The entity id appears only in the action data, and the trigger is the wall clock.
    expect(body.triggers).toEqual([{ trigger: "time", at: "16:00:00" }]);
    expect(body.actions).toEqual([{ action: "light.turn_on", data: { entity_id: ["light.porch"] } }]);
    expect(body.conditions).toEqual([{ condition: "time", weekday: ["mon", "tue", "wed", "thu", "fri"] }]);
    const row = db.select().from(scheduledTasks).where(eq(scheduledTasks.id, result.id)).get()!;
    expect(row.externalRef).toBe(automationId);
    expect(row.externalRef).not.toBe(row.id);
    expect(row.state).toBe("active");
    expect(JSON.parse(row.grantSnapshot)).toEqual(["default/light.porch"]);
  });

  test("a daily task has no weekday condition and a one-shot adds a date condition in the person's zone", async () => {
    await createPorch({ days: [] });
    await createPorch({ onceAt: "2026-11-08T21:30:00.000Z", time: undefined, days: undefined });
    const bodies = [...ha.automations.values()];
    expect(bodies[0]!.conditions).toEqual([]);
    expect(bodies[1]!.triggers).toEqual([{ trigger: "time", at: "16:30:00" }]);
    expect(bodies[1]!.conditions).toEqual([{ condition: "template", value_template: "{{ now().strftime('%Y-%m-%d') == '2026-11-08' }}" }]);
    const once = db.select().from(scheduledTasks).all().find((row) => row.onceAt !== null)!;
    // The zone stays in the column for a one-shot (so a rebuild never uses a changed person zone) but never on the record.
    expect(once.zone).toBe("America/New_York");
    expect(once.time).toBeNull();
  });

  test("a scene task activates the scene and a switch uses the generic turn service", async () => {
    const adult = { id: ADULT, role: "adult" };
    expect((await createDeviceSchedule({ person: adult, kind: "scene", targets: ["scene.evening"], action: "activate", ...weekly }, deps())).ok).toBe(true);
    expect((await createDeviceSchedule({ person: adult, kind: "device_action", targets: ["switch.lamp", "light.hall"], action: "turn_off", ...weekly }, deps())).ok).toBe(true);
    const actions = [...ha.automations.values()].map((body) => body.actions);
    expect(actions[0]).toEqual([{ action: "scene.turn_on", data: { entity_id: ["scene.evening"] } }]);
    expect(actions[1]).toEqual([{ action: "light.turn_off", data: { entity_id: ["light.hall"] } }, { action: "homeassistant.turn_off", data: { entity_id: ["switch.lamp"] } }]);
  });

  test("locks, garage, and scripts are refused with a reminder offer, and nothing is made", async () => {
    for (const target of ["default/lock.front", "cover.garage", "script.goodnight", "alarm_control_panel.house", "camera.driveway"]) {
      const result = await createPorch({ targets: [target] });
      expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.reason).toBe("sensitive"); expect(result.offerReminder).toBe(true); expect(result.text).toContain("reminder"); }
    }
    expect(ha.automations.size).toBe(0);
    expect(db.select().from(scheduledTasks).all()).toHaveLength(0);
  });

  test("a scene that sets a lock cannot be scheduled", async () => {
    entities = [PORCH, LOCK, SCENE(["light.porch", "lock.front"])];
    const result = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "scene", targets: ["scene.evening"], action: "activate", ...weekly }, deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.offerReminder).toBe(true);
  });

  test("only a person with house.control on every target can create", async () => {
    const result = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "device_action", targets: ["light.porch", "light.garden"], action: "turn_on", ...weekly }, deps());
    expect(result.ok).toBe(false);
    grantedTo[ADULT] = ["light.porch"];
    const noHall = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "device_action", targets: ["light.porch", "light.hall"], action: "turn_on", ...weekly }, deps());
    expect(noHall.ok).toBe(false);
    if (!noHall.ok) expect(noHall.reason).toBe("no_access");
  });

  test("teens, children, guests and an unknown speaker are refused", async () => {
    for (const role of ["teen", "child", "guest", "unknown"]) {
      const result = await createDeviceSchedule({ person: { id: role === "teen" ? TEEN : CHILD, role }, kind: "device_action", targets: ["light.porch"], action: "turn_on", ...weekly }, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not_allowed");
    }
    const unknown = await createDeviceSchedule({ person: { id: "", role: "owner" }, kind: "device_action", targets: ["light.porch"], action: "turn_on", ...weekly }, deps());
    expect(unknown.ok).toBe(false);
    expect(ha.automations.size).toBe(0);
  });

  test("a bad shape is refused before any network call", async () => {
    expect((await createPorch({ action: "activate" })).ok).toBe(false);
    expect((await createPorch({ action: "set_brightness" })).ok).toBe(false);
    expect((await createPorch({ time: "25:00" })).ok).toBe(false);
    expect((await createPorch({ onceAt: "2026-01-01T00:00:00.000Z", time: undefined, days: undefined })).ok).toBe(false);
    expect(ha.requests).toHaveLength(0);
  });

  test("when the automation API fails the task runs on the hub executor and the row says so", async () => {
    ha.state.failWrites = true;
    const result = await createPorch();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.executor).toBe("hub");
    expect(result.fellBack).toBe(true);
    const row = db.select().from(scheduledTasks).where(eq(scheduledTasks.id, result.id)).get()!;
    expect(row.executor).toBe("hub");
    expect(row.state).toBe("active");
    expect(row.externalRef).toBeNull();
    expect(ha.automations.size).toBe(0);
    const jobs = db.select().from(scheduledJobs).all();
    expect(jobs.filter((job) => job.job === "schedules.device.fire")).toHaveLength(1);
  });
});

describe("the home assistant client", () => {
  test("only a maipai id is ever written or deleted, and nothing else leaves the module", async () => {
    const connection = { lanFetch: async (path: string, init?: { method?: string }) => { ha.requests.push({ method: init?.method ?? "GET", path, body: "" }); return { ok: true as const, status: 200, text: "{}", truncated: false }; }, token: "t" };
    expect((await createAutomation({ ...connection, id: "manual_morning_lights", body: {} })).ok).toBe(false);
    expect((await createAutomation({ ...connection, id: "maipai_../../x", body: {} })).ok).toBe(false);
    expect((await deleteAutomation({ ...connection, id: "light.porch" })).ok).toBe(false);
    expect(ha.requests).toHaveLength(0);
    expect(buildAutomationBody({ time: "16:00", days: [], action: "turn_on", entityIds: ["lock.front"] })).toBeNull();
    expect(buildAutomationBody({ time: "16:00", days: [], action: "turn_on", entityIds: ["script.goodnight"] })).toBeNull();
  });
});

describe("cancel and list", () => {
  test("cancel deletes the automation, tombstones the row, and works for the owner of the row only", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    expect(await cancelSchedule(ADULT, made.id, deps())).toEqual({ ok: false, reason: "not_found" });
    expect(ha.automations.size).toBe(1);
    expect(await cancelSchedule(OWNER, made.id, deps())).toEqual({ ok: true, automationRemoved: true });
    expect(ha.automations.size).toBe(0);
    const row = db.select().from(scheduledTasks).where(eq(scheduledTasks.id, made.id)).get()!;
    expect(row.deletedAt).not.toBeNull();
    expect(listOwnSchedules(OWNER)).toHaveLength(0);
  });

  test("a person lists only their own rows and an admin sees counts only", async () => {
    await createPorch();
    await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "device_action", targets: ["light.hall"], action: "turn_off", ...weekly }, deps());
    expect(listOwnSchedules(OWNER)).toHaveLength(1);
    expect(listOwnSchedules(ADULT)).toHaveLength(1);
    expect(JSON.stringify(listOwnSchedules(OWNER))).not.toContain("maipai_");
    expect(adminScheduleCount()).toEqual({ total: 2, active: 2, paused: 0 });
  });
});

describe("reconcile", () => {
  test("recreates a missing automation with the same reference and removes an orphan, never touching a hand-made one", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    const ref = db.select().from(scheduledTasks).get()!.externalRef!;
    ha.automations.delete(ref);
    ha.automations.set("maipai_0123456789abcdef", { alias: "stale" });
    const result = await reconcileSchedules("default", deps());
    expect(result).toEqual({ ran: true, report: { recreated: 1, orphansRemoved: 1, grantRevoked: 0, sceneChanged: 0, finished: 0 } });
    expect(ha.automations.has(ref)).toBe(true);
    expect(ha.automations.has("maipai_0123456789abcdef")).toBe(false);
    expect(ha.manual.has("manual_morning_lights")).toBe(true);
    expect(ha.requests.some((request) => request.path.includes("manual_morning_lights") || request.path.includes("abc123"))).toBe(false);
  });

  test("a revoked grant pauses the task and deletes its automation", async () => {
    grantedTo[ADULT] = ["light.porch"];
    const made = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "device_action", targets: ["light.porch"], action: "turn_on", ...weekly }, deps());
    if (!made.ok) throw new Error("setup");
    grantedTo[ADULT] = [];
    const result = await reconcileSchedules("default", deps());
    expect(result.ran && result.report.grantRevoked).toBe(0);
    const row = db.select().from(scheduledTasks).where(eq(scheduledTasks.id, made.id)).get()!;
    expect(row.state).toBe("paused");
    expect(row.pausedReason).toBe("grant_revoked");
    expect(row.externalRef).toBeNull();
    expect(ha.automations.size).toBe(0);
    const issue = db.select().from(issues).where(eq(issues.source, "schedules")).all();
    expect(issue.map((item) => item.key)).toEqual(["drift-grant-revoked"]);
  });

  test("a person who was demoted to teen loses the schedule too", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    db.update(people).set({ role: "teen" }).where(eq(people.id, OWNER)).run();
    await reconcileSchedules("default", deps());
    expect(db.select().from(scheduledTasks).get()!.pausedReason).toBe("grant_revoked");
    expect(ha.automations.size).toBe(0);
  });

  test("a scheduled scene that gains a sensitive member is paused with scene_changed", async () => {
    const made = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "scene", targets: ["scene.evening"], action: "activate", ...weekly }, deps());
    if (!made.ok) throw new Error("setup");
    entities = [PORCH, HALL, LOCK, SCENE(["light.porch", "light.hall", "lock.front"])];
    await reconcileSchedules("default", deps());
    const row = db.select().from(scheduledTasks).where(eq(scheduledTasks.id, made.id)).get()!;
    expect(row.state).toBe("paused");
    expect(row.pausedReason).toBe("scene_changed");
    expect(ha.automations.size).toBe(0);
    expect(db.select().from(issues).where(eq(issues.source, "schedules")).all().map((item) => item.key)).toEqual(["drift-scene-changed"]);
  });

  test("an unreadable registry or automation list changes nothing", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    grantedTo[OWNER] = [];
    ha.state.failStates = true;
    expect(await reconcileSchedules("default", deps())).toEqual({ ran: false, reason: "unreadable" });
    ha.state.failStates = false;
    await reconcileSchedules("default", deps({ loadRegistry: async () => ({ ok: false, kind: "unreachable" }) }));
    expect(db.select().from(scheduledTasks).get()!.state).toBe("active");
    expect(ha.automations.size).toBe(1);
  });

  test("a one-shot whose time has passed is finished and its automation removed", async () => {
    const made = await createPorch({ onceAt: "2026-11-06T21:00:00.000Z", time: undefined, days: undefined });
    if (!made.ok) throw new Error("setup");
    await reconcileSchedules("default", deps({ now: () => new Date("2026-11-07T00:00:00.000Z") }));
    expect(db.select().from(scheduledTasks).get()!.state).toBe("done");
    expect(ha.automations.size).toBe(0);
  });

  test("no Home Assistant address means nothing runs", async () => {
    expect(await reconcileSchedules("default", deps({ house: { read: () => undefined, fetch: ha.fetch } }))).toEqual({ ran: false, reason: "no_connection" });
  });
});

describe("the connect hook", () => {
  test("a connect reconciles; the registry cache's refresh is throttled and the events socket's connect is not", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    const ref = db.select().from(scheduledTasks).get()!.externalRef!;
    const off = registerScheduleReconcile(deps());
    ha.automations.delete(ref);
    emitHouseConnected("default", { force: true });
    for (let i = 0; i < 40 && !ha.automations.has(ref); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ha.automations.has(ref)).toBe(true);
    ha.automations.delete(ref);
    emitHouseConnected("default");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ha.automations.has(ref)).toBe(false);
    emitHouseConnected("default", { force: true });
    for (let i = 0; i < 40 && !ha.automations.has(ref); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ha.automations.has(ref)).toBe(true);
    off();
  });
});

describe("the hub executor", () => {
  async function hubTask() {
    ha.state.failWrites = true;
    const made = await createPorch({ days: [] });
    if (!made.ok) throw new Error("setup");
    ha.state.failWrites = false;
    return { id: made.id, job: db.select().from(scheduledJobs).all().find((job) => job.job === "schedules.device.fire")! as JobRow };
  }

  test("runs the action with the creator's access rechecked and queues the next run", async () => {
    const { job } = await hubTask();
    const performed: string[] = [];
    await fireHubDeviceTask(job, { ...deps(), perform: async (entity, action) => { performed.push(`${entity.id}:${action.name}`); return { ok: true, before: { state: "off", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "on", brightness: null, rgb: null, percentage: null, temperature: null }, undo: null }; } });
    expect(performed).toEqual(["light.porch:turn_on"]);
    expect(db.select().from(scheduledJobs).all().filter((item) => item.job === "schedules.device.fire")).toHaveLength(2);
  });

  test("a creator who lost access pauses the task instead of running it", async () => {
    const { id, job } = await hubTask();
    db.update(people).set({ role: "teen" }).where(eq(people.id, OWNER)).run();
    const performed: string[] = [];
    await fireHubDeviceTask(job, { ...deps(), perform: async (entity) => { performed.push(entity.id); return { ok: false, kind: "refused" }; } });
    expect(performed).toEqual([]);
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.pausedReason).toBe("grant_revoked");
  });

  test("a failed device is an error with plain text and no id", async () => {
    const { job } = await hubTask();
    let message = "";
    try { await fireHubDeviceTask(job, { ...deps(), perform: async () => ({ ok: false, kind: "unreachable" }) }); } catch (error) { message = String(error); }
    expect(message).not.toBe("");
    for (const id of [OWNER, "light.porch", "sched-", "person-", "default/"]) expect(message).not.toContain(id);
  });
});

describe("no ids in audit rows, Repairs issues or logs", () => {
  test("a full create, drift, pause and cancel run leaves none of the ids behind", async () => {
    const original = [console.log, console.warn, console.error, console.info];
    const record = (...args: unknown[]) => { consoleLines.push(args.map(String).join(" ")); };
    console.log = record; console.warn = record; console.error = record; console.info = record;
    try {
      const a = await createPorch();
      const b = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "scene", targets: ["scene.evening"], action: "activate", ...weekly }, deps());
      if (!a.ok || !b.ok) throw new Error("setup");
      const refs = db.select().from(scheduledTasks).all().map((row) => row.externalRef!);
      ha.automations.delete(refs[0]!);
      ha.automations.set("maipai_ffffffffffffffff", {});
      grantedTo[ADULT] = [];
      await reconcileSchedules("default", deps());
      await cancelSchedule(OWNER, a.id, deps());
      const secrets = [a.id, b.id, ...refs, "maipai_ffffffffffffffff", OWNER, ADULT, "light.porch", "scene.evening", "default/", "Porch"];
      const surfaces = [JSON.stringify(db.select().from(toolAudit).all()), JSON.stringify(db.select().from(issues).all()), consoleLines.join("\n")];
      for (const surface of surfaces) for (const secret of secrets) expect(surface).not.toContain(secret);
      const keys = db.select().from(issues).where(eq(issues.source, "schedules")).all();
      expect(keys.length).toBeGreaterThan(0);
      for (const issue of keys) expect(`${issue.title} ${issue.detail}`).toMatch(/\d/);
    } finally {
      [console.log, console.warn, console.error, console.info] = original as [typeof console.log, typeof console.warn, typeof console.error, typeof console.info];
    }
  });
});

describe("the Home Assistant events socket", () => {
  test("opening the socket tells the reconcile hook, forced", async () => {
    const { __resetHomeAssistantEventsForTests, __setHomeAssistantEventAdaptersForTests, subscribeHomeAssistantEntities } = await import("@/lib/integrations/homeAssistant");
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const { onHouseConnected } = await import("@/lib/house/connectHooks");
    const listeners = new Map<string, Array<(event: { data?: string }) => void>>();
    const socket = {
      readyState: 1, send: () => {}, close: () => {},
      addEventListener: (type: string, listener: (event: { data?: string }) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    };
    const message = (value: unknown) => { for (const listener of listeners.get("message") ?? []) listener({ data: JSON.stringify(value) }); };
    const seen: Array<{ instance: string; force: boolean }> = [];
    const off = onHouseConnected((instance, opts) => { seen.push({ instance, force: opts.force }); });
    __setHomeAssistantEventAdaptersForTests({ socket: () => socket as never, readState: async () => null });
    setHouseholdSettingValue("home.base_url", "http://homeassistant.local:8123");
    setHouseholdSettingValue("home.access_token", "test-ha-token");
    const unsubscribe = subscribeHomeAssistantEntities("sched-test", ["binary_sensor.door"], () => {});
    message({ type: "auth_required" }); message({ type: "auth_ok" }); message({ type: "result", id: 1, success: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual([{ instance: "default", force: true }]);
    unsubscribe(); off(); __resetHomeAssistantEventsForTests();
  });
});


// ---- Review fixes (SCHED-02 part A, second pass) ----
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

describe("access changes stop automations at once", () => {
  function putGrant(id: string, personId: string, action: string): void {
    const now = "2026-11-06T00:00:00.000Z";
    db.insert(grants).values({ id, person: personId, action, effect: "allow", grantedByPersonId: OWNER, createdAt: now, updatedAt: now, hlc: "1:0:testnode" }).run();
  }

  test("revoking a house grant pauses the task and deletes the automation without any reconnect", async () => {
    const made = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "device_action", targets: ["light.porch"], action: "turn_on", ...weekly }, deps());
    if (!made.ok) throw new Error("setup");
    registerScheduleRecheck(deps());
    putGrant("grant-hhhhhh", ADULT, "house.control:default/entity:light.porch");
    putGrant("grant-nnnnnn", ADULT, "backups.run");
    const { revokeGrant } = await import("@/lib/grants");
    // A grant that is not a house grant does not recheck.
    grantedTo[ADULT] = [];
    revokeGrant("grant-nnnnnn");
    await settle();
    expect(ha.automations.size).toBe(1);
    revokeGrant("grant-hhhhhh");
    for (let i = 0; i < 40 && ha.automations.size > 0; i++) await settle(10);
    expect(ha.automations.size).toBe(0);
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, made.id)).get()!.pausedReason).toBe("grant_revoked");
  });

  test("a role change recheck pauses a demoted person's task, and the periodic pass does nothing when no automation task exists", async () => {
    expect(await reconcileAllInstances(deps())).toBeUndefined();
    expect(ha.requests).toHaveLength(0);
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    ha.requests.length = 0;
    registerScheduleRecheck(deps());
    db.update(people).set({ role: "teen" }).where(eq(people.id, OWNER)).run();
    emitScheduleRecheck();
    for (let i = 0; i < 40 && ha.automations.size > 0; i++) await settle(10);
    expect(ha.automations.size).toBe(0);
    // Cheap: one list read, one registry read (injected here), no per-task calls beyond the delete and reload.
    expect(ha.requests.filter((request) => request.path === "/api/template")).toHaveLength(1);
  });

  test("the periodic pass reconciles every instance when a task exists", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    const ref = db.select().from(scheduledTasks).get()!.externalRef!;
    ha.automations.delete(ref);
    await reconcileAllInstances(deps());
    expect(ha.automations.has(ref)).toBe(true);
  });
});

describe("listing through the fixed template", () => {
  test("never reads /api/states, and a truncated answer changes nothing and raises one count-free issue that clears on the next good read", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    ha.requests.length = 0;
    ha.state.truncateTemplate = true;
    expect(await reconcileSchedules("default", deps())).toEqual({ ran: false, reason: "unreadable" });
    expect(ha.automations.size).toBe(1);
    let rows = db.select().from(issues).where(eq(issues.source, "schedules")).all();
    expect(rows.map((row) => row.key)).toEqual(["schedules_unreadable"]);
    expect(`${rows[0]!.title} ${rows[0]!.detail}`).not.toMatch(/\d/);
    ha.state.truncateTemplate = false;
    await reconcileSchedules("default", deps());
    rows = db.select().from(issues).where(eq(issues.source, "schedules")).all().filter((row) => row.resolvedAt === null);
    expect(rows).toHaveLength(0);
    expect(ha.requests.some((request) => request.path === "/api/states")).toBe(false);
    const template = ha.requests.find((request) => request.path === "/api/template")!;
    expect(template.method).toBe("POST");
    expect(JSON.parse(template.body)).toEqual({ template: expect.stringContaining("maipai_") });
  });

  test("no other template body can be sent", async () => {
    const { createAutomation: unusedCreate, listMaipaiAutomationIds } = await import("@/lib/house/automations");
    void unusedCreate;
    const sent: string[] = [];
    const lanFetch = async (path: string, init?: { body?: unknown }) => { sent.push(`${path} ${String(init?.body)}`); return { ok: true as const, status: 200, text: "[]", truncated: false }; };
    expect((await listMaipaiAutomationIds({ lanFetch, token: "t" })).ok).toBe(true);
    expect(sent).toHaveLength(1);
    const { LIST_TEMPLATE_BODY } = await import("@/lib/house/automations");
    expect(sent[0]).toBe(`/api/template ${LIST_TEMPLATE_BODY}`);
  });
});

describe("a second Home Assistant instance", () => {
  function addInstance(slug: string): void {
    const now = "2026-11-06T00:00:00.000Z";
    db.insert(integrations).values({ id: `integ-${slug}00000`, type: "home_assistant", instance: slug, label: slug, address: "http://192.168.1.21:8123", credentialRef: "home.access_token", options: "{}", provenance: "test", createdAt: now, updatedAt: now, hlc: "1:0:testnode" }).run();
  }
  const upstairs = [light("light.den", "Den", { instance: "upstairs", instanceLabel: "Upstairs" })];
  const registryTwo = async (): Promise<HouseRegistryResult> => ({ ok: true, areas: [], entities: upstairs });

  test("a revoked grant on the second instance pauses the task", async () => {
    addInstance("upstairs");
    grantedTo[ADULT] = [];
    const permissions = (personId: string): EffectivePermission[] => personId === ADULT && grantedTo[ADULT]!.length === 0 && state.granted ? ["see", "control"].map((level) => ({ action: `house.${level}:upstairs/entity:light.den`, effect: "allow" as const })) : [];
    const state = { granted: true };
    const d = deps({ loadRegistry: registryTwo, permissionsOf: permissions });
    const made = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "device_action", targets: ["upstairs/light.den"], action: "turn_on", ...weekly }, d);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.executor).toBe("home_assistant");
    state.granted = false;
    const result = await reconcileSchedules("upstairs", d);
    expect(result.ran).toBe(true);
    const row = db.select().from(scheduledTasks).where(eq(scheduledTasks.id, made.id)).get()!;
    expect(row.pausedReason).toBe("grant_revoked");
    expect(ha.automations.size).toBe(0);
  });

  test("the registry the reconciler loads carries the instance on every entity", async () => {
    addInstance("upstairs");
    const { loadScheduleRegistry } = await import("@/lib/schedules/guard");
    const { __setHouseRegistryCacheDepsForTests, clearHouseRegistry } = await import("@/lib/house/cache");
    clearHouseRegistry();
    __setHouseRegistryCacheDepsForTests({ read: HOUSE_SETTINGS, fetch: async (_url, init) => new Response(JSON.parse(String(init.body)).template.includes("states") ? JSON.stringify([{ id: "light.den", name: "Den", state: "off", area: "", dc: "", rgb: [], bri: 0, ents: [] }]) : "[]") });
    const loaded = await loadScheduleRegistry(["upstairs"]);
    clearHouseRegistry();
    expect(loaded.ok && loaded.entities.map((entity) => `${entity.instance}/${entity.id}`)).toEqual(["upstairs/light.den"]);
  });
});

describe("a registry that cannot answer is not a revoked grant", () => {
  test("the hub executor skips an unknown target and a scene with a missing member, and queues the next run", async () => {
    ha.state.failWrites = true;
    const made = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "scene", targets: ["scene.evening"], action: "activate", ...weekly }, deps());
    if (!made.ok) throw new Error("setup");
    ha.state.failWrites = false;
    const job = db.select().from(scheduledJobs).all().find((item) => item.job === "schedules.device.fire")! as JobRow;
    const performed: string[] = [];
    const perform = async (entity: HouseEntity) => { performed.push(entity.id); return { ok: false as const, kind: "refused" as const }; };
    entities = [PORCH, SCENE(["light.porch", "light.hall"])]; // light.hall is briefly missing
    await fireHubDeviceTask(job, { ...deps(), perform });
    entities = [PORCH, HALL]; // the scene itself is missing
    await fireHubDeviceTask(job, { ...deps(), perform });
    expect(performed).toEqual([]);
    expect(db.select().from(scheduledTasks).get()!.state).toBe("active");
    expect(db.select().from(scheduledJobs).all().filter((item) => item.job === "schedules.device.fire").length).toBe(3);
  });

  test("reconcile keeps a scheduled scene and its automation while a member is missing, and pauses only when a present member turns sensitive", async () => {
    const made = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "scene", targets: ["scene.evening"], action: "activate", ...weekly }, deps());
    if (!made.ok) throw new Error("setup");
    entities = [PORCH, SCENE(["light.porch", "light.hall"])]; // Home Assistant is restarting: light.hall not back yet
    await reconcileSchedules("default", deps());
    expect(db.select().from(scheduledTasks).get()!.state).toBe("active");
    expect(ha.automations.size).toBe(1);
    entities = [PORCH, light("light.hall", "Hall", { sensitive: "lock" }), SCENE(["light.porch", "light.hall"])];
    await reconcileSchedules("default", deps());
    expect(db.select().from(scheduledTasks).get()!.pausedReason).toBe("scene_changed");
  });

  test("a scene with an unreadable member list cannot be created yet, and says to try again", async () => {
    entities = [PORCH, { ...SCENE([]), sceneMembers: null }];
    const result = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "scene", targets: ["scene.evening"], action: "activate", ...weekly }, deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unavailable");
  });
});

describe("time zones", () => {
  test("a Home Assistant in another zone, or one whose zone cannot be read, gets the hub executor", async () => {
    ha.state.timeZone = "America/Los_Angeles";
    const other = await createPorch();
    ha.state.timeZone = null;
    const unreadable = await createPorch();
    expect(other.ok && other.executor).toBe("hub");
    expect(unreadable.ok && unreadable.executor).toBe("hub");
    expect(ha.automations.size).toBe(0);
  });

  test("reconcile rebuilds a one-shot from the task's stored zone, not the person's current zone", async () => {
    const made = await createPorch({ onceAt: "2026-11-08T21:30:00.000Z", time: undefined, days: undefined });
    if (!made.ok) throw new Error("setup");
    const ref = db.select().from(scheduledTasks).get()!.externalRef!;
    const original = JSON.stringify(ha.automations.get(ref));
    ha.automations.delete(ref);
    await reconcileSchedules("default", deps({ zoneOf: () => "Asia/Tokyo" }));
    expect(JSON.stringify(ha.automations.get(ref))).toBe(original);
  });

  test("reconcile does not rebuild an automation when Home Assistant's zone is not the task's", async () => {
    const made = await createPorch();
    if (!made.ok) throw new Error("setup");
    const ref = db.select().from(scheduledTasks).get()!.externalRef!;
    ha.automations.delete(ref);
    ha.state.timeZone = "Europe/Paris";
    await reconcileSchedules("default", deps());
    expect(ha.automations.has(ref)).toBe(false);
  });
});

describe("a create that times out after Home Assistant wrote it", () => {
  test("the automation is deleted before the hub fallback, so it cannot fire twice", async () => {
    ha.state.writeThenTimeout = true;
    const result = await createPorch();
    expect(result.ok && result.executor).toBe("hub");
    expect(ha.automations.size).toBe(0);
    expect(ha.requests.some((request) => request.method === "DELETE")).toBe(true);
  });
});

describe("DELETE on lanFetch", () => {
  test("is refused unless the connection asked for it", async () => {
    const { createLanFetch } = await import("@/lib/lanFetch");
    const calls: string[] = [];
    const fetcher = async (_url: string, init: RequestInit) => { calls.push(String(init.method)); return new Response("ok"); };
    const plain = createLanFetch({ host: "192.168.1.20", port: 8123 }, { fetch: fetcher });
    expect(await plain("/x", { method: "DELETE" })).toEqual({ ok: false, kind: "refused" });
    expect(calls).toEqual([]);
    const allowed = createLanFetch({ host: "192.168.1.20", port: 8123, allowDelete: true }, { fetch: fetcher });
    expect((await allowed("/x", { method: "DELETE" })).ok).toBe(true);
    expect(calls).toEqual(["DELETE"]);
  });

  test("only the automation client's connection carries allowDelete", async () => {
    const { houseInstanceLanFetch } = await import("@/lib/house/connection");
    const refused = houseInstanceLanFetch("default", { read: HOUSE_SETTINGS, fetch: ha.fetch });
    if (!refused.ok) throw new Error("setup");
    expect(await refused.lanFetch("/api/config/automation/config/maipai_0123456789abcdef", { method: "DELETE", headers: { Authorization: "Bearer fake-ha-token" } })).toEqual({ ok: false, kind: "refused" });
    expect(ha.requests).toHaveLength(0);
  });
});

describe("a hub one-shot is done only after it fires", () => {
  const AT = "2026-11-06T20:30:00.000Z";
  async function hubOnce() {
    ha.state.failWrites = true;
    const made = await createPorch({ onceAt: AT, time: undefined, days: undefined });
    if (!made.ok) throw new Error("setup");
    ha.state.failWrites = false;
    return { id: made.id, job: db.select().from(scheduledJobs).all().find((item) => item.job === "schedules.device.fire")! as JobRow };
  }
  const fireJobs = () => db.select().from(scheduledJobs).all().filter((item) => item.job === "schedules.device.fire");
  const ok = async () => ({ ok: true as const, before: { state: "off", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "on", brightness: null, rgb: null, percentage: null, temperature: null }, undo: null });

  test("a run skipped because Home Assistant did not answer keeps it active and tries again", async () => {
    const { id, job } = await hubOnce();
    let message = "";
    try { await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T20:30:10.000Z") }), loadRegistry: async () => ({ ok: false, kind: "unreachable" }) }); } catch (error) { message = String(error); }
    expect(message).not.toBe("");
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state).toBe("active");
    expect(fireJobs()).toHaveLength(2);
  });

  test("a retry that finds the device then fires it and marks the task done", async () => {
    const { id, job } = await hubOnce();
    const performed: string[] = [];
    await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T20:36:00.000Z") }), perform: async (entity) => { performed.push(entity.id); return ok(); } });
    expect(performed).toEqual(["light.porch"]);
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state).toBe("done");
  });

  test("an unknown target keeps it active inside the grace and ends it with no action after 30 minutes", async () => {
    const { id, job } = await hubOnce();
    entities = [HALL];
    const performed: string[] = [];
    const perform = async (entity: HouseEntity) => { performed.push(entity.id); return ok(); };
    await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T20:35:00.000Z") }), perform });
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state).toBe("active");
    await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T21:01:00.000Z") }), perform });
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state).toBe("done");
    expect(performed).toEqual([]);
  });

  test("it is claimed (done) before the device action runs, so a crash mid-run cannot fire it twice", async () => {
    const { id, job } = await hubOnce();
    let stateDuringRun = "";
    await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T20:31:00.000Z") }), perform: async () => { stateDuringRun = db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state; return ok(); } });
    expect(stateDuringRun).toBe("done");
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state).toBe("done");
  });

  test("a device that cannot be reached leaves it failed with no retry left", async () => {
    const { id, job } = await hubOnce();
    let message = "";
    try { await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T20:31:00.000Z") }), perform: async () => ({ ok: false, kind: "unreachable" }) }); } catch (error) { message = String(error); }
    expect(message).not.toBe("");
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state).toBe("failed");
    expect(fireJobs().filter((item) => item.status === "pending" && item.id !== job.id)).toHaveLength(0);
  });

  test("a perform that throws leaves it failed, not active with nothing pending, and cancels a queued retry", async () => {
    const { id, job } = await hubOnce();
    // An earlier skipped attempt queued a retry.
    await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T20:30:10.000Z") }), loadRegistry: async () => ({ ok: false, kind: "unreachable" }) }).catch(() => {});
    expect(fireJobs().filter((item) => item.status === "pending")).toHaveLength(2);
    let message = "";
    try { await fireHubDeviceTask(job, { ...deps({ now: () => new Date("2026-11-06T20:31:00.000Z") }), perform: async () => { throw new Error("socket closed for light.porch"); } }); } catch (error) { message = String(error); }
    expect(message).not.toContain("light.porch");
    expect(db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!.state).toBe("failed");
    expect(fireJobs().filter((item) => item.status === "pending" && item.id !== job.id)).toHaveLength(0);
  });
});
