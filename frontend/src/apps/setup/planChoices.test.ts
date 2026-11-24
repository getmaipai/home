import { describe, expect, test } from "bun:test";
import table from "../../../../shared/diskPlan.json";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import { jobsFor } from "./planFixtures";
import { defaultPicks, selectedRows } from "./planChoices";

const plans = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers;
describe("setup units", () => {
  test("the default picks install exactly the disk plan's default rows on every tier", () => {
    for (const tier of ["p16", "p32", "p64", "p128"]) {
      const plan = plans[tier]!;
      const jobs = jobsFor(plan);
      expect([...selectedRows(jobs, plan, defaultPicks(jobs))].sort()).toEqual([...plan.default_selected].sort());
    }
  });

  test("required units cannot be off, optional ones start off, and an adult-only home has no minors-only video row", () => {
    const plan = plans.p128!;
    const jobs = jobsFor(plan);
    const byJob = Object.fromEntries(jobs.map((job) => [job.job, job]));
    expect(byJob.chat!.required).toBe(true);
    expect(byJob.music!.required).toBe(false);
    const picks = defaultPicks(jobs);
    expect(picks.music).toBe(false);
    expect(picks.videos).toBe(false);
    expect(byJob.videos!.rowIds).toEqual(["video-ltx25"]);
    expect(selectedRows(jobs, plan, picks).has("video")).toBe(false);
  });

  test("WAN-DEFAULT-01: a home with a child or teen gets the minors-only video row on by default, and it installs", () => {
    const plan = plans.p128!;
    const jobs = jobsFor(plan, { householdHasMinors: true });
    const videos = jobs.find((job) => job.job === "videos")!;
    expect(videos.rowIds).toContain("video");
    expect(defaultPicks(jobs).videos).toBe(true);
    expect(selectedRows(jobs, plan, defaultPicks(jobs)).has("video")).toBe(true);
  });

  test("turning a unit on adds its recommended rows and off drops them", () => {
    const plan = plans.p128!;
    const jobs = jobsFor(plan);
    const picks = defaultPicks(jobs);
    const music = jobs.find((job) => job.job === "music")!;
    for (const id of music.rowIds) expect(selectedRows(jobs, plan, picks).has(id)).toBe(false);
    for (const id of music.rowIds) expect(selectedRows(jobs, plan, { ...picks, music: true }).has(id)).toBe(true);
  });

  test("a hub part that is blocked stays off; one that is installed or the face finder starts on", () => {
    const plan = plans.p128!;
    const jobs = jobsFor(plan, { hub: {
      faces: { installed: false, bytes: 1, label: "Faces", description: "d" },
      ingredients: { installed: false, bytes: 2, blockedReason: "Add it after setup.", label: "Adapter", description: "d" },
    } });
    const picks = defaultPicks(jobs);
    expect(picks.faces).toBe(true);
    expect(picks.ingredients).toBe(false);
    expect(jobs.find((job) => job.job === "ingredients")!.blocked).toBe("Add it after setup.");
    expect(selectedRows(jobs, plan, picks).has("faces-finder")).toBe(true);
  });

  test("a plan without the music row has no Music unit (its helper rows never stand in for it)", () => {
    for (const tier of ["p16", "p32"]) {
      const plan = plans[tier]!;
      const hasMusic = plan.rows.some((row) => row.id === "music");
      expect(jobsFor(plan).some((job) => job.job === "music")).toBe(hasMusic);
    }
  });
});
