import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { alarms, people, scheduledJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { nextOccurrence, runTimeCriticalJobs } from "@/lib/scheduler";
import { createAlarm, listAlarms, updateAlarm, deleteAlarm, skipNext } from "@/lib/alarms";
import { runPlugin, registerAllPackageNotificationTypes } from "@/lib/plugins";

beforeEach(() => resetDb());

describe("nextOccurrence", () => {
  const call = (days: number[], after: string, time = "06:30", zone = "UTC", skipUntil: string | null = null) =>
    nextOccurrence({ time, days, zone, after: new Date(after), skipUntil });
  test("selects weekdays and weekends using ISO weekdays", () => {
    expect(call([1, 2, 3, 4, 5], "2026-10-30T12:00:00Z")?.toISOString()).toBe("2026-11-02T06:30:00.000Z");
    expect(call([6, 7], "2026-10-30T12:00:00Z")?.toISOString()).toBe("2026-10-31T06:30:00.000Z");
  });
  test("chooses today only while its time is ahead, and supports one-time alarms", () => {
    expect(call([5], "2026-10-30T05:00:00Z")?.toISOString()).toBe("2026-10-30T06:30:00.000Z");
    expect(call([5], "2026-10-30T07:00:00Z")?.toISOString()).toBe("2026-11-06T06:30:00.000Z");
    expect(call([], "2026-10-30T05:00:00Z")?.toISOString()).toBe("2026-10-30T06:30:00.000Z");
    // A one-time alarm made after its clock time today rings tomorrow, never "never".
    expect(call([], "2026-10-30T07:00:00Z")?.toISOString()).toBe("2026-10-31T06:30:00.000Z");
  });
  test("honors skip_until and timezone offsets including half-hour zones", () => {
    expect(call([5], "2026-10-30T05:00:00Z", "06:30", "UTC", "2026-10-30T06:30:00Z")?.toISOString()).toBe("2026-11-06T06:30:00.000Z");
    expect(call([], "2026-01-01T00:00:00Z", "09:00", "Asia/Kolkata")?.toISOString()).toBe("2026-01-01T03:30:00.000Z");
    expect(call([], "2026-01-01T08:00:00Z", "09:00", "America/Los_Angeles")?.toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });
  test("handles New York spring gaps and fall overlaps once", () => {
    expect(call([7], "2026-03-08T05:00:00Z", "02:30", "America/New_York")?.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(call([7], "2026-11-01T04:00:00Z", "01:30", "America/New_York")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("alarm records and own-only API", () => {
  test("creates, updates, skips, and tombstones with exactly one synchronized job", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).get()!;
    const created = createAlarm(actor, { time: "06:30", days: [1, 2, 3, 4, 5], label: "gym" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()).toHaveLength(1);
    const moved = updateAlarm(actor, created.value.id, { time: "07:15", enabled: false });
    expect(moved.ok).toBe(true);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()[0]?.status).toBe("cancelled");
    const enabled = updateAlarm(actor, created.value.id, { enabled: true });
    expect(enabled.ok).toBe(true);
    const skipped = skipNext(actor, created.value.id);
    expect(skipped.ok).toBe(true);
    expect(deleteAlarm(actor, created.value.id).ok).toBe(true);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "alarms.fire")).all()[0]?.status).toBe("cancelled");
  });

  test("routes expose and mutate only the caller's alarms, including admins", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const owner = db.select().from(people).get()!;
    const own = createAlarm(owner, { time: "06:30", days: [] });
    expect(own.ok).toBe(true);
    const response = await client.get("/api/alarms");
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect(listAlarms(owner)).toHaveLength(1);
    if (own.ok) expect(updateAlarm({ ...owner, id: "person-zzzzzz" }, own.value.id, { label: "x" }).ok).toBe(false);
  });

  test("rejects invalid time and days and never exposes a person's alarm to an admin", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const owner = db.select().from(people).get()!;
    const response = await client.post("/api/alarms", { time: "25:99", days: [8] });
    expect(response.status).toBe(400);
    const result = createAlarm(owner, { time: "06:30", days: [1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admin = { ...owner, id: "person-admin1", role: "admin" };
    expect(listAlarms(admin)).toHaveLength(0);
    expect(deleteAlarm(admin, result.value.id).ok).toBe(false);
  });
});

describe("alarm firing", () => {
  test("keeps legacy one-shot jobs firing and runs the time-critical lane idempotently", async () => {
    registerAllPackageNotificationTypes();
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).get()!;
    const row = db.insert(scheduledJobs).values({ id: "job-legacy", kind: "core", packageId: "core", job: "alarms.fire", personId: actor.id, inputs: JSON.stringify({ task: "Legacy" }), when: "2099-01-01T00:00:00Z", recurring: false, nextRunAt: new Date(0).toISOString(), status: "pending", createdAt: new Date().toISOString() }).returning().get()!;
    const first = await runTimeCriticalJobs(runPlugin);
    expect(first.ran).toBe(1);
    expect(await runTimeCriticalJobs(runPlugin)).toMatchObject({ ran: 0 });
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.id, row.id)).get()?.status).toBe("done");
  });

  test("weekly firing reschedules the same row and one-time firing disables its record", async () => {
    registerAllPackageNotificationTypes();
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).get()!;
    const repeating = createAlarm(actor, { time: "06:30", days: [1, 2, 3, 4, 5], label: "gym" });
    const once = createAlarm(actor, { time: "06:30", days: [], label: "once" });
    if (!repeating.ok || !once.ok) throw new Error("setup failed");
    const rows = db.select().from(scheduledJobs).all().filter((j) => JSON.parse(j.inputs).alarmId);
    const repeatJob = rows.find((j) => JSON.parse(j.inputs).alarmId === repeating.value.id)!;
    const onceJob = rows.find((j) => JSON.parse(j.inputs).alarmId === once.value.id)!;
    const due = new Date(Date.now() - 1000).toISOString();
    db.update(scheduledJobs).set({ nextRunAt: due }).where(eq(scheduledJobs.id, repeatJob.id)).run();
    db.update(scheduledJobs).set({ nextRunAt: due }).where(eq(scheduledJobs.id, onceJob.id)).run();
    await runTimeCriticalJobs(runPlugin, new Date(Date.now() + 1000));
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.id, repeatJob.id)).get()?.status).toBe("pending");
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.id, repeatJob.id)).get()?.id).toBe(repeatJob.id);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.id, onceJob.id)).get()?.status).toBe("done");
    expect(db.select().from(alarms).where(eq(alarms.id, once.value.id)).get()?.enabled).toBe(false);
  });
});
