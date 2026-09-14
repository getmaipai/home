// Lane 12 item 4. selectLongMemEvalSample's own promises: 40 per class
// (fewer only when a class has fewer available), abstention prioritized
// within its class, deterministic for a given seed, and knowledge-update
// ordered first among classes.
import { describe, expect, test } from "bun:test";
import { selectLongMemEvalSample, SAMPLE_SEED } from "../scripts/bench/datasets/sample";
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
