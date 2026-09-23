// PARITY-BISECT-03's own scripted acceptance: buildStages3() is pure
// (no live call, no setup.ts import-time guard), tested directly
// against DEFAULT_PERSONA, mirroring parityBisect2Stages.test.ts's own
// style.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PERSONA,
  FORMALITY_FRAGMENT_WRITTEN,
  COMPLEXITY_FRAGMENT,
  ENGAGEMENT_FRAGMENT_WRITTEN,
  FILLER_FRAGMENT,
  INFORMATION_HANDLING_POLICY,
  WRITTEN_POLICY,
} from "@/lib/persona";
import { identityLine, STABLE_SYSTEM_SUFFIX_SENTENCES } from "@/lib/turnEngine";
import { buildStages3, QUESTION } from "../scripts/bench/parity-bisect3-stages";

describe("parity-bisect3-stages: buildStages3()", () => {
  test("one baseline, six fragment-alone stages, six suffix-sentence-alone stages", () => {
    const stages = buildStages3(DEFAULT_PERSONA);
    expect(stages.map((s) => s.name)).toEqual([
      "baseline-identity-alone",
      "alone-complexity",
      "alone-engagement",
      "alone-filler",
      "alone-info-policy",
      "alone-written-policy",
      "alone-formality",
      "alone-suffix-sentence-1",
      "alone-suffix-sentence-2",
      "alone-suffix-sentence-3",
      "alone-suffix-sentence-4",
      "alone-suffix-sentence-5",
      "alone-suffix-sentence-6",
    ]);
  });

  test("the baseline is the identity line alone, real text", () => {
    const [baseline] = buildStages3(DEFAULT_PERSONA);
    expect(baseline!.messages[0]!.content).toBe(identityLine(DEFAULT_PERSONA));
  });

  test("every fragment-alone stage is the identity line plus exactly one real fragment, never stacked with another", () => {
    const stages = buildStages3(DEFAULT_PERSONA);
    const identity = identityLine(DEFAULT_PERSONA);
    const cases: [string, string][] = [
      ["alone-complexity", COMPLEXITY_FRAGMENT[DEFAULT_PERSONA.complexity]],
      ["alone-engagement", ENGAGEMENT_FRAGMENT_WRITTEN[DEFAULT_PERSONA.engagement]],
      ["alone-filler", FILLER_FRAGMENT[DEFAULT_PERSONA.filler_density]],
      ["alone-info-policy", INFORMATION_HANDLING_POLICY],
      ["alone-written-policy", WRITTEN_POLICY],
      ["alone-formality", FORMALITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.formality]],
    ];
    for (const [name, fragment] of cases) {
      const content = stages.find((s) => s.name === name)!.messages[0]!.content;
      expect(content).toBe(`${identity} ${fragment}`);
    }
  });

  test("every suffix-sentence-alone stage carries exactly one real STABLE_SYSTEM_SUFFIX_SENTENCES entry, in order", () => {
    const stages = buildStages3(DEFAULT_PERSONA);
    const identity = identityLine(DEFAULT_PERSONA);
    expect(STABLE_SYSTEM_SUFFIX_SENTENCES.length).toBe(6);
    STABLE_SYSTEM_SUFFIX_SENTENCES.forEach((sentence, i) => {
      const content = stages.find((s) => s.name === `alone-suffix-sentence-${i + 1}`)!.messages[0]!.content;
      expect(content).toBe(`${identity} ${sentence}`);
    });
  });

  test("every stage runs at the reply floor's own conditions: engine-default temperature, thinking off", () => {
    for (const s of buildStages3(DEFAULT_PERSONA)) {
      expect(s.opts.temperature).toBe(0.8);
      expect(s.opts.thinking).toBe(false);
    }
  });

  test("every stage's user message is the same question", () => {
    for (const s of buildStages3(DEFAULT_PERSONA)) {
      expect(s.messages[1]).toEqual({ role: "user", content: QUESTION });
    }
  });
});
