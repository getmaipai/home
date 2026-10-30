import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, scheduledJobs } from "@/db/schema";
import { listComingUp } from "@/lib/comingUp";
import { scheduleCoreJob } from "@/lib/scheduler";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function ownerSession() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const response = await client.get("/api/auth/me");
  return { client, id: ((await response.json()) as { id: string }).id };
}

async function addPerson(client: TestClient, name: string) {
  const response = await client.post("/api/people", { displayName: name, role: "adult", secret: "0000" });
  return ((await response.json()) as { id: string }).id;
}

async function personSession(client: TestClient, id: string) {
  const child = new TestClient();
  await child.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  return child;
}

function add(id: string, personId: string, job: string, at: string, input: Record<string, string | number>, status = "pending") {
  db.insert(scheduledJobs).values({ id, kind: "core", packageId: "core", job, personId, inputs: JSON.stringify(input), when: at, recurring: false, nextRunAt: at, status, createdAt: at, lastRunAt: status === "done" ? at : null, lastError: null }).run();
}

describe("coming up", () => {
  test("returns only the actor's pending alarm, reminder and timer rows in time order", async () => {
    const { client, id } = await ownerSession();
    const otherId = await addPerson(client, "Marlow");
    add("alarm-later", id, "alarms.fire", "2099-01-03T08:00:00.000Z", { task: "Wake" });
    add("reminder-soon", id, "reminders.fire", "2099-01-01T09:00:00.000Z", { task: "Milk" });
    add("timer", id, "timers.fire", "2099-01-02T09:00:00.000Z", { label: "Tea", total_seconds: 3600 });
    add("other", otherId, "alarms.fire", "2099-01-01T08:00:00.000Z", { task: "Private" });
    add("done", id, "alarms.fire", "2099-01-01T07:00:00.000Z", { task: "Already ran" }, "done");
    const response = await client.get("/api/coming-up");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: "reminder-soon", kind: "reminder", text: "Milk", at: "2099-01-01T09:00:00.000Z" },
      { id: "timer", kind: "timer", text: "Tea", at: "2099-01-02T09:00:00.000Z", total_seconds: 3600 },
      { id: "alarm-later", kind: "alarm", text: "Wake", at: "2099-01-03T08:00:00.000Z" },
    ]);
  });

  test("creates own timers with duration metadata and extends the same pending job", async () => {
    const { client, id } = await ownerSession();
    const otherId = await addPerson(client, "Marlow");
    expect((await client.post("/api/coming-up/timers", { label: "Focus", minutes: 0 })).status).toBe(400);
    expect((await client.post("/api/coming-up/timers", { label: "Focus", minutes: 1441 })).status).toBe(400);
    const response = await client.post("/api/coming-up/timers", { label: "Focus", minutes: 25 });
    expect(response.status).toBe(201);
    const timer = await response.json() as { id: string };
    const before = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, timer.id)).get()!;
    expect(before.job).toBe("timers.fire");
    expect(JSON.parse(before.inputs)).toEqual({ label: "Focus", total_seconds: 1500 });
    expect((await client.post(`/api/coming-up/${timer.id}/extend`)).status).toBe(200);
    const after = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, timer.id)).get()!;
    expect(after.id).toBe(before.id);
    expect(Date.parse(after.nextRunAt) - Date.parse(before.nextRunAt)).toBe(60_000);
    expect(JSON.parse(after.inputs).total_seconds).toBe(1560);
    const completed = { ...after, status: "done", lastRunAt: new Date().toISOString() };
    db.update(scheduledJobs).set({ status: "done", lastRunAt: completed.lastRunAt }).where(eq(scheduledJobs.id, timer.id)).run();
    expect((await client.post(`/api/coming-up/${timer.id}/extend`)).status).toBe(400);
    add("foreign-timer", otherId, "timers.fire", "2099-01-01T09:00:00.000Z", { label: "Private", total_seconds: 30 });
    expect((await client.post("/api/coming-up/foreign-timer/extend")).status).toBe(403);
  });

  test("legacy timers infer total seconds from their scheduled interval", async () => {
    const { client, id } = await ownerSession();
    const createdAt = new Date(Date.now() - 30_000).toISOString();
    const dueAt = new Date(Date.now() + 90_000).toISOString();
    db.insert(scheduledJobs).values({ id: "legacy-timer", kind: "core", packageId: "core", job: "timers.fire", personId: id, inputs: JSON.stringify({ label: "Tea" }), when: dueAt, recurring: false, nextRunAt: dueAt, status: "pending", createdAt, lastRunAt: null, lastError: null }).run();
    const rows = await (await client.get("/api/coming-up")).json() as Array<{ id: string; total_seconds?: number }>;
    expect(rows.find((row) => row.id === "legacy-timer")?.total_seconds).toBe(120);
  });

  test("done cancels own row and refuses another person's row even for an owner", async () => {
    const { client, id } = await ownerSession();
    const otherId = await addPerson(client, "Marlow");
    add("own", id, "reminders.fire", "2099-01-01T09:00:00.000Z", { task: "Own" });
    add("other", otherId, "reminders.fire", "2099-01-01T09:00:00.000Z", { task: "Other" });
    expect((await client.post("/api/coming-up/own/done")).status).toBe(200);
    expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.id, "own")).get()?.status).toBe("cancelled");
    expect((await client.post("/api/coming-up/other/done")).status).toBe(403);
  });

  test("snooze updates the same row and rejects another person's row", async () => {
    const { client, id } = await ownerSession();
    const otherId = await addPerson(client, "Marlow");
    add("own", id, "timers.fire", "2099-01-01T09:00:00.000Z", { label: "Tea" });
    add("other", otherId, "timers.fire", "2099-01-01T09:00:00.000Z", { label: "Private" });
    expect((await client.post("/api/coming-up/own/snooze", { minutes: 15 })).status).toBe(200);
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, "own")).all();
    expect(rows).toHaveLength(1);
    expect(Date.parse(rows[0]!.nextRunAt)).toBeGreaterThan(Date.now());
    expect((await client.post("/api/coming-up/other/snooze", { minutes: 15 })).status).toBe(403);
  });

  test("snoozing a fired alarm returns its same job to pending", async () => {
    const { client, id } = await ownerSession();
    const otherId = await addPerson(client, "Marlow");
    add("fired-alarm", id, "alarms.fire", "2026-10-29T08:00:00.000Z", { task: "Gym" }, "done");
    add("other-fired-alarm", otherId, "alarms.fire", "2026-10-29T08:00:00.000Z", { task: "Private" }, "done");
    expect((await client.post("/api/coming-up/fired-alarm/snooze", { minutes: 5 })).status).toBe(200);
    expect((await client.post("/api/coming-up/other-fired-alarm/snooze", { minutes: 5 })).status).toBe(403);
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, "fired-alarm")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect(Date.parse(rows[0]!.nextRunAt)).toBeGreaterThan(Date.now());
  });

  test("snooze accepts only the shared minute choices", async () => {
    const { client, id } = await ownerSession();
    for (const minutes of [5, 10, 15, 30, 60]) {
      const jobId = `alarm-${minutes}`;
      add(jobId, id, "alarms.fire", "2099-01-01T09:00:00.000Z", { task: "Gym" });
      expect((await client.post(`/api/coming-up/${jobId}/snooze`, { minutes })).status).toBe(200);
    }
    add("alarm-invalid", id, "alarms.fire", "2099-01-01T09:00:00.000Z", { task: "Gym" });
    expect((await client.post("/api/coming-up/alarm-invalid/snooze", { minutes: 7 })).status).toBe(400);
    add("alarm-tomorrow", id, "alarms.fire", "2099-01-01T09:00:00.000Z", { task: "Gym" });
    expect((await client.post("/api/coming-up/alarm-tomorrow/snooze", { until: "tomorrow_morning" })).status).toBe(200);
  });

  test("a child sees only their own rows even though the owner created both people", async () => {
    const { client, id: ownerId } = await ownerSession();
    const childRes = await client.post("/api/people", { displayName: "Nova", role: "child", secret: "0000" });
    const childId = ((await childRes.json()) as { id: string }).id;
    const child = await personSession(client, childId);
    add("child-alarm", childId, "alarms.fire", "2099-01-01T09:00:00.000Z", { task: "School" });
    add("owner-alarm", ownerId, "alarms.fire", "2099-01-01T08:00:00.000Z", { task: "Private" });
    expect(await (await child.get("/api/coming-up")).json()).toEqual([{ id: "child-alarm", kind: "alarm", text: "School", at: "2099-01-01T09:00:00.000Z" }]);
  });
});

describe("alarm records are not listed as one-time alarms", () => {
  test("an alarms.fire job that has an alarmId stays out of the Coming up list", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const made = await client.post("/api/alarms", { time: "07:00", days: [1, 2, 3, 4, 5], label: "Gentle wake" });
    expect(made.status).toBe(201);
    const once = scheduleCoreJob(actor, "alarms.fire", "2099-01-01T00:00:00.000Z", { task: "chat alarm" });
    expect(once.ok).toBe(true);
    const list = listComingUp(actor);
    expect(list.map((row) => row.text)).toEqual(["chat alarm"]);
  });
});
