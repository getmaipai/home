import { describe, expect, test } from "bun:test";
import table from "../../../../shared/diskPlan.json";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import { buildAiCards } from "../../../../shared/aiChoices";
import { cardsFor, fakeCopy } from "./planFixtures";
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
    expect(detailed.has("video-ltx25")).toBe(true);
    expect(detailed.has("video")).toBe(false);
  });

  test("settings carry the chosen model and switch the music and detailed pictures off", () => {
    const plan = plans.p128!;
    const jobs = setupJobs(cardsFor(plan).cards, plan);
    const picks = defaultPicks(jobs, plan);
    const base = settingsFor(jobs, picks);
    expect(base["engines.image.tier.standard"]).toBe("ernie");
    expect(base["generation.music.enabled"]).toBe(false);
    expect(settingsFor(jobs, { ...picks, music: { on: true, choiceId: "music.make" } })["generation.music.enabled"]).toBe(true);
    expect(settingsFor(jobs, { ...picks, videos: { on: true, choiceId: "videos.detailed" } })["generation.video_tier"]).toBe("boost");
  });
});

describe("the hub's own parts in the wizard", () => {
  const plan = plans.p128!;
  const cards = () => buildAiCards({ copy: fakeCopy, plan, components: null, settings: { pictureQuickModel: "ernie", pictureDetailedEnabled: false, videoQuality: "quick", musicEnabled: false }, freeBytes: null, faces: { installed: false, bytes: 38_926_091 }, ingredients: { installed: false, bytes: 1_308_787_472, blockedReason: "Add it after setup in Settings, AI and models." } }).cards;

  test("the face finder starts on and is a hub row; the adapter is listed but blocked and off", () => {
    const jobs = setupJobs(cards(), plan);
    const byJob = Object.fromEntries(jobs.map((job) => [job.job, job]));
    expect(byJob.faces!.hubPart).toBe(true);
    expect(byJob.faces!.blocked).toBeNull();
    expect(byJob.ingredients!.blocked).toContain("Settings, AI and models");
    const picks = defaultPicks(jobs, plan);
    expect(picks.faces).toEqual({ on: true, choiceId: "faces.finder" });
    expect(picks.ingredients!.on).toBe(false);
    const rows = selectedRows(jobs, plan, picks);
    expect(rows.has("faces-finder")).toBe(true);
    expect(rows.has("ingredients-adapter")).toBe(false);
    for (const id of plan.default_selected) expect(rows.has(id)).toBe(true);
  });
});
