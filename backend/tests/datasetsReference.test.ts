// Lane 13 item 2 (docs/plans/session-b-lane-13-2026-09-14.md): dev.md
// section 12's own hand-computed DailyDialog reference, made
// reproducible. Two kinds of test, per the org's "deterministic and
// offline by default" rule: the compute functions proven against a
// small hand-built sample (never the real ~95k-turn corpus, which
// this suite must not require); the committed reference/
// dailydialog.json pinned to dev.md's own quoted figures within one
// percentage point, which is deterministic (reading one small JSON
// file) and still catches drift - reference.ts's own live regeneration
// against the real corpus (registry.json's held-out train+validation
// split for the distributions, train alone for the transitions) is a
// manual step, proven once and reported in docs/dev/session-b.md,
// "Lane 13 item 2", the same shape generate-sample-manifest.ts's own
// live-run proof uses.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeActDistribution,
  computeEmotionDistribution,
  computeActTransition,
  computeEmotionTransition,
  computeNextTurnQuestionMarkRate,
  buildReference,
  ACT_NAMES,
  EMOTION_NAMES,
  type DailyDialogReference,
} from "../scripts/bench/datasets/reference";
import type { DatasetConversation } from "../scripts/bench/datasets/types";
import { registryEntry } from "../scripts/bench/datasets/registry";

function conv(id: string, turns: DatasetConversation["sessions"][number]["turns"]): DatasetConversation {
  return { id, source: "dailydialog", modality: "text", sessions: [{ sessionId: `${id}-s`, timestamp: null, turns }] };
}

// Ten hand-built turns across two dialogues, with a known, hand-counted
// act and emotion distribution and a known transition, so every
// compute function's own arithmetic is checked exactly, not just its
// shape.
const SAMPLE: DatasetConversation[] = [
  conv("d1", [
    { turnId: "d1:0", speaker: "A", text: "I finished the report.", act: 1, emotion: 0, isEvidence: false }, // inform, neutral
    { turnId: "d1:1", speaker: "B", text: "When did you send it?", act: 2, emotion: 0, isEvidence: false }, // question, neutral
    { turnId: "d1:2", speaker: "A", text: "This morning, I'm so relieved!", act: 1, emotion: 4, isEvidence: false }, // inform, happiness
    { turnId: "d1:3", speaker: "B", text: "Please forward me a copy.", act: 3, emotion: 0, isEvidence: false }, // directive, neutral
    { turnId: "d1:4", speaker: "A", text: "I will send it now.", act: 4, emotion: 0, isEvidence: false }, // commissive, neutral
  ]),
  conv("d2", [
    { turnId: "d2:0", speaker: "A", text: "I lost my keys again.", act: 1, emotion: 1, isEvidence: false }, // inform, anger
    { turnId: "d2:1", speaker: "B", text: "Did you check your coat?", act: 2, emotion: 0, isEvidence: false }, // question, neutral
    { turnId: "d2:2", speaker: "A", text: "Yes, still nothing.", act: 1, emotion: 5, isEvidence: false }, // inform, sadness
    { turnId: "d2:3", speaker: "B", text: "Want me to help you look?", act: 2, emotion: 0, isEvidence: false }, // question, neutral
    { turnId: "d2:4", speaker: "A", text: "That would be great, thanks.", act: 4, emotion: 4, isEvidence: false }, // commissive, happiness
  ]),
];

describe("computeActDistribution", () => {
  test("counts every turn's act across the whole set, rounded to one decimal", () => {
    // 10 turns: inform 4, question 3, directive 1, commissive 2.
    expect(computeActDistribution(SAMPLE)).toEqual({ inform: 40, question: 30, directive: 10, commissive: 20 });
  });

  test("throws on an act code outside DailyDialog's own 1-4 range, rather than silently miscounting it into a phantom bucket", () => {
    const malformed = [conv("bad", [{ turnId: "bad:0", speaker: "A", text: "?", act: 9, emotion: 0, isEvidence: false }])];
    expect(() => computeActDistribution(malformed)).toThrow(/act code \(9\) outside/);
  });
});

describe("computeEmotionDistribution", () => {
  test("counts every turn's emotion across the whole set", () => {
    // 10 turns: neutral 6 (d1:0,1,3,4; d2:1,3), anger 1 (d2:0), happiness
    // 2 (d1:2, d2:4), sadness 1 (d2:2).
    expect(computeEmotionDistribution(SAMPLE)).toEqual({ neutral: 60, anger: 10, disgust: 0, fear: 0, happiness: 20, sadness: 10, surprise: 0 });
  });
});

describe("computeActTransition", () => {
  test("a consecutive-turn matrix, never crossing a session boundary", () => {
    const table = computeActTransition(SAMPLE);
    // d1: inform->question, question->inform, inform->directive, directive->commissive (4 pairs)
    // d2: inform->question, question->inform, inform->question, question->commissive (4 pairs)
    // after inform (n=4): question x3 (75%), directive x1 (25%)
    expect(table.inform).toEqual({ inform: 0, question: 75, directive: 25, commissive: 0 });
    // after question (n=3): inform x2 (66.7%), commissive x1 (33.3%)
    expect(table.question).toEqual({ inform: 66.7, question: 0, directive: 0, commissive: 33.3 });
    // after directive (n=1): commissive x1 (100%)
    expect(table.directive).toEqual({ inform: 0, question: 0, directive: 0, commissive: 100 });
  });

  test("a from-act with no occurrences produces an all-zero row, never NaN", () => {
    const noCommissive = SAMPLE.map((c) => ({ ...c, sessions: c.sessions.map((s) => ({ ...s, turns: s.turns.filter((t) => t.act !== 4) })) }));
    const table = computeActTransition(noCommissive);
    expect(Object.values(table.commissive).every((v) => v === 0)).toBe(true);
  });
});

describe("computeEmotionTransition", () => {
  test("mirrors computeActTransition's own logic on the emotion label", () => {
    const table = computeEmotionTransition(SAMPLE);
    // after neutral (d1: 0->1, 1->2(happy) so happy; d2: 1->2(sad); 3->4(happy)) ... just check it sums to 100 per populated row
    // Tolerance: each emotion category is rounded to one decimal, so a
    // row can legitimately drift up to EMOTION_NAMES.length x 0.05 from
    // an exact 100 without any of the underlying counts being wrong.
    for (const row of Object.values(table)) {
      const sum = Object.values(row).reduce((a, b) => a + b, 0);
      expect(sum === 0 || Math.abs(sum - 100) <= EMOTION_NAMES.length * 0.05).toBe(true);
    }
  });
});

describe("computeNextTurnQuestionMarkRate", () => {
  test("the share of the next turn's own text carrying a \"?\", by the current turn's act", () => {
    const rate = computeNextTurnQuestionMarkRate(SAMPLE);
    // after inform (n=4): next turns are question("?") , directive("."), question("?"), question("?") -> 3/4 = 75%
    expect(rate.inform).toBe(75);
  });
});

describe("buildReference", () => {
  test("assembles the registry's own version and checksums alongside the computed tables", () => {
    // Compared against registry.json itself, not a copied-out literal:
    // a routine re-versioning of the dailydialog entry must not break
    // this test with an unrelated-looking diff, since buildReference's
    // own assembly logic (does it read the registry entry correctly)
    // is what this test checks, not what today's version happens to be.
    const entry = registryEntry("dailydialog");
    const ref = buildReference(SAMPLE, SAMPLE);
    expect(ref.datasetVersion).toBe(entry.version);
    expect(ref.datasetChecksums).toEqual(entry.files);
    expect(ref.distributionSplits).toEqual(["train", "validation"]);
    expect(ref.transitionSplit).toBe("train");
    expect(ref.dialogueCount).toBe(2);
    expect(ref.turnCount).toBe(10);
  });
});

describe("the committed reference/dailydialog.json pins dev.md's own quoted figures", () => {
  const reference = JSON.parse(readFileSync(join(import.meta.dir, "..", "scripts", "bench", "datasets", "reference", "dailydialog.json"), "utf-8")) as DailyDialogReference;
  const within = (got: number, want: number, tolerance = 1) => Math.abs(got - want) <= tolerance;

  test("13,118 dialogues, 102,979 turns across all three splits is the paper's own total; this file's train+validation total is the held-out subset of it", () => {
    // registry.json's own heldOut note: dailydialog's test split is
    // never used for register-reference sampling in this project.
    // train (11,118) + validation (1,000) = 12,118 of the paper's own
    // 13,118, honoring that without giving up dev.md's own precision
    // (checked live, 2026-09-14: within 0.1 point of every figure
    // below either way).
    expect(reference.dialogueCount).toBe(12118);
    expect(reference.turnCount).toBe(95239);
  });

  test("act distribution: inform 45.2, question 28.6, directive 16.8, commissive 9.4 (dev.md section 12)", () => {
    expect(within(reference.actDistribution.inform, 45.2)).toBe(true);
    expect(within(reference.actDistribution.question, 28.6)).toBe(true);
    expect(within(reference.actDistribution.directive, 16.8)).toBe(true);
    expect(within(reference.actDistribution.commissive, 9.4)).toBe(true);
  });

  test("emotion distribution: neutral 83.1, happiness 12.5, surprise 1.8, sadness 1.1, anger 1.0, disgust 0.3, fear 0.2 (dev.md section 12)", () => {
    expect(within(reference.emotionDistribution.neutral, 83.1)).toBe(true);
    expect(within(reference.emotionDistribution.happiness, 12.5)).toBe(true);
    expect(within(reference.emotionDistribution.surprise, 1.8)).toBe(true);
    expect(within(reference.emotionDistribution.sadness, 1.1)).toBe(true);
    expect(within(reference.emotionDistribution.anger, 1.0)).toBe(true);
    expect(within(reference.emotionDistribution.disgust, 0.3)).toBe(true);
    expect(within(reference.emotionDistribution.fear, 0.2)).toBe(true);
  });

  test("after an inform: inform 47, question 37 (act-based), and the next turn carries a question mark 43 percent of the time (dev.md section 12)", () => {
    expect(within(reference.actTransition.inform.inform, 47)).toBe(true);
    expect(within(reference.actTransition.inform.question, 37)).toBe(true);
    expect(within(reference.nextTurnQuestionMarkRate.inform, 43)).toBe(true);
  });

  test("after a question: inform 76 (act-based), and the next turn carries a question mark 16 percent of the time (dev.md section 12 - not the act-based question-to-question rate, which this file also reports and is genuinely 11.4 percent, a real 4.6-point gap outside this test's own tolerance if compared to \"16\" directly)", () => {
    expect(within(reference.actTransition.question.inform, 76)).toBe(true);
    expect(within(reference.nextTurnQuestionMarkRate.question, 16)).toBe(true);
    expect(within(reference.actTransition.question.question, 16)).toBe(false);
  });

  test("after a directive: commissive 57 (dev.md section 12)", () => {
    expect(within(reference.actTransition.directive.commissive, 57)).toBe(true);
  });

  test("every act-transition and emotion-transition row sums to 100 (or 0, for an emotion no training turn ever followed)", () => {
    // Tolerance is category-count-aware: each row's own percentages are
    // independently rounded to one decimal, so a row of k categories
    // can legitimately drift up to k x 0.05 from an exact 100 without
    // any of the underlying counts being wrong.
    for (const row of Object.values(reference.actTransition)) {
      expect(Math.abs(Object.values(row).reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(ACT_NAMES.length * 0.05);
    }
    for (const row of Object.values(reference.emotionTransition)) {
      const sum = Object.values(row).reduce((a, b) => a + b, 0);
      expect(sum === 0 || Math.abs(sum - 100) <= EMOTION_NAMES.length * 0.05).toBe(true);
    }
  });

  test("the committed checksums match registry.json's own dailydialog entry, so a re-downloaded or re-versioned dataset is a visible diff, not a silent one", () => {
    const registry = JSON.parse(readFileSync(join(import.meta.dir, "..", "scripts", "bench", "datasets", "registry.json"), "utf-8")) as { datasets: { name: string; files: { path: string; sha256: string }[] }[] };
    const entry = registry.datasets.find((d) => d.name === "dailydialog")!;
    expect(reference.datasetChecksums).toEqual(entry.files);
  });
});
