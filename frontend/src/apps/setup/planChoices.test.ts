import { describe, expect, test } from "bun:test";
import table from "../../../../shared/diskPlan.json";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import { cardsFor } from "./planFixtures";
import { defaultPicks, selectedRows, settingsFor, setupJobs } from "./planChoices";

const plans = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers;
describe("setup jobs", () => {
  test("the default picks install exactly the disk plan's default rows on every tier", () => {
    for (const tier of ["p16", "p64", "p128"]) {
      const plan = plans[tier]!;
      const jobs = setupJobs(cardsFor(plan).cards, plan);
      expect([...selectedRows(jobs, plan, defaultPicks(jobs, plan))].sort()).toEqual([...plan.default_selected].sort());
    }
  });

  test("required jobs cannot be off, optional ones start off, and the wake word is not asked", () => {
    const plan = plans.p128!;
    const jobs = setupJobs(cardsFor(plan).cards, plan);
    const byJob = Object.fromEntries(jobs.map((job) => [job.job, job]));
    expect(byJob.chat!.required).toBe(true);
    expect(byJob.music!.required).toBe(false);
    expect(byJob.wakeword).toBeUndefined();
    const picks = defaultPicks(jobs, plan);
    expect(picks.music!.on).toBe(false);
    expect(picks.picturesdetailed!.on).toBe(false);
    expect(picks.videos).toEqual({ on: true, choiceId: "videos.quick" });
  });

  test("turning a job off drops its rows, and choosing Detailed videos swaps the row", () => {
    const plan = plans.p128!;
    const jobs = setupJobs(cardsFor(plan).cards, plan);
    const picks = defaultPicks(jobs, plan);
    expect([...selectedRows(jobs, plan, { ...picks, videos: { on: false, choiceId: "videos.quick" } })]).not.toContain("video");
    const detailed = selectedRows(jobs, plan, { ...picks, videos: { on: true, choiceId: "videos.detailed" } });
    expect(detailed.has("video-detailed")).toBe(true);
    expect(detailed.has("video")).toBe(false);
  });

  test("settings carry the chosen model and switch the music and detailed pictures off", () => {
    const plan = plans.p128!;
    const jobs = setupJobs(cardsFor(plan).cards, plan);
    const picks = defaultPicks(jobs, plan);
    const base = settingsFor(jobs, picks);
    expect(base["generation.picture_quick_model"]).toBe("ernie");
    expect(base["generation.music.enabled"]).toBe(false);
    expect(settingsFor(jobs, { ...picks, music: { on: true, choiceId: "music.make" } })["generation.music.enabled"]).toBe(true);
    expect(settingsFor(jobs, { ...picks, videos: { on: true, choiceId: "videos.detailed" } })["generation.video_quality"]).toBe("detailed");
  });
});
