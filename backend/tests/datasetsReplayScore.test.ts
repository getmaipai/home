// Lane 14 item 2: EVAL-07's memory replay, the pure scoring half - no
// engine, no live grader call, only the arithmetic and the reporting
// rules.
import { describe, expect, test } from "bun:test";
import { tokenF1, scoreLocomo, longMemEvalTotalsByType, locomoTotalsByCategory, computeRecallHits, type LongMemEvalResult, type LocomoResult, type RecallDiagnostics } from "../scripts/bench/datasets/replayScore";

const NO_DIAGNOSTICS: RecallDiagnostics = { contextMessage: null, recallHits: [], judgeWrittenRecords: [] };

describe("tokenF1", () => {
  test("an exact match scores 1", () => {
    expect(tokenF1("GPS system not functioning correctly", "GPS system not functioning correctly")).toBe(1);
  });

  test("two empty strings match perfectly; one empty and one not is a total miss", () => {
    expect(tokenF1("", "")).toBe(1);
    expect(tokenF1("", "Kerala")).toBe(0);
    expect(tokenF1("Kerala", "")).toBe(0);
  });

  test("no shared content words scores 0", () => {
    expect(tokenF1("The dog is brown.", "Paris is in France.")).toBe(0);
  });

  test("a partial overlap scores between 0 and 1, case- and punctuation-insensitive", () => {
    const f1 = tokenF1("Kerala, India", "kerala");
    expect(f1).toBeGreaterThan(0);
    expect(f1).toBeLessThan(1);
  });

  test("stopwords do not count toward the overlap", () => {
    // Every content word differs; only "the"/"is" would overlap, which
    // must not save the score.
    expect(tokenF1("the cat is here", "the dog is there")).toBe(0);
  });

  test("a repeated word in the prediction cannot double-count against one gold occurrence", () => {
    // gold has "kerala" once; predicting it three times must not score
    // as if all three matched.
    const f1 = tokenF1("kerala kerala kerala", "kerala state");
    // precision = 1/3 (one real match out of three predicted words),
    // recall = 1/2 (one of the two gold words matched)
    expect(f1).toBeCloseTo((2 * (1 / 3) * (1 / 2)) / (1 / 3 + 1 / 2), 5);
  });
});

describe("scoreLocomo", () => {
  test("category 1-4 scores the reply's own F1 against the answer", () => {
    const r = scoreLocomo("l1", 3, "Last summer", "Last summer", null, NO_DIAGNOSTICS);
    expect(r.f1).toBe(1);
    expect(r.refusedAdversarialPremise).toBeNull();
  });

  test("category 5 (adversarial): a reply that does not repeat the adversarial answer's own words is a refusal, correctly", () => {
    const r = scoreLocomo("l1", 5, "I don't have anything in the notes about that.", null, "Yes, you mentioned Rome last spring.", NO_DIAGNOSTICS);
    expect(r.refusedAdversarialPremise).toBe(true);
    expect(r.f1).toBe(0); // category 5 never scores F1 against a "right" answer
  });

  test("category 5: a reply substantially repeating the adversarial answer is not a refusal", () => {
    const r = scoreLocomo("l1", 5, "Yes, you mentioned Rome last spring.", null, "Yes, you mentioned Rome last spring.", NO_DIAGNOSTICS);
    expect(r.refusedAdversarialPremise).toBe(false);
  });

  test("category 1-4 with no answer text scores 0, never throws", () => {
    const r = scoreLocomo("l1", 4, "Some reply.", null, null, NO_DIAGNOSTICS);
    expect(r.f1).toBe(0);
  });
});

describe("computeRecallHits", () => {
  test("an evidence turn whose own words substantially appear in the context is a hit", () => {
    const hits = computeRecallHits([{ turnId: "t1", text: "The GPS system stopped working after the update." }], "Recall: the GPS system stopped working after the update, per the household's own notes.");
    expect(hits).toEqual([{ turnId: "t1", text: "The GPS system stopped working after the update.", foundInContext: true }]);
  });

  test("an evidence turn whose words are absent from the context is a miss, never assumed from a record existing elsewhere", () => {
    const hits = computeRecallHits([{ turnId: "t1", text: "The GPS system stopped working after the update." }], "Recall: the weather tomorrow looks sunny.");
    expect(hits[0]!.foundInContext).toBe(false);
  });

  test("a null context message (no model call was made) is every evidence turn missed", () => {
    const hits = computeRecallHits([{ turnId: "t1", text: "The GPS system stopped working." }], null);
    expect(hits[0]!.foundInContext).toBe(false);
  });

  test("a paraphrased or partially-quoted context still counts as a hit above the threshold, never requiring an exact quote", () => {
    // A memory line typically summarizes rather than quoting verbatim.
    const hits = computeRecallHits([{ turnId: "t1", text: "the GPS system stopped working after the recent software update was installed" }], "Recall: GPS system stopped working after the update.");
    expect(hits[0]!.foundInContext).toBe(true);
  });

  test("multiple evidence turns are each scored independently", () => {
    const hits = computeRecallHits(
      [
        { turnId: "t1", text: "The GPS system stopped working." },
        { turnId: "t2", text: "The dealership replaced the whole unit." },
      ],
      "Recall: the GPS system stopped working.",
    );
    expect(hits[0]!.foundInContext).toBe(true);
    expect(hits[1]!.foundInContext).toBe(false);
  });
});

describe("longMemEvalTotalsByType", () => {
  const mk = (over: Partial<LongMemEvalResult>): LongMemEvalResult => ({
    questionId: "q1",
    questionType: "single-session-user",
    isAbstention: false,
    reply: "",
    grader: "4b",
    verdict: "correct",
    contextMessage: null,
    recallHits: [],
    judgeWrittenRecords: [],
    ...over,
  });

  test("abstention is its own bucket, never folded into the question's own type", () => {
    const totals = longMemEvalTotalsByType([mk({ questionId: "q1", questionType: "single-session-user", isAbstention: true, verdict: "correct" }), mk({ questionId: "q2", questionType: "single-session-user", isAbstention: false, verdict: "incorrect" })]);
    const byType = new Map(totals.map((t) => [t.type, t]));
    expect(byType.get("abstention")).toMatchObject({ n: 1, correct: 1, accuracy: 1 });
    expect(byType.get("single-session-user")).toMatchObject({ n: 1, correct: 0, accuracy: 0 });
  });

  test("accuracy is correct over n, per type", () => {
    const totals = longMemEvalTotalsByType([
      mk({ questionId: "q1", questionType: "knowledge-update", verdict: "correct" }),
      mk({ questionId: "q2", questionType: "knowledge-update", verdict: "correct" }),
      mk({ questionId: "q3", questionType: "knowledge-update", verdict: "incorrect" }),
    ]);
    expect(totals).toEqual([{ type: "knowledge-update", n: 3, correct: 2, accuracy: 2 / 3 }]);
  });
});

describe("locomoTotalsByCategory", () => {
  const mk = (over: Partial<LocomoResult>): LocomoResult => ({ conversationId: "l1", category: 1, reply: "", answer: null, adversarialAnswer: null, f1: 0, refusedAdversarialPremise: null, contextMessage: null, recallHits: [], judgeWrittenRecords: [], ...over });

  test("mean F1 per category, categories in ascending order", () => {
    const totals = locomoTotalsByCategory([mk({ category: 3, f1: 1 }), mk({ category: 3, f1: 0 }), mk({ category: 2, f1: 0.5 })]);
    expect(totals.map((t) => t.category)).toEqual([2, 3]);
    expect(totals.find((t) => t.category === 3)).toMatchObject({ n: 2, meanF1: 0.5 });
  });

  test("refusalRate is reported only for category 5, null for every other category", () => {
    const totals = locomoTotalsByCategory([mk({ category: 5, refusedAdversarialPremise: true }), mk({ category: 5, refusedAdversarialPremise: false }), mk({ category: 4, refusedAdversarialPremise: null })]);
    expect(totals.find((t) => t.category === 5)?.refusalRate).toBe(0.5);
    expect(totals.find((t) => t.category === 4)?.refusalRate).toBeNull();
  });

  test("meanF1 is null for category 5 (scoreLocomo never scores a real F1 there), never a misleading 0", () => {
    const totals = locomoTotalsByCategory([mk({ category: 5, f1: 0, refusedAdversarialPremise: true }), mk({ category: 4, f1: 0.7 })]);
    expect(totals.find((t) => t.category === 5)?.meanF1).toBeNull();
    expect(totals.find((t) => t.category === 4)?.meanF1).toBe(0.7);
  });
});
