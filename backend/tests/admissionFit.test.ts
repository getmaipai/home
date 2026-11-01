import { afterEach, describe, expect, test } from "bun:test";
import { fitForAdmission, memoryNowFromBudget, resetFitHysteresisForTests, setProfileSource, type ProfileSource } from "../src/lib/jobs/admissionFit";
import type { ProfileRow } from "../src/lib/jobs/profileTable";

const maxVideo: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "standard" }, video: { state: "max" }, picture: { state: "boost" }, voice: { state: "standard" } } };
const boostVideo: ProfileRow = { ...maxVideo, tier: "boost", cells: { ...maxVideo.cells, video: { state: "boost" } } };
const source: ProfileSource = { table: [maxVideo, boostVideo], hw: { budgetGb: 80, marginGb: 2, peakGb: { video: { max: 60, boost: 40 } }, residentGb: { chat: { standard: 1 }, picture: { boost: 1 }, voice: { standard: 1 } } }, pins: {}, priorityWeight: { picture: 1 }, lowerWithoutAsking: { video: true } };
afterEach(() => { setProfileSource(null); resetFitHysteresisForTests(); });

describe("admission fit", () => {
  test("converts budget bytes to decimal GB and counts only unpinned warm or burst items whose footprint was measured", () => {
    expect(memoryNowFromBudget({ freeMemoryBytes: 12e9, loaded: [
      { class: "warm", peakBytes: 2e9, pinned: false, measured: true }, { class: "burst", peakBytes: 3e9, pinned: false, measured: true },
      { class: "warm", peakBytes: 5e9, pinned: true, measured: true }, { class: "cold", peakBytes: 7e9, pinned: false, measured: true },
      { class: "warm", peakBytes: 11e9, pinned: false, measured: false }, { class: "burst", peakBytes: 13e9, pinned: false },
    ] })).toEqual({ freeGb: 12, evictableGb: 5 });
  });
  test("returns null without a configured profile source", async () => {
    expect(await fitForAdmission({ jobClass: "video", tier: "max" }, async () => ({ freeMemoryBytes: 62e9, loaded: [] }))).toBeNull();
  });
  test("returns null for Standard jobs", async () => {
    setProfileSource(source);
    expect(await fitForAdmission({ jobClass: "video", tier: "standard" }, async () => ({ freeMemoryBytes: 62e9, loaded: [] }))).toBeNull();
  });
  test("returns null if budget read fails or no matching row exists", async () => {
    setProfileSource(source);
    expect(await fitForAdmission({ jobClass: "video", tier: "max" }, async () => { throw new Error("offline"); })).toBeNull();
    expect(await fitForAdmission({ jobClass: "picture", tier: "max" }, async () => ({ freeMemoryBytes: 62e9, loaded: [] }))).toBeNull();
  });
  test("runs a matching row against live memory", async () => {
    setProfileSource(source);
    const result = await fitForAdmission({ jobClass: "video", tier: "max" }, async () => ({ freeMemoryBytes: 66e9, loaded: [] }));
    expect(result?.outcome).toBe("run");
  });
  // MAX-LIVE-01 (Home side). The Max video row needs 63 GB (60 peak plus 3 of supporting residents); the machine keeps a 2 GB working margin.
  const clean = (r: Awaited<ReturnType<typeof fitForAdmission>>) => r?.outcome === "run" && r.lowered.length === 0 && !r.belowPick;
  const job = { id: "j1", jobClass: "video" as const, tier: "max" as const };
  test("the same Max job runs on an idle machine and does not run when other programs hold the memory (fake Stack reporting low available memory)", async () => {
    setProfileSource(source);
    const idle = await fitForAdmission(job, async () => ({ freeMemoryBytes: 90e9, loaded: [] }));
    expect(idle?.outcome).toBe("run"); expect(idle?.lowered).toEqual([]);
    resetFitHysteresisForTests();
    const busy = await fitForAdmission(job, async () => ({ freeMemoryBytes: 25e9, loaded: [] })); // others hold 45 GB of 70 GB
    expect(busy?.outcome).not.toBe("run");
    expect(busy?.haveGb).toBeCloseTo(23, 1); // 25 GB available less the 2 GB working margin
  });
  test("the working margin is taken out of what is free: 63 GB needed, 64 GB free, 2 GB kept back", async () => {
    setProfileSource(source);
    expect(clean(await fitForAdmission(job, async () => ({ freeMemoryBytes: 64e9, loaded: [] })))).toBe(false);
    resetFitHysteresisForTests();
    expect(clean(await fitForAdmission(job, async () => ({ freeMemoryBytes: 65.5e9, loaded: [] })))).toBe(true);
  });
  test("an idle model counts as room only when its footprint was measured; a ledger guess does not", async () => {
    setProfileSource(source);
    const read = (measured: boolean) => async () => ({ freeMemoryBytes: 52e9, loaded: [{ class: "warm", peakBytes: 14e9, pinned: false, measured }] });
    const guessed = await fitForAdmission(job, read(false));
    expect(clean(guessed)).toBe(false);
    resetFitHysteresisForTests();
    expect(clean(await fitForAdmission(job, read(true)))).toBe(true);
  });
  test("hysteresis: a job that just did not fit waits for one more GB before it runs, so a reading at the edge does not flap", async () => {
    setProfileSource(source);
    const at = (freeGb: number) => fitForAdmission(job, async () => ({ freeMemoryBytes: freeGb * 1e9, loaded: [] }));
    expect(clean(await at(64))).toBe(false); // needs 65
    expect(clean(await at(65.5))).toBe(false); // fits by half a GB, inside the band
    expect(clean(await at(66.5))).toBe(true); // clear of the band
    expect(clean(await at(65.5))).toBe(true); // a clean run stays a run (the job is released)
  });
  test("an unreadable memory sampler gives no Home-side answer; the Stack's own governor decides", async () => {
    setProfileSource(source);
    expect(await fitForAdmission(job, async () => ({ freeMemoryBytes: 10e9, loaded: [], readingDegraded: true }))).toBeNull();
  });
});
