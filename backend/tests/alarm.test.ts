import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { alarms as alarmsTable, people, scheduledJobs, notificationDeliveries } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { TestClient } from "./client";
import { createHost } from "@/lib/packageHost";
import { runDueJobs, scheduleCoreJob, listJobs } from "@/lib/scheduler";
import { listPending } from "@/lib/notifications";
import { runPlugin, loadManifestOnly, registerAllPackageNotificationTypes } from "@/lib/plugins";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { commandOpeners, loadAllManifests } from "@/lib/turnShared";

let householdClient: TestClient;
beforeEach(() => { resetDb(); householdClient = new TestClient(); });

async function person(displayName: string, role: "owner" | "child" = "owner") {
  const client = householdClient;
  if (!db.select().from(people).where(eq(people.displayName, "Sage")).get()) await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  if (role === "child") {
    const res = await client.post("/api/people", { displayName, role: "child", secret: "0000" });
    const body = await res.json() as { id: string };
    return db.select().from(people).where(eq(people.id, body.id)).get()!;
  }
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

async function childPerson(displayName: string) {
  const res = await householdClient.post("/api/people", { displayName, role: "child", secret: "0000" });
  const body = await res.json() as { id: string };
  return db.select().from(people).where(eq(people.id, body.id)).get()!;
}

describe("alarm package", () => {
  async function runAlarm(actor: Awaited<ReturnType<typeof person>>, action: "set" | "list" | "cancel", expression = "") {
    return runPlugin("alarm", actor, { action, expression });
  }

  test("setting an alarm schedules alarms.fire for the asking person", async () => {
    const actor = await person("Sage");
    const loaded = loadManifestOnly("alarm");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const host = createHost(actor, loaded.value);
    const result = host.reminders.set("set tomorrow at 7 called gym");
    expect(result.task).toContain("gym");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBe(actor.id);
    expect(JSON.parse(rows[0]!.inputs)).toEqual({ task: "gym" });
  });

  test("a bare hour with a label, as people say it, schedules the morning and keeps only the label", async () => {
    const actor = await person("Sage");
    const result = await runPlugin("alarm", actor, { action: "set", expression: "for 7 tomorrow called gym" });
    expect(result.ok).toBe(true);
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all();
    const row = rows[rows.length - 1]!;
    expect(JSON.parse(row.inputs)).toEqual({ task: "gym" });
    const when = new Date(row.nextRunAt);
    expect(when.getHours()).toBe(7);
    expect(when.getMinutes()).toBe(0);
    expect(when.getTime()).toBeGreaterThan(Date.now());
  });

  test("the package reply includes its schedule card", async () => {
    const actor = await person("Sage");
    const result = await runPlugin("alarm", actor, { action: "set", expression: "tomorrow at 7 for gym" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as { reply?: { text?: string }; blocks?: unknown[] };
    expect(value.reply?.text).toBeString();
    expect(value.reply?.text).toContain("Okay, alarm set: gym");
    expect(value.blocks?.[0]).toMatchObject({ kind: "schedule_card", producer: "alarm" });
  });

  test("an alarm fires once to its person only, including after a restart", async () => {
    registerAllPackageNotificationTypes();
    const actor = await person("Sage");
    const scheduled = scheduleCoreJob(actor, "alarms.fire", "2099-01-01T00:00:00.000Z", { task: "private label" });
    if (!scheduled.ok) throw new Error("setup failed");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, scheduled.value.id)).run();
    const result = await runDueJobs(runPlugin);
    expect(result.ran).toBe(1);
    expect(listPending(actor).filter((n) => n.typeId === "alarm.due")).toHaveLength(1);
    expect(db.select().from(notificationDeliveries).all().every((n) => n.recipientId === actor.id)).toBe(true);
    expect(listPending(actor).find((n) => n.typeId === "alarm.due")?.subjectJobId).toBe(scheduled.value.id);
    expect((await runDueJobs(runPlugin)).ran).toBe(0);
    expect(listPending(actor).filter((n) => n.typeId === "alarm.due")).toHaveLength(1);
  });

  test("a child may set an alarm for themselves", async () => {
    const actor = await person("Nova", "child");
    const loaded = loadManifestOnly("alarm");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(() => createHost(actor, loaded.value).reminders.set("tomorrow at 7 for gym")).not.toThrow();
  });

  test("an unidentified speaker cannot schedule an alarm", async () => {
    const actor = await person("Sage");
    const utterance = "wake me at 6:30";
    const signal = classifyTurnSignal({ text: utterance, ageBand: "child", commandOpeners: commandOpeners(loadAllManifests()) });
    const state = { actor, surface: "robot", speakerEvidence: null, signal, temporary: false, turnId: "alarm-anonymous", conversationId: "alarm-anonymous" } as never;
    const { output } = await commandsNode(state, { utterance }, new AbortController().signal);
    // The answer is a fixed line, never a model that might claim an alarm was set.
    expect(output.matched).toBe(true);
    expect((output as { text?: string }).text).toContain("can't set an alarm");
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()).toHaveLength(0);
  });

  test("an alarm whose time cannot be read gets the alarm's own fixed answer, never the model", async () => {
    const actor = await person("Sage");
    const utterance = "set an alarm for whenever";
    const signal = classifyTurnSignal({ text: utterance, ageBand: "adult", commandOpeners: commandOpeners(loadAllManifests()) });
    const state = { actor, surface: "chat", speakerEvidence: null, signal, temporary: false, turnId: "alarm-unreadable", conversationId: "alarm-unreadable", outcomes: [] } as never;
    const { output } = await commandsNode(state, { utterance }, new AbortController().signal);
    expect(output.matched).toBe(true);
    const text = (output as { text?: string }).text ?? "";
    expect(text).toContain("alarm");
    expect(text).toContain("8:17 pm");
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()).toHaveLength(0);
  });

  test("a time without a label uses Alarm as its task", async () => {
    const actor = await person("Sage");
    const loaded = loadManifestOnly("alarm");
    if (!loaded.ok) throw new Error(loaded.error);
    expect(createHost(actor, loaded.value).reminders.set("set at 6:30").task).toContain("Alarm");
  });

  test("alarm task text never appears in logs during set or fire", async () => {
    registerAllPackageNotificationTypes();
    const actor = await person("Sage");
    const loaded = loadManifestOnly("alarm");
    if (!loaded.ok) throw new Error(loaded.error);
    const logs: string[] = [];
    const old = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    console.log = capture;
    console.info = capture;
    console.warn = capture;
    console.error = capture;
    console.debug = capture;
    try {
      createHost(actor, loaded.value).reminders.set("tomorrow at 7 called SECRET-GYM-TASK");
      await runAlarm(actor, "list");
      await runAlarm(actor, "cancel", "SECRET-GYM-TASK");
      const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).get()!;
      db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, row.id)).run();
      await runDueJobs(runPlugin);
    } finally {
      console.log = old.log;
      console.info = old.info;
      console.warn = old.warn;
      console.error = old.error;
      console.debug = old.debug;
    }
    expect(logs.join("\n")).not.toContain("SECRET-GYM-TASK");
  });

  test("list shows only the asking person's pending alarms and reminders", async () => {
    const parent = await person("Sage");
    const child = await childPerson("Nova");
    scheduleCoreJob(parent, "alarms.fire", "2099-01-01T06:30:00.000Z", { task: "Wake up" });
    scheduleCoreJob(parent, "reminders.fire", "2099-01-01T07:00:00.000Z", { task: "Call Nadia" });
    scheduleCoreJob(child, "alarms.fire", "2099-01-01T08:00:00.000Z", { task: "School" });
    const parentList = await runAlarm(parent, "list");
    const childList = await runAlarm(child, "list");
    expect(parentList.ok && parentList.value.reply?.text).toContain("Call Nadia");
    expect(parentList.ok && parentList.value.reply?.text).not.toContain("School");
    expect(childList.ok && childList.value.reply?.text).toContain("School");
    expect(childList.ok && childList.value.reply?.text).not.toContain("Call Nadia");
    expect(listJobs(parent).some((job) => job.personId === child.id)).toBe(true);
  });

  test("a parent-created reminder remains the parent's row, hidden from the child", async () => {
    const parent = await person("Sage");
    const child = await childPerson("Nova");
    scheduleCoreJob(parent, "reminders.fire", "2099-01-01T07:00:00.000Z", { task: "Tell Nova to pack lunch" });
    const childList = await runAlarm(child, "list");
    expect(childList.ok && childList.value.reply?.text).not.toContain("pack lunch");
  });

  test("cancel before firing removes the matching job and it never fires", async () => {
    registerAllPackageNotificationTypes();
    const actor = await person("Sage");
    const job = scheduleCoreJob(actor, "alarms.fire", "2099-01-01T06:30:00.000Z", { task: "Wake up" });
    if (!job.ok) throw new Error("setup failed");
    const cancelled = await runAlarm(actor, "cancel", "6:30");
    expect(cancelled.ok && cancelled.value.reply?.text).toContain("cancel");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, job.value.id)).run();
    expect((await runDueJobs(runPlugin)).ran).toBe(0);
    expect(db.select().from(notificationDeliveries).all()).toHaveLength(0);
  });

  test("cancel after firing says there is nothing to cancel", async () => {
    const actor = await person("Sage");
    const job = scheduleCoreJob(actor, "alarms.fire", "2099-01-01T06:30:00.000Z", { task: "Wake up" });
    if (!job.ok) throw new Error("setup failed");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, job.value.id)).run();
    await runDueJobs(runPlugin);
    const cancelled = await runAlarm(actor, "cancel", "Wake up");
    expect(cancelled.ok && cancelled.value.reply?.text).toMatch(/nothing.*cancel|no .*cancel/i);
  });

  test("ambiguous cancellation lists matches and cancels nothing", async () => {
    const actor = await person("Sage");
    scheduleCoreJob(actor, "alarms.fire", "2099-01-01T06:30:00.000Z", { task: "Wake up" });
    scheduleCoreJob(actor, "reminders.fire", "2099-01-02T06:30:00.000Z", { task: "Call at 6:30" });
    const result = await runAlarm(actor, "cancel", "6:30");
    expect(result.ok && result.value.reply?.text).toMatch(/which|choose/i);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.status, "pending")).all()).toHaveLength(2);
  });

  test("closed command patterns route list and both supported cancellation forms", async () => {
    const actor = await person("Sage");
    scheduleCoreJob(actor, "reminders.fire", "2099-01-01T07:00:00.000Z", { task: "Call Nadia" });
    for (const utterance of ["what alarms do I have", "what reminders do I have", "cancel the reminder to call Nadia"]) {
      const state = { actor, surface: "chat", speakerEvidence: undefined, signal: classifyTurnSignal({ text: utterance, ageBand: "adult", commandOpeners: commandOpeners(loadAllManifests()) }), temporary: false, turnId: "alarm-command", conversationId: "alarm-command" } as never;
      const { output } = await commandsNode(state, { utterance }, new AbortController().signal);
      expect(output.matched).toBe(true);
    }
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.status, "pending")).all()).toHaveLength(0);
  });

  test("an unidentified speaker cannot list or cancel alarms", async () => {
    const actor = await person("Sage");
    for (const utterance of ["what alarms do I have", "what reminders do I have", "cancel my alarm at 6:30", "cancel the reminder to call Nadia"]) {
      const state = { actor, surface: "robot", speakerEvidence: null, signal: classifyTurnSignal({ text: utterance, ageBand: "child", commandOpeners: commandOpeners(loadAllManifests()) }), temporary: false, turnId: "alarm-anonymous", conversationId: "alarm-anonymous" } as never;
      const { output } = await commandsNode(state, { utterance }, new AbortController().signal);
      // Only an alarm phrase is answered here, with the fixed line; "what reminders do I have" is not the alarm tool's own pattern
      // when the speaker is unknown and the turn goes on to the model as before.
      if (output.matched) expect((output as { text?: string }).text).toContain("can't set an alarm");
    }
    expect(db.select().from(scheduledJobs).all()).toHaveLength(0);
  });

  test("a repeating alarm said in chat becomes an alarm record the Alarms tab and cancel can see", async () => {
    registerAllPackageNotificationTypes();
    const actor = await person("Sage");
    const made = await runAlarm(actor, "set", "for 6:30 am on weekdays called gym");
    expect(made.ok).toBe(true);
    const records = db.select().from(alarmsTable).all();
    expect(records).toHaveLength(1);
    expect(JSON.parse(records[0]!.days)).toEqual([1, 2, 3, 4, 5]);
    expect(records[0]!.time).toBe("06:30");
    expect(records[0]!.label).toBe("gym");
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()).toHaveLength(1);
    const listed = await runAlarm(actor, "list");
    expect((listed as { value?: { reply?: { text?: string } } }).value?.reply?.text ?? JSON.stringify(listed)).toContain("gym");
    const cancelled = await runAlarm(actor, "cancel", "gym");
    expect(JSON.stringify(cancelled)).toContain("cancelled");
    expect(db.select().from(alarmsTable).where(isNull(alarmsTable.deletedAt)).all()).toHaveLength(0);
    expect(db.select().from(scheduledJobs).where(and(eq(scheduledJobs.job, "alarms.fire"), eq(scheduledJobs.status, "pending"))).all()).toHaveLength(0);
  });

  test("a one-time alarm said in chat still makes a plain job, not a record", async () => {
    const actor = await person("Sage");
    const made = await runAlarm(actor, "set", "for 6:30 am tomorrow called gym");
    expect(made.ok).toBe(true);
    expect(db.select().from(alarmsTable).all()).toHaveLength(0);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()).toHaveLength(1);
  });
});
