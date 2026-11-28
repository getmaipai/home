import { describe, expect, test } from "bun:test";
import { applySkip, mapTime, type SkipPlan } from "./skipPlan";

describe("shared skip plan", () => {
  const plan: SkipPlan = { state: "ready", ranges: [{ startSec: 10, endSec: 20, kind: "ad", status: "auto" }, { startSec: 30, endSec: 35, kind: "intro", status: "held" }], modes: { ad: "skip", intro: "skip" } };
  test("auto-jumps eligible ranges with seek tolerance; held and rejected never jump", () => {
    expect(applySkip(plan, 9.8)?.endSec).toBe(20);
    expect(applySkip(plan, 31)).toBeNull();
    expect(applySkip({ ...plan, ranges: [{ ...plan.ranges[0]!, status: "rejected" }] }, 12)).toBeNull();
    expect(applySkip({ ...plan, modes: { ad: "mark" } }, 12)).toBeNull();
  });
  test("maps source and cut positions across removed ranges", () => {
    expect(mapTime(12, [{ startSec: 10, endSec: 20 }])).toBe(20);
    expect(mapTime(25, [{ startSec: 10, endSec: 20 }], "to-skipped")).toBe(15);
  });
});
