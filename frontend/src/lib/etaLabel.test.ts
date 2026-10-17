import { describe, expect, test } from "bun:test";
import { etaLabel } from "@/lib/etaLabel";

describe("etaLabel", () => {
  test("rounds to what is worth saying", () => {
    expect(etaLabel(2)).toBe("almost done");
    expect(etaLabel(7)).toBe("about 5 seconds left");
    expect(etaLabel(38)).toBe("about 40 seconds left");
    expect(etaLabel(50)).toBe("about 1 minute left");
    expect(etaLabel(89)).toBe("about 1 minute left");
    expect(etaLabel(95)).toBe("about 2 minutes left");
    expect(etaLabel(130)).toBe("about 2 minutes left");
  });
  test("the short form for one-line captions", () => {
    expect(etaLabel(2, { short: true })).toBe("almost done");
    expect(etaLabel(7, { short: true })).toBe("5s left");
    expect(etaLabel(38, { short: true })).toBe("40s left");
    expect(etaLabel(50, { short: true })).toBe("1 min left");
    expect(etaLabel(130, { short: true })).toBe("2 min left");
  });
  test("says nothing when the engine has no number", () => {
    expect(etaLabel(null)).toBeUndefined();
    expect(etaLabel(undefined)).toBeUndefined();
    expect(etaLabel(-3)).toBeUndefined();
  });
});
