import { describe, expect, test } from "bun:test";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { fallbackSignal } from "@/lib/turnSignal";
import { planFor, planLine, type PlanInput } from "@/lib/register";

const base = (act: TurnSignal["primary_act"], emotion: TurnSignal["expressed_emotion"] = "neutral", intensity: TurnSignal["emotion_intensity"] = "none"): TurnSignal => ({
  ...fallbackSignal("test", "adult"), primary_act: act, expressed_emotion: emotion, emotion_intensity: intensity,
});
const input = (signal: TurnSignal, over: Partial<PlanInput> = {}): PlanInput => ({
  signal, surface: "chat", brevity: false, evidence: { choices: 0, sources: 0, deliverable: false },
  companion: { directness: "diplomatic", engagement: "balanced", vocabulary: "advanced" },
  band: "adult", deferred: false, disclosureWithheld: false, ...over,
});

describe("planFor", () => {
  test("base table covers each act and chat lengths", () => {
    expect(planFor(input(base("inform"))).moves.say).toBe("allowed");
    expect(planFor(input(base("question"))).moves.say).toBe("required");
    expect(planFor(input(base("directive"))).moves.say).toBe("required");
    expect(planFor(input(base("commissive"))).moves.react).toBe("required");
    expect(planFor(input(base("greeting"))).max_words).toBe(15);
    expect(planFor(input(base("closing"))).moves.close).toBe("required");
    expect(planFor(input(base("backchannel"))).max_words).toBe(20);
  });

  test("sadness requires care and forbids playfulness", () => {
    const plan = planFor(input(base("inform", "sadness", "moderate")));
    expect(plan.moves.care).toBe("required"); expect(plan.playfulness).toBe("forbidden");
  });
  test("anger at the hub turns optional moves off", () => {
    const signal = { ...base("inform", "anger"), target: "hub" as const };
    const plan = planFor(input(signal));
    expect(plan.moves.ask_back).toBe("forbidden"); expect(plan.moves.react).toBe("forbidden");
  });
  test("high intensity shortens the length", () => {
    expect(planFor(input(base("question", "surprise", "high"))).max_sentences).toBe(1);
  });
  test("direct removes optional react but cannot remove required care", () => {
    const direct = { directness: "direct" as const, engagement: "balanced" as const };
    expect(planFor(input(base("inform"), { companion: direct })).moves.react).toBe("forbidden");
    expect(planFor(input(base("inform", "sadness"), { companion: direct })).moves.care).toBe("required");
  });
  test("brief forbids ask-back and curious allows it after inform", () => {
    expect(planFor(input(base("inform"), { companion: { directness: "diplomatic", engagement: "brief" } })).moves.ask_back).toBe("forbidden");
    expect(planFor(input(base("inform"), { companion: { directness: "diplomatic", engagement: "curious" } })).moves.ask_back).toBe("allowed");
  });
  test("brevity forbids react and ask-back", () => {
    const plan = planFor(input(base("inform"), { brevity: true }));
    expect(plan.moves.react).toBe("forbidden"); expect(plan.moves.ask_back).toBe("forbidden");
  });
  test("child band applies its register ceiling", () => {
    const plan = planFor(input(base("question"), { band: "child" }));
    expect(plan.vocabulary_level).toBe("simple"); expect(plan.explanation_style).toBe("concrete");
    expect(plan.moves.point).toBe("forbidden"); expect(plan.max_words).toBe(40);
  });
  test("deferred requires defer and offers to ask a trusted adult", () => {
    const plan = planFor(input(base("question"), { deferred: true }));
    expect(plan.moves.defer).toBe("required"); expect(plan.trusted_adult_move).toBe("offer_to_ask");
  });
  test("two choices on a question require pick", () => {
    expect(planFor(input(base("question"), { evidence: { choices: 2, sources: 0, deliverable: false } })).moves.pick).toBe("required");
  });
  test("planLine states the design example", () => {
    const signal = base("inform", "sadness", "moderate");
    const line = planLine(planFor(input(signal)), signal);
    expect(line).toContain("acknowledge the feeling first"); expect(line).toContain("no question");
  });

  // U4/RESP-01: no surfaceClass pins today's exact numbers, so
  // turnEngine.ts's four call sites (none of which pass it) keep
  // running the frozen path's own act table unchanged.
  test("with no surfaceClass, every act keeps today's numbers", () => {
    expect(planFor(input(base("question"))).max_words).toBe(60);
    expect(planFor(input(base("inform"))).max_words).toBe(30);
    expect(planFor(input(base("greeting"))).max_words).toBe(15);
  });

  test("surfaceClass: spoken is identical to no surfaceClass", () => {
    expect(planFor(input(base("question"), { surfaceClass: "spoken" })).max_words).toBe(60);
  });

  describe("the written class (a typed screen: chat, tv)", () => {
    test("a written question with no evidence: 220 words, 14 sentences", () => {
      const plan = planFor(input(base("question"), { surfaceClass: "written" }));
      expect(plan.max_words).toBe(220); expect(plan.max_sentences).toBe(14);
    });
    test("a written question with a source, a deliverable, or two choices gets room: 360 words, 24 sentences", () => {
      const withSource = planFor(input(base("question"), { surfaceClass: "written", evidence: { choices: 0, sources: 1, deliverable: false } }));
      expect(withSource.max_words).toBe(360); expect(withSource.max_sentences).toBe(24);
      const withDeliverable = planFor(input(base("question"), { surfaceClass: "written", evidence: { choices: 0, sources: 0, deliverable: true } }));
      expect(withDeliverable.max_words).toBe(360);
      const withChoices = planFor(input(base("question"), { surfaceClass: "written", evidence: { choices: 2, sources: 0, deliverable: false } }));
      expect(withChoices.max_words).toBe(360);
    });
    test("a written inform is 90 words, 6 sentences", () => {
      const plan = planFor(input(base("inform"), { surfaceClass: "written" }));
      expect(plan.max_words).toBe(90); expect(plan.max_sentences).toBe(6);
    });
    test("a written greeting keeps the reaction shape: 15 words, 1 sentence - 'hi' still gets 'hey'", () => {
      const plan = planFor(input(base("greeting"), { surfaceClass: "written" }));
      expect(plan.max_words).toBe(15); expect(plan.max_sentences).toBe(1);
      expect(plan.moves.react).toBe("required");
    });
    test("brevity on the written class uses the spoken table for that turn", () => {
      const plan = planFor(input(base("question"), { surfaceClass: "written", brevity: true }));
      expect(plan.max_words).toBe(60);
    });
    test("the child band's cap holds on the written class too", () => {
      const plan = planFor(input(base("question"), { surfaceClass: "written", band: "child" }));
      expect(plan.max_words).toBe(40);
    });
    test("planLine on the written class names no sentence count", () => {
      const signal = base("inform");
      const line = planLine(planFor(input(signal, { surfaceClass: "written" })), signal, "written");
      expect(line).not.toContain("sentence");
      expect(line).toContain("as complete as you would answer with no persona at all, then in the companion's voice");
    });
  });

  describe("the glance class (a shared overlay)", () => {
    test("keeps today's numbers, same as spoken", () => {
      expect(planFor(input(base("question"), { surfaceClass: "glance" })).max_words).toBe(60);
    });
  });
});
