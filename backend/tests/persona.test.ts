import { describe, expect, test } from "bun:test";
import {
  PERSONAS,
  PERSONA_IDS,
  DEFAULT_PERSONA,
  DEFAULT_PERSONA_ID,
  resolvePersona,
  composePersonaPrompt,
  INFORMATION_HANDLING_POLICY,
} from "@/lib/persona";

describe("the persona catalog", () => {
  test("every persona has a unique id, and the default id resolves to a real entry", () => {
    const ids = PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PERSONA_IDS).toEqual(ids);
    expect(PERSONAS.find((p) => p.id === DEFAULT_PERSONA_ID)).toBe(DEFAULT_PERSONA);
  });
});

describe("resolvePersona", () => {
  test("a known id resolves to its real persona", () => {
    const tutor = resolvePersona("tutor");
    expect(tutor.id).toBe("tutor");
  });

  test("an unknown id, undefined, or a non-string value all fall back to the default - never a broken or empty persona", () => {
    expect(resolvePersona("not-a-real-persona")).toBe(DEFAULT_PERSONA);
    expect(resolvePersona(undefined)).toBe(DEFAULT_PERSONA);
    expect(resolvePersona(42)).toBe(DEFAULT_PERSONA);
    expect(resolvePersona(null)).toBe(DEFAULT_PERSONA);
  });
});

describe("composePersonaPrompt", () => {
  test("the default persona talks casually, briefly, and without pushing follow-ups", () => {
    const prompt = composePersonaPrompt(DEFAULT_PERSONA);
    expect(prompt).toContain("contractions");
    expect(prompt).toContain("answer the exact question then stop");
  });

  // A code review (2026-09-05) found this cap - real in the old
  // NATURAL_REGISTER_POLICY this replaced - had silently disappeared
  // once its one sentence got split across formality and engagement:
  // every household member on the default persona (the common case)
  // lost brevity control entirely. Every engagement level keeps its own
  // proportional length cap now, not just "brief".
  test("every engagement level keeps some real length control - none of them is unboundedly long", () => {
    expect(composePersonaPrompt(resolvePersona("default"))).toContain("a sentence or two");
    expect(composePersonaPrompt({ ...DEFAULT_PERSONA, engagement: "balanced" })).toContain("just a few sentences");
    expect(composePersonaPrompt({ ...DEFAULT_PERSONA, engagement: "curious" })).toContain("not too long");
  });

  test("a formal persona never gets the contraction instruction, and does get the no-contractions one", () => {
    const tutor = resolvePersona("tutor");
    const prompt = composePersonaPrompt(tutor);
    expect(prompt).toContain("without contractions");
    expect(prompt).not.toContain("use contractions");
  });

  test("a curious-engagement persona is instructed to follow up on something personal or emotional", () => {
    const buddy = resolvePersona("buddy");
    expect(composePersonaPrompt(buddy)).toContain("ask a brief, genuine follow-up");
  });

  test("changing exactly one dimension changes the composed prompt", () => {
    const base = resolvePersona("default");
    const morFormal = { ...base, formality: "formal" as const };
    expect(composePersonaPrompt(base)).not.toBe(composePersonaPrompt(morFormal));
  });

  test("never asks the model to insert filler words into a confident answer - filler_density stays about discourse-marker casualness, not literal disfluency", () => {
    const pal = resolvePersona("pal"); // filler_density: "frequent"
    const prompt = composePersonaPrompt(pal);
    expect(prompt.toLowerCase()).not.toContain("um");
    expect(prompt.toLowerCase()).not.toContain('"uh"');
  });
});

describe("INFORMATION_HANDLING_POLICY", () => {
  test("is a real, non-empty, persona-independent policy - the same string regardless of which persona composed it", () => {
    expect(INFORMATION_HANDLING_POLICY.length).toBeGreaterThan(0);
    expect(INFORMATION_HANDLING_POLICY).toContain("hedged");
  });
});
