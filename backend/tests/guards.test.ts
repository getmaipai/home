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

describe("invention: a proper noun, number or date grounded nowhere", () => {
  test("an ungrounded name is flagged - 'that's probably Marlow' when nobody said so", () => {
    const g = guardReply("That's probably Marlow.", ctx({ utterance: "who's at the door" }));
    expect(g.reason).toBe("invention");
  });

  test("the same name stands once a source actually grounds it", () => {
    const g = guardReply("That's probably Marlow.", ctx({ utterance: "who's at the door", sources: ["Marlow said he'd stop by around five."] }));
    expect(g.reason).toBeNull();
  });

  test("an ungrounded date/time is flagged - 'it's on Thursday at four' with no source for it", () => {
    const g = guardReply("It's on Thursday at four.", ctx({ utterance: "when is the appointment" }));
    expect(g.reason).toBe("invention");
  });

  test("the same date stands once a source grounds it", () => {
    const g = guardReply("It's on Thursday at four.", ctx({ utterance: "when is the appointment", sources: ["The dentist appointment is Thursday at four."] }));
    expect(g.reason).toBeNull();
  });

  test("a real decline is never itself an invention", () => {
    const g = guardReply("I don't know, sorry.", ctx({ utterance: "who's at the door" }));
    expect(g.reason).toBeNull();
  });
});

describe("unrelated recall (bot-legacy's own test: eye exam answered from the dentist line)", () => {
  const SOURCES = ["The dentist is on Thursday at four.", "Nadia likes the kitchen radio on in the morning."];

  test("a real memory line said back to the WRONG question is caught", () => {
    const g = guardReply("The dentist is on Thursday at four.", ctx({ utterance: "when is my eye exam", sources: SOURCES }));
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
    const g = guardReply("I don't know, sorry. That's probably Marlow though.", ctx({ utterance: "who's at the door" }));
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
    const g = guardReply("Rover is in the barn.", ctx({ utterance: "where is Rover", sources: ["Rover asked about the carbarn schedule."] }));
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
