// #87: the judge-eval scorer, deterministic. A missed fact and an extra
// fact are different failures with different numbers; the old bench
// printed one pass rate under both names.
import { describe, expect, test } from "bun:test";
import { scoreCase, scoreExtraction, formatPercent } from "../scripts/bench/judgeScore";

describe("scoreCase()", () => {
  test("an exact extraction is one true positive, nothing missed, nothing extra", () => {
    const s = scoreCase({ turnId: "t1", label: "job", expected: [["nurse", "riverside"]], extracted: ["Iris works as a nurse at Riverside Hospital"] });
    expect(s).toMatchObject({ truePositives: 1, falsePositives: 0, misses: 0, missed: [], extra: [] });
  });

  test("a missed fact counts as a miss, not a false positive", () => {
    const s = scoreCase({ turnId: "t1", label: "job", expected: [["nurse", "riverside"]], extracted: [] });
    expect(s).toMatchObject({ truePositives: 0, falsePositives: 0, misses: 1, missed: [["nurse", "riverside"]] });
  });

  test("an extra fact counts as a false positive, not a miss", () => {
    const s = scoreCase({ turnId: "t1", label: "job", expected: [["nurse", "riverside"]], extracted: ["Iris works as a nurse at Riverside Hospital", "Iris loves hiking"] });
    expect(s).toMatchObject({ truePositives: 1, falsePositives: 1, misses: 0, extra: ["Iris loves hiking"] });
  });

  test("an abstention turn expects nothing: any extraction is a false positive", () => {
    const s = scoreCase({ turnId: "t3", label: "abstention", expected: [], extracted: ["Iris asked about the weather"] });
    expect(s).toMatchObject({ truePositives: 0, falsePositives: 1, misses: 0 });
    expect(scoreCase({ turnId: "t3", label: "abstention", expected: [], extracted: [] })).toMatchObject({ truePositives: 0, falsePositives: 0, misses: 0 });
  });

  test("one extraction satisfies one expected fact at most; keywords match case-insensitively", () => {
    const s = scoreCase({ turnId: "t2", label: "two facts", expected: [["teacher"], ["Teacher", "new job"]], extracted: ["Iris is a teacher now"] });
    expect(s).toMatchObject({ truePositives: 1, falsePositives: 0, misses: 1 });
  });
});

describe("scoreCase(): the review's cases", () => {
  test("overlapping expected sets: the more specific claims first, so a perfect two-fact extraction scores two true positives", () => {
    const s = scoreCase({ turnId: "t2", label: "two facts", expected: [["teacher"], ["teacher", "new job"]], extracted: ["Iris started a new job as a teacher", "Iris is a teacher"] });
    expect(s).toMatchObject({ truePositives: 2, falsePositives: 0, misses: 0 });
  });

  test("keywords match whole words: nurse is not nursery, tea is not teacher", () => {
    expect(scoreCase({ turnId: "t", label: "x", expected: [["nurse"]], extracted: ["Iris runs the nursery"] })).toMatchObject({ truePositives: 0, misses: 1 });
    expect(scoreCase({ turnId: "t", label: "x", expected: [["tea"]], extracted: ["Iris is a teacher"] })).toMatchObject({ truePositives: 0, misses: 1 });
  });

  test("an empty keyword set is a mis-authored case and throws instead of matching everything", () => {
    expect(() => scoreCase({ turnId: "t", label: "x", expected: [[]], extracted: ["anything"] })).toThrow();
  });
});

describe("scoreExtraction()", () => {
  test("precision and recall are computed from the totals and are different numbers", () => {
    const score = scoreExtraction([
      { turnId: "t1", label: "job", expected: [["nurse"]], extracted: ["Iris is a nurse", "Iris likes tea"] }, // tp 1, fp 1
      { turnId: "t2", label: "new job", expected: [["teacher"]], extracted: [] }, // miss 1
      { turnId: "t3", label: "abstention", expected: [], extracted: [] },
    ]);
    expect(score.truePositives).toBe(1);
    expect(score.falsePositives).toBe(1);
    expect(score.misses).toBe(1);
    expect(score.precision).toBeCloseTo(0.5);
    expect(score.recall).toBeCloseTo(0.5);
    const better = scoreExtraction([{ turnId: "t1", label: "job", expected: [["nurse"]], extracted: ["Iris is a nurse", "Iris likes tea", "Iris likes coffee"] }]);
    expect(better.precision).toBeCloseTo(1 / 3);
    expect(better.recall).toBeCloseTo(1); // the two numbers move apart, as they must
  });

  test("nothing extracted at all is a null precision, nothing expected at all a null recall, never a division by zero read as a score", () => {
    expect(scoreExtraction([{ turnId: "t", label: "x", expected: [["a"]], extracted: [] }]).precision).toBeNull();
    expect(scoreExtraction([{ turnId: "t", label: "x", expected: [], extracted: [] }]).recall).toBeNull();
    expect(formatPercent(null)).toBe("n/a");
    expect(formatPercent(0.856)).toBe("85.6%");
  });
});
