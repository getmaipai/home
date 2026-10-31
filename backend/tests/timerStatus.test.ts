import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, scheduledJobs } from "@/db/schema";
import { runPlugin } from "@/lib/plugins";
import { timerStatusReply } from "@/lib/timerStatus";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

describe("running timer status", () => {
  let client: TestClient;
  beforeEach(() => { resetDb(); client = new TestClient(); });

  async function owner() {
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  }

  test("reports the stored end time against a fake clock", async () => {
    const actor = await owner();
    const set = await runPlugin("timer", actor, { expression: "ten minutes" });
    expect(set.ok).toBe(true);
    const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "timers.fire")).get()!;
    const now = new Date(Date.parse(row.nextRunAt) - 552_000);
    expect(timerStatusReply([row], now)).toContain("9 minutes and 12 seconds left");
  });

  test("reports no running timers", async () => {
    const actor = await owner();
    const result = await runPlugin("timer", actor, { action: "list_timers", expression: "timers" });
    expect(result.ok && result.value.reply?.text).toBe("You have no timers running.");
  });

  test("does not report another person's timer", async () => {
    const actor = await owner();
    const other = await client.post("/api/people", { displayName: "Nova", role: "child", secret: "0000" });
    const { id } = await other.json() as { id: string };
    db.insert(scheduledJobs).values({
      id: "other-timer", kind: "core", packageId: "core", job: "timers.fire", personId: id,
      inputs: JSON.stringify({ label: "private timer" }), when: "2099-01-01T00:10:00.000Z", recurring: false,
      nextRunAt: "2099-01-01T00:10:00.000Z", status: "pending", createdAt: "2099-01-01T00:00:00.000Z", lastRunAt: null, lastError: null,
    }).run();
    const result = await runPlugin("timer", actor, { action: "list_timers", expression: "timers" });
    expect(result.ok && result.value.reply?.text).toBe("You have no timers running.");
  });
});

describe("timer status wording", () => {
  const at = (iso: string, label?: string) => ({ nextRunAt: iso, inputs: JSON.stringify(label === undefined ? {} : { label }) });
  const now = new Date("2026-10-31T12:00:00.000Z");
  test("a length label reads as a length, a name stays whole, no label is just a timer", () => {
    expect(timerStatusReply([at("2026-10-31T12:05:00.000Z", "10 minutes")], now)).toBe("Your 10 minute timer has 5 minutes left.");
    expect(timerStatusReply([at("2026-10-31T12:00:30.000Z", "Glass")], now)).toBe("Your Glass timer has 30 seconds left.");
    expect(timerStatusReply([at("2026-10-31T12:01:01.000Z")], now)).toBe("Your timer has 1 minute and 1 second left.");
  });
});
