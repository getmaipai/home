// TIER-PRIO-02/06: the household queue reads its policy from the household settings. Each test sets a real setting and watches the queue order or
// release change; the policy source is the same `wireQueuePolicy` that start-up calls.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { queuePolicyFromSettings, wireQueuePolicy } from "@/lib/jobs/queuePolicy";
import { DEFAULT_POLICY } from "@/lib/jobs/jobScore";
import { order, registerQueueProvider, releaseHouseholdQueue, resetTierStateForTests, setQueuePolicySource, type QueueJob } from "@/lib/jobs/householdQueue";

const now = Date.parse("2026-11-01T12:00:00.000Z");
const job = (id: string, personId: string, jobClass: QueueJob["jobClass"], createdAt: number, extra: Partial<QueueJob> = {}): QueueJob => ({ id, personId, jobClass, state: "queued", createdAt, ...extra });
const first = (jobs: QueueJob[]) => order(jobs, now).find((item) => item.position === 1)!.id;

beforeEach(() => { resetDb(); resetTierStateForTests(); wireQueuePolicy(); });
afterEach(() => { setQueuePolicySource(null); });

describe("queuePolicyFromSettings", () => {
  test("the shipped settings give exactly the shipped policy", () => {
    const policy = queuePolicyFromSettings(() => undefined);
    expect(policy.classWeights).toEqual(DEFAULT_POLICY.classWeights);
    expect(policy.maxConcurrentPerPerson).toBe(1);
    expect(policy.maxWaitBeforeAgingMinutes).toEqual({});
  });
  test("the default setting values change nothing either", () => {
    const read = (key: string) => ({ "resources.priority": '["chat","image","video","music"]', "resources.max_concurrent_per_person": 1, "resources.max_wait_before_aging.image": 0, "resources.strict.image": false })[key];
    expect(queuePolicyFromSettings(read)).toEqual({ ...DEFAULT_POLICY, maxWaitBeforeAgingMinutes: {} });
  });
});

describe("resources.priority decides who goes first", () => {
  test("the shipped order puts a picture before a song, and moving music up puts the song first", () => {
    const jobs = [job("song", "a", "other", now - 1000, { category: "music" }), job("pic", "b", "picture", now - 1000)];
    expect(first(jobs)).toBe("pic");
    setHouseholdSettingValue("resources.priority", '["chat","music","image","video"]');
    expect(first(jobs)).toBe("song");
  });
});

describe("strict kinds and the aging delay", () => {
  test("a strict kind goes before another kind that waited much longer", () => {
    const jobs = [job("pic", "a", "picture", now - 50 * 60_000), job("vid", "b", "video", now - 1000)];
    expect(first(jobs)).toBe("pic");
    setHouseholdSettingValue("resources.strict.video", true);
    expect(first(jobs)).toBe("vid");
  });
  test("the aging delay holds back a waiting job's climb", () => {
    // A song that waited 20 minutes has climbed the whole gap to a video (30 to 40) and, being older, goes first; 20 minutes of grace keeps it behind.
    const jobs = [job("vid", "a", "video", now), job("song", "b", "other", now - 20 * 60_000, { category: "music" })];
    expect(first(jobs)).toBe("song");
    setHouseholdSettingValue("resources.max_wait_before_aging.music", 20);
    expect(first(jobs)).toBe("vid");
  });
});

describe("resources.max_concurrent_per_person decides how many of one person's jobs start", () => {
  const releaseTwo = async () => {
    const released: string[] = [];
    const jobs = [job("pic", "p1", "picture", now), job("vid", "p1", "video", now + 1)];
    const remove = registerQueueProvider(() => jobs.map((item) => ({ job: item, save: () => undefined, release: async () => { released.push(item.id); } })));
    try { await releaseHouseholdQueue(); } finally { remove(); }
    return released;
  };
  test("one at a time by default, two when the limit is raised", async () => {
    expect(await releaseTwo()).toHaveLength(1);
    setHouseholdSettingValue("resources.max_concurrent_per_person", 2);
    expect(await releaseTwo()).toHaveLength(2);
  });
});
