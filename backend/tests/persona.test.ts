import { describe, expect, test } from "bun:test";
import {
  PERSONAS,
  PERSONA_IDS,
  DEFAULT_PERSONA,
  DEFAULT_PERSONA_ID,
  resolvePersona,
  composePersonaPrompt,
  INFORMATION_HANDLING_POLICY,
  INFORMATION_HANDLING_POLICY_WRITTEN,
  WRITTEN_VOICE_POLICY,
  WRITTEN_VOICE_PROSE,
  FORMALITY_FRAGMENT_WRITTEN,
  COMPLEXITY_FRAGMENT_WRITTEN,
  ENGAGEMENT_FRAGMENT_WRITTEN,
  FILLER_FRAGMENT_WRITTEN,
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

  // Step 8 (session-a-intelligence.md): every bundled companion package
  // sets `examples` (manifest.schema.json's own "3 to 5 lines in the
  // character's own voice"), so the few-shot block should appear for
  // every real persona, not just be reachable in principle.
  // OUT-01: dash lines, no quotation marks (the quoted form was the
  // prompt's format echoed back as stray quotes in replies).
  test("every real persona's own examples appear in its composed prompt as dash lines, never quoted", () => {
    for (const persona of PERSONAS) {
      expect(persona.examples?.length ?? 0).toBeGreaterThanOrEqual(3);
      const prompt = composePersonaPrompt(persona);
      for (const example of persona.examples!) {
        expect(prompt).toContain(`- ${example}`);
        expect(prompt).not.toContain(`"${example}"`);
      }
    }
  });

  test("a persona with no examples at all composes without a dangling few-shot header", () => {
    const prompt = composePersonaPrompt({ ...DEFAULT_PERSONA, examples: undefined });
    expect(prompt).not.toContain("Some examples of how you talk");
  });
});

describe("INFORMATION_HANDLING_POLICY", () => {
  test("is a real, non-empty, persona-independent policy - the same string regardless of which persona composed it", () => {
    expect(INFORMATION_HANDLING_POLICY.length).toBeGreaterThan(0);
    expect(INFORMATION_HANDLING_POLICY).toContain("hedged");
  });
});

// The written prompt on tier 1, decided (dev.md, the coordinator's own
// design record, 2026-09-23): every shape that added persona or policy
// prose to the written-adult prompt measured 0.12x to 0.48x the bare
// floor; the two that ever cleared close to it (the ceiling, arm e's
// own no-prose variant) both lacked it entirely. composePersonaPrompt(
// persona, "written") returns "" while WRITTEN_VOICE_PROSE is false -
// the written dial/policy twins (FORMALITY_FRAGMENT_WRITTEN and the
// rest, still exported below) stay declared for WRITTEN-VOICE-TIER-01
// to turn on once a bigger tier measures them clearing the bar, but
// this function never reaches them while the switch is off.
describe("composePersonaPrompt written class (PREFIX-CLASS-01, decided)", () => {
  test("WRITTEN_VOICE_PROSE is off", () => {
    expect(WRITTEN_VOICE_PROSE).toBe(false);
  });

  test("returns empty while the switch is off - no dial fragment, no policy, for any persona", () => {
    for (const persona of PERSONAS) {
      expect(composePersonaPrompt(persona, "written")).toBe("");
    }
  });

  test("the written dial/policy twins still exist as real, non-empty, third-person text - reachable directly, just not through this function while the switch is off", () => {
    expect(FORMALITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.formality]).toContain("The reply reads in a relaxed, friendly tone");
    expect(COMPLEXITY_FRAGMENT_WRITTEN[DEFAULT_PERSONA.complexity]).toContain("The reply uses plain, everyday language");
    expect(ENGAGEMENT_FRAGMENT_WRITTEN[DEFAULT_PERSONA.engagement]).toContain("The reply answers the exact question completely, then stops");
    expect(FILLER_FRAGMENT_WRITTEN[DEFAULT_PERSONA.filler_density]).toContain("The reply's wording is clean and direct");
    expect(INFORMATION_HANDLING_POLICY_WRITTEN.length).toBeGreaterThan(0);
    expect(WRITTEN_VOICE_POLICY.length).toBeGreaterThan(0);
    for (const fragment of Object.values(FORMALITY_FRAGMENT_WRITTEN)) {
      expect(fragment.toLowerCase()).not.toContain("relaxed message"); // PARITY-BISECT-02's own lowercase-register finding
    }
  });

  test("the spoken class is untouched: composePersonaPrompt(persona) with no surfaceClass, or explicit \"spoken\", still carries the old instructive wording", () => {
    expect(composePersonaPrompt(DEFAULT_PERSONA)).toContain("Talk the way a person actually talks in a relaxed conversation");
    expect(composePersonaPrompt(DEFAULT_PERSONA, "spoken")).toContain("Talk the way a person actually talks in a relaxed conversation");
    expect(composePersonaPrompt(DEFAULT_PERSONA, "spoken")).not.toContain(INFORMATION_HANDLING_POLICY_WRITTEN);
    expect(composePersonaPrompt(DEFAULT_PERSONA, "spoken")).not.toContain(WRITTEN_VOICE_POLICY);
  });
});
