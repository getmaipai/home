import { describe, expect, test } from "bun:test";
import { applySkip, mapTime, mergeSkipToast, screenReaderSkipLine, skipSourceLabel, type SkipPlan } from "./skipPlan";

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

  test("merges jumps within three seconds and starts a fresh toast after that", () => {
    const ad = { id: "ad", kind: "ad", startSec: 10, endSec: 70 };
    const bumper = { id: "bumper", kind: "bumper", startSec: 71, endSec: 76 };
    const first = mergeSkipToast(null, ad, 1000);
    const merged = mergeSkipToast(first, bumper, 3500);
    expect(merged.savedSeconds).toBe(65);
    expect(merged.undoRange.startSec).toBe(10);
    expect(merged.replayEnd).toBe(76);
    expect(mergeSkipToast(merged, ad, 5000).undoRange.startSec).toBe(10);
    expect(mergeSkipToast(merged, ad, 5001).startedAt).toBe(5001);
  });

  test("uses plain translated source descriptors and a polite break announcement", () => {
    expect(skipSourceLabel("llm", 0.994)).toEqual({ id: "Found by the AI, {confidence}% sure", values: { confidence: 99 } });
    expect(skipSourceLabel("person", 1)).toEqual({ id: "Found by you" });
    expect(skipSourceLabel("fingerprint", 0.7)).toEqual({ id: "Found by matching the same sound as other episodes" });
    expect(skipSourceLabel("alignment", 0.7)).toEqual({ id: "Found by matching the same sound as other episodes" });
    expect(screenReaderSkipLine(125)).toEqual({ id: "Skipped a {mins} minute break", values: { mins: 2 } });
  });
});
