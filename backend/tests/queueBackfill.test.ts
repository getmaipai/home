// QUEUE-FIT-01: the household queue backfills jobs that fit and never leaves a quick job behind a big one that cannot run.
// Stack fit is not involved here: `admit` is pure, and the release test uses Standard jobs only (the Stack decides memory).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { admit, registerQueueProvider, releaseHouseholdQueue, resetTierStateForTests, setQueuePolicySource, type QueueJob, type TierState } from "../src/lib/jobs/householdQueue";
import { DEFAULT_POLICY } from "../src/lib/jobs/jobScore";

const now = Date.parse("2026-11-15T12:00:00.000Z");
const MIN = 60_000;
const empty: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: null };
function job(id: string, personId: string, jobClass: QueueJob["jobClass"], createdAt: number, extra: Partial<QueueJob> = {}): QueueJob {
  return { id, personId, jobClass, state: "queued", createdAt, ...extra };
}

describe("queue backfill", () => {
  beforeEach(() => { resetTierStateForTests(); setQueuePolicySource(null); });
  afterEach(() => { setQueuePolicySource(null); });

  test("a: a Standard song starts beside a running picture while a Max video drains", () => {
    const running = job("pic", "A", "picture", now - MIN, { state: "running" });
    const video = job("video", "B", "video", now - MIN, { tier: "max" });
    const song = job("song", "C", "other", now, { category: "music" });
    expect(admit([running, video, song], now, empty)).toEqual({ start: ["song"], holds: { video: "max_drain" } });
  });

  test("b: once the Max video has waited past the limit, the song holds too", () => {
    const running = job("pic", "A", "picture", now - 20 * MIN, { state: "running" });
    const video = job("video", "B", "video", now - 11 * MIN, { tier: "max" });
    const song = job("song", "C", "other", now, { category: "music" });
    expect(admit([running, video, song], now, empty)).toEqual({ start: [], holds: { video: "max_drain", song: "max_drain" } });
  });

  test("b2: the limit is resources.max_wait_before_aging.<kind> when set", () => {
    setQueuePolicySource(() => ({ ...DEFAULT_POLICY, maxWaitBeforeAgingMinutes: { video: 2 } }));
    const running = job("pic", "A", "picture", now - 20 * MIN, { state: "running" });
    const video = job("video", "B", "video", now - 3 * MIN, { tier: "max" });
    const song = job("song", "C", "other", now, { category: "music" });
    expect(admit([running, video, song], now, empty).start).toEqual([]);
    setQueuePolicySource(() => ({ ...DEFAULT_POLICY, maxWaitBeforeAgingMinutes: { video: 5 } }));
    expect(admit([running, video, song], now, empty).start).toEqual(["song"]);
  });

  test("c: a Standard picture starts beside a running Boost while a Boost video holds heavy_slot", () => {
    const running = job("boost", "A", "picture", now - MIN, { state: "running", tier: "boost" });
    const video = job("video", "B", "video", now - MIN, { tier: "boost" });
    const picture = job("pic", "C", "picture", now);
    expect(admit([running, video, picture], now, empty)).toEqual({ start: ["pic"], holds: { video: "heavy_slot" } });
  });

  test("c2: a Boost job that has aged past the limit holds a later Standard job (aged_guard)", () => {
    const running = job("boost", "A", "picture", now - 30 * MIN, { state: "running", tier: "boost" });
    const video = job("video", "B", "video", now - 11 * MIN, { tier: "boost" });
    const picture = job("pic", "C", "other", now, { category: "music" });
    expect(admit([running, video, picture], now, empty)).toEqual({ start: [], holds: { video: "heavy_slot", pic: "aged_guard" } });
  });

  test("d: three Standard jobs with nothing running all start", () => {
    const jobs = ["A", "B", "C"].map((p, i) => job(`s${p}`, p, "picture", now + i));
    expect(admit(jobs, now, empty)).toEqual({ start: ["sA", "sB", "sC"], holds: {} });
  });

  test("e: per-person cap 1 holds a person's second Standard job; another person's still starts", async () => {
    setQueuePolicySource(() => ({ ...DEFAULT_POLICY, maxConcurrentPerPerson: 1 }));
    const jobs = [job("run", "A", "picture", now - MIN, { state: "running" }), job("a2", "A", "picture", now - 30_000), job("b1", "B", "picture", now - 20_000)];
    const released: string[] = [];
    const remove = registerQueueProvider(() => jobs.map((j) => ({ job: j, save: () => undefined, release: async () => { released.push(j.id); } })));
    try { await releaseHouseholdQueue(); } finally { remove(); }
    expect(released).toEqual(["b1"]);
  });

  test("f: fairness after a Max (T4) still lets another person's first job go first", () => {
    const max = job("max", "A", "video", now, { tier: "max" });
    const other = job("other", "B", "picture", now + 1);
    const state: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: "A" };
    expect(admit([max, other], now, state)).toEqual({ start: ["other"], holds: { max: "fairness_wait" } });
  });

  test("g: a Max alone with nothing running starts at once", () => {
    expect(admit([job("max", "A", "video", now, { tier: "max" })], now, empty)).toEqual({ start: ["max"], holds: {} });
  });

  test("a Max never starts beside a job started in the same pass", () => {
    const std = job("std", "A", "picture", now - 1000);
    const max = job("max", "B", "video", now, { tier: "max" });
    expect(admit([std, max], now, empty)).toEqual({ start: ["std"], holds: { max: "max_drain" } });
  });
});
