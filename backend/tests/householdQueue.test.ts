import { describe, expect, test } from "bun:test";
import { db } from "../src/db";
import { notificationDeliveries } from "../src/db/schema";
import { admit, order, requeueAfterCritical, registerQueueProvider, releaseHouseholdQueue, stillRunningMinutes, writePositions, type QueueJob, type TierState } from "../src/lib/jobs/householdQueue";

const now = Date.parse("2026-10-25T12:00:00.000Z");
const emptyTierState: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: null };
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

  test("promotes a video to picture class after ten minutes", () => {
    const picture = job("picture", "A", "picture", now - 1000);
    const video = job("video", "B", "video", now - 10 * 60_000 + 1);
    expect(order([picture, video], now).map((item) => item.id)).toEqual(["picture", "video"]);
    video.createdAt = now - 10 * 60_000;
    expect(order([picture, video], now).map((item) => item.id)).toEqual(["video", "picture"]);
  });

  test("ages a Max video up one class after ten minutes", () => {
    const picture = job("picture", "A", "picture", now - 1000);
    const maxVideo = job("max-video", "B", "video", now - 10 * 60_000, { tier: "max" });
    expect(order([picture, maxVideo], now).map((item) => item.id)).toEqual(["max-video", "picture"]);
  });

  test("T1 permits only one running Boost or Max job, leaving Standard unaffected", () => {
    const runningBoost = job("rb", "A", "other", now, { tier: "boost", state: "running" });
    const queuedBoost = job("qb", "B", "picture", now, { tier: "boost" });
    const standard = job("s", "C", "video", now, { tier: "standard" });
    expect(admit([runningBoost, queuedBoost, standard], now, emptyTierState)).toEqual({ start: ["s"], holds: { qb: "heavy_slot" } });
  });

  test("T2 drains running work for the first Max and holds admissions behind it", () => {
    const running = job("run", "A", "other", now, { state: "running" });
    const max = job("max", "B", "video", now, { tier: "max" });
    const after = job("after", "C", "other", now + 1);
    expect(admit([running, max, after], now, emptyTierState)).toEqual({ start: [], holds: { max: "max_drain", after: "max_drain" } });
  });

  test("T3 open Max window holds every other queued job", () => {
    const max = job("max", "A", "video", now, { state: "running", tier: "max" });
    const standard = job("standard", "B", "picture", now);
    expect(admit([max, standard], now, { ...emptyTierState, windowOpenFor: "max" })).toEqual({ start: [], holds: { standard: "max_window" } });
  });

  test("T4a Max does not jump queued jobs ahead of it", () => {
    const ahead = job("ahead", "A", "picture", now);
    const max = job("max", "B", "video", now, { tier: "max" });
    expect(admit([ahead, max], now, emptyTierState)).toEqual({ start: ["ahead"], holds: { max: "max_drain" } });
    const behind = job("behind", "C", "other", now + 1);
    expect(admit([ahead, max, behind], now + 1, emptyTierState)).toEqual({ start: ["ahead"], holds: { max: "max_drain", behind: "max_drain" } });
  });

  test("T4b waits for other people's first queued non-Max jobs before another Max", () => {
    const max = job("max", "A", "video", now, { tier: "max" });
    const nonMax = job("other-job", "B", "picture", now + 1);
    const state: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: "A" };
    expect(admit([max, nonMax], now, state)).toEqual({ start: ["other-job"], holds: { max: "fairness_wait" } });
  });

  test("over-estimate running Max work does not cancel or alter other admissions", () => {
    const max = job("max", "A", "other", now, { state: "running", tier: "max", remainingSeconds: 601 });
    const standard = job("standard", "B", "picture", now);
    expect(stillRunningMinutes(max)).toBe(11);
    expect(admit([max, standard], now, emptyTierState)).toEqual({ start: ["standard"], holds: {} });
    expect(max.state).toBe("running");
  });

  test("T5 requeues twice before low-memory failure", () => {
    expect(requeueAfterCritical({ requeues: 0 })).toBe("requeue_head");
    expect(requeueAfterCritical({ requeues: 1 })).toBe("requeue_head");
    expect(requeueAfterCritical({ requeues: 2 })).toBe("fail_low_memory");
  });

  test("still running estimate is only shown for running jobs past their estimate", () => {
    expect(stillRunningMinutes(job("queued", "A", "picture", now, { remainingSeconds: 61 }))).toBeNull();
    expect(stillRunningMinutes(job("running", "A", "picture", now, { state: "running", remainingSeconds: 60 }))).toBe(1);
    expect(stillRunningMinutes(job("no-estimate", "A", "picture", now, { state: "running" }))).toBeNull();
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
