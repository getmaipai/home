import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { parseWhen, scheduleJob, ensureCoreJob, listJobs, cancelJob, runDueJobs } from "@/lib/scheduler";
import { runPlugin } from "@/lib/plugins";
import { db } from "@/db";
import { people, scheduledJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, row };
}

describe("parseWhen", () => {
  // A hardcoded target datetime compared against the real wall clock
  // (parseWhen's own default `from: Date = new Date()`) is a ticking time
  // bomb - this test passed for months, then started failing the moment
  // real time caught up to the "future" date it hardcoded, on
  // 2026-09-05, the exact day this fix landed. `parseWhen` already takes
  // an injectable `from` for exactly this reason (the recurring test
  // below already used it); this test just hadn't.
  test("parses a one-shot ISO datetime as non-recurring", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const parsed = parseWhen("2026-09-05T08:00:00.000Z", from);
    expect(parsed?.recurring).toBe(false);
    expect(parsed?.nextRunAt.toISOString()).toBe("2026-09-05T08:00:00.000Z");
  });

  test("parses every:<n><unit> as recurring, relative to `from`", () => {
    const from = new Date("2026-09-04T00:00:00.000Z");
    const parsed = parseWhen("every:2h", from);
    expect(parsed?.recurring).toBe(true);
    expect(parsed?.nextRunAt.toISOString()).toBe("2026-09-04T02:00:00.000Z");
  });

  test("rejects garbage", () => {
    expect(parseWhen("whenever")).toBeNull();
    expect(parseWhen("every:0h")).toBeNull();
    expect(parseWhen("every:1y")).toBeNull();
  });

  // A review (2026-09-04) found this wasn't actually enforced: a past
  // one-shot time was silently accepted and scheduled as immediately
  // due, contradicting both this docstring and scheduleJob's own error
  // message.
  test("rejects a one-shot time already in the past, relative to `from`", () => {
    const from = new Date("2026-09-04T12:00:00.000Z");
    expect(parseWhen("2026-09-04T11:59:59.000Z", from)).toBeNull();
    expect(parseWhen("2026-09-04T12:00:01.000Z", from)).not.toBeNull();
  });
});

describe("scheduleJob / listJobs / cancelJob", () => {
  test("a scheduled job is only visible to its owner, not another non-admin person", async () => {
    const { row: ownerRow, client: ownerClient } = await owner();
    const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "adult" });
    const other = (await created.json()) as { id: string };
    const otherRow = db.select().from(people).where(eq(people.id, other.id)).get()!;

    const scheduled = scheduleJob(ownerRow, "remember", "remember", "2026-12-25T00:00:00.000Z", { fact: "x" });
    expect(scheduled.ok).toBe(true);

    expect(listJobs(ownerRow).length).toBe(1); // owner sees everything
    expect(listJobs(otherRow).length).toBe(0); // a non-admin sees only their own
  });

  test("rejects an unparseable when", async () => {
    const { row } = await owner();
    const result = scheduleJob(row, "remember", "remember", "not a time", {});
    expect(result.ok).toBe(false);
  });

  test("only the owner or an admin can cancel someone else's job", async () => {
    const { row: ownerRow } = await owner();
    const scheduled = scheduleJob(ownerRow, "remember", "remember", "2026-12-25T00:00:00.000Z", {});
    if (!scheduled.ok) throw new Error("setup failed");
    const cancelled = cancelJob(ownerRow, scheduled.value.id);
    expect(cancelled.ok).toBe(true);
    expect(listJobs(ownerRow).find((j) => j.id === scheduled.value.id)?.status).toBe("cancelled");
  });

  // A review (2026-09-04) found cancelJob didn't check the job was
  // still pending: an already-"done" job could be flipped to
  // "cancelled" after the fact, corrupting the one field an operator
  // reads to answer "did this actually run."
  test("cannot cancel a job that already ran", async () => {
    const { row: ownerRow } = await owner();
    const scheduled = scheduleJob(ownerRow, "remember", "remember", "2099-01-01T00:00:00.000Z", { fact: "x" });
    if (!scheduled.ok) throw new Error("setup failed");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, scheduled.value.id)).run();
    await runDueJobs(runPlugin);
    expect(listJobs(ownerRow).find((j) => j.id === scheduled.value.id)?.status).toBe("done");

    const cancelled = cancelJob(ownerRow, scheduled.value.id);
    expect(cancelled.ok).toBe(false);
    expect(listJobs(ownerRow).find((j) => j.id === scheduled.value.id)?.status).toBe("done"); // unchanged
  });
});

describe("ensureCoreJob", () => {
  test("is idempotent: calling it twice inserts one row", () => {
    ensureCoreJob("memory.maintenance", "every:1d");
    ensureCoreJob("memory.maintenance", "every:1d");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.kind, "core")).all();
    expect(rows.length).toBe(1);
  });
});

describe("runDueJobs", () => {
  test("fires a due core job (memory.maintenance) for real", async () => {
    ensureCoreJob("memory.maintenance", "every:1d");
    // Force it due: ensureCoreJob schedules a day out by design.
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).run();
    const result = await runDueJobs(runPlugin);
    expect(result.ran).toBe(1);
    expect(result.errors).toBe(0);
    const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.kind, "core")).get()!;
    expect(row.recurring).toBe(true);
    expect(row.status).toBe("pending"); // recurring: stays pending, reschedules forward
    expect(new Date(row.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("fires a due plugin job and marks a one-shot job done", async () => {
    const { row: ownerRow, client } = await owner();
    const scheduled = scheduleJob(ownerRow, "remember", "remember", "2099-01-01T00:00:00.000Z", { fact: "the garage code is 4471" });
    if (!scheduled.ok) throw new Error("setup failed");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, scheduled.value.id)).run();

    const result = await runDueJobs(runPlugin);
    expect(result.ran).toBe(1);
    expect(result.errors).toBe(0);

    const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, scheduled.value.id)).get()!;
    expect(row.status).toBe("done");
    expect(row.lastError).toBeNull();

    const recall = await client.post("/api/memory/recall", { q: "garage code" });
    const matches = (await recall.json()) as Array<{ record: { text: string } }>;
    expect(matches.some((m) => m.record.text.includes("garage code"))).toBe(true);
  });

  test("records lastError and still marks a failing one-shot job done, not retried", async () => {
    const { row: ownerRow } = await owner();
    const scheduled = scheduleJob(ownerRow, "does-not-exist", "x", "2099-01-01T00:00:00.000Z", {});
    if (!scheduled.ok) throw new Error("setup failed");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, scheduled.value.id)).run();

    const result = await runDueJobs(runPlugin);
    expect(result.ran).toBe(0);
    expect(result.errors).toBe(1);

    const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, scheduled.value.id)).get()!;
    expect(row.status).toBe("done");
    expect(row.lastError).toContain("no bundled package");
  });

  // A review (2026-09-04) found the reschedule advanced from `now`
  // (when it actually fired) rather than from the job's own scheduled
  // nextRunAt, which would permanently shift a daily job's time-of-day
  // forward by however late each tick was. This pins the fixed
  // behavior: a job overdue by 3 hours reschedules to exactly one
  // interval past its ORIGINAL due time, not past the moment it fired.
  test("a late-firing recurring job reschedules from its own due time, not from when it fired", async () => {
    ensureCoreJob("memory.maintenance", "every:1d");
    const originalDue = new Date("2026-09-04T06:00:00.000Z");
    db.update(scheduledJobs).set({ nextRunAt: originalDue.toISOString() }).run();

    const firedAt = new Date("2026-09-04T09:00:00.000Z"); // 3 hours late
    await runDueJobs(runPlugin, firedAt);

    const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.kind, "core")).get()!;
    expect(row.nextRunAt).toBe(new Date(originalDue.getTime() + 86_400_000).toISOString());
  });

  test("does nothing when no job is due", async () => {
    const { row: ownerRow } = await owner();
    const scheduled = scheduleJob(ownerRow, "remember", "remember", "2099-01-01T00:00:00.000Z", { fact: "future" });
    if (!scheduled.ok) throw new Error("setup failed");
    const result = await runDueJobs(runPlugin);
    expect(result.ran).toBe(0);
    expect(result.errors).toBe(0);
  });

  // A code review (2026-09-05, the same pass that made this function
  // async so a job could really await host.fetch) found "no concurrent
  // invocations" was true only by accident, back when this was
  // synchronous: once a due job can await a slow real fetch, a second
  // call arriving mid-run (index.ts's interval firing again, or a manual
  // POST /scheduler/run-due) would SELECT the same still-"pending" row
  // and fire a one-shot job twice. Proven directly with a controllable
  // slow runPluginFn rather than trusting real timing.
  test("two overlapping calls share the same run - a one-shot job fires exactly once, not twice", async () => {
    const { row: ownerRow } = await owner();
    const scheduled = scheduleJob(ownerRow, "remember", "remember", "2099-01-01T00:00:00.000Z", { fact: "the garage code is 4471" });
    if (!scheduled.ok) throw new Error("setup failed");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, scheduled.value.id)).run();

    let callCount = 0;
    const slowRunPlugin = (id: string, actor: typeof ownerRow, inputs: Record<string, unknown>) => {
      callCount++;
      return new Promise<Awaited<ReturnType<typeof runPlugin>>>((resolve) => {
        setTimeout(() => resolve(runPlugin(id, actor, inputs)), 30);
      });
    };

    // Fired without awaiting the first, on purpose - this is the exact
    // overlap ("the interval fires again mid-run") the fix guards against.
    const first = runDueJobs(slowRunPlugin);
    const second = runDueJobs(slowRunPlugin);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(callCount).toBe(1); // the plugin itself only ever actually ran once
    expect(firstResult).toEqual(secondResult); // both callers got back the exact same real result
    expect(firstResult.ran).toBe(1);

    const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, scheduled.value.id)).get()!;
    expect(row.status).toBe("done"); // not somehow re-queued by the second, overlapping call
  });
});

describe("HTTP: GET/POST /api/scheduler", () => {
  test("requires auth", async () => {
    const res = await new TestClient().get("/api/scheduler/jobs");
    expect(res.status).toBe(401);
  });

  test("a package's real host.schedule() persists a job, listed via the API", async () => {
    // remember's own recipe never calls schedule; exercised at the
    // packageHost unit level (tests/packageHost.test.ts). Here: confirm
    // the HTTP surface round-trips a job scheduleJob() itself created.
    const { client, row } = await owner();
    const scheduled = scheduleJob(row, "remember", "remember", "2026-12-25T00:00:00.000Z", {});
    if (!scheduled.ok) throw new Error("setup failed");

    const res = await client.get("/api/scheduler/jobs");
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((j) => j.id === scheduled.value.id)).toBe(true);
  });

  test("owner can run-due on demand", async () => {
    const { client } = await owner();
    ensureCoreJob("memory.maintenance", "every:1d");
    db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).run();
    const res = await client.post("/api/scheduler/run-due", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ran: number };
    expect(body.ran).toBe(1);
  });

  test("run-due is owner/admin only", async () => {
    const { client: ownerClient } = await owner();
    const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "adult" });
    const adult = (await created.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });
    const res = await adultClient.post("/api/scheduler/run-due", {});
    expect(res.status).toBe(403);
  });
});
