// MEM-RETRY-01: the Stack's memory watchdog stopped a clip (code memory_cancelled). Home says so in plain words, keeps the clip in the
// waiting state (not a failure), starts the same clip again by itself (at most twice), never retries a person's Stop, and never shows a
// resource word to a person.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { cancelVideoJob, getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { setNoRoomRecheckForTests } from "@/lib/jobs/householdQueue";
import { JOB_QUEUE_COPY, jobQueueCopy } from "@/lib/jobQueueCopy";
import { phaseLabel } from "@/lib/videos/phaseLabel";
import { videoCardView } from "@/routes/videos";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); fake = installFakeVideoStack({ pollsToFinish: 6 }); setNoRoomRecheckForTests(25); });
afterEach(() => { fake.restore(); setNoRoomRecheckForTests(null); });

async function owner(): Promise<{ actor: PersonRow; conversationId: string }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
  const conv = await import("@/lib/conversationHistory");
  const resolved = conv.resolveOrCreateConversation(actor, "chat", undefined, {});
  if (!resolved.ok) throw new Error("no conversation");
  return { actor, conversationId: resolved.value.id };
}
const start = (who: { actor: PersonRow; conversationId: string }, extra: Record<string, unknown> = {}) =>
  startVideoJob({ actor: who.actor, conversationId: who.conversationId, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", size: "832x480", seconds: 5, seed: 4242, audience: "adult" }, ...extra });
const WAITING = "Your video stopped for a moment so chat could keep going. It will start again by itself.";

describe("a clip the Stack's memory watchdog stopped", () => {
  test("shows the waiting line, starts again by itself with the same body, and finishes", async () => {
    fake.memoryCancels = 1;
    const who = await owner();
    const job = await start(who);
    const labels = new Set<string>();
    const seen = new Set<string>();
    await until(() => {
      const current = getVideoJobFor(who.actor, job.id)!;
      seen.add(current.state);
      if (current.state === "queued" && (current.request as { memoryRequeues?: number }).memoryRequeues === 1) labels.add(videoCardView(who.actor, current, true).items[0]!.label);
      return current.state === "done";
    });
    expect(labels.has(WAITING)).toBe(true);
    expect(seen.has("failed")).toBe(false);
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]).toEqual(fake.submitted[0]!);
    expect(fake.submitted[0]).toMatchObject({ seed: 4242, audience: "adult", prompt: "a paper boat" });
  });

  test("a second stop starts it once more; a third shows the plain failure with the clip still failed (Try again)", async () => {
    fake.memoryCancels = 2;
    const who = await owner();
    const job = await start(who);
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "done");
    expect(fake.submitted).toHaveLength(3);

    fake.memoryCancels = 3;
    const failing = await start(who);
    await until(() => getVideoJobFor(who.actor, failing.id)?.state === "failed");
    expect(fake.submitted).toHaveLength(6);
    const error = getVideoJobFor(who.actor, failing.id)!.error!;
    expect(error).toBe("I couldn't make that video. Your video could not finish. Try again in a few minutes.");
    expect(videoCardView(who.actor, getVideoJobFor(who.actor, failing.id)!, true).items[0]!.error).toBe(error);
  });

  test("the Stack refusing new clips while it recovers keeps the clip waiting, never failed", async () => {
    fake.memoryCancels = 1;
    fake.refusalsAfterCancel = 4;
    const who = await owner();
    const job = await start(who);
    const states = new Set<string>();
    await until(() => { const c = getVideoJobFor(who.actor, job.id)!; states.add(c.state); return c.state === "done"; }, 15_000);
    expect(states.has("failed")).toBe(false);
    expect(fake.refused).toBe(4);
    expect(fake.submitted).toHaveLength(2);
  });

  test("a Max clip the watchdog stopped (the Stack ends it failed with the same code) is started again too, and keeps its tier", async () => {
    fake.memoryCancels = 1;
    fake.memoryStopState = "failed";
    fake.ltx25max = "ready";
    const who = await owner();
    const job = await start(who, { tier: "max", body: { prompt: "a paper boat", size: "1024x576", seconds: 5, seed: 7, audience: "adult", model: "ltx25-max", tier: "max" } });
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "done");
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]).toMatchObject({ seed: 7, tier: "max", model: "ltx25-max" });
    expect(getVideoJobFor(who.actor, job.id)!.request).toMatchObject({ tier: "max" });
  });

  test("an adult-only clip started again keeps its adult-only mark and lock", async () => {
    fake.memoryCancels = 1;
    const who = await owner();
    const job = await start(who, { adultOnly: true, adultLock: "on" });
    // The finished-clip check is not under test here; the second start is.
    await until(() => fake.submitted.length === 2);
    const request = getVideoJobFor(who.actor, job.id)!.request as { adultOnly?: boolean; adultLock?: string; memoryRequeues?: number };
    expect(request).toMatchObject({ adultOnly: true, adultLock: "on", memoryRequeues: 1 });
    expect(fake.submitted).toHaveLength(2);
  });

  test("a person's Stop is never retried, while running and while waiting to start again", async () => {
    fake.pollsToFinish = 1000;
    const who = await owner();
    const job = await start(who);
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "running");
    await cancelVideoJob(who.actor, job.id);
    await Bun.sleep(150);
    expect(getVideoJobFor(who.actor, job.id)!.state).toBe("cancelled");
    expect(fake.submitted).toHaveLength(1);

    // Stopped while it waits to start again: the retry never goes out.
    fake.pollsToFinish = 1000;
    fake.memoryCancels = 1;
    fake.refusalsAfterCancel = 1000;
    const second = await start(who);
    await until(() => (getVideoJobFor(who.actor, second.id)!.request as { memoryRequeues?: number }).memoryRequeues === 1);
    await cancelVideoJob(who.actor, second.id);
    const sent = fake.submitted.length;
    await Bun.sleep(200);
    expect(getVideoJobFor(who.actor, second.id)!.state).toBe("cancelled");
    expect(fake.submitted).toHaveLength(sent);
  });

  test("an older Stack's code (no_memory on a cancelled clip) is still started again", async () => {
    fake.pausedForMemory = true;
    const who = await owner();
    const job = await start(who);
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "failed");
    expect(fake.submitted).toHaveLength(3);
    expect(getVideoJobFor(who.actor, job.id)!.error).toContain("could not finish");
  });
});

describe("the words", () => {
  const lines = [
    JOB_QUEUE_COPY.requeued_memory.adult, JOB_QUEUE_COPY.requeued_memory.child, JOB_QUEUE_COPY.memory_stopped_failure.adult, JOB_QUEUE_COPY.memory_stopped_failure.child,
    jobQueueCopy("waiting_memory", "requeued_memory", null, null, "adult"), jobQueueCopy("failed_memory", "memory_stopped_failure", null, null, "child"),
  ];
  test("no resource word is ever shown to a person, and the child lane gets the simpler line", () => {
    for (const line of lines) expect(line).not.toMatch(/memory|\bRAM\b|swap|\broom\b|\bGB\b|pressure|reserve/i);
    expect(JOB_QUEUE_COPY.requeued_memory.adult).toBe(WAITING);
    expect(JOB_QUEUE_COPY.requeued_memory.child).toBe("Your video will start again by itself.");
    expect(JOB_QUEUE_COPY.requeued_memory.child.length).toBeLessThan(JOB_QUEUE_COPY.requeued_memory.adult.length);
  });
  test("the card and the Create feed say the same waiting line for adult and child", async () => {
    fake.memoryCancels = 1;
    fake.refusalsAfterCancel = 1000;
    const who = await owner();
    const job = await start(who);
    await until(() => (getVideoJobFor(who.actor, job.id)!.request as { memoryRequeues?: number }).memoryRequeues === 1);
    const current = getVideoJobFor(who.actor, job.id)!;
    expect(phaseLabel(current, "adult")).toBe(WAITING);
    expect(phaseLabel(current, "child")).toBe(JOB_QUEUE_COPY.requeued_memory.child);
    expect(videoCardView(who.actor, current, true).items[0]).toMatchObject({ state: "queued", label: WAITING, error: null });
  });
});
