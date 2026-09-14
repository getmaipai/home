// Lane 12 item 4. selectLongMemEvalSample's own promises: 40 per class
// (fewer only when a class has fewer available), abstention prioritized
// within its class, deterministic for a given seed, and knowledge-update
// ordered first among classes.
import { describe, expect, test } from "bun:test";
import { selectLongMemEvalSample, selectStratifiedLongMemEvalSample, SAMPLE_SEED } from "../scripts/bench/datasets/sample";
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
