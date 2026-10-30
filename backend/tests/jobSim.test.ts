import { describe, expect, test } from "bun:test";
import { checkInvariants, seededJobs, simulate, type SimJob } from "../src/lib/jobs/jobSim";
import { DEFAULT_POLICY } from "../src/lib/jobs/jobScore";

const bounds = { picture: 1800, video: 3600, music: 3600, tools: 7200, background: 14400 } as const;
describe("job replay", () => {
  test("keeps seeded days within category bounds", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const jobs = seededJobs(seed, 60, 3);
      expect(checkInvariants(simulate(jobs, DEFAULT_POLICY), jobs, bounds)).toEqual([]);
    }
  });
  test("does not let a video run take ten slots before another person", () => {
    const jobs: SimJob[] = Array.from({ length: 10 }, (_, index) => ({ id: `a${index}`, personId: "a", category: "video" as const, arriveAt: 0, durationSec: 30 }))
      .concat({ id: "b", personId: "b", category: "video" as const, arriveAt: 1, durationSec: 30 });
    expect(simulate(jobs, DEFAULT_POLICY).started.b).toBeLessThanOrEqual(60);
  });
});
