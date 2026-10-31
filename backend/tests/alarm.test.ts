import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { alarms as alarmsTable, people, scheduledJobs, notificationDeliveries, toolAudit } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { TestClient } from "./client";
import { runDueJobs, scheduleCoreJob, listJobs } from "@/lib/scheduler";
import { listPending } from "@/lib/notifications";
import { runPlugin, loadManifestOnly, registerAllPackageNotificationTypes } from "@/lib/plugins";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { commandOpeners, loadAllManifests } from "@/lib/turnShared";
import { getNotificationType } from "@/lib/notificationTypes";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import type { TurnState } from "@/lib/turnMachine/contract";
import { listPackageIds } from "@/lib/plugins";

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

// ASSIST-REMIND-01: the alarm phrases run through `timer` (and the reminder cancel and list phrases through `remind`).
describe("alarms through the timer package", () => {
  const ACTIONS = { set: "set_alarm", list: "list_alarms", cancel: "cancel_alarm" } as const;
  async function runAlarm(actor: Awaited<ReturnType<typeof person>>, action: "set" | "list" | "cancel", expression = "alarms") {
    return runPlugin("timer", actor, { action: ACTIONS[action], expression });
  }

  test("setting an alarm schedules alarms.fire for the asking person", async () => {
    const actor = await person("Sage");
    const result = await runAlarm(actor, "set", "tomorrow at 7 called gym");
    expect(result.ok && result.value.reply?.text).toContain("gym");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBe(actor.id);
    expect(JSON.parse(rows[0]!.inputs)).toEqual({ task: "gym" });
  });

  test("a bare hour with a label, as people say it, schedules the morning and keeps only the label", async () => {
    const actor = await person("Sage");
    const result = await runAlarm(actor, "set", "for 7 tomorrow called gym");
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
    const result = await runAlarm(actor, "set", "tomorrow at 7 for gym");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as { reply?: { text?: string }; blocks?: unknown[] };
    expect(value.reply?.text).toBeString();
    expect(value.reply?.text).toContain("Okay, alarm set: gym");
    expect(value.blocks?.[0]).toMatchObject({ kind: "schedule_card", producer: "timer" });
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
    const result = await runAlarm(actor, "set", "tomorrow at 7 for gym");
    expect(result.ok).toBe(true);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()[0]!.personId).toBe(actor.id);
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
    const result = await runAlarm(actor, "set", "at 6:30");
    expect(result.ok && result.value.data?.task).toContain("Alarm");
  });

  test("alarm task text never appears in logs during set or fire", async () => {
    registerAllPackageNotificationTypes();
    const actor = await person("Sage");
    const logs: string[] = [];
    const old = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    console.log = capture;
    console.info = capture;
    console.warn = capture;
    console.error = capture;
    console.debug = capture;
    try {
      await runAlarm(actor, "set", "tomorrow at 7 called SECRET-GYM-TASK");
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


// ASSIST-REMIND-01: what the port of the alarm package into timer (and its reminder phrases into remind) must keep.
describe("the alarm port into timer", () => {
  const abort = new AbortController().signal;
  const ACTION_NAMES = { set: "set_alarm", list: "list_alarms", cancel: "cancel_alarm" } as const;
  async function runAlarm(actor: Awaited<ReturnType<typeof person>>, action: "set" | "list" | "cancel", expression = "alarms") {
    return runPlugin("timer", actor, { action: ACTION_NAMES[action], expression });
  }

  async function say(utterance: string, anonymous: boolean) {
    const actor = await person("Sage");
    const signal = classifyTurnSignal({ text: utterance, ageBand: anonymous ? "child" : "adult", commandOpeners: commandOpeners(loadAllManifests()) });
    const state = { actor, surface: anonymous ? "robot" : "chat", speakerEvidence: anonymous ? null : undefined, signal, temporary: false, turnId: "port", conversationId: "port", outcomes: [], toolEvents: [] } as never;
    return (await commandsNode(state, { utterance }, abort)).output as { matched: boolean; text?: string; blockEvents?: Array<{ block?: { kind?: string; props?: Record<string, unknown>; producer?: string } }> };
  }

  test("the alarm package is gone and each alarm and reminder operation lives in exactly one tool", () => {
    expect(listPackageIds()).not.toContain("alarm");
    const owners = (pattern: string) => loadAllManifests().filter((l) => l.manifest.routing?.patterns?.includes(pattern)).map((l) => l.manifest.id);
    for (const pattern of ["wake me *", "set an alarm *", "cancel my alarm *", "cancel my * alarm", "what alarms do I have", "set a timer for *"]) {
      expect(owners(pattern)).toEqual(["timer"]);
    }
    for (const pattern of ["cancel the reminder *", "what reminders do I have", "remind me *"]) expect(owners(pattern)).toEqual(["remind"]);
  });

  test("timer keeps its base offer and its model-visible args do not widen", () => {
    const loaded = loadManifestOnly("timer");
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.value.offer).toEqual({ mode: "base", priority: 7 });
    expect(loaded.value.args).toEqual({ type: "object", required: ["expression"], properties: { expression: { type: "string", minLength: 1 } } });
    expect(loaded.value.permissions).toEqual(["timers:write", "reminders:write"]);
    expect(loaded.value.returns_blocks).toEqual(["schedule_card", "confirmation"]);
  });

  test("alarm.due keeps its id and defaults and is registered from timer's manifest", () => {
    const loaded = loadManifestOnly("timer");
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.value.notifications).toContainEqual({ id: "alarm.due", level: "time_sensitive", audience: "person", template: "Alarm: {task}", configurable: true, default_channels: ["in_app"] });
    registerAllPackageNotificationTypes();
    expect(getNotificationType("alarm.due")).toMatchObject({ id: "alarm.due", level: "time_sensitive", audience: "person", template: "Alarm: {task}", configurable: true, defaultChannels: ["in_app"] });
    expect(getNotificationType("timer.done")).toBeDefined();
  });

  test("an alarm phrase through timer keeps the old reply and returns the alarm card with its cadence", async () => {
    const weekdays = await runPlugin("timer", await person("Sage"), { action: "set_alarm", expression: "for 6:30 am on weekdays called gym" });
    if (!weekdays.ok) throw new Error(weekdays.error);
    expect(weekdays.value.reply?.text).toBe("Okay, alarm set: gym (weekdays at 6:30 AM).");
    expect(weekdays.value.data).toMatchObject({ action: "set", schedule_task: "gym", when_text: "weekdays at 6:30 AM" });
    const card = (weekdays.value as { blocks?: Array<{ kind: string; producer: string; props: Record<string, unknown> }> }).blocks ?? [];
    expect(card).toHaveLength(1);
    expect(card[0]).toMatchObject({ kind: "schedule_card", producer: "timer", props: { name: "gym", cadence: "Weekdays", nextRun: "weekdays at 6:30 AM" } });
    const once = await runPlugin("timer", await person("Sage"), { action: "set_alarm", expression: "for 6:30 am tomorrow called run" });
    const onceCard = (once.ok ? (once.value as { blocks?: Array<{ props: Record<string, unknown> }> }).blocks : undefined) ?? [];
    expect(onceCard[0]?.props.cadence).toBe("Once");
  });

  test("a plain timer is unchanged: its reply, its card and its Undo receipt", async () => {
    const result = await runPlugin("timer", await person("Sage"), { expression: "ten minutes" });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.reply?.text).toMatch(/^Timer set: ten minutes/);
    const kinds = ((result.value as { blocks?: Array<{ kind: string }> }).blocks ?? []).map((block) => block.kind);
    expect(kinds).toEqual(["schedule_card", "confirmation"]);
    expect(db.select().from(toolAudit).all().filter((row) => row.tool === "timer")).toHaveLength(0);
  });

  test("an alarm action through the host writes one audit row for tool timer", async () => {
    await runAlarm(await person("Sage"), "set", "tomorrow at 7 called gym");
    const rows = db.select().from(toolAudit).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: "timer", action: "set_alarm", decision: "do" });
    await runAlarm(await person("Sage"), "list");
    expect(db.select().from(toolAudit).all().map((row) => row.action)).toEqual(["set_alarm", "list_alarms"]);
  });

  test("a reminder cancel and list run through remind with the old answers, audit rows and card", async () => {
    const actor = await person("Sage");
    scheduleCoreJob(actor, "reminders.fire", "2099-01-01T07:00:00.000Z", { task: "Call Nadia" });
    const listed = await say("what reminders do I have", false);
    expect(listed.text).toContain("Call Nadia");
    const cancelled = await say("cancel the reminder to call Nadia", false);
    expect(cancelled.text).toBe("Reminder cancelled: Call Nadia.");
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.status, "pending")).all()).toHaveLength(0);
    expect(db.select().from(toolAudit).all().map((row) => `${row.tool}:${row.action}`)).toEqual(["remind:list_reminders", "remind:cancel_reminder"]);
  });

  test("an unidentified speaker is refused every alarm action but still starts a plain timer", async () => {
    for (const utterance of ["wake me at 6:30", "set an alarm for 7 tomorrow", "cancel my alarm at 6:30", "what alarms do I have", "what reminders do I have", "cancel the reminder to call Nadia"]) {
      const out = await say(utterance, true);
      expect(out.matched).toBe(true);
      expect(out.text).toContain("can't set an alarm");
    }
    expect(db.select().from(toolAudit).all()).toHaveLength(0);
    expect(db.select().from(scheduledJobs).all()).toHaveLength(0);
    const timer = await say("set a timer for 10 minutes", true);
    expect(timer.matched).toBe(true);
    expect(timer.text).toMatch(/^Timer set: 10 minutes/);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "timers.fire")).all()).toHaveLength(1);
  });

  test("the policy refuses a model's alarm action for an unidentified speaker and lets a plain timer through", async () => {
    const actor = await person("Sage");
    const robot = (speakerEvidence: unknown) => ({ actor: { id: actor.id, role: "owner" }, surface: "robot", speakerEvidence, context: [], crisis: false, temporary: false, utterance: "set a timer for 10 minutes" }) as unknown as TurnState;
    const decide = async (state: TurnState, tool: string, args: Record<string, unknown>) =>
      (await policyNode(state, { calls: [{ id: "call-1", tool, args }] }, abort)).output.entries[0]?.decision;
    for (const [tool, action] of [["timer", "set_alarm"], ["timer", "cancel_alarm"], ["timer", "list_alarms"], ["remind", "cancel_reminder"], ["remind", "list_reminders"]] as const) {
      expect(await decide(robot(null), tool, { action, expression: "x" })).toEqual({ allow: false, reason: "anonymous_speaker" });
    }
    expect(await decide(robot(null), "timer", { expression: "10 minutes" })).toEqual({ allow: true });
    expect(await decide({ ...robot(null), surface: "chat" } as TurnState, "timer", { action: "set_alarm", expression: "x" })).toEqual({ allow: true });
  });

  test("an expression that starts with a reserved prefix never reaches the alarm engine", async () => {
    const actor = await person("Sage");
    await runPlugin("timer", actor, { expression: "alarm:set:tomorrow at 7 called smuggled" });
    await runPlugin("timer", actor, { expression: "  Alarm:list:" });
    await runPlugin("remind", actor, { expression: "reminder:cancel:everything" });
    await runPlugin("remind", actor, { expression: "REMINDER:list:" });
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()).toHaveLength(0);
    expect(db.select().from(alarmsTable).all()).toHaveLength(0);
    expect(db.select().from(toolAudit).all()).toHaveLength(0);
  });
});
