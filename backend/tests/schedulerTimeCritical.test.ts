import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { scheduledJobs } from "@/db/schema";
import { TestClient } from "./client";
import { runDueJobs, runTimeCriticalJobs, scheduleCoreJob } from "@/lib/scheduler";
import { listPending } from "@/lib/notifications";
import { runPlugin, registerAllPackageNotificationTypes } from "@/lib/plugins";

beforeEach(() => { resetDb(); });

async function owner() {
  await new TestClient().post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  registerAllPackageNotificationTypes();
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

import type { PersonRow } from "@/types";

/** A job that is due now (scheduleCoreJob refuses a time already past, so it is moved back after). */
function dueNow(actor: PersonRow, job: string, inputs: Record<string, unknown>) {
  const scheduled = scheduleCoreJob(actor, job, "2099-01-01T00:00:00.000Z", inputs);
  if (!scheduled.ok) throw new Error("setup failed");
  db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, scheduled.value.id)).run();
}

describe("time-critical jobs", () => {
  test("an alarm, reminder and timer fire while another job is still running", async () => {
    const actor = await owner();
    // A background job that never finishes (the live hub's news poll did exactly this and held every later alarm).
    dueNow(actor, "test.hang", {});
    // The hung job's own budget is short here so this test ends; in the hub it is 20 minutes.
    const general = runDueJobs(runPlugin, new Date(), { "test.hang": () => new Promise<void>(() => {}) }, 400);
    await new Promise((resolve) => setTimeout(resolve, 0));
    dueNow(actor, "alarms.fire", { task: "wake up" });
    dueNow(actor, "reminders.fire", { task: "call Nadia" });
    dueNow(actor, "timers.fire", { label: "10 minutes" });
    const result = await runTimeCriticalJobs(runPlugin);
    expect(result.ran).toBe(3);
    expect(listPending(actor).map((n) => n.typeId).sort()).toEqual(["alarm.due", "remind.due", "timer.done"]);
    await general;
  });

  test("a due alarm fires once even when the general and the critical runs both look at it", async () => {
    const actor = await owner();
    dueNow(actor, "alarms.fire", { task: "wake up" });
    await Promise.all([runTimeCriticalJobs(runPlugin), runDueJobs(runPlugin)]);
    await runDueJobs(runPlugin);
    expect(listPending(actor).filter((n) => n.typeId === "alarm.due")).toHaveLength(1);
  });
});
