import { describe, expect, test } from "bun:test";
import { db } from "../src/db";
import { notificationDeliveries } from "../src/db/schema";
import { order, registerQueueProvider, releaseHouseholdQueue, writePositions, type QueueJob } from "../src/lib/jobs/householdQueue";

const now = Date.parse("2026-10-25T12:00:00.000Z");
function job(id: string, personId: string, jobClass: QueueJob["jobClass"], createdAt: number, extra: Partial<QueueJob> = {}): QueueJob {
  return { id, personId, jobClass, state: "queued", createdAt, ...extra };
}

describe("household queue", () => {
  test("interleaves people within a class", () => {
    const jobs = [job("a1", "A", "picture", now - 4000), job("a2", "A", "picture", now - 3000), job("a3", "A", "picture", now - 2000), job("b1", "B", "picture", now - 1000)];
    expect(order(jobs, now)).toEqual([{ id: "a1", position: 1 }, { id: "b1", position: 2 }, { id: "a2", position: 3 }, { id: "a3", position: 4 }]);
  });

  test("releases Stack submissions in round-robin order, one unstarted job per kind", async () => {
    const entries = [
      { job: job("a1", "A", "picture", now - 4000), waiting: false },
      { job: job("a2", "A", "picture", now - 3000), waiting: false },
      { job: job("a3", "A", "picture", now - 2000), waiting: false },
      { job: job("b1", "B", "picture", now - 1000), waiting: false },
    ];
    const submitted: string[] = [];
    const remove = registerQueueProvider(() => entries.map((entry) => ({
      job: entry.job,
      stackWaiting: entry.waiting,
      release: entry.job.state === "queued" && !entry.waiting ? async () => { entry.waiting = true; submitted.push(entry.job.id); } : undefined,
      save: () => undefined,
    })));
    try {
      await releaseHouseholdQueue();
      entries[0]!.job.state = "running";
      entries[0]!.waiting = false;
      await releaseHouseholdQueue();
      entries[0]!.job.state = "done";
      entries[3]!.job.state = "running";
      entries[3]!.waiting = false;
      await releaseHouseholdQueue();
      entries[1]!.job.state = "done";
      entries[1]!.waiting = false;
      entries[3]!.job.state = "done";
      await releaseHouseholdQueue();
      expect(submitted).toEqual(["a1", "b1", "a2", "a3"]);
    } finally { remove(); }
  });

  test("a cancelled held job is never released to Stack", async () => {
    const held = job("held", "A", "video", now - 1000);
    held.state = "cancelled";
    let submits = 0;
    const remove = registerQueueProvider(() => [{ job: held, save: () => undefined,
      release: held.state === "queued" ? async () => { submits += 1; } : undefined }]);
    try { await releaseHouseholdQueue(); expect(submits).toBe(0); }
    finally { remove(); }
  });

  test("a job awaiting a consent approval takes no place in line and is never released", async () => {
    const held = job("held", "A", "picture", now - 5000, { awaitingApproval: true });
    const ready = job("ready", "B", "picture", now - 1000);
    expect(order([held, ready], now)).toEqual([{ id: "ready", position: 1 }]);
    const released: string[] = [];
    const remove = registerQueueProvider(() => [held, ready].map((entry) => ({ job: entry, save: () => undefined, release: entry.state === "queued" ? async () => { released.push(entry.id); } : undefined })));
    try { await releaseHouseholdQueue(); expect(released).toEqual(["ready"]); }
    finally { remove(); }
    held.awaitingApproval = false;
    expect(order([held, ready], now).map((item) => item.id)).toEqual(["held", "ready"]);
  });

  test("promotes a video to picture class after ten minutes", () => {
    const picture = job("picture", "A", "picture", now - 1000);
    const video = job("video", "B", "video", now - 10 * 60_000 + 1);
    expect(order([picture, video], now).map((item) => item.id)).toEqual(["picture", "video"]);
    video.createdAt = now - 10 * 60_000;
    expect(order([picture, video], now).map((item) => item.id)).toEqual(["video", "picture"]);
  });

  test("backfills a fitting picture beside a paused clip", () => {
    const clip = job("clip", "A", "video", now - 11 * 60_000, { resourcePaused: true, remainingSeconds: 50 });
    const fitting = job("fitting", "B", "picture", now - 1000, { backfillFits: true, typicalSeconds: 20 });
    const tooLarge = job("large", "C", "picture", now - 500, { backfillFits: false, typicalSeconds: 90 });
    expect(order([clip, fitting], now).map((item) => item.id)).toEqual(["fitting", "clip"]);
    expect(order([clip, tooLarge], now).map((item) => item.id)).toEqual(["clip", "large"]);
  });

  test("keeps other people's first request ahead of a person's later requests", () => {
    const jobs = Array.from({ length: 20 }, (_, index) => job(`a${index}`, "A", "picture", now - 20_000 + index))
      .concat(job("b1", "B", "picture", now - 1000));
    expect(order(jobs, now)[1]).toEqual({ id: "b1", position: 2 });
  });

  test("explains a number that rises when another person's first job joins the class", () => {
    const jobs = [job("a1", "A", "picture", now - 3000), job("a2", "A", "picture", now - 2000), job("a3", "A", "picture", now - 1000)];
    writePositions(jobs, now, () => undefined);
    const other = job("b1", "B", "picture", now);
    writePositions([...jobs, other], now, () => undefined);
    expect(jobs[1]!.position).toBe(3);
    expect(jobs[1]!.riseReason).toBe("other_person_first");
  });

  test("writes live positions and a rise reason, then drops positions when the head starts", () => {
    const jobs = [job("v1", "A", "video", now - 3000), job("v2", "B", "video", now - 2000), job("v3", "C", "video", now - 1000)];
    writePositions(jobs, now, (item) => undefined);
    expect(jobs.map((item) => item.position)).toEqual([1, 2, 3]);
    const picture = job("p1", "D", "picture", now);
    writePositions([...jobs, picture], now, (item) => undefined);
    expect(jobs[1]!.position).toBe(3);
    expect(jobs[1]!.riseReason).toBe("higher_class");
    jobs[0]!.state = "running";
    writePositions([...jobs, picture], now, (item) => undefined);
    expect(jobs.slice(1).map((item) => item.position)).toEqual([2, 3]);
    expect(jobs[0]!.position).toBeNull();
  });

  test("only invokes the job store hook and never a notification hook", () => {
    const writes: string[] = [];
    const notificationsBefore = db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).all();
    writePositions([job("one", "A", "picture", now)], now, (item) => writes.push(item.id));
    expect(writes).toEqual(["one"]);
    expect(db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).all()).toEqual(notificationsBefore);
  });
});
