import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, scheduledJobs } from "@/db/schema";
import { TestClient } from "./client";
import { isWorkbench, runDueJobs, runTimeCriticalJobs, scheduleCoreJob, WORKBENCH_SKIPPED_JOBS } from "@/lib/scheduler";
import { runPlugin } from "@/lib/plugins";
import type { PersonRow } from "@/types";

const before = process.env.MAIPAI_WORKBENCH;
beforeEach(() => { resetDb(); });
afterEach(() => {
  if (before === undefined) delete process.env.MAIPAI_WORKBENCH;
  else process.env.MAIPAI_WORKBENCH = before;
});

async function owner(): Promise<PersonRow> {
  await new TestClient().post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function dueNow(actor: PersonRow, job: string): string {
  const scheduled = scheduleCoreJob(actor, job, "2099-01-01T00:00:00.000Z", {});
  if (!scheduled.ok) throw new Error("setup failed");
  db.update(scheduledJobs).set({ nextRunAt: new Date(0).toISOString() }).where(eq(scheduledJobs.id, scheduled.value.id)).run();
  return scheduled.value.id;
}

describe("workbench scheduler gate", () => {
  test("reads only MAIPAI_WORKBENCH=1", () => {
    expect(isWorkbench({ MAIPAI_WORKBENCH: "1" })).toBe(true);
    expect(isWorkbench({ MAIPAI_WORKBENCH: "0" })).toBe(false);
    expect(isWorkbench({})).toBe(false);
  });

  test("a workbench hub leaves heavy and outside-world jobs pending and still runs the rest", async () => {
    process.env.MAIPAI_WORKBENCH = "1";
    const actor = await owner();
    const ran: string[] = [];
    const handlers = Object.fromEntries(["packages.warm", "talent.shows.due", "test.ordinary", "schedules.device.fire"].map((job) => [job, () => { ran.push(job); }]));
    const warm = dueNow(actor, "packages.warm");
    const show = dueNow(actor, "talent.shows.due");
    const device = dueNow(actor, "schedules.device.fire");
    dueNow(actor, "test.ordinary");
    await runDueJobs(runPlugin, new Date(), handlers);
    await runTimeCriticalJobs(runPlugin, new Date(), handlers);
    expect(ran).toEqual(["test.ordinary"]);
    for (const id of [warm, show, device]) {
      expect(db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get()?.status).toBe("pending");
    }
    expect(WORKBENCH_SKIPPED_JOBS).toContain("stack.updates.maintenance");
  });

  test("a normal hub runs the same jobs", async () => {
    delete process.env.MAIPAI_WORKBENCH;
    const actor = await owner();
    const ran: string[] = [];
    dueNow(actor, "packages.warm");
    dueNow(actor, "talent.shows.due");
    await runDueJobs(runPlugin, new Date(), { "packages.warm": () => { ran.push("packages.warm"); }, "talent.shows.due": () => { ran.push("talent.shows.due"); } });
    expect(ran.sort()).toEqual(["packages.warm", "talent.shows.due"]);
  });
});
