import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY, scoreJobs, type ScoreJob } from "../src/lib/jobs/jobScore";

const now = 10_000_000;
function job(id: string, personId: string, category: ScoreJob["category"], createdAt: number, extra: Partial<ScoreJob> = {}): ScoreJob {
  return { id, personId, category, state: "queued", createdAt, ...extra };
}
describe("job scoring", () => {
  test("orders classes and caps smooth aging below the next class", () => {
    const jobs = [job("p", "a", "picture", now), job("v", "b", "video", now), job("m", "c", "music", now)];
    expect(scoreJobs(jobs, DEFAULT_POLICY, now, {}).map((item) => item.id)).toEqual(["p", "v", "m"]);
    const aged = scoreJobs([job("old-v", "a", "video", now - 30 * 60_000), job("fresh-p", "b", "picture", now)], DEFAULT_POLICY, now, {});
    expect(aged.find((item) => item.id === "old-v")!.terms.aging).toBe(20);
    expect(aged.map((item) => item.id)).toEqual(["old-v", "fresh-p"]);
  });
  test("fair share, boost, limits, ties, reasons and child cap", () => {
    const jobs = [job("low-use", "a", "video", now, { adminBoost: 50 }), job("high-use", "b", "video", now - 1)];
    const scored = scoreJobs(jobs, DEFAULT_POLICY, now, { a: 0, b: 100 });
    expect(scored[0]!.id).toBe("low-use");
    expect(scored[0]!.reason).toBe("boost");
    expect(scored[0]!.terms.fairShare).toBe(20);
    expect(scoreJobs([job("capped", "a", "picture", now, { childDailyCapReached: true })], DEFAULT_POLICY, now, {})).toEqual([]);
    const blocked = scoreJobs([job("run", "a", "picture", now, { state: "running" }), job("wait", "a", "video", now)], DEFAULT_POLICY, now, {});
    expect(blocked[0]!.startable).toBe(false);
    const ties = scoreJobs([job("later", "a", "video", now + 10), job("older", "b", "video", now)], DEFAULT_POLICY, now, {});
    expect(ties[0]!.id).toBe("older");
    expect(ties[0]!.reason).toBe("arrival");
    expect(scoreJobs([job("class", "a", "picture", now), job("next", "b", "video", now)], DEFAULT_POLICY, now, {})[0]!.reason).toBe("class");
    expect(scoreJobs([job("aged", "a", "video", now - 1000), job("new", "b", "video", now)], DEFAULT_POLICY, now, {})[0]!.reason).toBe("aging");
    expect(scoreJobs([job("fair", "a", "video", now), job("used", "b", "video", now)], DEFAULT_POLICY, now, { b: 100 })[0]!.reason).toBe("fair_share");
    expect(scoreJobs([job("boost", "a", "video", now, { adminBoost: 5 }), job("plain", "b", "video", now)], DEFAULT_POLICY, now, {})[0]!.reason).toBe("boost");
  });
  test("does not mutate input", () => {
    const jobs = [job("x", "a", "picture", now)];
    const before = structuredClone(jobs);
    scoreJobs(jobs, DEFAULT_POLICY, now, {});
    expect(jobs).toEqual(before);
  });
});
