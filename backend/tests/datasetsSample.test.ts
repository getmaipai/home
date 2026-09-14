// Lane 12 item 4. selectLongMemEvalSample's own promises: 40 per class
// (fewer only when a class has fewer available), abstention prioritized
// within its class, deterministic for a given seed, and knowledge-update
// ordered first among classes.
import { describe, expect, test } from "bun:test";
import { selectLongMemEvalSample, selectStratifiedLongMemEvalSample, selectBaselineV0Sample, SAMPLE_SEED } from "../scripts/bench/datasets/sample";
import type { LongMemEvalQuestion } from "../scripts/bench/datasets/types";

function question(overrides: Partial<LongMemEvalQuestion>): LongMemEvalQuestion {
  return {
    questionId: "q",
    questionType: "single-session-user",
    isAbstention: false,
    question: "?",
    answer: "a",
    questionDate: null,
    conversationId: "q",
    answerSessionIds: [],
    ...overrides,
  };
}

function pool(type: string, count: number, abstentionCount: number): LongMemEvalQuestion[] {
  return Array.from({ length: count }, (_, i) =>
    question({ questionId: `${type}-${i}`, questionType: type, isAbstention: i < abstentionCount }),
  );
}

describe("selectLongMemEvalSample", () => {
  test("a class with more than the target keeps exactly the target, every abstention question first", () => {
    const questions = pool("single-session-user", 60, 5);
    const selected = selectLongMemEvalSample(questions, 40);
    expect(selected).toHaveLength(40);
    expect(selected.filter((s) => s.isAbstention)).toHaveLength(5);
  });

  test("a class with fewer than the target keeps every question it has", () => {
    const questions = pool("single-session-preference", 30, 6);
    const selected = selectLongMemEvalSample(questions, 40);
    expect(selected).toHaveLength(30);
    expect(selected.filter((s) => s.isAbstention)).toHaveLength(6);
  });

  test("a class whose abstention count exceeds the target still keeps only the target, seeded not arbitrary", () => {
    const questions = pool("multi-session", 100, 50);
    const selected = selectLongMemEvalSample(questions, 40);
    expect(selected).toHaveLength(40);
    expect(selected.every((s) => s.isAbstention)).toBe(true);
    // Reproducible: the exact 40 ids chosen are the same on a second run.
    const again = selectLongMemEvalSample(questions, 40);
    expect(selected.map((s) => s.questionId)).toEqual(again.map((s) => s.questionId));
  });

  test("the same seed always produces the same manifest; a different seed can differ", () => {
    const questions = pool("temporal-reasoning", 80, 10);
    const a = selectLongMemEvalSample(questions, 40, SAMPLE_SEED);
    const b = selectLongMemEvalSample(questions, 40, SAMPLE_SEED);
    expect(a.map((s) => s.questionId)).toEqual(b.map((s) => s.questionId));
    const c = selectLongMemEvalSample(questions, 40, SAMPLE_SEED + 1000);
    expect(a.map((s) => s.questionId)).not.toEqual(c.map((s) => s.questionId));
  });

  test("knowledge-update is ordered first among classes in the manifest", () => {
    const questions = [...pool("single-session-user", 10, 0), ...pool("knowledge-update", 10, 0), ...pool("temporal-reasoning", 10, 0)];
    const selected = selectLongMemEvalSample(questions, 40);
    expect(selected[0]!.questionType).toBe("knowledge-update");
  });

  test("every question type present gets its own entries; a type with zero questions contributes nothing", () => {
    const questions = pool("single-session-assistant", 5, 0);
    const selected = selectLongMemEvalSample(questions, 40);
    expect(selected).toHaveLength(5);
    expect(new Set(selected.map((s) => s.questionType))).toEqual(new Set(["single-session-assistant"]));
  });
});

// The coordinator's own fix, 2026-09-14: at a small perClass (baseline
// v0's own 5), selectLongMemEvalSample's abstention-first rule made a
// class with 5+ abstention questions come out entirely abstention -
// unrepresentative of anything. selectStratifiedLongMemEvalSample draws
// each class's own abstention share proportional to that type's real
// rate instead, and records the computed rate/target in `strata` so the
// rule is visible, not just its result.
describe("selectStratifiedLongMemEvalSample", () => {
  test("a class's abstention target is proportional to its own real rate, rounded", () => {
    // 100 questions, 20 abstention (20%): perClass 5 -> round(5*0.2)=1.
    const questions = pool("multi-session", 100, 20);
    const { entries, strata } = selectStratifiedLongMemEvalSample(questions, 5);
    expect(strata).toEqual([{ questionType: "multi-session", poolSize: 100, abstentionPoolSize: 20, abstentionRate: 0.2, abstentionTarget: 1 }]);
    expect(entries).toHaveLength(5);
    expect(entries.filter((e) => e.isAbstention)).toHaveLength(1);
  });

  test("a small real abstention rate rounds to zero - proportional, not forced, and never all-abstention", () => {
    // Mirrors the oracle set's own real shape (~4.5%-9% abstention per
    // type): a class with plenty of abstention questions available
    // still draws none at perClass=5, because 5 * 0.09 rounds to 0.
    const questions = pool("temporal-reasoning", 133, 12);
    const { entries, strata } = selectStratifiedLongMemEvalSample(questions, 5);
    expect(strata[0]!.abstentionTarget).toBe(0);
    expect(entries).toHaveLength(5);
    expect(entries.every((e) => !e.isAbstention)).toBe(true);
  });

  test("the abstention target never exceeds the available abstention pool, even if the proportional math would ask for more", () => {
    // 10 questions, 1 abstention (10%): perClass 20 -> round(20*0.1)=2,
    // but only 1 abstention question exists.
    const questions = pool("knowledge-update", 10, 1);
    const { entries, strata } = selectStratifiedLongMemEvalSample(questions, 20);
    expect(strata[0]!.abstentionTarget).toBe(1);
    expect(entries.filter((e) => e.isAbstention)).toHaveLength(1);
    expect(entries).toHaveLength(10); // the whole pool, not padded past what exists
  });

  test("deterministic for a given seed; a different seed can choose differently", () => {
    const questions = pool("single-session-user", 50, 10);
    const a = selectStratifiedLongMemEvalSample(questions, 5, SAMPLE_SEED);
    const b = selectStratifiedLongMemEvalSample(questions, 5, SAMPLE_SEED);
    expect(a.entries.map((e) => e.questionId)).toEqual(b.entries.map((e) => e.questionId));
    const c = selectStratifiedLongMemEvalSample(questions, 5, SAMPLE_SEED + 1000);
    expect(a.entries.map((e) => e.questionId)).not.toEqual(c.entries.map((e) => e.questionId));
  });

  test("a class with zero abstention questions gets an abstentionRate and target of exactly 0, never NaN or a division error", () => {
    const questions = pool("single-session-preference", 30, 0);
    const { strata } = selectStratifiedLongMemEvalSample(questions, 5);
    expect(strata[0]).toMatchObject({ abstentionPoolSize: 0, abstentionRate: 0, abstentionTarget: 0 });
  });

  test("every question type present gets its own stratum and entries", () => {
    const questions = [...pool("single-session-user", 10, 1), ...pool("knowledge-update", 10, 1)];
    const { entries, strata } = selectStratifiedLongMemEvalSample(questions, 5);
    expect(strata.map((s) => s.questionType).sort()).toEqual(["knowledge-update", "single-session-user"]);
    expect(new Set(entries.map((e) => e.questionType))).toEqual(new Set(["knowledge-update", "single-session-user"]));
  });
});

// The coordinator's own second pass, 2026-09-14: proportional
// representation alone left abstention (the class mapping onto the
// project's worst defect) measured by zero questions - a dedicated
// seventh stratum, layered on top of the six type strata, fixes that
// without changing how the six are drawn.
describe("selectBaselineV0Sample", () => {
  test("35 total at the default sizing: 30 from the six type strata plus a dedicated 5-question abstention stratum", () => {
    // Mirrors the oracle set's own real shape - small per-type rates,
    // so the six strata alone would carry no abstention question.
    const questions = [
      ...pool("temporal-reasoning", 133, 6),
      ...pool("multi-session", 133, 12),
      ...pool("knowledge-update", 78, 6),
      ...pool("single-session-preference", 30, 0),
      ...pool("single-session-assistant", 56, 0),
      ...pool("single-session-user", 70, 6),
    ];
    const { entries, strata, abstentionStratum } = selectBaselineV0Sample(questions, 5, 5);
    expect(entries).toHaveLength(35);
    expect(strata.every((s) => s.abstentionTarget === 0)).toBe(true);
    expect(abstentionStratum).toEqual({ poolSize: 30, target: 5 });
    expect(entries.filter((e) => e.isAbstention)).toHaveLength(5);
    // The reliable way to tell which stratum picked an entry: not its
    // questionType plus the type stratum's own (correctly zero)
    // abstentionTarget, which would misattribute every one of these.
    expect(entries.filter((e) => e.fromAbstentionStratum)).toHaveLength(5);
    expect(entries.filter((e) => e.fromAbstentionStratum).every((e) => e.isAbstention)).toBe(true);
    expect(entries.filter((e) => !e.fromAbstentionStratum).every((e) => !e.isAbstention)).toBe(true);
  });

  test("the abstention stratum never repeats an id a type stratum already chose", () => {
    // 8 abstention out of 10 (rate 0.8): the type stratum's own
    // proportional math picks round(5*0.8)=4 of them, leaving only 4 of
    // the 8 for the dedicated stratum to draw from.
    const questions = pool("knowledge-update", 10, 8);
    const { entries, abstentionStratum } = selectBaselineV0Sample(questions, 5, 5);
    const ids = entries.map((e) => e.questionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(abstentionStratum).toEqual({ poolSize: 8, target: 4 });
    // Every entry carries this type's own questionType regardless of
    // which stratum picked it, and both strata contribute abstention
    // questions here - fromAbstentionStratum is what actually
    // distinguishes the type stratum's own 4 from the dedicated
    // stratum's own 4, not questionType (identical on both) or
    // isAbstention (true on both).
    expect(entries.filter((e) => e.fromAbstentionStratum)).toHaveLength(4);
    expect(entries.filter((e) => !e.fromAbstentionStratum && e.isAbstention)).toHaveLength(4);
  });

  test("the dedicated stratum's own target is clamped to whatever abstention pool remains after the type stratum's own exclusion", () => {
    // 2 abstention out of 20 (rate 0.1): the type stratum's own
    // proportional math picks round(5*0.1)=1 of them (JS rounds .5 up),
    // leaving only 1 of the 2 for the dedicated stratum.
    const questions = pool("single-session-user", 20, 2);
    const { abstentionStratum } = selectBaselineV0Sample(questions, 5, 5);
    expect(abstentionStratum).toEqual({ poolSize: 2, target: 1 });
  });

  test("deterministic for a given seed; the abstention stratum's own shuffle is independent of the per-type ones", () => {
    const questions = [...pool("knowledge-update", 78, 6), ...pool("single-session-user", 70, 6)];
    const a = selectBaselineV0Sample(questions, 5, 5, SAMPLE_SEED);
    const b = selectBaselineV0Sample(questions, 5, 5, SAMPLE_SEED);
    expect(a.entries.map((e) => e.questionId)).toEqual(b.entries.map((e) => e.questionId));
    const c = selectBaselineV0Sample(questions, 5, 5, SAMPLE_SEED + 1000);
    expect(a.entries.map((e) => e.questionId)).not.toEqual(c.entries.map((e) => e.questionId));
  });

  test("a source set with no abstention questions at all yields a zero-size, never-broken abstention stratum", () => {
    const questions = pool("single-session-preference", 30, 0);
    const { entries, abstentionStratum } = selectBaselineV0Sample(questions, 5, 5);
    expect(abstentionStratum).toEqual({ poolSize: 0, target: 0 });
    expect(entries).toHaveLength(5); // just the type stratum's own 5
  });
});
