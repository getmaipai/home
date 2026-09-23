// PARITY-BISECT-02's own scripted acceptance: buildStages2() is pure
// (no live call, no setup.ts import-time guard), tested directly
// against DEFAULT_PERSONA, mirroring parityBisectStages.test.ts's own
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
import { identityLine, STABLE_SYSTEM_SUFFIX, buildStablePrefix } from "@/lib/turnEngine";
import { buildStages2, QUESTION } from "../scripts/bench/parity-bisect2-stages";

describe("parity-bisect2-stages: buildStages2()", () => {
  test("one row per stage, following buildStablePrefix's own real order", () => {
    const stages = buildStages2(DEFAULT_PERSONA);
    expect(stages.map((s) => s.name)).toEqual([
      "a-control-helpful-assistant",
      "b-identity-alone",
      "c-plus-suffix",
      "d-plus-formality",
      "e-plus-complexity",
      "f-plus-engagement",
      "g-plus-filler",
      "h-plus-info-policy",
      "i-plus-written-policy-full-prefix",
      "swap-no-formality",
      "swap-no-description",
    ]);
  });

  test("stage a is a fixed control, unrelated to the persona", () => {
    const [stageA] = buildStages2(DEFAULT_PERSONA);
    expect(stageA!.messages).toEqual([{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: QUESTION }]);
  });

  test("stage b is the identity line alone, real text", () => {
    const stages = buildStages2(DEFAULT_PERSONA);
    const stageB = stages.find((s) => s.name === "b-identity-alone")!;
    expect(stageB.messages[0]!.content).toBe(identityLine(DEFAULT_PERSONA));
  });

  test("each stage from c through i adds exactly one real fragment, in buildStablePrefix's own order", () => {
    const stages = buildStages2(DEFAULT_PERSONA);
    const byName = Object.fromEntries(stages.map((s) => [s.name, s.messages[0]!.content]));
    expect(byName["c-plus-suffix"]).toBe(`${identityLine(DEFAULT_PERSONA)} ${STABLE_SYSTEM_SUFFIX}`);
    expect(byName["d-plus-formality"]).toBe(`${byName["c-plus-suffix"]} ${FORMALITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.formality]}`);
    expect(byName["e-plus-complexity"]).toBe(`${byName["d-plus-formality"]} ${COMPLEXITY_FRAGMENT[DEFAULT_PERSONA.complexity]}`);
    expect(byName["f-plus-engagement"]).toBe(`${byName["e-plus-complexity"]} ${ENGAGEMENT_FRAGMENT_WRITTEN[DEFAULT_PERSONA.engagement]}`);
    expect(byName["g-plus-filler"]).toBe(`${byName["f-plus-engagement"]} ${FILLER_FRAGMENT[DEFAULT_PERSONA.filler_density]}`);
    expect(byName["h-plus-info-policy"]).toBe(`${byName["g-plus-filler"]} ${INFORMATION_HANDLING_POLICY}`);
    expect(byName["i-plus-written-policy-full-prefix"]).toBe(`${byName["h-plus-info-policy"]} ${WRITTEN_POLICY}`);
  });

  test("stage i is byte-identical to the real buildStablePrefix() output", () => {
    const stages = buildStages2(DEFAULT_PERSONA);
    const stageI = stages.find((s) => s.name === "i-plus-written-policy-full-prefix")!;
    expect(stageI.messages[0]!.content).toBe(buildStablePrefix(DEFAULT_PERSONA, "written"));
  });

  test("the no-formality swap drops the formality fragment but keeps everything else from the real prefix", () => {
    const stages = buildStages2(DEFAULT_PERSONA);
    const swap = stages.find((s) => s.name === "swap-no-formality")!;
    expect(swap.messages[0]!.content).not.toContain(FORMALITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.formality]);
    expect(swap.messages[0]!.content).toContain(identityLine(DEFAULT_PERSONA));
    expect(swap.messages[0]!.content).toContain(WRITTEN_POLICY);
  });

  test("the no-description swap drops STABLE_SYSTEM_SUFFIX but keeps the identity line and the persona dials", () => {
    const stages = buildStages2(DEFAULT_PERSONA);
    const swap = stages.find((s) => s.name === "swap-no-description")!;
    expect(swap.messages[0]!.content).not.toContain(STABLE_SYSTEM_SUFFIX);
    expect(swap.messages[0]!.content).toContain(identityLine(DEFAULT_PERSONA));
    expect(swap.messages[0]!.content).toContain(FORMALITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.formality]);
  });

  test("every stage runs at the reply floor's own conditions: engine-default temperature, thinking off", () => {
    for (const s of buildStages2(DEFAULT_PERSONA)) {
      expect(s.opts.temperature).toBe(0.8);
      expect(s.opts.thinking).toBe(false);
    }
  });
});
