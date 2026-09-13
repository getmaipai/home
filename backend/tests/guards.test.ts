// Session C step 3: one test per guard, from the real broken replies -
// bot-legacy's own `robot/tests/test_guards.py` and the live-found bench
// cases its `guards.py`/`social.py` comments name (2026-09-01 through
// 2026-09-03), adapted to this hub's context shape (sources/history as
// plain strings, no robot-specific Iterable-of-tuples).
import { describe, expect, test } from "bun:test";
import { guardReply, guardSentence, type GuardContext } from "@/lib/guards";

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return { utterance: "", personId: "person-test", ...overrides };
}

describe("capability claims (bot-legacy: claimed_action/accepted_request)", () => {
  test("a claimed action on a request is replaced - 'I've added milk to your list'", () => {
    const g = guardReply("I've added milk to your list.", ctx({ utterance: "add milk to my list on my phone" }));
    expect(g.reason).toBe("capability_claim");
    expect(g.reply).not.toContain("added");
  });

  test("a promise is a claim too - 'I'll text Nadia now'", () => {
    const g = guardReply("I'll text Nadia now.", ctx({ utterance: "text Nadia that I'm running late" }));
    expect(g.reason).toBe("capability_claim");
  });

  test("a claim stands when an action actually ran", () => {
    const g = guardReply("Done, timer's set.", ctx({ utterance: "set a timer", actionsRan: true }));
    expect(g.reason).toBeNull();
  });

  test("a claim is not guarded on a question - 'did you set it' answered 'I set it earlier'", () => {
    const g = guardReply("I set it earlier.", ctx({ utterance: "did you set the alarm" }));
    expect(g.reason).toBeNull();
  });
});

// FAST-05 (docs/BACKLOG.md's 2026-09-12 chat block): the invention guard
// applies only to claims about the household. The bare-candidate scan
// (any ungrounded capitalised word, number, or day name) and the hedge
// check are gone; the four probes the 2026-09-12 review named are the
// permanent proof, and the three household negatives prove the guard
// still guards.
describe("invention: general knowledge is not an invention (FAST-05)", () => {
  test("arithmetic is not an invention - 'It is 4.' to 'what is two plus two'", () => {
    expect(guardReply("It is 4.", ctx({ utterance: "what is two plus two" })).reason).toBeNull();
  });

  test("a capital city is not an invention - 'The capital is Paris.' with no Paris anywhere in the context", () => {
    expect(guardReply("The capital is Paris.", ctx({ utterance: "what is the capital of France" })).reason).toBeNull();
  });

  test("acknowledging a disclosure is not an invention - 'Got it, Pippa is allergic to peanuts.' after that disclosure", () => {
    expect(guardReply("Got it, Pippa is allergic to peanuts.", ctx({ utterance: "did you get that?", history: ["Pippa is allergic to peanuts"] })).reason).toBeNull();
  });

  test("a recalled fact answering a pronoun question is not unrelated - 'She likes painting.' with 'Pippa likes painting' supplied and Pippa resolved", () => {
    expect(guardReply("She likes painting.", ctx({ utterance: "what does she like", history: ["tell me about Pippa"], sources: ["Pippa likes painting"] })).reason).toBeNull();
  });

  test("a bare day name is not an invention - 'It's on Thursday at four' with no source", () => {
    expect(guardReply("It's on Thursday at four.", ctx({ utterance: "when is the appointment" })).reason).toBeNull();
  });

  test("a hedged name is not an invention - 'That's probably Marlow' (the retired GUESSING_RE and name scan both used to fire)", () => {
    expect(guardReply("That's probably Marlow.", ctx({ utterance: "who's at the door" })).reason).toBeNull();
  });

  test("a real decline is never itself an invention", () => {
    const g = guardReply("I don't know, sorry.", ctx({ utterance: "who's at the door" }));
    expect(g.reason).toBeNull();
  });
});

describe("invention: a claim about the household still needs a source (FAST-05)", () => {
  test("a place for a person on the roster with no memory is an invention - 'Pippa is at soccer practice right now.'", () => {
    expect(guardReply("Pippa is at soccer practice right now.", ctx({ utterance: "where is Pippa", roster: ["Pippa"] })).reason).toBe("invention");
  });

  test("the same place stands once a source grounds it", () => {
    expect(guardReply("Pippa is at soccer practice right now.", ctx({ utterance: "where is Pippa", roster: ["Pippa"], sources: ["Pippa has soccer practice on Tuesdays."] })).reason).toBeNull();
  });

  test("a place for the person themselves counts as household - 'You're at the office.'", () => {
    expect(guardReply("You're at the office.", ctx({ utterance: "where am I" })).reason).toBe("invention");
  });

  test("a place for the world is not - 'Paris is in France.' (the old LOCATION_CLAIM_RE matched any three-letter subject)", () => {
    expect(guardReply("Paris is in France.", ctx({ utterance: "where is Paris", roster: ["Pippa"] })).reason).toBeNull();
  });

  test("speech put in a family member's mouth with no memory is an invention - 'Your brother said he'd be late.'", () => {
    expect(guardReply("Your brother said he'd be late.", ctx({ utterance: "any news from my brother" })).reason).toBe("invention");
  });

  test("a first-person experience is an invention - 'I've been to Paris myself.'", () => {
    expect(guardReply("I've been to Paris myself.", ctx({ utterance: "have you been to Paris" })).reason).toBe("invention");
  });
});

// FAST-05b: the guess phrases came back household-scoped, after the
// conversation bench lost its "sedan" row to FAST-05's deletion of the
// old GUESSING_RE. A guess about what the household meant is an
// invented household fact wearing a hedge; a guess about the world is
// the hedge the information policy asks for.
describe("invention: a guess about the household's own business (FAST-05b)", () => {
  test("the bench row flags again - 'I think you're talking about a sedan, right?' after 'my car needs to be charged'", () => {
    const g = guardReply("I think you're talking about a sedan, right?", ctx({ utterance: "what type of car needs to be charged", history: ["my car needs to be charged"] }));
    expect(g.reason).toBe("invention");
  });

  test("a guess about the world passes - 'I think you're talking about Paris' to a France question", () => {
    expect(guardReply("I think you're talking about Paris.", ctx({ utterance: "what is the capital of France" })).reason).toBeNull();
  });

  test("'my guess is your dentist is Thursday' passes with the memory present and flags without it", () => {
    const withMemory = guardReply("My guess is your dentist is Thursday.", ctx({ utterance: "when is my dentist", sources: ["The dentist appointment is Thursday at four."] }));
    expect(withMemory.reason).toBeNull();
    const without = guardReply("My guess is your dentist is Thursday.", ctx({ utterance: "when is my dentist" }));
    expect(without.reason).toBe("invention");
  });

  test("a roster name makes the guess household-owned too - 'you must mean the Tuesday one' about Pippa's practice", () => {
    expect(guardReply("You must mean the Tuesday practice.", ctx({ utterance: "when is Pippa's practice", roster: ["Pippa"] })).reason).toBe("invention");
    expect(guardReply("You must mean the Tuesday practice.", ctx({ utterance: "when is Pippa's practice", roster: ["Pippa"], sources: ["Pippa has soccer practice on Tuesday."] })).reason).toBeNull();
  });

  // A medium code review on this diff found three holes in the first
  // cut, each a repro below: "my guess is" owned itself through its own
  // "my"; a confirmation tag ("right?") counted as an ungrounded word;
  // and `\b` never matched a name ending in a non-ASCII letter.
  test("'my guess is' does not own itself - 'My guess is Paris' to a France question passes", () => {
    expect(guardReply("My guess is Paris.", ctx({ utterance: "what is the capital of France" })).reason).toBeNull();
    expect(guardReply("My guess is 1945.", ctx({ utterance: "when did the second world war end" })).reason).toBeNull();
  });

  test("a confirmation tag is not part of the guess - a grounded guess ending in 'right?' passes", () => {
    expect(guardReply("I think you mean your dentist appointment, right?", ctx({ utterance: "when is it again", sources: ["The dentist appointment is Thursday at four."] })).reason).toBeNull();
    expect(guardReply("I think you're talking about your car, correct?", ctx({ utterance: "what type needs charging", history: ["my car needs to be charged"] })).reason).toBeNull();
  });

  test("an accented roster name still counts - José's and Zoë's practice", () => {
    expect(guardReply("You must mean the Tuesday practice.", ctx({ utterance: "when is José's practice", roster: ["José"] })).reason).toBe("invention");
    expect(guardReply("You must mean the Tuesday practice.", ctx({ utterance: "when is Zoë's practice", roster: ["Zoë"], sources: ["Zoë has practice on Tuesday."] })).reason).toBeNull();
  });

  test("the plain hedges stay out - 'probably a' and 'I'm guessing' are not guesses about what the household meant", () => {
    expect(guardReply("That's probably a delivery driver.", ctx({ utterance: "who's at my door" })).reason).toBeNull();
    expect(guardReply("I'm guessing a sedan.", ctx({ utterance: "what type of car needs to be charged", history: ["my car needs to be charged"] })).reason).toBeNull();
  });
});

// A medium code review on FAST-05's first cut found the wider location
// subject (you, pronouns) plus the optional article turned everyday
// idioms into cuts, only the first location clause was checked, and a
// roster entry that is a full name never matched. Each test is that
// exact repro.
describe("invention: the location guard's edges (FAST-05 code review)", () => {
  test("an idiom after in/on/at is not a place - 'You're in luck', 'on their way', 'in a good mood', 'on the right track'", () => {
    for (const reply of ["You're in luck, that recipe is easy.", "They're on their way.", "He's in a good mood today.", "You're on the right track.", "They are in season right now.", "Your order is on its way."]) {
      expect(guardReply(reply, ctx({ utterance: "hi", roster: ["Pippa"] })).reason).toBeNull();
    }
  });

  test("every clause is checked, not just the first - a world claim ahead of the household one does not shadow it", () => {
    expect(guardReply("Dinner is on the table and Pippa is at the shops.", ctx({ utterance: "where is everyone", roster: ["Pippa"] })).reason).toBe("invention");
  });

  test("a roster entry that is a full name still matches its first name, and short or accented names match too", () => {
    expect(guardReply("Pippa is at the shops.", ctx({ utterance: "where is Pippa", roster: ["Pippa Jones"] })).reason).toBe("invention");
    expect(guardReply("Bo is at the shops.", ctx({ utterance: "where is Bo", roster: ["Bo"] })).reason).toBe("invention");
    expect(guardReply("José is at the shops.", ctx({ utterance: "where is José", roster: ["José"] })).reason).toBe("invention");
  });

  test("a capitalised non-person before 'says' is a world-knowledge framing, not a quote - 'Legend says the city was founded in 753 BC.'", () => {
    expect(guardReply("Legend says the city was founded in 753 BC.", ctx({ utterance: "tell me about rome" })).reason).toBeNull();
  });

  test("the hub's own honest line, parroted by the model, is never an attribution - 'That's not something I've been told.'", () => {
    expect(guardReply("That's not something I've been told.", ctx({ utterance: "what year did the second world war end" })).reason).toBeNull();
  });
});

describe("unrelated recall (bot-legacy's own test: eye exam answered from the dentist line)", () => {
  const SOURCES = ["The dentist is on Thursday at four.", "Nadia likes the kitchen radio on in the morning."];

  test("a real memory line said back to the WRONG question is caught", () => {
    const g = guardReply("The dentist is on Thursday at four.", ctx({ utterance: "when is my eye exam", sources: SOURCES }));
    expect(g.reason).toBe("unrelated_recall");
  });

  test("a pronoun question resolved by the previous turn is the RIGHT question - 'what does she like' after 'tell me about Pippa'", () => {
    const g = guardReply("She likes painting.", ctx({ utterance: "what does she like", history: ["tell me about Pippa"], sources: ["Pippa likes painting"] }));
    expect(g.reason).toBeNull();
  });

  test("only the last two turns count as context: a topic mentioned three turns ago does not excuse the wrong memory", () => {
    const g = guardReply("The dentist is on Thursday at four.", ctx({ utterance: "when is my eye exam", history: ["when is the dentist", "thanks", "ok"], sources: SOURCES }));
    expect(g.reason).toBe("unrelated_recall");
  });

  test("the identical line answering the RIGHT question stands", () => {
    const g = guardReply("The dentist is on Thursday at four.", ctx({ utterance: "when is the dentist", sources: SOURCES }));
    expect(g.reason).toBeNull();
  });
});

describe("near-echo (social.py's own bench case: 'I play it on the ps5' -> 'Okay, playing it on the ps5.')", () => {
  test("restating the person's own words behind an acknowledgment is not an answer", () => {
    const g = guardReply("Okay, playing it on the ps5.", ctx({ utterance: "I play it on the ps5" }));
    expect(g.reason).toBe("near_echo");
  });

  test("a reply that adds real content is left alone", () => {
    const g = guardReply("Nice, the ps5 version has better load times.", ctx({ utterance: "I play it on the ps5" }));
    expect(g.reason).toBeNull();
  });
});

describe("near-echo does not fire on a plain greeting reciprocation (Jesse, live-found 2026-09-07)", () => {
  test("'good morning' answered 'Good morning!' is not a stall", () => {
    const g = guardReply("Good morning!", ctx({ utterance: "good morning" }));
    expect(g.reason).toBeNull();
  });

  // Each pair below fully echoes the utterance's own (post-stopword)
  // word pool, so without the fix every one of these is genuinely
  // flagged near_echo - not just trivially null via the pre-existing
  // `words.length < 2` short-circuit, which a code review (2026-09-07)
  // found the original single-word forms ("Morning!", "Hey!") were
  // quietly passing through regardless of whether the fix was even
  // present.
  test("other greeting shapes ('hi there', 'hey there', 'good night') are exempted the same way", () => {
    expect(guardReply("Hi there!", ctx({ utterance: "hi there" })).reason).toBeNull();
    expect(guardReply("Hey there!", ctx({ utterance: "hey there" })).reason).toBeNull();
    expect(guardReply("Good night!", ctx({ utterance: "good night" })).reason).toBeNull();
  });

  // The everyday compound case a code review (2026-09-07) found still
  // broken in the first cut of this fix: the utterance carries MORE
  // than just the greeting, but "how are you"/"are"/"you" are all
  // stopwords, so the reply's own bare "Good morning!" still fully
  // echoes what's left of the utterance's word pool once they're
  // dropped - genuinely flagged without the fix, same as the plain
  // "good morning" case above.
  test("a greeting stitched onto a real follow-on question still gets its reciprocation through - 'good morning, how are you'", () => {
    const g = guardReply("Good morning!", ctx({ utterance: "good morning, how are you" }));
    expect(g.reason).toBeNull();
  });

  test("a greeting stitched onto an unrelated statement doesn't smuggle in the exemption - the REPLY has to be a bare reciprocation, not just the utterance a greeting", () => {
    const g = guardReply("Okay, playing it on the ps5.", ctx({ utterance: "good morning, I play it on the ps5" }));
    expect(g.reason).toBe("near_echo");
  });

  test("the ps5 bench case is still caught - the exemption is scoped to greetings, not to every short utterance", () => {
    const g = guardReply("Okay, playing it on the ps5.", ctx({ utterance: "I play it on the ps5" }));
    expect(g.reason).toBe("near_echo");
  });
});

describe("medication doses: never stated as a number", () => {
  test("a numeric dose is flagged, tight-written ('400mg')", () => {
    const g = guardReply("You could take 400mg of ibuprofen.", ctx({ utterance: "how much ibuprofen can I take" }));
    expect(g.reason).toBe("medication_dose");
    expect(g.reply).not.toMatch(/\d/);
  });

  test("a numeric dose is flagged, spaced ('two tablets, 500 mg each')", () => {
    const g = guardReply("Take two tablets, 500 mg each.", ctx({ utterance: "how much tylenol should I take" }));
    expect(g.reason).toBe("medication_dose");
  });

  test("declining to advise at all is left alone", () => {
    const g = guardReply("I'm not able to give medication amounts - check with a pharmacist.", ctx({ utterance: "how much ibuprofen can I take" }));
    expect(g.reason).toBeNull();
  });
});

describe('"like I said": never across conversations', () => {
  test("a fresh conversation (empty history) opening with 'like I said' is always false", () => {
    const g = guardReply("Like I said, I don't know.", ctx({ utterance: "what's the wifi password", history: [] }));
    expect(g.reason).toBe("like_i_said");
  });

  test("'like I said' pointing at something genuinely in this conversation's history stands", () => {
    const g = guardReply("Like I said, it's sunny today.", ctx({ utterance: "what's the weather like again", history: ["what's the weather", "It's sunny today."] }));
    expect(g.reason).toBeNull();
  });
});

describe("the attractor rule: the reply IS one of the persona's own few-shot lines", () => {
  const EXAMPLES = ["Oh nice - how'd that go?", "That sounds rough, want to talk about it?"];

  test("the exact example line handed back verbatim is flagged (bench: the same line answered two different statements in a row)", () => {
    const g = guardReply("Oh nice - how'd that go?", ctx({ utterance: "I got a new job", personaExamples: EXAMPLES }));
    expect(g.reason).toBe("example_parrot");
  });

  test("a genuinely different reply is left alone even with the same examples loaded", () => {
    const g = guardReply("Congrats! What's the role?", ctx({ utterance: "I got a new job", personaExamples: EXAMPLES }));
    expect(g.reason).toBeNull();
  });
});

describe("guardReply(): cutting padding vs replacing the whole reply", () => {
  test("a CUTTABLE reason (invention) cuts just that sentence, keeping an honest one before it", () => {
    // FAST-05: the invented sentence is a household location claim now
    // (a bare name no longer counts), the cut behaviour is unchanged.
    const g = guardReply("I don't know, sorry. Marlow is at the shops though.", ctx({ utterance: "who's at the door", roster: ["Marlow"] }));
    expect(g.reason).toBe("invention");
    expect(g.reply).toBe("I don't know, sorry.");
  });

  test("a non-cuttable reason (capability_claim) replaces the whole reply even with an honest sentence first", () => {
    const g = guardReply("Sure thing. I've added milk to your list.", ctx({ utterance: "add milk to my list" }));
    expect(g.reason).toBe("capability_claim");
    expect(g.reply).not.toContain("Sure thing");
  });

  test("a fully honest reply passes through untouched", () => {
    const g = guardReply("Sure, what's the address?", ctx({ utterance: "text Nadia I'm on my way" }));
    expect(g.reason).toBeNull();
    expect(g.reply).toBe("Sure, what's the address?");
  });
});

describe("guardSentence(): the streaming half (one sentence at a time, before hand-off)", () => {
  test("checks a single sentence in isolation, same rules as guardReply", () => {
    expect(guardSentence("I've added milk to your list.", ctx({ utterance: "add milk to my list" }))).toBe("capability_claim");
    expect(guardSentence("Sure, what's the address?", ctx({ utterance: "text Nadia" }))).toBeNull();
  });
});

describe("replacement lines rotate per person (replyVariation.ts's pickVariant, reused)", () => {
  test("the same guard reason for the same person doesn't always return the identical line", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const g = guardReply("I've added milk to your list.", ctx({ utterance: "add milk to my list", personId: "person-rotate" }));
      seen.add(g.reply);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// A medium-effort code review (2026-09-06) found and reproduced three
// real bugs directly against guardReply() before any fix landed; each
// test below is that exact repro, now passing.
describe("code review fixes (2026-09-06)", () => {
  test("groundedness is real word-boundary matching, not a substring scan - 'barn' inside a source's own 'carbarn' does not ground an invented 'barn'", () => {
    const g = guardReply("Rover is in the barn.", ctx({ utterance: "where is Rover", roster: ["Rover"], sources: ["Rover asked about the carbarn schedule."] }));
    expect(g.reason).toBe("invention");
  });

  test("an otherwise fully-grounded reply is never flagged for incidental pronouns/time words alone - 'He lives in Florida now.' against a source that already says so", () => {
    const g = guardReply("He lives in Florida now.", ctx({ utterance: "where does Rover live", sources: ["Rover lives in Florida."] }));
    expect(g.reason).toBeNull();
  });

  test("a capability claim's 'never guard a question' exemption looks at the WHOLE reply, not just the current sentence - 'Sure! What do you have in the fridge?' is an honest clarifying question, not a false claim", () => {
    const g = guardReply("Sure! What do you have in the fridge?", ctx({ utterance: "can you help me plan dinner" }));
    expect(g.reason).toBeNull();
  });
});
