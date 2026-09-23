// PARITY-BISECT-04's own scripted acceptance: buildStages4() is pure
// (no live call, no setup.ts import-time guard), tested directly
// against DEFAULT_PERSONA, mirroring parityBisect3Stages.test.ts's own
// style.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PERSONA,
  FORMALITY_FRAGMENT_WRITTEN,
  WRITTEN_POLICY,
  INFORMATION_HANDLING_POLICY,
} from "@/lib/persona";
import { identityLine, STABLE_SYSTEM_SUFFIX, STABLE_SYSTEM_SUFFIX_SENTENCES, buildStablePrefix } from "@/lib/turnEngine";
import { buildStages4, QUESTION, BENCHMARKING_QUESTION, FLOOR_SENTENCE } from "../scripts/bench/parity-bisect4-stages";

describe("parity-bisect4-stages: buildStages4()", () => {
  test("six stages: the floor, four arms, and the ceiling", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    expect(stages.map((s) => s.name)).toEqual([
      "floor-bare-thinking-off",
      "arm-a-floor-sentence-plus-full-prefix",
      "arm-b-reduced-system-preamble-user",
      "arm-c-floor-sentence-full-suffix-preamble-user",
      "arm-d-descriptive-never-instructive",
      "ceiling-identity-plus-surviving-suffix",
    ]);
  });

  test("the floor has no system message at all", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const floor = stages.find((s) => s.name === "floor-bare-thinking-off")!;
    expect(floor.messages).toEqual([{ role: "user", content: QUESTION }]);
  });

  test("arm a is the floor sentence ahead of the real, complete buildStablePrefix() output", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const armA = stages.find((s) => s.name === "arm-a-floor-sentence-plus-full-prefix")!;
    expect(armA.messages[0]!.content).toBe(`${FLOOR_SENTENCE} ${buildStablePrefix(DEFAULT_PERSONA, "written")}`);
    expect(armA.messages[1]).toEqual({ role: "user", content: QUESTION });
  });

  test("arm b's system carries only identity, the floor sentence and the three surviving suffix sentences (not sentences 1, 5 or 6)", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const armB = stages.find((s) => s.name === "arm-b-reduced-system-preamble-user")!;
    const content = armB.messages[0]!.content;
    expect(content).toContain(identityLine(DEFAULT_PERSONA));
    expect(content).toContain(FLOOR_SENTENCE);
    expect(content).toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[1]!);
    expect(content).toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[2]!);
    expect(content).toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[3]!);
    expect(content).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[0]!);
    expect(content).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[4]!);
    expect(content).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[5]!);
  });

  test("arm b's user message carries the dials and policies as a preamble above the real question", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const armB = stages.find((s) => s.name === "arm-b-reduced-system-preamble-user")!;
    const userContent = armB.messages[1]!.content;
    expect(userContent).toContain("How to sound:");
    expect(userContent).toContain(FORMALITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.formality]);
    expect(userContent).toContain(WRITTEN_POLICY);
    expect(userContent).toContain(INFORMATION_HANDLING_POLICY);
    expect(userContent.endsWith(QUESTION)).toBe(true);
  });

  test("arm c keeps the full, unreduced suffix in the system message alongside the floor sentence, and moves the preamble to the user message like arm b", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const armC = stages.find((s) => s.name === "arm-c-floor-sentence-full-suffix-preamble-user")!;
    expect(armC.messages[0]!.content).toBe(`${FLOOR_SENTENCE} ${identityLine(DEFAULT_PERSONA)} ${STABLE_SYSTEM_SUFFIX}`);
    expect(armC.messages[1]!.content).toContain("How to sound:");
  });

  test("arm d has no floor sentence, no second-person address beyond the identity line, and carries the household-facts sentence in Fable's own descriptive wording", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const armD = stages.find((s) => s.name === "arm-d-descriptive-never-instructive")!;
    const content = armD.messages[0]!.content;
    expect(content).not.toContain(FLOOR_SENTENCE);
    expect(content).toContain("Facts about this household's own people, plans and home come only from what it was told here; anything about the world it answers from what it knows.");
    expect(content).not.toContain(FORMALITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.formality]); // the instructive form must not leak in
  });

  test("arm d's identity sentence is Fable's own descriptive form, naming who 'you' refers to (the benchmarking question's own failure)", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const armD = stages.find((s) => s.name === "arm-d-descriptive-never-instructive")!;
    const content = armD.messages[0]!.content;
    expect(content).toContain(
      "MaiPai is this household's own assistant; it answers \"you\" as the person it is talking to, and a question about what \"you\" need is about them, never about MaiPai.",
    );
  });

  test("buildStages4() takes an explicit question, used verbatim on every stage's user message", () => {
    const stages = buildStages4(DEFAULT_PERSONA, BENCHMARKING_QUESTION);
    for (const s of stages) {
      const last = s.messages[s.messages.length - 1]!;
      expect(last.role).toBe("user");
      expect(last.content.endsWith(BENCHMARKING_QUESTION)).toBe(true);
    }
    const floor = stages.find((s) => s.name === "floor-bare-thinking-off")!;
    expect(floor.messages).toEqual([{ role: "user", content: BENCHMARKING_QUESTION }]);
  });

  test("the ceiling carries only identity and the three surviving suffix sentences - no floor sentence, no dials, no policies", () => {
    const stages = buildStages4(DEFAULT_PERSONA);
    const ceiling = stages.find((s) => s.name === "ceiling-identity-plus-surviving-suffix")!;
    const content = ceiling.messages[0]!.content;
    expect(content).toContain(identityLine(DEFAULT_PERSONA));
    expect(content).toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[1]!);
    expect(content).not.toContain(FLOOR_SENTENCE);
    expect(content).not.toContain(WRITTEN_POLICY);
    expect(content).not.toContain(INFORMATION_HANDLING_POLICY);
    expect(ceiling.messages[1]).toEqual({ role: "user", content: QUESTION });
  });

  test("every stage runs at the reply floor's own conditions: engine-default temperature, thinking off", () => {
    for (const s of buildStages4(DEFAULT_PERSONA)) {
      expect(s.opts.temperature).toBe(0.8);
      expect(s.opts.thinking).toBe(false);
    }
  });
});
