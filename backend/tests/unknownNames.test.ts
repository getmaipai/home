// ASK-01 (docs/dev.md "The chat design pass" section 3; docs/dev/
// session-a.md "ASK-01"): the unknown-name rule's own parts, pure.
// The resolver's known set and frames, the question and the context
// line, the answer parser for a pet, a relative and an unreadable
// answer, and the two guard shapes both ways; the engine flows are in
// tests/ask01.test.ts. Finding 24's check comes first: a grounded
// first-person recall with the fact in context trips no guard.
import { describe, expect, test } from "bun:test";
import { SubjectRef as SubjectRefSchema } from "@maipai/spec/gen/ts/subject-ref.js";
import { validateSubjectRef } from "@maipai/spec/records/ts/validate.js";
import { parseWhoAnswer, relationFramesIn, replyAsksAbout, resolveNames, speakerStatedKind, statedPronounFor, unknownNamesLine, whoQuestion, looksLikeWhoAnswer, candidateQuestion, relationPhraseFor, pronounFamiliesIn } from "@/lib/unknownNames";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { guardReply, dontKnowYetLine, replacementFor } from "@/lib/guards";

const ROSTER = ["Sage", "Bramble", "Marsh", "Rover", "Pippa"];
const known = { names: ROSTER, resolveEntity: (n: string) => `ent-${n.toLowerCase().padEnd(6, "x")}` };
const resolve = (text: string) => resolveNames(text, classifyTurnSignal({ text, roster: ROSTER, ageBand: "adult" }), known, "turn-t");
const asks = (text: string) => resolve(text).unknown.filter((u) => u.ask).map((u) => u.name);
const unresolved = (text: string) =>
  resolve(text)
    .subjects.filter((s) => s.type === "unresolved")
    .map((s) => (s.type === "unresolved" ? s.surface_form : ""));

describe("finding 24 first: a grounded first-person recall trips no guard", () => {
  test("'what did I say my class schedule was' with the fact in context is answered from the fact, guard null", () => {
    const ctx = {
      utterance: "what did I say my class schedule was",
      act: "question" as const,
      sources: ["Sage's class schedule is Monday and Wednesday mornings, with a lab on Thursday"],
      roster: ["Sage", "Bramble"],
      personId: "person-t",
      unknownNames: [],
      subjectPronouns: [],
      pronounsInPlay: [],
    };
    for (const reply of [
      "You said your class schedule is Monday and Wednesday mornings, with a lab on Thursday.",
      "You told me it's Monday and Wednesday mornings plus a Thursday lab.",
      "As you mentioned, Monday and Wednesday mornings, and a lab on Thursday.",
      "I remember: Monday and Wednesday mornings, lab on Thursday.",
    ]) {
      expect([reply, guardReply(reply, ctx).reason]).toEqual([reply, null]);
    }
  });
});

describe("resolveNames(): the known set and the household frames", () => {
  test("a roster name or a registry name is a household ref; the rest is unresolved", () => {
    const r = resolve("Marsh and I are training for the 10k in October");
    expect(r.subjects).toEqual([{ type: "household", entity_id: "ent-marshx", carried_question: null }]);
    expect(r.unknown).toEqual([]);
    expect(unresolved("what is the runtime of Cobra")).toEqual(["Cobra"]);
    expect(asks("what is the runtime of Cobra")).toEqual([]);
  });

  test("a possessive in the clause, a personal pronoun for it, or the roster's shape frames a name as household: the engine asks", () => {
    expect(asks("Clover borrowed our tent for the weekend")).toEqual(["Clover"]);
    expect(asks("Nadia just got back from her first marathon")).toEqual(["Nadia"]);
    expect(resolve("Nadia just got back from her first marathon").unknown[0]?.pronoun).toBe("she");
    expect(asks("Pippa and Clover are coming over")).toEqual(["Clover"]);
    // A bare possessive is not a frame (the set: "Tempo's second album"
    // asked about the band).
    expect(asks("and what did I say about Tempo's second album")).toEqual([]);
    expect(asks("Clover's tent is in the garage")).toEqual([]);
    expect(asks("Raven and I got the same manager this week, and she keeps borrowing my stapler")).toEqual(["Raven"]);
  });

  test("a relation noun beside the name settles its kind: unresolved with the hint, no ask (the judge writes it stated)", () => {
    const r = resolve("my coworker Quill likes seltzer");
    expect(r.subjects).toEqual([{ type: "unresolved", surface_form: "Quill", candidate_kinds: ["person"], provenance: "turn-t", confidence: 0.8, carried_question: null }]);
    expect(r.unknown[0]?.ask).toBe(false);
    expect(resolve("my cousin Clover, she teaches piano").unknown[0]).toMatchObject({ name: "Clover", hintedKinds: ["person"], ask: false });
  });

  test("a bare proper noun, a world kind noun, a lowercase name and a roster name inside a longer proper noun never ask", () => {
    expect(asks("Sage is getting a Tempo treadmill for the office")).toEqual([]);
    expect(asks("have you heard of the band Tempo? I have been listening to them all morning")).toEqual([]);
    expect(asks("is the new Dune film any good")).toEqual([]);
    expect(asks("juniper chewed through the garden hose again")).toEqual([]);
    expect(unresolved("juniper chewed through the garden hose again")).toEqual([]);
    const lantern = resolve("I love the new Marsh Lantern album");
    expect(lantern.subjects).toEqual([{ type: "unresolved", surface_form: "Marsh Lantern", candidate_kinds: [], provenance: "turn-t", confidence: 0.4, carried_question: null }]);
    expect(asks("Dinner is at six")).toEqual([]);
    expect(asks("Dinner is at Grandma's, she said six")).toEqual([]);
    // A model number stays with a name the household does not know
    // ("Rivet 3"); a roster name keeps its own shape (a review).
    expect(unresolved("the old one is a Rivet 3 with 8 gigs")).toEqual(["Rivet 3"]);
    expect(resolve("I told Marsh 3 times to clean up").subjects).toEqual([{ type: "household", entity_id: "ent-marshx", carried_question: null }]);
    expect(relationFramesIn("Tell Nadia my phone is broken")).toEqual([]);
    expect(relationFramesIn("Remind Clover our dog needs walking")).toEqual([]);
    // A question about a public figure carries a pronoun too and is
    // the world's (a review).
    for (const world of ["what did Shakespeare write before he died", "is Messi still playing? he must be old", "did Beyonce say she is touring"]) expect([world, asks(world)]).toEqual([world, []]);
    expect(asks("wait, how would you know that?")).toEqual([]);
  });

  test("every ref the resolver writes is SPEC-01's SubjectRef shape", () => {
    for (const text of ["Clover borrowed our tent", "what is the runtime of Cobra", "Marsh and I are training", "my coworker Quill likes seltzer"]) {
      for (const ref of resolve(text).subjects) {
        expect(SubjectRefSchema.safeParse(ref).success).toBe(true);
        expect(validateSubjectRef(ref as never)).toEqual([]);
      }
    }
  });
});

describe("relationFramesIn() and speakerStatedKind(): the kind the person's own words state", () => {
  test("the innermost noun decides, the relation only from the speaker's side", () => {
    expect(relationFramesIn("our neighbor's dog Juniper dug up the beds")).toEqual([{ name: "Juniper", noun: "dog", kind: "pet", type: null }]);
    expect(relationFramesIn("my cousin Clover teaches piano")).toEqual([{ name: "Clover", noun: "cousin", kind: "person", type: "relative_of" }]);
    expect(relationFramesIn("the dog Rover is sick")).toEqual([{ name: "Rover", noun: "dog", kind: "pet", type: null }]);
    expect(relationFramesIn("my sister Nadia's dog Rover is sick").map((f) => [f.name, f.kind])).toEqual([
      ["Nadia", "person"],
      ["Rover", "pet"],
    ]);
    expect(speakerStatedKind("my coworker Quill likes seltzer", "Quill", "person")).toBe(true);
    expect(speakerStatedKind("juniper chewed through the garden hose again", "juniper", "pet")).toBe(false);
    expect(speakerStatedKind("Raven and I got the same manager", "Raven", "person")).toBe(false);
    // A place, an organization or a thing is stated by its name alone;
    // a two-word person name reads through its frame (a review).
    expect(speakerStatedKind("we went to Lakeview Park", "Lakeview Park", "place")).toBe(true);
    // The two-turn household-frame rule (the set's pet row): the name in
    // the previous turn, the kind noun with a pronoun in this one.
    expect(speakerStatedKind("he's our rabbit", "juniper", "pet", "juniper chewed through the garden hose again")).toBe(true);
    expect(speakerStatedKind("he's our rabbit", "juniper", "pet", "the weather was nice")).toBe(false);
    expect(speakerStatedKind("my sister Nadia is visiting", "juniper", "pet", "juniper chewed through the garden hose again")).toBe(false);
    expect(statedPronounFor("he's our rabbit", "juniper", "pet", "juniper chewed through the garden hose again")).toBe("he");
    expect(statedPronounFor("he's our rabbit", "juniper", "pet")).toBeNull();
    // The previous turn must name only the candidate (a review): two
    // pets then "he's our rabbit" states neither.
    expect(speakerStatedKind("he's our rabbit", "juniper", "pet", "juniper and Rover chewed through the hose")).toBe(false);
    expect(speakerStatedKind("he's our rabbit", "juniper", "pet", "juniper and rover chewed through the hose")).toBe(false);
    expect(speakerStatedKind("he's our rabbit", "rover", "pet", "juniper and rover chewed through the hose")).toBe(false);
    // The answer shape itself, never a statement carrying a noun (a review).
    expect(speakerStatedKind("my cousin is coming over Saturday", "juniper", "person", "juniper chewed through the garden hose again")).toBe(false);
    // A place the model supplied is never stated by a turn that does
    // not carry the name (a review).
    expect(speakerStatedKind("we drove for an hour", "Lakeview Park", "place", "we went to Lakeview Park")).toBe(false);
    expect(speakerStatedKind("my coworker Quill Marsh likes seltzer", "Quill Marsh", "person")).toBe(true);
  });
});

describe("the question, the context line, and the reply's own question", () => {
  test("whoQuestion() never guesses a kind; the line lists the framed unknowns only", () => {
    expect(whoQuestion("Clover")).toBe("Who's Clover?");
    expect(unknownNamesLine(["Clover"])).toBe("Names in this message you have never heard before: Clover. You don't know who or what Clover is: don't guess, and don't claim to remember.");
    expect(unknownNamesLine([])).toBeNull();
    expect(candidateQuestion("entity", "juniper")).toBe("Who's Juniper?");
    expect(candidateQuestion("relationship", "Raven", relationPhraseFor("colleague_of") ?? undefined)).toBe("Is Raven your coworker?");
    expect(relationPhraseFor("owned_by")).toBeNull();
    // The prompt's own phrase per type (a review: never "your dog" for owns).
    expect(candidateQuestion("relationship", "Tesla", relationPhraseFor("owns") ?? undefined)).toBe("Is Tesla yours?");
    expect(relationPhraseFor("parent_of")).toBe("your child");
  });

  test("replyAsksAbout(): a question sentence naming the unknown counts as the ask", () => {
    expect(replyAsksAbout("Sounds like fun. Who is Clover, by the way?", "Clover")).toBe(true);
    expect(replyAsksAbout("I don't know Clover yet, who's that?", "Clover")).toBe(true);
    expect(replyAsksAbout("I hope Clover had fun. Tents are great.", "Clover")).toBe(false);
    expect(replyAsksAbout("Who's that?", "Clover")).toBe(false);
    // Chit-chat about the name is not the ask (a review).
    expect(replyAsksAbout("How is Clover doing today?", "Clover")).toBe(false);
    expect(replyAsksAbout("Did Clover bring the tent back?", "Clover")).toBe(false);
    expect(replyAsksAbout("What is Clover to you?", "Clover")).toBe(true);
  });
});

describe("parseWhoAnswer(): a pet, a relative, a verdict, and an answer it cannot read", () => {
  test("a pet with a pronoun and a relation", () => {
    expect(parseWhoAnswer("he's our rabbit", "Juniper")).toEqual({ kind: "pet", relationType: "owns", noun: "rabbit", pronouns: "he", description: "rabbit", verdict: null });
  });
  test("a relative with what else was said", () => {
    expect(parseWhoAnswer("my cousin, she teaches piano", "Clover")).toEqual({ kind: "person", relationType: "relative_of", noun: "cousin", pronouns: "she", description: "cousin, she teaches piano", verdict: null });
    // The name itself is not a description of it.
    expect(parseWhoAnswer("She's my coworker Nadia. Very nice.", "Nadia")?.toString()).not.toContain("Nadia");
  });
  test("a kind with no relation of the speaker's, and a verdict", () => {
    expect(parseWhoAnswer("a friend from work", "Quill")).toMatchObject({ kind: "person", relationType: null, noun: "friend" });
    expect(parseWhoAnswer("the neighbor's dog", "Juniper")).toMatchObject({ kind: "pet", relationType: null, noun: "dog" });
    expect(parseWhoAnswer("yes", "Raven", { relationAsked: true })).toMatchObject({ verdict: "yes", kind: undefined });
    // A bare yes or "sure" to "Who's X?" says nothing (a review).
    expect(parseWhoAnswer("yes", "Raven")).toBeNull();
    expect(parseWhoAnswer("sure", "Clover")).toBeNull();
    expect(parseWhoAnswer("no, she is my sister", "Raven")).toMatchObject({ verdict: "no", kind: "person", relationType: "sibling_of", pronouns: "she" });
  });
  test("a cancel is declined; a new subject or a question is unreadable (null)", () => {
    for (const cancel of ["never mind", "not now", "forget it", "doesn't matter", "nobody", "no"]) expect([cancel, parseWhoAnswer(cancel, "Clover")]).toEqual([cancel, "declined"]);
    for (const other of ["what is the weather", "wait, how would you know that?", "add eggs to the list", "she ran it in four hours"]) expect([other, parseWhoAnswer(other, "Nadia")]).toEqual([other, null]);
  });
  test("looksLikeWhoAnswer(): the bare answer shape with no other name in it, and never a statement of its own (the review's rows)", () => {
    expect(looksLikeWhoAnswer("he's our rabbit", "juniper")).toBe(true);
    expect(looksLikeWhoAnswer("he's our rabbit and he bites", "juniper")).toBe(true);
    expect(looksLikeWhoAnswer("she is my sister", "Raven")).toBe(true);
    expect(looksLikeWhoAnswer("my cousin", "Clover")).toBe(true);
    expect(looksLikeWhoAnswer("a friend from work", "Quill")).toBe(true);
    expect(looksLikeWhoAnswer("my cousin Clover teaches piano", "Raven")).toBe(false);
    expect(looksLikeWhoAnswer("what should I get her as a thank-you", "Clover")).toBe(false);
    expect(looksLikeWhoAnswer("the weather is nice today", "Raven")).toBe(false);
    // Ordinary sentences with "my <noun>" are their own turn, never the
    // answer to a question nobody asked (a review).
    for (const statement of ["my sister is visiting tomorrow", "I'm heading to my mom's place", "my dog is sick", "my cousin, she teaches piano"]) {
      expect([statement, looksLikeWhoAnswer(statement, "Juniper")]).toEqual([statement, false]);
    }
  });
  test("the phrase sits where an answer puts it: a command or a statement with the noun inside is never the answer (a review)", () => {
    for (const other of ["turn on the office lights", "play the band Tempo", "tell Nadia my phone is broken", "remind Clover our dog needs walking", "she's fine, my sister is visiting her"]) {
      expect([other, parseWhoAnswer(other, "Clover")]).toEqual([other, null]);
    }
    expect(parseWhoAnswer("no, she is my sister", "Raven")).toMatchObject({ kind: "person", relationType: "sibling_of" });
    expect(parseWhoAnswer("that's our dog", "Rover")).toMatchObject({ kind: "pet" });
    // The name itself leads the natural answer (a review).
    expect(parseWhoAnswer("Nadia is my sister", "Nadia")).toMatchObject({ kind: "person", relationType: "sibling_of", description: "sister" });
    expect(parseWhoAnswer("Nadia's my sister, she lives nearby", "Nadia")).toMatchObject({ relationType: "sibling_of", description: "sister, she lives nearby" });
    expect(parseWhoAnswer("She's just a friend from work.", "Quill")).toMatchObject({ kind: "person", relationType: null });
  });
  test("a bare no answers a relationship question and cancels a who question (a review)", () => {
    expect(parseWhoAnswer("No", "Raven", { relationAsked: true })).toMatchObject({ verdict: "no", kind: undefined });
    expect(parseWhoAnswer("nope", "Raven", { relationAsked: true })).toMatchObject({ verdict: "no" });
    expect(parseWhoAnswer("No", "Clover")).toBe("declined");
    expect(parseWhoAnswer("never mind", "Raven", { relationAsked: true })).toBe("declined");
  });
  test("pronounFamiliesIn() reads he, she and they", () => {
    expect([...pronounFamiliesIn("Nadia got back from her marathon and he drove them home")].sort()).toEqual(["he", "she", "they"]);
  });
});

describe("the two guard shapes, both ways", () => {
  const base = { utterance: "Nadia just got back from her first marathon", act: "inform" as const, personId: "person-t", roster: ["Sage"], pronounsInPlay: ["she"] };

  test("false_familiarity: a prior-knowledge claim about an unknown name is cut and the ask stands in; with evidence naming it, or an honest line, nothing fires", () => {
    const ctx = { ...base, unknownNames: ["Nadia"] };
    const cut = guardReply("That's right, Nadia ran her marathon last spring.", ctx);
    expect(cut.reason).toBe("false_familiarity");
    expect(cut.replaced).toBe(true);
    expect(cut.reply).toBe(dontKnowYetLine("Nadia"));
    expect(replacementFor("false_familiarity", "person-t", { sentence: "I remember Nadia.", ctx })).toBe("I don't know Nadia yet, who's that?");
    // A later sentence's claim is cut and the honest opening kept.
    const later = guardReply("A marathon is a big deal. As you mentioned, Nadia trained all year.", ctx);
    expect(later).toMatchObject({ reason: "false_familiarity", replaced: false, reply: "A marathon is a big deal." });
    expect(guardReply("That's right, Nadia ran her marathon last spring.", { ...ctx, sources: ["Nadia (your cousin) ran a marathon last spring"] }).reason).toBeNull();
    expect(guardReply("I don't know Nadia yet, who's that?", ctx).reason).toBeNull();
    expect(guardReply("That's right, a marathon is 26.2 miles.", ctx).reason).toBeNull();
    expect(guardReply("That's right, Nadia ran her marathon last spring.", { ...base, unknownNames: [] }).reason).toBeNull();
    // Restating what the person said this turn is not prior knowledge
    // (a review); "you said earlier" about an unknown name is.
    expect(guardReply("You said Nadia just got back from her first marathon.", ctx).reason).toBeNull();
    expect(guardReply("You mentioned earlier that Nadia runs.", ctx).reason).toBe("false_familiarity");
    // Agreement is not familiarity (a review).
    expect(guardReply("Of course, I'll remind you to call Nadia.", { ...ctx, utterance: "Nadia ran her marathon, remind me to call her" }).reason).not.toBe("false_familiarity");
  });

  test("pronoun_mismatch: a reply pronoun against the subject's is skipped and the rest stands; the subject's own, one in play, or another referent passes", () => {
    const ctx = { utterance: "should he be outside in this heat", act: "question" as const, personId: "person-t", subjectPronouns: [{ name: "Juniper", pronouns: "he" }], pronounsInPlay: ["he"] };
    const skipped = guardReply("She should stay in the shade with plenty of water. Rabbits overheat fast.", ctx);
    expect(skipped).toMatchObject({ reason: "pronoun_mismatch", replaced: false, reply: "Rabbits overheat fast." });
    expect(guardReply("He should stay in the shade with plenty of water.", ctx).reason).toBeNull();
    expect(guardReply("She should stay in the shade.", { ...ctx, pronounsInPlay: ["he", "she"] }).reason).toBeNull();
    expect(guardReply("She's right, he should stay inside.", { ...ctx, utterance: "my sister says he should stay inside" }).reason).toBeNull();
    expect(guardReply("Ask Sage, she knows rabbits.", ctx).reason).toBeNull();
    // A sentence opening with a roster name has another referent (a review).
    expect(guardReply("Sage can take him in, she knows rabbits.", { ...ctx, roster: ["Sage"] }).reason).toBeNull();
    // A member named in the utterance beside the subject is a referent
    // with no stored pronouns (a review).
    expect(guardReply("She probably didn't love that. Hopefully she got away fast.", { ...ctx, utterance: "Rover chased Pippa around the yard again", subjectPronouns: [{ name: "Rover", pronouns: "he" }], roster: ["Pippa", "Rover"] }).reason).toBeNull();
    expect(guardReply("She should stay in the shade.", { ...ctx, subjectPronouns: [{ name: "Juniper", pronouns: "they" }] }).reason).toBeNull();
  });

  test("a household role put on a name with nothing behind it is an invention (the seltzer target row)", () => {
    const ctx = { utterance: "who is Quill", act: "question" as const, personId: "person-t", roster: ["Sage", "Bramble", "Quill"], sources: ["Quill (your coworker) likes seltzer"] };
    expect(guardReply("Quill is the child in the house, Bramble's sibling.", ctx)).toMatchObject({ reason: "invention", replaced: true });
    expect(guardReply("Quill is your coworker, the one who likes seltzer.", ctx).reason).toBeNull();
    expect(guardReply("Quill is a neighbor's dog.", { ...ctx, unknownNames: ["Quill"], roster: ["Sage"] })).toMatchObject({ reason: "invention" });
    // A bare unresolved name too (the set: "who is Raven" answered "the
    // child who shares the house").
    expect(guardReply("Raven is the child who shares the house with Sage and Bramble.", { utterance: "who is Raven", act: "question", personId: "person-t", roster: ["Sage", "Bramble"], unresolvedNames: ["Raven"] })).toMatchObject({ reason: "invention" });
    // A world answer about a bare name is not a household claim (a review).
    for (const world of ["Snoopy is a dog in Peanuts.", "A Rottweiler is a dog breed.", "Socrates was a teacher in Athens."]) {
      expect([world, guardReply(world, { utterance: "who is that", act: "question", personId: "person-t", roster: ["Sage"], unresolvedNames: ["Snoopy", "Rottweiler", "Socrates"] }).reason]).toEqual([world, null]);
    }
  });
});
