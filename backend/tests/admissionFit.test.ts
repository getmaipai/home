import { afterEach, describe, expect, test } from "bun:test";
import { fitForAdmission, memoryNowFromBudget, setProfileSource, type ProfileSource } from "../src/lib/jobs/admissionFit";
import type { ProfileRow } from "../src/lib/jobs/profileTable";

const maxVideo: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "standard" }, video: { state: "max" }, picture: { state: "boost" }, voice: { state: "standard" } } };
const boostVideo: ProfileRow = { ...maxVideo, tier: "boost", cells: { ...maxVideo.cells, video: { state: "boost" } } };
const source: ProfileSource = { table: [maxVideo, boostVideo], hw: { budgetGb: 80, marginGb: 2, peakGb: { video: { max: 60, boost: 40 } }, residentGb: { chat: { standard: 1 }, picture: { boost: 1 }, voice: { standard: 1 } } }, pins: {}, priorityWeight: { picture: 1 }, lowerWithoutAsking: { video: true } };
afterEach(() => setProfileSource(null));

describe("admission fit", () => {
  test("converts budget bytes to decimal GB and counts only unpinned warm or burst items", () => {
    expect(memoryNowFromBudget({ freeMemoryBytes: 12e9, loaded: [
      { class: "warm", peakBytes: 2e9, pinned: false }, { class: "burst", peakBytes: 3e9, pinned: false },
      { class: "warm", peakBytes: 5e9, pinned: true }, { class: "cold", peakBytes: 7e9, pinned: false },
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
    const result = await fitForAdmission({ jobClass: "video", tier: "max" }, async () => ({ freeMemoryBytes: 62e9, loaded: [] }));
    expect(result?.outcome).toBe("run");
  });
});
