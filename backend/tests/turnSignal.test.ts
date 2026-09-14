// ACT-01: the turn signal's producer, pure. The rows are dev.md section
// 12's own (parts 4 and 6), roster names only.
import { describe, expect, test } from "bun:test";
import { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { classifyTurnSignal, fallbackSignal, freezeDirective, hasEligibleClause, shapeOf, EVERYDAY_IMPERATIVES, type SignalInput } from "@/lib/turnSignal";
import { utteranceShape } from "@/lib/utteranceShape";

const openers = new Set(["add", "set", "remind", "play", "turn", "remember", "forget"]);
const roster = ["Sage", "Pippa", "Rover", "Bramble", "Quill"];
const signal = (text: string, extra: Partial<SignalInput> = {}) => classifyTurnSignal({ text, commandOpeners: openers, roster, ageBand: "adult", ...extra });
const acts = (text: string) => {
  const s = signal(text);
  return [s.primary_act, ...s.secondary_acts].join("+");
};

describe("ACT-01: the act", () => {
  test("the act-register rows read as designed", () => {
    expect(acts("Pippa got the lead in the school play")).toBe("inform");
    expect(acts("ugh, Rover chewed my only good headphones")).toBe("inform+backchannel");
    expect(acts("I've been dreading the dentist all week")).toBe("inform");
    expect(acts("I'll book it tomorrow")).toBe("commissive");
    expect(acts("ok")).toBe("backchannel");
    expect(acts("add oat milk to the list, and when is Pippa's appointment")).toBe("directive+question");
    expect(acts("no, Friday, not Thursday")).toBe("inform+inform");
    expect(acts("you added the wrong item")).toBe("inform");
    expect(acts("why does Rover keep getting sick")).toBe("question");
    expect(acts("play the birthday playlist")).toBe("directive");
    expect(acts("I got the job")).toBe("inform");
    expect(acts("Rover died yesterday")).toBe("inform");
    expect(acts("thanks, that's all for tonight")).toBe("closing+closing");
  });

  test("greetings, closings and backchannels are exact; a request or a question beside them decides the turn", () => {
    expect(acts("good morning")).toBe("greeting");
    expect(acts("hi Sage")).toBe("greeting");
    expect(acts("good morning, how are you")).toBe("question+greeting");
    expect(acts("great, thanks")).toBe("closing");
    expect(acts("thanks for the update")).toBe("closing");
    expect(acts("bye!")).toBe("closing");
    expect(acts("I'm off to bed, night")).toBe("closing");
    expect(acts("thanks, what time is it")).toBe("question+closing");
    expect(acts("remind me later")).toBe("directive");
    expect(acts("cool")).toBe("backchannel");
    expect(acts("makes sense")).toBe("backchannel");
    expect(acts("wow, really?")).toBe("question");
    expect(acts("nice car")).toBe("inform");
  });

  test("the precedence: directive, question, commissive, inform, then the management acts", () => {
    expect(signal("hey, set a timer for ten minutes, and I'll start the pasta").primary_act).toBe("directive");
    expect(signal("could you remember that Pippa's recital is Friday?").primary_act).toBe("directive");
    expect(signal("what's the weather, I'm going out").primary_act).toBe("question");
    expect(signal("I'll call the dentist tomorrow, I promise").primary_act).toBe("commissive");
    expect(signal("ha, I'm basically a professional chef now").primary_act).toBe("inform");
  });

  test("a literal-pattern win freezes a directive, whichever clause the rules read", () => {
    const before = signal("oat milk on the list please, and I'm out of eggs");
    expect(before.primary_act).toBe("inform");
    const frozen = freezeDirective(before);
    expect(frozen.primary_act).toBe("directive");
    expect(frozen.secondary_acts).toEqual(["inform"]);
    expect(frozen.clauses.map((c) => c.act)).toEqual(["directive", "inform"]);
    expect(freezeDirective(frozen)).toEqual(frozen);
    expect(signal("add eggs", { literalWin: true }).primary_act).toBe("directive");
    // A question a package pattern answers ("what time is it") asks.
    const asked = signal("what time is it");
    expect(freezeDirective(asked)).toEqual(asked);
    expect(signal("what is the wifi password", { literalWin: true }).primary_act).toBe("question");
  });

  test("the protocol layer: an answer the pending ask consumed is the parked directive, a refusal its retraction", () => {
    const yes = signal("yes", { protocol: { kind: "confirm", answer: "affirmative" } });
    expect([yes.primary_act, yes.source, yes.repair]).toEqual(["directive", "protocol", "none"]);
    const no = signal("no thanks", { protocol: { kind: "confirm", answer: "negative" } });
    expect([no.primary_act, no.source, no.repair]).toEqual(["directive", "protocol", "retraction"]);
    const value = signal("oat milk", { protocol: { kind: "ask", answer: "value" } });
    expect([value.primary_act, value.source]).toEqual(["directive", "protocol"]);
    expect(hasEligibleClause(yes)).toBe(false);
  });

  test("the fallback: empty text is an inform with unknown clauses", () => {
    const empty = signal("   ");
    expect([empty.primary_act, empty.source, empty.clauses[0]!.stance]).toEqual(["inform", "fallback", "unknown"]);
    expect(hasEligibleClause(empty)).toBe(false);
    expect(fallbackSignal("x", "child").age_band).toBe("child");
  });
});

describe("ACT-01: the emotion, the intensity and the target", () => {
  const feel = (text: string) => {
    const s = signal(text);
    return `${s.expressed_emotion}/${s.emotion_intensity}/${s.target}`;
  };
  test("unmistakable cues at their band; a diminisher lowers one, an intensifier raises one; neutral is none", () => {
    expect(feel("I'm nervous about tomorrow's appointment")).toBe("fear/moderate/self");
    expect(feel("I'm a little annoyed about the traffic")).toBe("anger/low/self");
    expect(feel("I'm terrified about the storm tonight")).toBe("fear/high/self");
    expect(feel("I'm so excited, we're getting a new puppy!")).toBe("happiness/high/self");
    expect(feel("I've been dreading the dentist all week")).toBe("fear/moderate/self");
    expect(feel("Rover died yesterday")).toBe("sadness/high/other");
    expect(feel("Rover died yesterday, and I'm devastated")).toBe("sadness/high/other");
    expect(feel("Pippa got the lead in the school play")).toBe("happiness/moderate/other");
    expect(feel("ugh, Rover chewed my only good headphones")).toBe("anger/moderate/other");
    expect(feel("you added the wrong item")).toBe("anger/moderate/hub");
    expect(feel("why does Rover keep getting sick")).toBe("fear/moderate/other");
    expect(feel("play the birthday playlist")).toBe("happiness/low/world"); // an occasion, not a feeling: a warm word allowed, nothing for memory
    expect(feel("that's disgusting, the milk went off")).toBe("disgust/high/world");
    expect(feel("wow, really?")).toBe("surprise/moderate/world");
    expect(feel("I prefer quiet films")).toBe("neutral/none/self");
    expect(feel("add oat milk to the list")).toBe("neutral/none/world");
  });

  test("a negated cue expresses nothing, and a correction is read as repair", () => {
    const s = signal("I'm not nervous anymore");
    expect([s.expressed_emotion, s.repair]).toEqual(["neutral", "correction"]);
    expect(signal("no, Friday, not Thursday").repair).toBe("correction");
    expect(signal("you added the wrong item").repair).toBe("correction");
    expect(signal("never mind, forget it").repair).toBe("retraction");
    expect(signal("I'm nervous about tomorrow").repair).toBe("none");
  });
});

describe("ACT-01: the clauses, their stance and their subject", () => {
  const clauses = (text: string) => signal(text).clauses.map((c) => `${c.act}:${c.stance}:${c.subject.kind}${c.subject.kind === "named" ? `(${c.subject.name})` : ""}`);
  test("the act-memory rows: what may become a memory and what may not", () => {
    expect(clauses("I prefer quiet films")).toEqual(["inform:asserted:speaker"]);
    expect(clauses("I'll call the dentist tomorrow")).toEqual(["commissive:asserted:speaker"]);
    expect(clauses("does Pippa prefer quiet films")).toEqual(["question:asserted:named(Pippa)"]);
    expect(clauses("add oat milk to the list")).toEqual(["directive:asserted:world"]);
    expect(clauses("thanks, that's all tonight")).toEqual(["closing:asserted:world", "closing:asserted:world"]);
    expect(clauses("add oat milk, and I prefer that brand")).toEqual(["directive:asserted:world", "inform:asserted:speaker"]);
    expect(clauses("Pippa said she hates cilantro")).toEqual(["inform:reported:named(Pippa)"]);
    expect(clauses("if I lived in Paris I'd walk everywhere")).toEqual(["inform:hypothetical:speaker"]);
    expect(clauses("my sister Nadia says she hates cilantro")).toEqual(["inform:reported:named(Nadia)"]);
    expect(clauses("ha, I'm basically a professional chef now")).toEqual(["backchannel:asserted:world", "inform:joke:speaker"]);
    expect(clauses("Quill said, 'I hate seltzer'")).toEqual(["inform:quoted:named(Quill)"]);
    expect(clauses("Quill said he was furious, but I think he was joking")).toEqual(["inform:reported:named(Quill)", "inform:joke:speaker"]);
    expect(clauses("my coworker Tempo likes seltzer")).toEqual(["inform:asserted:named(Tempo)"]);
    expect(clauses("we're getting a new puppy")).toEqual(["inform:asserted:household"]);
  });

  test("eligibility: only an asserted or reported inform or commissive clause", () => {
    for (const text of ["I prefer quiet films", "I'll call the dentist tomorrow", "add oat milk, and I prefer that brand", "my sister Nadia says she hates cilantro", "the dishwasher is broken again"]) {
      expect([text, hasEligibleClause(signal(text))]).toEqual([text, true]);
    }
    for (const text of ["does Pippa prefer quiet films", "add oat milk to the list", "thanks, that's all tonight", "if I lived in Paris I'd walk everywhere", "ha, I'm basically a professional chef now", "ok", "good morning", "Quill said, 'I hate seltzer'"]) {
      expect([text, hasEligibleClause(signal(text))]).toEqual([text, false]);
    }
  });

  test("the ranges index the utterance, cover every clause and never overlap", () => {
    const text = "hey Sage, add oat milk to the list, and when is Pippa's appointment";
    const s = signal(text);
    expect(s.clauses.map((c) => text.slice(c.range.start, c.range.end))).toEqual(["add oat milk to the list", "when is Pippa's appointment"]);
    for (let i = 1; i < s.clauses.length; i++) expect(s.clauses[i]!.range.start).toBeGreaterThanOrEqual(s.clauses[i - 1]!.range.end);
  });

  test("a roster name resolves through the caller's resolver; a household member resolves to no entity", () => {
    const s = signal("Rover died yesterday", { resolveEntity: (name) => (name === "Rover" ? "ent-rover001" : null) });
    expect(s.clauses[0]!.subject).toEqual({ kind: "named", name: "Rover", entity_id: "ent-rover001" });
    expect(signal("Pippa got the lead").clauses[0]!.subject).toEqual({ kind: "named", name: "Pippa", entity_id: null });
  });
});

describe("ACT-01: one classification", () => {
  test("every signal validates against the spec shape, with the band and its basis", () => {
    for (const text of ["ok", "I got the job", "add oat milk to the list, and when is Pippa's appointment", "Quill said, 'I hate seltzer'", "  ", "yes"]) {
      const s = text === "yes" ? signal(text, { protocol: { kind: "confirm", answer: "affirmative" } }) : signal(text);
      const parsed = TurnSignal.safeParse(s);
      expect([text, parsed.success ? null : parsed.error.issues[0]]).toEqual([text, null]);
      expect([s.age_band, s.age_band_basis, s.refers_to_prior, s.classifier_id]).toEqual(["adult", "identified_profile", null, null]);
    }
    expect(signal("hi", { ageBand: "child", ageBandBasis: "unknown_speaker_default" }).age_band_basis).toBe("unknown_speaker_default");
  });

  test("the router's shape is a projection of the signal, equal to utteranceShape() over the merged openers on every row", () => {
    const merged = new Set([...EVERYDAY_IMPERATIVES, ...openers]);
    const rows = ["lock the front door", "text Nadia that I'm running late", "take the second one off", "say that again", "actually, forget what I told you about Marlow's birthday",
      "Pippa got the lead in the school play", "I've been dreading the dentist all week", "I'll book it tomorrow", "ok", "add oat milk to the list, and when is Pippa's appointment",
      "no, Friday, not Thursday", "why does Rover keep getting sick", "play the birthday playlist", "thanks, that's all for tonight", "could you remember that Pippa's recital is Friday?",
      "good morning, how are you", "what's the difference between a crocodile and an alligator", "please, what time is it", "Remember, I have a dentist appointment", "hey remember to buy eggs",
      "the dishwasher is broken again", "I'm so excited, we're getting a new puppy!", "what does ephemeral mean and remember that my dentist appointment is next week",
    ];
    for (const text of rows) expect([text, shapeOf(signal(text), text)]).toEqual([text, utteranceShape(text, merged)]);
    expect(shapeOf(signal("lock the front door"), "lock the front door")).toBe("command");
    expect(signal("actually, forget what I told you about Marlow's birthday").primary_act).toBe("directive");
    expect(signal("ugh, what a long day").primary_act).toBe("inform");
    expect(signal("and why is a sunset red").primary_act).toBe("question");
    expect(signal("Marsh and I are training for the 10k in October").clauses.length).toBe(1);
  });

  test("the review's cases: a pronoun is not a source, a trip is not a person, an occasion never preempts a feeling, a request in the negative is a directive and never a correction", () => {
    expect(signal("He said the vet is closed Monday").clauses[0]!.subject.kind).toBe("world");
    expect(signal("Everyone says the new cafe is good").clauses[0]!.subject.kind).toBe("world");
    expect(signal("my trip to Paris was amazing").clauses[0]!.subject).toEqual({ kind: "speaker" });
    expect(signal("my older sister Nadia says she hates cilantro").clauses[0]!.subject).toEqual({ kind: "named", name: "Nadia", entity_id: null });
    expect(signal("our neighbor Marlow has a new truck").clauses[0]!.subject).toEqual({ kind: "named", name: "Marlow", entity_id: null });
    const cancelled = signal("I can't believe they cancelled the party");
    expect([cancelled.expressed_emotion, cancelled.emotion_intensity]).toEqual(["surprise", "high"]);
    expect(signal("Rover threw up at the party, so gross").expressed_emotion).toBe("disgust");
    for (const text of ["stop the music", "cancel my 3pm", "don't forget to lock the door tonight", "no thanks", "what's wrong with the lights?"]) {
      expect([text, signal(text).repair]).toEqual([text, "none"]);
    }
    expect(signal("don't forget to lock the door tonight").primary_act).toBe("directive");
    expect(signal("no, Friday, not Thursday").repair).toBe("correction");
    expect(signal("that's wrong, it's on Friday").repair).toBe("correction");
    // A proposal is a directive for the plan and conversation-shaped for the router.
    const proposal = signal("let's plan the trip this weekend");
    expect([proposal.primary_act, shapeOf(proposal, "let's plan the trip this weekend")]).toEqual(["directive", "statement"]);
    expect(shapeOf(signal("you should see the sunset tonight"), "you should see the sunset tonight")).toBe("statement");
  });

  test("the classifier is microseconds, never a model: a thousand turns in well under a second", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) signal("add oat milk to the list, and when is Pippa's appointment, I'm so nervous about it");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
