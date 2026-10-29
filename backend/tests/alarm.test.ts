import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, scheduledJobs, notificationDeliveries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { createHost } from "@/lib/packageHost";
import { runDueJobs, scheduleCoreJob } from "@/lib/scheduler";
import { listPending } from "@/lib/notifications";
import { runPlugin, loadManifestOnly, registerAllPackageNotificationTypes } from "@/lib/plugins";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { commandOpeners, loadAllManifests } from "@/lib/turnShared";

beforeEach(() => resetDb());

async function person(displayName: string, role: "owner" | "child" = "owner") {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  if (role === "child") {
    const res = await client.post("/api/people", { displayName, role: "child", secret: "0000" });
    const body = await res.json() as { id: string };
    return db.select().from(people).where(eq(people.id, body.id)).get()!;
  }
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

describe("alarm package", () => {
  test("setting an alarm schedules alarms.fire for the asking person", async () => {
    const actor = await person("Sage");
    const loaded = loadManifestOnly("alarm");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const host = createHost(actor, loaded.value);
    const result = host.reminders.set("tomorrow at 7 called gym");
    expect(result.task).toBe("gym");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBe(actor.id);
    expect(JSON.parse(rows[0]!.inputs)).toEqual({ task: "gym" });
  });

  test("the package reply includes its schedule card", async () => {
    const actor = await person("Sage");
    const result = await runPlugin("alarm", actor, { expression: "tomorrow at 7 for gym" });
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
    expect(output.matched).toBe(false);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()).toHaveLength(0);
  });

  test("a time without a label uses Alarm as its task", async () => {
    const actor = await person("Sage");
    const loaded = loadManifestOnly("alarm");
    if (!loaded.ok) throw new Error(loaded.error);
    expect(createHost(actor, loaded.value).reminders.set("at 6:30").task).toBe("Alarm");
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
});
