// Session C step 3: one test per guard, from the real broken replies -
// bot-legacy's own `robot/tests/test_guards.py` and the live-found bench
// cases its `guards.py`/`social.py` comments name (2026-09-01 through
// 2026-09-03), adapted to this hub's context shape (sources/history as
// plain strings, no robot-specific Iterable-of-tuples).
import { describe, expect, test } from "bun:test";
import { guardReply, guardSentence, replacementFor, withoutHonestyLines, type GuardContext } from "@/lib/guards";

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return { utterance: "", personId: "person-test", ...overrides };
}

describe("item 4b: the forget family (the review's findings 8 and 9)", () => {
  test("'I've forgotten your birthday' is a forget claim with no outcome", () => {
    expect(guardReply("I've forgotten your birthday.", ctx({ utterance: "forget my birthday please" })).reason).toBe("unsupported_action");
  });
  test("'that's cleared up' and 'it's gone' are not memory claims", () => {
    expect(guardReply("Glad that's cleared up.", ctx({ utterance: "so the recital is Friday, not Thursday" })).reason).toBeNull();
    expect(guardReply("The rain's gone for today.", ctx({ utterance: "is it still raining" })).reason).toBeNull();
    expect(guardReply("I cleared that up with the school.", ctx({ utterance: "did you sort out the form" })).reason).not.toBe("unsupported_action");
  });
  // The second review's findings 8 and 9: a list or reminder claim is
  // not answered with the forget family's line, and an admission of a
  // gap is not a completed-forget claim.
  test("'removed it from your list' and 'deleted your reminder' never get the forget line", () => {
    const forgetLine = /say "forget that"/i;
    expect(guardReply("I've removed it from your list.", ctx({ utterance: "remove milk from my list" })).reply ?? "").not.toMatch(forgetLine);
    expect(guardReply("I've deleted your reminder.", ctx({ utterance: "delete my dentist reminder" })).reply ?? "").not.toMatch(forgetLine);
    expect(guardReply("I've removed items you checked off.", ctx({ utterance: "clean up my list" })).reply ?? "").not.toMatch(forgetLine);
    expect(guardReply("I've removed that from memory.", ctx({ utterance: "remove that from your memory" })).reason).toBe("unsupported_action");
  });
  test("'I forgot it was Tuesday' admits a gap and is not a forget claim", () => {
    expect(guardReply("I forgot it.", ctx({ utterance: "forget my plans for Tuesday" })).reason).toBe("unsupported_action"); // the claim, same shape
    expect(guardReply("I forgot it was Tuesday.", ctx({ utterance: "forget my plans for Tuesday" })).reason).toBeNull();
    expect(guardReply("Sorry, I forgot what you said about Friday.", ctx({ utterance: "forget my plans for Friday" })).reason).toBeNull();
    expect(guardReply("Right, I forgot that you mentioned that.", ctx({ utterance: "forget my plans for Friday" })).reason).toBeNull();
    expect(guardReply("I've forgotten your name, sorry.", ctx({ utterance: "forget my plans for Friday" })).reason).toBeNull();
  });
});

describe("CHAT-15: a rejected proposal is no outcome for the guards", () => {
  test("a list-add the engine set aside unattempted narrates 'nothing added'; one the schema refused narrates the failure", () => {
    const aside = guardReply("I've added milk to your list.", ctx({ utterance: "add milk to my list", outcomes: [{ packageId: "list-add", status: "rejected", reason: "over_cap" }] }));
    expect(aside.reason).toBe("unsupported_action");
    expect(aside.reply).toBe("I haven't added anything to your list.");
    const refused = guardReply("I've added milk to your list.", ctx({ utterance: "add milk to my list", outcomes: [{ packageId: "list-add", status: "rejected", reason: "invalid_args" }] }));
    expect(refused.reason).toBe("unsupported_action");
    expect(refused.reply).toBe("Adding that to your list didn't work."); // the family's own failed line
    // A bare "Done." reads the same outcome the same way.
    const bare = guardReply("Done.", ctx({ utterance: "add milk to my list", outcomes: [{ packageId: "list-add", status: "rejected", reason: "invalid_args" }] }));
    expect(bare.reply).toBe("Adding that to your list didn't work.");
  });
});

describe("capability claims (bot-legacy: claimed_action/accepted_request)", () => {
  test("a claimed action on a request is replaced - 'I've added milk to your list' (CHAT-04: a completed claim with no list-add outcome is unsupported_action)", () => {
    const g = guardReply("I've added milk to your list.", ctx({ utterance: "add milk to my list on my phone" }));
    expect(g.reason).toBe("unsupported_action");
    expect(g.reply).toBe("I haven't added anything to your list."); // narrated from the outcome (none), not a pool
  });

  test("a promise is a claim too - 'I'll text Nadia now'", () => {
    const g = guardReply("I'll text Nadia now.", ctx({ utterance: "text Nadia that I'm running late" }));
    expect(g.reason).toBe("capability_claim");
  });

  test("a claim stands when the action's own package actually ran", () => {
    const g = guardReply("Done, timer's set.", ctx({ utterance: "set a timer", outcomes: [{ packageId: "timer", status: "succeeded" }] }));
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

// Item 4c (docs/plans/baseline-fixes-2026-09-13.md): the live bench heard
// "Sage is watching it too!" after "I'm watching the movie Cobra": a
// roster name given a present activity nothing about Sage supports, and
// the utterance's own "watching" grounded the word.
describe("item 4c: an activity for a household subject needs a line that says so about them", () => {
  test("'Sage is watching it too!' after the person said they are watching is an invention", () => {
    expect(guardReply("Cobra is a classic! Sage is watching it too!", ctx({ utterance: "I'm watching the movie Cobra", roster: ["Sage"] })).reason).toBe("invention");
  });
  test("'you're watching Cobra tonight' is grounded by the person's own first-person line", () => {
    expect(guardReply("You're watching Cobra tonight, nice pick.", ctx({ utterance: "I'm watching the movie Cobra", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("You're watching Cobra tonight, nice pick.", ctx({ utterance: "any thoughts", history: ["I'm watching the movie Cobra"], roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("You're watching Cobra tonight, nice pick.", ctx({ utterance: "any thoughts", roster: ["Sage"] })).reason).toBe("invention");
  });
  test("'Pippa is playing soccer right now' with a memory about Pippa and soccer passes; without it, cut", () => {
    expect(guardReply("Pippa is playing soccer right now.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"] })).reason).toBe("invention");
    expect(guardReply("Pippa is playing soccer right now.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"], sources: ["Pippa plays soccer on Tuesdays."] })).reason).toBeNull();
    // A line about someone else does not ground Pippa's activity.
    expect(guardReply("Pippa is playing soccer right now.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa", "Marlow"], sources: ["Marlow plays soccer on Tuesdays."] })).reason).toBe("invention");
  });
  test("a pronoun subject is grounded by any line with the verb; a stranger's name is not the household's", () => {
    expect(guardReply("She's sleeping in the car.", ctx({ utterance: "where is Pippa", roster: ["Pippa"] })).reason).toBe("invention");
    expect(guardReply("She's sleeping in the car.", ctx({ utterance: "where is Pippa", roster: ["Pippa"], episodes: ["Pippa sleeps in the car on long drives."] })).reason).toBeNull();
    expect(guardReply("Stallone is playing a cop named Cobretti.", ctx({ utterance: "what is Cobra about", roster: ["Sage"] })).reason).toBeNull();
  });
  test("conversational and idiomatic progressives are not activity claims", () => {
    expect(guardReply("You're doing great, keep going.", ctx({ utterance: "how am I doing", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("If you're looking for a comedy, try Airplane.", ctx({ utterance: "any film ideas", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("You're asking about the runtime, right?", ctx({ utterance: "how long", roster: ["Sage"] })).reason).toBeNull();
  });
  // The review of the first cut: the second person is a claim only
  // with a right-now marker, never advice, an idiom or a conditional.
  test("advice and idioms in the second person stand: 'if you're driving', 'you're running out of time'", () => {
    const c = ctx({ utterance: "fastest way to the city", roster: ["Sage"] });
    expect(guardReply("Great choice. If you're driving, take the 101.", c).reason).toBeNull();
    expect(guardReply("When you're cooking rice, rinse it first.", c).reason).toBeNull();
    expect(guardReply("You're running out of time on that return.", c).reason).toBeNull();
    expect(guardReply("You're playing with fire there.", c).reason).toBeNull();
    expect(guardReply("You're reading that right, it is 200 calories.", c).reason).toBeNull();
    expect(guardReply("Your dog is sleeping a lot.", ctx({ utterance: "Rover sleeps all day, is that normal", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("You're watching it right now, so no spoilers.", ctx({ utterance: "what happens at the end", roster: ["Sage"] })).reason).toBe("invention");
  });
  test("a pronoun answering a world question is the world's; beside a roster name it is that person", () => {
    expect(guardReply("She's singing in the finale.", ctx({ utterance: "is Taylor Swift in the show", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("They're building a new stadium downtown.", ctx({ utterance: "what are the Lakers up to", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("Sage, she's watching it too!", ctx({ utterance: "I'm watching the movie Cobra", roster: ["Sage"] })).reason).toBe("invention");
  });
  // The second review of this shape.
  test("'your dog' is grounded by the person's third-person words; impersonal 'they' after 'my kids' is not a claim", () => {
    expect(guardReply("Your dog is sleeping a lot today, which is normal in summer.", ctx({ utterance: "the dog has been sleeping all day today, is that ok", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("Try Paddington, they're streaming it on most services.", ctx({ utterance: "what should I watch with my kids tonight", roster: ["Sage"] })).reason).toBeNull();
    expect(guardReply("You're still watching it, so no spoilers.", ctx({ utterance: "what happens at the end", roster: ["Sage"] })).reason).toBe("invention");
  });
  test("filler never grounds the object, and a stem matches its own inflections only", () => {
    expect(guardReply("Sage is watching it as well!", ctx({ utterance: "I'm watching the movie Cobra", roster: ["Sage"], sources: ["Sage works as a nurse."] })).reason).toBe("invention");
    expect(guardReply("Pippa is resting today.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"], sources: ["Pippa went to a restaurant."] })).reason).toBe("invention");
    expect(guardReply("Pippa is skiing this weekend.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"], sources: ["Pippa has a skill test."] })).reason).toBe("invention");
    expect(guardReply("Pippa is studying tonight.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"], sources: ["Pippa studies most nights."] })).reason).toBeNull();
  });
  test("a line that grounds the activity's own words counts, and a short stem never grounds by accident", () => {
    expect(guardReply("Pippa is running a 5k on Saturday.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"], grounding: ["Pippa: 5k on Saturday."] })).reason).toBeNull();
    expect(guardReply("Sage is watching a movie at Marlow's.", ctx({ utterance: "where is Sage", roster: ["Sage", "Marlow"], sources: ["Sage went to Marlow's for a movie."] })).reason).toBeNull();
    expect(guardReply("Pippa is camping this weekend.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"], sources: ["Pippa came home late."] })).reason).toBe("invention");
    expect(guardReply("Pippa is painting today.", ctx({ utterance: "what is Pippa up to", roster: ["Pippa"], sources: ["Pippa has a pain in her knee."] })).reason).toBe("invention");
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
    expect(guardReply("I've been to Paris myself.", ctx({ utterance: "have you been to Paris" })).reason).toBe("claimed_experience"); // item 1b: its own reason, the world's line, not the household's
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

  // JOIN-01: a recalled turn from an earlier conversation grounds the
  // reply (GuardContext.episodes) without being an unrelated-recall
  // candidate: "what did you suggest last week" answered with the
  // suggestion shares no stem with the question's own words, which is
  // the shape this guard was built to catch for memory lines and the
  // shape a correct episode answer always has.
  test("a recalled earlier reply said back to 'what did you suggest' is the answer, not an unrelated memory line", () => {
    const utterance = "what did you suggest for dinner last week";
    const reply = "I suggested lemon chicken pasta.";
    const asSource = guardReply(reply, ctx({ utterance, sources: ["How about lemon chicken pasta? It's quick."] }));
    expect(asSource.reason).toBe("unrelated_recall"); // the memory-line reading, kept for memory lines
    const asEpisode = guardReply(reply, ctx({ utterance, episodes: ["any recipe ideas for tonight?", "How about lemon chicken pasta? It's quick."] }));
    expect(asEpisode.reason).toBeNull();
  });

  test("the identical line answering the RIGHT question stands", () => {
    const g = guardReply("The dentist is on Thursday at four.", ctx({ utterance: "when is the dentist", sources: SOURCES }));
    expect(g.reason).toBeNull();
  });
});

// CHAT-04 (#74, #62): the near-echo guard is a question guard now. The
// social.py bench case ("I play it on the ps5" -> "Okay, playing it on
// the ps5.") used to be near_echo; a statement said back behind an
// acknowledgment is the acknowledgment, and the same overlap rule was
// cutting "Got it, Pippa is allergic to peanuts." in the turn the
// person disclosed it. Only a restated QUESTION is a non-answer.
describe("near-echo is a question guard (CHAT-04 replaced the statement echo)", () => {
  test("a restated question behind an acknowledgment answers nothing and is cut", () => {
    const g = guardReply("Okay, what game do you play on the ps5.", ctx({ utterance: "what game do you play on the ps5" }));
    expect(g.reason).toBe("near_echo");
  });

  test("a disclosure said back in the same turn is the acknowledgment (#74's exact shape)", () => {
    const g = guardReply("Got it, Pippa is allergic to peanuts.", ctx({ utterance: "Pippa is allergic to peanuts" }));
    expect(g.reason).toBeNull();
    expect(g.reply).toBe("Got it, Pippa is allergic to peanuts.");
  });

  test("a first-person statement said back is left alone (the retired ps5 bench case)", () => {
    const g = guardReply("Okay, playing it on the ps5.", ctx({ utterance: "I play it on the ps5" }));
    expect(g.reason).toBeNull();
  });

  test("a reply that adds real content is left alone", () => {
    const g = guardReply("Nice, the ps5 version has better load times.", ctx({ utterance: "I play it on the ps5" }));
    expect(g.reason).toBeNull();
  });

  test("a question answered with real content is left alone", () => {
    const g = guardReply("The ps5, mostly.", ctx({ utterance: "what game do you play on the ps5" }));
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

  // CHAT-04 retired the two assertions that stood here ("a greeting
  // stitched onto an unrelated statement doesn't smuggle in the
  // exemption" and "the ps5 bench case is still caught"): both expected
  // near_echo on a restated STATEMENT, which the guard no longer reads
  // as a stall. The exemption's scope is proven on a question instead.
  test("a greeting stitched onto a restated question doesn't smuggle in the exemption - the REPLY has to be a bare reciprocation", () => {
    const g = guardReply("Okay, what game do you play on the ps5.", ctx({ utterance: "good morning, what game do you play on the ps5" }));
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
    expect(guardSentence("I've added milk to your list.", ctx({ utterance: "add milk to my list" }))).toBe("unsupported_action"); // CHAT-04: a completed claim, no list-add outcome
    expect(guardSentence("Sure, what's the address?", ctx({ utterance: "text Nadia" }))).toBeNull();
  });
});

describe("replacement lines rotate per person (replyVariation.ts's pickVariant, reused)", () => {
  // CHAT-04 moved the completed-action claim to a narrated line (one
  // true sentence per outcome state, no rotation); the pooled rotation
  // is proven on an accepted impossible request, which still draws from
  // CANNOT_DO.
  test("the same guard reason for the same person doesn't always return the identical line", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const g = guardReply("Sure, I'll text her now.", ctx({ utterance: "text Nadia that I'm late", personId: "person-rotate" }));
      expect(g.reason).toBe("capability_claim");
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

// CHAT-04 (docs/dev/session-a.md): an explicit action claim is matched
// to the package family its verb names, over the turn's own outcomes.
// One unrelated success never licenses every claim in the reply, and a
// pending or failed outcome counts as nothing ran.
describe("action claims are matched per package family (CHAT-04)", () => {
  const succeeded = (packageId: string) => [{ packageId, status: "succeeded" as const }];

  test("a completed save claim with no remember outcome is unsupported_action, replaced with the narrated line (nothing ran)", () => {
    const g = guardReply("I saved that.", ctx({ utterance: "Pippa is allergic to peanuts" }));
    expect(g.reason).toBe("unsupported_action");
    expect(g.replaced).toBe(true);
    expect(g.reply).toBe("I haven't saved that as a memory.");
  });

  test("a save claim with a failed remember outcome is unsupported, and the line narrates the failure, never a pooled cannot-do", () => {
    const g = guardReply("I've saved that to your memory.", ctx({ utterance: "remember that Pippa is allergic to peanuts", outcomes: [{ packageId: "remember", status: "failed" }] }));
    expect(g.reason).toBe("unsupported_action");
    expect(g.reply).toBe("That didn't get saved.");
  });

  test("the replacement is narrated from the typed outcome per family: failed, pending and none each say what happened", () => {
    expect(guardReply("Timer's set.", ctx({ utterance: "set a timer", outcomes: [{ packageId: "timer", status: "failed" }] })).reply).toBe("The timer didn't get set.");
    expect(guardReply("Timer's set.", ctx({ utterance: "set a timer" })).reply).toBe("I haven't set a timer.");
    expect(guardReply("I've locked the doors.", ctx({ utterance: "lock the doors", outcomes: [{ packageId: "lock-doors", status: "pending" }] })).reply).toBe("That's waiting on your confirmation.");
    expect(guardReply("I've added that to your list.", ctx({ utterance: "add milk", outcomes: [{ packageId: "websearch", status: "succeeded" }] })).reply).toBe("I haven't added anything to your list.");
    expect(guardReply("I've texted Nadia.", ctx({ utterance: "text Nadia" })).reply).toBe("I can't send messages, make calls, or order anything from here.");
    // replacementFor() with no flagged sentence keeps the pooled line, so an
    // older caller cannot produce an empty replacement.
    expect(replacementFor("unsupported_action", "person-test")).toMatch(/can't|not able|not something/i);
  });

  test("a save claim with a succeeded remember outcome stands", () => {
    const g = guardReply("I saved that.", ctx({ utterance: "remember that Pippa is allergic to peanuts", outcomes: succeeded("remember") }));
    expect(g.reason).toBeNull();
  });

  test("future intent and remembering are acknowledgments, not claims: 'I'll remember that', 'Remembered.', 'Noted' pass with no outcome (the judge remembers on its own)", () => {
    expect(guardReply("I'll remember that.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBeNull();
    expect(guardReply("Noted, I'll keep that in mind.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBeNull();
    expect(guardReply("Remembered. I'll make sure to keep that in mind.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBeNull(); // the live 8B's own reply, 2026-09-13
    expect(guardReply("Got it, noted.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBeNull();
  });

  test("a search that ran does not license an invented list claim: the family has to match", () => {
    const g = guardReply("I've added that to your list.", ctx({ utterance: "look up the pasta recipe and add it to my list", outcomes: succeeded("websearch") }));
    expect(g.reason).toBe("unsupported_action");
  });

  test("a timer claim with a failed timer outcome is unsupported; with a succeeded one it stands", () => {
    expect(guardReply("Timer's set for ten minutes.", ctx({ utterance: "set a ten minute timer", outcomes: [{ packageId: "timer", status: "failed" }] })).reason).toBe("unsupported_action");
    expect(guardReply("Timer's set for ten minutes.", ctx({ utterance: "set a ten minute timer", outcomes: succeeded("timer") })).reason).toBeNull();
  });

  test("a pending outcome (a confirmation parked) counts as nothing ran", () => {
    const g = guardReply("I've locked the doors.", ctx({ utterance: "lock the doors", outcomes: [{ packageId: "lock-doors", status: "pending" }] }));
    expect(g.reason).toBe("unsupported_action");
    expect(guardReply("Doors are locked.", ctx({ utterance: "lock the doors", outcomes: succeeded("lock-doors") })).reason).toBeNull();
  });

  test("lights, reminders and lookups match their own families", () => {
    expect(guardReply("Lights are off.", ctx({ utterance: "turn off the lights", outcomes: succeeded("lights-off") })).reason).toBeNull();
    expect(guardReply("I turned off the lights.", ctx({ utterance: "turn off the lights", outcomes: succeeded("timer") })).reason).toBe("unsupported_action");
    expect(guardReply("I set a reminder for eight.", ctx({ utterance: "remind me at eight", outcomes: succeeded("remind") })).reason).toBeNull();
    expect(guardReply("I set a reminder for eight.", ctx({ utterance: "remind me at eight" })).reason).toBe("unsupported_action");
    expect(guardReply("I looked that up: it opens at nine.", ctx({ utterance: "when does the pool open", outcomes: succeeded("websearch") })).reason).toBeNull();
    expect(guardReply("I looked that up: it opens at nine.", ctx({ utterance: "when does the pool open" })).reason).toBe("unsupported_action");
  });

  test("a verb with no package behind it never matches an outcome, whatever ran", () => {
    expect(guardReply("I've texted Nadia.", ctx({ utterance: "text Nadia I'm late", outcomes: succeeded("remember") })).reason).toBe("unsupported_action");
    expect(guardReply("I emailed the school.", ctx({ utterance: "tell the school Pippa is sick" })).reason).toBe("unsupported_action");
  });

  test("a claim inside a question is not a claim", () => {
    expect(guardReply("Want me to add that to your list, or have I saved it already?", ctx({ utterance: "milk" })).reason).toBeNull();
  });

  test("both paths decide identically: guardSentence() gives the streaming path the same reason", () => {
    const c = ctx({ utterance: "Pippa is allergic to peanuts" });
    expect(guardSentence("I saved that.", c)).toBe("unsupported_action");
    expect(guardSentence("Got it, Pippa is allergic to peanuts.", c)).toBeNull();
  });
});

// A code review of CHAT-04 (2026-09-13) found the first cut's family
// regexes replacing honest answers: third-person "added ... to the list",
// "I've written" with no "down", "I've ordered them by", a timer or light
// STATUS answering a question. Each stood on the previous HEAD and stays
// standing.
describe("action-claim families only match a claim (the CHAT-04 review's regressions)", () => {
  test("a third-person report, a poem written, a list ordered by priority, a timer status, a light's location: all stand", () => {
    expect(guardReply("Yes, Bruno added eggs to the shopping list earlier today.", ctx({ utterance: "did bruno add eggs to the list", shape: "question" })).reason).toBeNull();
    expect(guardReply("Here's what I've written for you.", ctx({ utterance: "write me a poem about the dog" })).reason).toBeNull();
    expect(guardReply("Here they are; I've ordered them by priority.", ctx({ utterance: "what's on my list" })).reason).toBeNull();
    expect(guardReply("I called it a day after that.", ctx({ utterance: "how was your afternoon" })).reason).toBeNull();
    expect(guardReply("Your timer is running, about four minutes left.", ctx({ utterance: "is my timer still going", shape: "question" })).reason).toBeNull();
    expect(guardReply("The porch light is on the panel by the door.", ctx({ utterance: "which switch is the porch light", shape: "question" })).reason).toBeNull();
  });

  test("the same status words after a command are a claim: 'Timer's set.' on 'set a timer' with nothing run", () => {
    expect(guardReply("Timer's set.", ctx({ utterance: "set a timer" })).reason).toBe("unsupported_action");
    expect(guardReply("Timer's set.", ctx({ utterance: "start the pasta", shape: "command" })).reason).toBe("unsupported_action");
    expect(guardReply("Lights are off now.", ctx({ utterance: "turn off the lights" })).reason).toBe("unsupported_action");
    expect(guardReply("Lights are off now.", ctx({ utterance: "turn off the lights", outcomes: [{ packageId: "lights-off", status: "succeeded" }] })).reason).toBeNull();
  });

  test("the guard reads the router's shape when given, so a package-declared opener the guard cannot know still counts as a command", () => {
    // With no shape passed, "queue the pasta timer?" is a question to the guard (a trailing "?", no opener known); the router, which knows the opener, says command.
    expect(guardReply("Timer's set.", ctx({ utterance: "queue the pasta timer?" })).reason).toBeNull();
    expect(guardReply("Timer's set.", ctx({ utterance: "queue the pasta timer?", shape: "command" })).reason).toBe("unsupported_action");
    // And near-echo: a trailing "?" the guard alone would read as a question is a command to the router.
    expect(guardReply("Okay, remember what I said about the ps5.", ctx({ utterance: "remember what I said about the ps5?" })).reason).toBe("near_echo");
    expect(guardReply("Okay, remember what I said about the ps5.", ctx({ utterance: "remember what I said about the ps5?", shape: "command" })).reason).toBeNull();
  });
});

// The second review round (2026-09-13): a true answer about an earlier
// turn, a third-person report after a command, a sorted list, a running
// timer on a stop command, "logged in", and a sentence carrying two claims.
describe("action-claim families, the second review's cases", () => {
  test("a question about the past is answered, never denied: only this turn's outcomes are known", () => {
    expect(guardReply("Yes, I set a timer for eight.", ctx({ utterance: "did you set my timer" })).reason).toBeNull();
    expect(guardReply("Yes, I saved that earlier.", ctx({ utterance: "did you save that" })).reason).toBeNull();
    expect(guardReply("I added them to the list yesterday.", ctx({ utterance: "what did you do with the eggs" })).reason).toBeNull();
    // A polite request with a "?" is still a command (the courtesy prefix), so a claim on it is still checked.
    expect(guardReply("I've added milk to your list.", ctx({ utterance: "can you add milk to my list?" })).reason).toBe("unsupported_action");
  });

  test("a third-person report after a command stands; the bare status form only at the sentence's start", () => {
    expect(guardReply("Bruno already added eggs to the list, so I only need milk.", ctx({ utterance: "add milk to my list" })).reason).toBeNull();
    expect(guardReply("Added milk to your shopping list.", ctx({ utterance: "add milk to my list" })).reason).toBe("unsupported_action");
    expect(guardReply("Added milk to your shopping list.", ctx({ utterance: "add milk to my list", outcomes: [{ packageId: "list-add", status: "succeeded" }] })).reason).toBeNull();
  });

  test("sorting a list, a running timer on a stop command and logging in are not actions", () => {
    expect(guardReply("I've ordered the list by priority.", ctx({ utterance: "sort my list" })).reason).toBeNull();
    expect(guardReply("Your timer is running with four minutes left, want me to stop it now.", ctx({ utterance: "stop the timer" })).reason).toBeNull();
    expect(guardReply("Okay, I logged in too.", ctx({ utterance: "I logged in to the router" })).reason).toBeNull();
    expect(guardReply("I've ordered a pizza for you.", ctx({ utterance: "order a pizza" })).reason).toBe("unsupported_action");
  });

  test("a sentence carrying two claims needs both outcomes, and the narration names the one that is missing", () => {
    const both = "I've added milk to your list and set a timer for ten minutes.";
    expect(guardReply(both, ctx({ utterance: "add milk and set a timer", outcomes: [{ packageId: "list-add", status: "succeeded" }] })).reply).toBe("I haven't set a timer.");
    expect(guardReply(both, ctx({ utterance: "add milk and set a timer", outcomes: [{ packageId: "list-add", status: "succeeded" }, { packageId: "timer", status: "succeeded" }] })).reason).toBeNull();
    // The chained form ("and set a timer") is read only after a command, where the subject can only be the hub.
    expect(guardReply("Bruno came home and set a timer for the pasta.", ctx({ utterance: "Bruno is cooking tonight" })).reason).toBeNull();
  });

  test("a lookup claim is about the answer being given, so it is checked on a question too", () => {
    expect(guardReply("I looked that up: it opens at nine.", ctx({ utterance: "when does the pool open" })).reason).toBe("unsupported_action");
    expect(guardReply("I looked that up: it opens at nine.", ctx({ utterance: "when does the pool open", outcomes: [{ packageId: "websearch", status: "succeeded" }] })).reason).toBeNull();
  });
});

// The third review round (2026-09-13): a reminder scheduled with the
// remind package having run, advice to the person after a command, the
// bare status forms with no copula, "called them", "looked up the pool
// hours", a memory search described honestly, and the idioms.
describe("action-claim families, the third review's cases", () => {
  const ran = (packageId: string) => [{ packageId, status: "succeeded" as const }];

  test("'I scheduled a reminder' with the remind package run stands; 'I've scheduled the appointment' is impossible", () => {
    expect(guardReply("I scheduled a reminder for eight.", ctx({ utterance: "remind me at eight", outcomes: ran("remind") })).reason).toBeNull();
    expect(guardReply("I've scheduled the appointment for you.", ctx({ utterance: "book the dentist", outcomes: ran("remind") })).reason).toBe("unsupported_action");
  });

  test("an instruction to the person after a command is advice, not a chained claim", () => {
    expect(guardReply("Boil the water, then set a timer for ten minutes.", ctx({ utterance: "start the pasta", shape: "command" })).reason).toBeNull();
    expect(guardReply("Put it on the calendar and set a reminder so you don't forget.", ctx({ utterance: "set up the dentist visit" })).reason).toBeNull();
    expect(guardReply("Check the fridge and put milk on the list if you're out.", ctx({ utterance: "put together a shopping plan" })).reason).toBeNull();
    expect(guardReply("I've added milk to your list and set a timer for ten minutes.", ctx({ utterance: "add milk and set a timer", outcomes: ran("list-add") })).reply).toBe("I haven't set a timer.");
  });

  test("the bare status with no copula is a claim after a command: 'Timer set for ten minutes.', 'Saved.', 'Lights off.', 'Milk added to your list.'", () => {
    expect(guardReply("Timer set for ten minutes.", ctx({ utterance: "set a timer for ten minutes" })).reason).toBe("unsupported_action");
    expect(guardReply("Reminder set for eight.", ctx({ utterance: "remind me at eight" })).reason).toBe("unsupported_action");
    expect(guardReply("Done, saved.", ctx({ utterance: "remember that Pippa is allergic to peanuts", shape: "command" })).reason).toBe("unsupported_action");
    expect(guardReply("Door's locked.", ctx({ utterance: "lock the door" })).reason).toBe("unsupported_action");
    expect(guardReply("Lights off.", ctx({ utterance: "turn off the lights" })).reason).toBe("unsupported_action");
    expect(guardReply("Milk added to your list.", ctx({ utterance: "add milk to my list" })).reason).toBe("unsupported_action");
    expect(guardReply("Milk is on your list now.", ctx({ utterance: "add milk to my list" })).reason).toBe("unsupported_action");
    expect(guardReply("Milk is on your list now.", ctx({ utterance: "add milk to my list", outcomes: ran("list-add") })).reason).toBeNull();
  });

  test("'called them' and 'ordered them for you' are the claim; the sorting and naming senses are not", () => {
    expect(guardReply("I called them and set a reminder for six.", ctx({ utterance: "call the plumber and remind me at six", outcomes: ran("remind") })).reason).toBe("unsupported_action");
    expect(guardReply("I ordered them for you.", ctx({ utterance: "get the groceries delivered", shape: "command" })).reason).toBe("unsupported_action");
    expect(guardReply("I ordered them by priority.", ctx({ utterance: "sort my list" })).reason).toBeNull();
    expect(guardReply("I called him Rover because he loves to wander.", ctx({ utterance: "the dog is named rover" })).reason).toBeNull();
    expect(guardReply("I called it a day after that.", ctx({ utterance: "how was your afternoon", shape: "statement" })).reason).toBeNull();
  });

  test("a lookup without a pronoun is a lookup; a memory search described honestly is not", () => {
    expect(guardReply("I looked up the pool hours: it opens at nine.", ctx({ utterance: "when does the pool open" })).reason).toBe("unsupported_action");
    expect(guardReply("I searched for that in your notes but there's nothing saved.", ctx({ utterance: "what's the wifi password" })).reason).toBeNull();
  });

  test("'logged into', 'locked in Friday', 'locked myself out' and 'I have saved recipes' are not actions", () => {
    expect(guardReply("Okay, I logged into the router too.", ctx({ utterance: "I logged in to the router" })).reason).toBeNull();
    expect(guardReply("I've locked in Friday for the recital.", ctx({ utterance: "Pippa's recital is friday" })).reason).toBeNull();
    expect(guardReply("I've locked myself out before too.", ctx({ utterance: "I locked myself out" })).reason).toBeNull();
    expect(guardReply("I have saved recipes I can suggest.", ctx({ utterance: "I'm bored of pasta" })).reason).toBeNull();
  });
});

// The fourth review round (2026-09-13): a bare completion word after a
// command, "went ahead and", the lookup in every first-person form, a
// noun phrase before the family noun, a room after on/off, a
// contraction on the list noun, a status on a disclosure, a named save.
describe("action-claim families, the fourth review's cases", () => {
  const failed = (packageId: string) => [{ packageId, status: "failed" as const }];

  test("'All set.' and 'Done.' after a command are claims about what was asked: narrated from the outcome, or 'nothing ran'", () => {
    expect(guardReply("All set.", ctx({ utterance: "remember that Pippa is allergic to peanuts", shape: "command", outcomes: failed("remember") })).reply).toBe("That didn't get saved.");
    expect(guardReply("Done.", ctx({ utterance: "set a timer for ten minutes", outcomes: failed("timer") })).reply).toBe("The timer didn't get set.");
    expect(guardReply("Done, locked.", ctx({ utterance: "lock the doors", outcomes: failed("lock-doors") })).reply).toBe("The lock didn't respond.");
    expect(guardReply("Done.", ctx({ utterance: "lock the doors", outcomes: [{ packageId: "lock-doors", status: "pending" }] })).reply).toBe("That's waiting on your confirmation.");
    expect(guardReply("Done.", ctx({ utterance: "set a timer for ten minutes" })).reply).toBe("I haven't actually done that.");
    expect(guardReply("Done.", ctx({ utterance: "set a timer for ten minutes", outcomes: [{ packageId: "timer", status: "succeeded" }] })).reason).toBeNull();
    expect(guardReply("Done.", ctx({ utterance: "I finished the puzzle" })).reason).toBeNull(); // not a command: an acknowledgment
    expect(guardReply("Done.", ctx({ utterance: "remember that Pippa is allergic to peanuts", shape: "command" })).reason).toBeNull(); // remembering needs no outcome
  });

  test("'went ahead and', 'checked and' after a command are claims; the chained form needs a first-person opener, not any 'and'", () => {
    expect(guardReply("I went ahead and added milk to your list.", ctx({ utterance: "add milk" })).reason).toBe("unsupported_action");
    expect(guardReply("I've gone ahead and saved that.", ctx({ utterance: "remember that Pippa is allergic to peanuts", shape: "command" })).reason).toBe("unsupported_action");
    expect(guardReply("Okay, I checked and set a timer for ten minutes.", ctx({ utterance: "set a timer" })).reason).toBe("unsupported_action");
    expect(guardReply("Boil the water, then set a timer for ten minutes.", ctx({ utterance: "start the pasta", shape: "command" })).reason).toBeNull();
  });

  test("a lookup in every first-person form needs the websearch outcome", () => {
    for (const reply of ["I've looked it up and it opens at nine.", "I just looked it up: it opens at nine.", "Okay, I've looked it up: nine."]) {
      expect(guardReply(reply, ctx({ utterance: "when does the pool open" })).reason).toBe("unsupported_action");
    }
  });

  test("a noun phrase before the family noun, a room after on/off, a contraction on the list noun", () => {
    expect(guardReply("Ten-minute timer set.", ctx({ utterance: "set a ten minute timer" })).reason).toBe("unsupported_action");
    expect(guardReply("Front door locked.", ctx({ utterance: "lock the front door" })).reason).toBe("unsupported_action");
    expect(guardReply("Kitchen lights off.", ctx({ utterance: "turn off the kitchen lights" })).reason).toBe("unsupported_action");
    expect(guardReply("Lights are off in the kitchen now.", ctx({ utterance: "turn off the kitchen lights" })).reason).toBe("unsupported_action");
    expect(guardReply("The lights in the kitchen are off.", ctx({ utterance: "turn off the kitchen lights" })).reason).toBe("unsupported_action");
    expect(guardReply("The porch light is on the panel by the door.", ctx({ utterance: "which switch is the porch light", shape: "question" })).reason).toBeNull();
    expect(guardReply("Milk's on your list now.", ctx({ utterance: "add milk to my list" })).reason).toBe("unsupported_action");
  });

  test("a status on a disclosure agrees with the first-person form: 'Saved.' and 'I saved that.' are the same claim", () => {
    expect(guardReply("Saved.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBe("unsupported_action");
    expect(guardReply("Got it, saved.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBe("unsupported_action");
    expect(guardReply("I've saved Pippa's allergy to your memory.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBe("unsupported_action");
    expect(guardReply("Got it, Pippa is allergic to peanuts.", ctx({ utterance: "Pippa is allergic to peanuts" })).reason).toBeNull();
  });
});

// #92: the window describes a non-model turn as a bracketed system note;
// a model that says the note back has said nothing ("[Knowledge could
// not answer.]" was spoken aloud in the baseline bench's reader's rows).
describe("placeholder_echo (#92)", () => {
  test("a bracketed note alone is replaced with the honest line; with other sentences it is cut and the rest stands", () => {
    const alone = guardReply("[Knowledge could not answer.]", ctx({ utterance: "where does Marlow work" }));
    expect(alone.reason).toBe("placeholder_echo");
    expect(alone.replaced).toBe(true);
    expect(alone.reply).not.toContain("[");
    expect(alone.reply).toMatch(/don't know|not sure|don't have an answer/);
    // On a disclosure the replacement is the acknowledgment it deserved (a bench run said "I'm not sure about that." to "and that he likes chocolate cake").
    const statement = guardReply('[Remember answered: "Okay, noted."]', ctx({ utterance: "and that he likes chocolate cake" }));
    expect(statement.reason).toBe("placeholder_echo");
    expect(["Okay.", "Got it.", "Noted."]).toContain(statement.reply);
    const tail = guardReply("I don't have that one. [The household was asked to confirm before this action ran.]", ctx({ utterance: "where does Marlow work" }));
    expect(tail.reason).toBe("placeholder_echo");
    expect(tail.reply).toBe("I don't have that one.");
    // A note with words after it has said something: the stub model's own echo opens with a bracketed tag.
    expect(guardSentence("[stub model: no real model loaded, this is a canned reply] good morning", ctx({ utterance: "good morning" }))).toBeNull();
  });

  test("a multi-sentence note split by the sentence splitter is caught in both halves (a review)", () => {
    const g = guardReply('[Weather answered: "It\'s 72 and sunny. Tomorrow looks clear."]', ctx({ utterance: "how's the weather" }));
    expect(g.reason).toBe("placeholder_echo");
    expect(g.reply).not.toContain("[");
    expect(g.reply).not.toContain("]");
    expect(guardSentence('Tomorrow looks clear."]', ctx({ utterance: "x" }))).toBe("placeholder_echo");
  });

  test("brackets inside ordinary prose are not a note", () => {
    expect(guardReply("The recipe [from the card] needs two eggs.", ctx({ utterance: "what does the recipe need" })).reason).toBeNull();
    expect(guardReply("Sure [1].", ctx({ utterance: "ok" })).reason).toBeNull();
  });

  test("a failed knowledge lookup on the turn narrates a lookup claim (#92 rides on the turn as an outcome)", () => {
    const g = guardReply("I looked that up: it's in Peru.", ctx({ utterance: "where is Machu Picchu", outcomes: [{ packageId: "knowledge", status: "failed" }] }));
    expect(g.reason).toBe("unsupported_action");
    expect(g.reply).toBe("That lookup didn't work.");
  });
});

// Item 1b (#67): the world's own line for a claimed experience, and only
// that sentence dropped; the household honesty lines never answer a
// world question.
describe("claimed_experience (item 1b, #67)", () => {
  test("'I think I've seen it! It's about a clownfish...' keeps the film fact and drops the claim", () => {
    const g = guardReply("I think I've seen it! It's about a clownfish looking for his son.", ctx({ utterance: "have you seen Finding Nemo" }));
    expect(g.reason).toBe("claimed_experience");
    expect(g.replaced).toBe(false);
    expect(g.reply).toBe("It's about a clownfish looking for his son.");
  });

  test("alone, the claim is replaced with the cannot-experience line, never 'nobody's told me'", () => {
    const g = guardReply("I've seen it a few times.", ctx({ utterance: "have you seen it" }));
    expect(g.reason).toBe("claimed_experience");
    expect(g.replaced).toBe(true);
    expect(g.reply).toMatch(/can't actually watch|don't get to watch/);
    expect(g.reply).not.toMatch(/told me|don't know that one/);
  });

  test("a claim in the middle is dropped and both sides stand", () => {
    const g = guardReply("It's a Pixar film. I watched it last week. It runs about a hundred minutes.", ctx({ utterance: "tell me about Finding Nemo" }));
    expect(g.reply).toBe("It's a Pixar film. It runs about a hundred minutes.");
  });
});

// Item 1b (#67): two honest replies the second series cut.
describe("item 1b's own regressions", () => {
  test("a fact attributed to a household member, every content word grounded, is not an invention for its 'that'", () => {
    const g = guardReply("Sage mentioned that Pippa is allergic to peanuts.", ctx({ utterance: "what is Pippa allergic to", sources: ["Pippa is allergic to peanuts"], grounding: ["Who lives here: Sage (owner), Pippa (child)"], roster: ["Sage", "Pippa"] }));
    expect(g.reason).toBeNull();
  });

  test("'Sure, I'll remember that' to a remember request is an acknowledgment, not an accepted impossible request", () => {
    expect(guardReply("Sure, I'll remember that Marlow's birthday is in June.", ctx({ utterance: "can you remember that Marlow's birthday is in June" })).reason).toBeNull();
    expect(guardReply("Sure, I'll text her now.", ctx({ utterance: "can you text Nadia" })).reason).toBe("capability_claim");
    // "remember to <do something>" is an action request, still checked (a review).
    expect(guardReply("Sure, I'll text her tomorrow.", ctx({ utterance: "can you remember to text Nadia tomorrow" })).reason).toBe("capability_claim");
    expect(guardReply("Sure, I'll call the vet now.", ctx({ utterance: "can you keep in mind to call the vet tomorrow" })).reason).toBe("capability_claim");
    expect(guardReply("Sure, I'll call the vet now.", ctx({ utterance: "could you note to call the vet tomorrow" })).reason).toBe("capability_claim");
  });

  test("'I've read that it's rated R' is hearsay, not a claimed experience; 'I read it last summer' still is one", () => {
    expect(guardReply("I've read that it's rated R.", ctx({ utterance: "what's its rating" })).reason).toBeNull();
    expect(guardReply("I read about it somewhere.", ctx({ utterance: "have you heard of it" })).reason).toBeNull();
    expect(guardReply("Yes, I read it last summer.", ctx({ utterance: "have you read Dune" })).reason).toBe("claimed_experience");
  });

  test("#101: 'a good one' about the thing the person named is not a person trait; a pronoun's or a name's good boy still is, adverbs included", () => {
    const film = ctx({ utterance: "I'm watching the movie Cobra" });
    expect(guardReply("Cobra's a good one, lots of action and some solid stunts. You enjoying it?", film).reason).toBeNull();
    const dog = ctx({ utterance: "how is Rover doing", roster: ["Sage", "Rover"] });
    for (const reply of ["He's a good boy.", "He's a really good boy.", "I bet he's a very good boy.", "She's probably a good girl.", "Rover's such a good boy.", "He's a good one."]) {
      expect(guardReply(reply, dog).reason).toBe("invention");
    }
  });

  test("withoutHonestyLines() strips every honesty line and keeps what the model itself said", () => {
    expect(withoutHonestyLines("I don't actually have that - nobody's told me.")).toBe("");
    expect(withoutHonestyLines("I don't know, sorry.")).toBe("");
    expect(withoutHonestyLines("It's a Pixar film. I don't know, sorry.")).toBe("It's a Pixar film.");
    expect(withoutHonestyLines("I haven't added anything to your list.")).toBe("I haven't added anything to your list.");
  });
});
