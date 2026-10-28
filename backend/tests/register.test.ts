import { describe, expect, test } from "bun:test";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { adviceOf, fallbackSignal } from "@/lib/turnSignal";
import { planFor, planLine, planLineForTurnMachine, type PlanInput } from "@/lib/register";

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
  test("the frozen planLine keeps its legacy wording for a world target", () => {
    const signal = { ...base("question"), target: "world" as const };
    expect(planLine(planFor(input(signal)), signal)).toContain("a question about themselves");
  });

  // U4/RESP-01: no surfaceClass pins today's exact numbers, so
  // the retired turn engine's four call sites (none of which pass it) keep
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
      expect(line).toContain("answer as completely as you would with no persona at all, then add the companion's voice");
    });
    test("PERSONA-LEAK-01: the written length rule is its own instruction sentence, not a fragment in the plan list", () => {
      // ks1-adult-stable-01 leaked "To say so, as complete as you would answer with no
      // persona at all..." because the length clause sat as a bare fragment between
      // list items and the model echoed it as reply text.
      const signal = base("question");
      const line = planLine(planFor(input(signal, { surfaceClass: "written" })), signal, "written");
      expect(line).not.toContain("as complete as you would answer");
      const sentences = line.split(". ");
      const [head = ""] = sentences;
      const tail = sentences[sentences.length - 1] ?? "";
      expect(head).not.toContain("persona");
      expect(tail).toContain("persona at all");
      expect(tail.startsWith("Length: ")).toBe(true);
    });
    test("PERSONA-LEAK-02: the written bans are an instruction sentence, never the 'no question, no tasks' fragment", () => {
      // Live 2026-10-17: three written replies in one session opened or closed with
      // "No question, no tasks." because the bans sat as a bare fragment at the end of
      // the plan list, the same leak PERSONA-LEAK-01 fixed for the length clause.
      const signal = base("question");
      const written = planLine(planFor(input(signal, { surfaceClass: "written" })), signal, "written");
      expect(written).not.toMatch(/no question/i);
      expect(written).not.toMatch(/no tasks/i);
      expect(written).not.toMatch(/no playfulness/i);
      expect(written).toMatch(/\. (Do not add [^.]+|Add no unnecessary follow-up)\. Length: /);
      // The spoken class keeps its frozen fragment wording (rule 0: a spoken turn's shape never changes here).
      const spoken = planLine(planFor(input(signal)), signal);
      expect(spoken).toMatch(/no question|no tasks|no unnecessary follow-up/);
    });
  });

  describe("the glance class (a shared overlay)", () => {
    test("keeps today's numbers, same as spoken", () => {
      expect(planFor(input(base("question"), { surfaceClass: "glance" })).max_words).toBe(60);
    });
  });
});

describe("RECENCY-02: a curious companion's spoken turn points at what it remembers", () => {
  const tie = "When what they say now connects to something they told you earlier, bring it back once with a playful remark, using only what they said";
  test("a curious companion's spoken plan line carries the tie-in sentence, a balanced one's does not, and the written class never does", () => {
    const signal = base("inform");
    const plan = planFor(input(signal, { surface: "robot" }));
    expect(planLineForTurnMachine(plan, signal, "spoken", "curious")).toContain(tie);
    expect(planLineForTurnMachine(plan, signal, "spoken", "balanced")).not.toContain(tie);
    expect(planLineForTurnMachine(plan, signal, "spoken")).not.toContain(tie);
    expect(planLineForTurnMachine(plan, signal, "written", "curious")).not.toContain(tie);
  });
});

describe("ROBOT-VOICE-02: a lively companion's spoken turn carries its voice", () => {
  const lively = { directness: "diplomatic" as const, engagement: "curious" as const, vocabulary: "standard" as const };
  test("a directive on a spoken turn allows a reaction and the plan line asks for one", () => {
    const signal = base("directive");
    const plan = planFor(input(signal, { surface: "robot", surfaceClass: "spoken", companion: lively }));
    expect(plan.moves.react).toBe("allowed");
    expect(planLineForTurnMachine(plan, signal, "spoken", "curious")).toContain("open with a quick happy reaction");
  });
  test("a balanced companion, the written class and a sad turn keep today's lines", () => {
    const signal = base("directive");
    expect(planFor(input(signal, { surfaceClass: "spoken" })).moves.react).toBe("forbidden");
    expect(planFor(input(signal, { surfaceClass: "written", companion: lively })).moves.react).toBe("forbidden");
    const sad = base("inform", "sadness", "moderate");
    const sadPlan = planFor(input(sad, { surfaceClass: "spoken", companion: lively }));
    expect(sadPlan.moves.care).toBe("required");
    expect(planLineForTurnMachine(sadPlan, sad, "spoken", "curious")).not.toContain("happy reaction");
    expect(planLineForTurnMachine(planFor(input(signal)), signal, "spoken", "balanced")).not.toContain("happy reaction");
  });
});

describe("ROBOT-VOICE-03: the tie-in is rare, relevant to a turn that says something, and faithful", () => {
  const tieStart = "When what they say now connects to something they told you earlier";
  const lively = { directness: "diplomatic" as const, engagement: "curious" as const, vocabulary: "standard" as const };
  const line = (act: TurnSignal["primary_act"]) => {
    const signal = base(act);
    return planLineForTurnMachine(planFor(input(signal, { surface: "robot", surfaceClass: "spoken", companion: lively })), signal, "spoken", "curious");
  };
  test("a statement, a plan or a request is offered the tie-in; a question, a greeting, a thanks and a goodbye are not", () => {
    for (const act of ["inform", "commissive", "directive"] as const) expect(line(act)).toContain(tieStart);
    for (const act of ["question", "greeting", "backchannel", "closing"] as const) expect(line(act)).not.toContain(tieStart);
  });
  test("the sentence forbids inventing details, rewriting the robot as a person, and repeating a recent callback", () => {
    const text = line("inform");
    expect(text).toContain("using only what they said");
    expect(text).toContain("never add details");
    expect(text).toContain("never turn something about you, the robot, into something about a person");
    expect(text).toContain("Do not bring up anything you already mentioned in your last few replies");
    expect(text).toContain("most replies bring nothing back");
  });
});

describe("planFor social dials (NAT-06)", () => {
  const withSocial = (social: NonNullable<PlanInput["companion"]["social"]>, over: Partial<PlanInput> = {}) =>
    input(base("inform"), { companion: { directness: "diplomatic", engagement: "balanced", social }, ...over });
  test("absent or medium changes nothing", () => {
    expect(planFor(withSocial({ humor: "medium", warmth: "medium", initiative: "medium" }))).toEqual(planFor(withSocial({})));
  });
  test("low humor forbids playfulness, low warmth drops the optional react, low initiative drops the question back", () => {
    const plan = planFor(withSocial({ humor: "low", warmth: "low", initiative: "low" }));
    expect(plan.playfulness).toBe("forbidden");
    expect(plan.moves.react).toBe("forbidden");
    expect(plan.moves.ask_back).toBe("forbidden");
  });
  test("high initiative allows a question back for a brief companion, but brevity still wins", () => {
    const brief = { directness: "diplomatic" as const, engagement: "brief" as const, social: { initiative: "high" as const } };
    expect(planFor(input(base("inform"), { companion: brief })).moves.ask_back).toBe("allowed");
    expect(planFor(input(base("inform"), { companion: brief, brevity: true })).moves.ask_back).toBe("forbidden");
  });
  test("high warmth never overrides required care", () => {
    const plan = planFor(input(base("inform", "sadness", "moderate"), { companion: { directness: "diplomatic", engagement: "balanced", social: { warmth: "high", humor: "high" } } }));
    const baseline = planFor(input(base("inform", "sadness", "moderate")));
    expect(plan.moves.care).toBe("required");
    expect(plan.moves).toEqual(baseline.moves);
    expect(plan.playfulness).toBe("forbidden");
  });
});

describe("wants_advice (NAT-06b)", () => {
  const sad = (wants?: "yes" | "no") => ({ ...base("inform", "sadness", "moderate"), ...(wants ? { wants_advice: wants } : {}) });
  test("the cues read the person's words, no wording means no field", () => {
    expect(adviceOf("I just need to vent about work")).toBe("no");
    expect(adviceOf("I don't want advice, I'm just tired")).toBe("no");
    expect(adviceOf("I'm so stressed, what should I do?")).toBe("yes");
    expect(adviceOf("any advice for getting over a cold")).toBe("yes");
    expect(adviceOf("I just need to vent, what should I do")).toBe("no");
    expect(adviceOf("it was a long day")).toBeUndefined();
    expect(adviceOf("what do you think of the weather")).toBeUndefined();
  });
  test("no: care stays, advice moves and questions back are off", () => {
    const plan = planFor(input(sad("no")));
    expect(plan.moves.care).toBe("required");
    for (const move of ["say", "pick", "point", "ask_back"] as const) expect(plan.moves[move]).toBe("forbidden");
    expect(planLineForTurnMachine(plan, sad("no"))).toContain("do not give advice");
  });
  test("yes on an emotional turn allows the answer and a longer reply, care still leads", () => {
    const plain = planFor(input(sad()));
    const plan = planFor(input(sad("yes")));
    expect(plan.moves.care).toBe("required");
    expect(plan.moves.say).toBe("allowed");
    expect(plan.max_sentences).toBeGreaterThan(plain.max_sentences);
    expect(planLineForTurnMachine(plan, sad("yes"))).toContain("then give the advice they asked for");
  });
  test("absent changes nothing, and a required say survives no", () => {
    expect(planFor(input(sad()))).toEqual(planFor(input(sad(undefined))));
    expect(planFor(input({ ...base("question"), wants_advice: "no" })).moves.say).toBe("required");
  });
  test("anger at the hub still wins over yes", () => {
    const plan = planFor(input({ ...base("inform", "anger", "moderate"), target: "hub", wants_advice: "yes" }));
    expect(plan.moves.say).toBe("forbidden");
  });
});
