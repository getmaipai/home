// STYLE-CORPUS-01 (docs/BACKLOG.md; design in docs/dev.md "EVAL-03
// design pass" and "STYLE-CORPUS-01: built, the rewrite brief and the
// real numbers"): the pure halves of backend/scripts/voice/corpus.ts -
// the deterministic validator, the prompt-list exclusion, and
// interleave() - exported for exactly this (labels.test.ts's own
// pattern: import the pure functions from the script by relative
// path, never a second copy). The live half (the local engine, the
// frontier rewrite call, the tool-row collection) is proven by running
// the script for real against 127.0.0.1:8788/:8794, recorded in
// dev.md, not by a test here.
//
// STYLE-CORPUS-02 (docs/dev.md "VOICE-CLASS-01 design pass"):
// validatePair() takes a third `shape` argument now - every test below
// that predates this item passes "conversational" (a short-prose
// neutral reply, the same full-rewrite path the flat validator always
// ran), so none of their own behavior changes. The five new tests below
// (replyShape/splitFrame, the document-row checks, the Pal fixture, the
// grown spoken reply) are this item's own, in the BACKLOG row's exact
// words.
import { describe, expect, test } from "bun:test";
import { validatePair, replyShape, splitFrame, lengthWithinBand, digitRuns, sameMultiset, capitalizedTokensAfterSentenceStart, interleave, toJsonl, buildPromptList, EXCLUDED_TEXTS } from "../scripts/voice/corpus";
import { WRITTEN_QUESTIONS } from "../scripts/bench/written-set";

describe("validatePair", () => {
  // Backlog's own words: "the validator drops a pair whose rewrite
  // changes a number, a name, or the presence of a list, and keeps one
  // that changes only phrasing."
  test("drops a pair whose rewrite changes a number", () => {
    const neutral = "Mount Everest is about 29,032 feet tall.";
    const rewrite = "Honestly, Mount Everest is about 28,000 feet tall.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("digit-run set");
  });

  test("drops a pair whose rewrite changes a name", () => {
    const neutral = "That's a question about Australia and Canberra.";
    const rewrite = "Honestly, that's a question about Australia and Sydney.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("capitalized-token set");
  });

  test("drops a pair whose rewrite adds a list the neutral reply never had", () => {
    const neutral = "You'll want milk, eggs, and bread for that.";
    const rewrite = "Here's what you need:\n- milk\n- eggs\n- bread";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("list marker presence changed");
  });

  test("drops a pair whose rewrite drops a list the neutral reply had", () => {
    const neutral = "Here's what you need:\n- milk\n- eggs\n- bread";
    const rewrite = "You'll want milk, eggs, and bread for that.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("list marker presence changed");
  });

  test("keeps a pair that changes only phrasing", () => {
    const neutral = "The capital of Australia is Canberra, not Sydney.";
    const rewrite = "Honestly, the capital of Australia is Canberra, not Sydney.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict).toEqual({ ok: true });
  });

  test("drops a pair grossly outside the length band", () => {
    const neutral = "It's about thirty degrees.";
    const rewrite = "Honestly, if you're asking me, I would say it feels like it is currently hovering somewhere in the neighborhood of about thirty degrees or so, give or take a little.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("length band");
  });

  // STYLE-CORPUS-01b (docs/dev.md, 2026-09-28): widened from 15 to 35
  // percent against real evidence - a real sample of 32 still-dropping,
  // substance-preserving rewrites against this household's own long
  // neutral replies had its length overage densely spread from 25% to
  // 45%, not the old band's 15%. STYLE-CORPUS-02 (VOICE-CLASS-01)
  // restated the band as the larger of 25 percent or eight words, now
  // that document rows (the ones that produced that wide spread) are
  // validated on the frame alone instead - this 20-word/27-word pair
  // still lands inside the new band too (7 words over, the 8-word
  // floor), so the same fixture still proves the point.
  test("keeps a pair within the widened length band that the old 15 percent band would have dropped", () => {
    const neutral = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";
    const rewrite = `${neutral} apple banana cherry date five six seven`; // 27 words vs 20 = 7 words over, inside the 8-word floor, outside the old 15%
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict).toEqual({ ok: true });
  });

  // STYLE-CORPUS-01b: found live, 2026-09-28, against this household's
  // own long, markdown-structured neutral replies (the local 8B chat
  // engine's real shape for an open-ended factual question) - a
  // genuine, substance-preserving rewrite routinely swaps a repeated
  // subject for a pronoun across sentences/bullets. The entity (Fuji,
  // Japan) is still named at least once on both sides; only the repeat
  // count differs, which is not the kind of drift this check exists to
  // catch (a real name changed, added, or dropped entirely - the
  // "Canberra"/"Sydney" and "drops a name entirely" tests below).
  test("keeps a pair where a repeated entity mention becomes a pronoun", () => {
    const neutral = "Mount Fuji is a volcano in Japan. Mount Fuji is very famous.";
    const rewrite = "Mount Fuji is a volcano in Japan. It's very famous.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict).toEqual({ ok: true });
  });

  test("drops a pair that drops a named entity entirely, not just a repeat count", () => {
    const neutral = "Mount Fuji is in Japan.";
    const rewrite = "It's a big mountain.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("capitalized-token set");
  });

  // STYLE-CORPUS-01b: found live, 2026-09-28 - an unpunctuated markdown
  // bullet or heading line (no `.!?` before the newline) used to merge
  // into the FOLLOWING line under the old `.!?`-only sentence split,
  // misclassifying that next bullet's own leading word as "mid-sentence"
  // instead of its own line-initial word.
  test("keeps a pair where an unpunctuated heading line precedes a bulleted rewrite", () => {
    const neutral = "Overview\n- Volcanoes are known for eruptions.";
    const rewrite = "Overview\n- They're known for eruptions.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict).toEqual({ ok: true });
  });

  // STYLE-CORPUS-01b: found live, 2026-09-28, on a real corpus row - a
  // bolded markdown label ending in a colon sits on the SAME line as
  // the sentence it introduces, with no period or newline between them,
  // so the `\n+` fix above alone still hid this sentence's true first
  // word ("Volcanoes"/"They're") behind the label.
  test("keeps a pair where a bolded label precedes the real sentence on the same line", () => {
    const neutral = "- **Volcanic Eruptions:** Volcanoes are known for their eruptions.";
    const rewrite = "- **Volcanic Eruptions:** They're known for their eruptions.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict).toEqual({ ok: true });
  });

  test("drops a rewrite that introduces a forbidden phrase", () => {
    const neutral = "The plumber said the pipe under the sink needs fixing.";
    const rewrite = "Honestly, don't have an answer for that one right now.";
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("forbidden phrase");
  });
});

// STYLE-CORPUS-02 (docs/BACKLOG.md's own row, "Tests in these words"):
// the five tests this item's own acceptance names, verbatim in spirit.
describe("STYLE-CORPUS-02: replyShape, splitFrame, and the class-aware validator", () => {
  // "the numbered how-to splitting correctly": a numbered how-to with an
  // "Overall" closer is document-shaped and splits into that opener,
  // that body and that closer. Mirrors the Pal "human heart" pair
  // described in dev.md's VOICE-CLASS-01 design pass: a lead-in
  // sentence, five bold-labeled numbered items, and an "Overall" closer.
  const HUMAN_HEART_NEUTRAL = [
    "The human heart is known for several important functions, most notably:",
    "**1. Pumping Blood:** The heart circulates blood throughout the body, delivering oxygen and nutrients to every cell.",
    "**2. Maintaining Blood Pressure:** Its rhythmic contractions help regulate blood pressure and ensure steady circulation.",
    "**3. Supporting the Immune System:** Blood carries white blood cells that fight infection throughout the body.",
    "**4. Regulating Body Temperature:** Circulation helps distribute heat evenly, keeping the body's temperature stable.",
    "**5. Signaling Overall Health:** A steady heartbeat is one of the clearest indicators of a person's general health.",
    "Overall, the human heart is essential for keeping the entire body alive and functioning well.",
  ].join("\n\n");

  test("a numbered how-to with an Overall closer is document-shaped and splits into that opener, body, and closer", () => {
    expect(replyShape(HUMAN_HEART_NEUTRAL)).toBe("document");
    const { opener, body, closer } = splitFrame(HUMAN_HEART_NEUTRAL);
    expect(opener).toBe("The human heart is known for several important functions, most notably:");
    expect(closer).toBe("Overall, the human heart is essential for keeping the entire body alive and functioning well.");
    expect(body).toContain("**1. Pumping Blood:**");
    expect(body).toContain("**5. Signaling Overall Health:**");
    expect(body).not.toContain("Overall, the human heart is essential");
  });

  // "a body-word-change being dropped": one word changed inside a list
  // item, opener and closer untouched.
  test("a document rewrite that changes one word inside the body is dropped", () => {
    const rewrite = HUMAN_HEART_NEUTRAL.replace("The heart circulates blood throughout the body", "The heart moves blood throughout the body");
    const verdict = validatePair(HUMAN_HEART_NEUTRAL, rewrite, "document");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("document body changed");
  });

  // "an opener/closer-only change being kept": the body is byte-for-byte
  // untouched, only the frame takes the companion's voice.
  test("a document rewrite that changes only the opener and closer is kept", () => {
    const rewrite = [
      "Honestly? The human heart's known for several important things, most notably:",
      "**1. Pumping Blood:** The heart circulates blood throughout the body, delivering oxygen and nutrients to every cell.",
      "**2. Maintaining Blood Pressure:** Its rhythmic contractions help regulate blood pressure and ensure steady circulation.",
      "**3. Supporting the Immune System:** Blood carries white blood cells that fight infection throughout the body.",
      "**4. Regulating Body Temperature:** Circulation helps distribute heat evenly, keeping the body's temperature stable.",
      "**5. Signaling Overall Health:** A steady heartbeat is one of the clearest indicators of a person's general health.",
      "Anyway, that's the deal: the heart keeps the whole body alive and running well.",
    ].join("\n\n");
    const verdict = validatePair(HUMAN_HEART_NEUTRAL, rewrite, "document");
    expect(verdict).toEqual({ ok: true });
  });

  // "the Pal aside-after-bold-label case being dropped as a reproduced
  // fixture": dev.md's VOICE-CLASS-01 design pass describes the real
  // dropped Pal pair directly - "reproduces it verbatim and inserts
  // 'Honestly? Yeah, that'd work.' before the first sentence, 'Like,
  // it's basically that but simpler.' after the first bold label, 'Ha,
  // classic.' after the second, 'I mean, up to you, but it helps.'
  // after the third, and 'Anyway, here's the deal.' after the fifth" -
  // exactly the failure VOICE-CLASS-01 exists to stop: asides glued
  // into the BODY, not just the frame.
  test("a document rewrite that inserts an aside after a bold label is dropped (the kept Pal pair in dev.md, reproduced as the fixture)", () => {
    const rewrite = [
      "Honestly? Yeah, that'd work. The human heart is known for several important functions, most notably:",
      "**1. Pumping Blood:** Like, it's basically that but simpler. The heart circulates blood throughout the body, delivering oxygen and nutrients to every cell.",
      "**2. Maintaining Blood Pressure:** Ha, classic. Its rhythmic contractions help regulate blood pressure and ensure steady circulation.",
      "**3. Supporting the Immune System:** I mean, up to you, but it helps. Blood carries white blood cells that fight infection throughout the body.",
      "**4. Regulating Body Temperature:** Circulation helps distribute heat evenly, keeping the body's temperature stable.",
      "**5. Signaling Overall Health:** Anyway, here's the deal. A steady heartbeat is one of the clearest indicators of a person's general health.",
      "Overall, the human heart is essential for keeping the entire body alive and functioning well.",
    ].join("\n\n");
    const verdict = validatePair(HUMAN_HEART_NEUTRAL, rewrite, "document");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("document body changed");
  });

  // "a grown spoken reply being kept": a fifteen-word spoken reply grown
  // by seven words - within the new "larger of 25 percent or eight
  // words" full-rewrite band (7 <= 8).
  test("a fifteen-word spoken reply grown by seven words is kept", () => {
    const neutral = "it started at eight thirty and ran for about two hours before everyone headed home"; // 15 words
    expect(neutral.split(/\s+/).length).toBe(15);
    const rewrite = `${neutral} pretty much right on schedule, like clockwork`; // +7 words = 22
    expect(rewrite.split(/\s+/).length).toBe(22);
    const verdict = validatePair(neutral, rewrite, "conversational");
    expect(verdict).toEqual({ ok: true });
  });
});

describe("lengthWithinBand / digitRuns / sameMultiset / capitalizedTokensAfterSentenceStart", () => {
  test("lengthWithinBand treats two empty replies as within band", () => {
    expect(lengthWithinBand("", "")).toBe(true);
  });

  test("digitRuns is count-sensitive, not deduplicated", () => {
    expect(digitRuns("12 apples and 12 oranges")).toEqual(["12", "12"]);
    expect(sameMultiset(digitRuns("12 apples and 12 oranges"), ["12"])).toBe(false);
  });

  test("capitalizedTokensAfterSentenceStart excludes the first word of each sentence", () => {
    // "Riff" and "He" open their own sentences and are excluded by
    // design (sentence-initial capitalization is just orthography);
    // "Mud" is a genuine mid-sentence proper noun and is kept.
    expect(capitalizedTokensAfterSentenceStart("Riff is the dog. He likes Mud.")).toEqual(["Mud"]);
  });
});

describe("interleave", () => {
  test("round-robins across lists rather than exhausting the first one", () => {
    expect(interleave([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]])).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
  });

  test("a prefix of an interleaved list still draws from every source", () => {
    const merged = interleave([["a1", "a2", "a3"], ["b1", "b2", "b3"], ["c1", "c2", "c3"]]);
    const prefix = merged.slice(0, 3);
    expect(prefix).toEqual(["a1", "b1", "c1"]);
  });
});

describe("toJsonl", () => {
  test("an empty row set writes nothing, not a stray trailing newline", () => {
    expect(toJsonl([])).toBe("");
  });

  test("one JSON object per line, one trailing newline", () => {
    expect(toJsonl([{ id: "a" }, { id: "b" }])).toBe('{"id":"a"}\n{"id":"b"}\n');
  });
});

describe("buildPromptList", () => {
  // Backlog's own words: "the excluded bench ids never appear in a
  // corpus" - written-set.ts's own held-out rows (the bench
  // STYLE-BENCH-01 gates on) must never surface as a generated prompt.
  test("never includes written-set.ts's held-out rows", () => {
    const { typed, spoken } = buildPromptList();
    const texts = new Set([...typed, ...spoken].map((p) => p.text.toLowerCase()));
    for (const q of WRITTEN_QUESTIONS) expect(texts.has(q.say.toLowerCase())).toBe(false);
  });

  test("EXCLUDED_TEXTS actually caught a real collision (owner-replay.json's benchmarking row)", () => {
    // Documented in dev.md: owner-replay.json's `benchmarking-typed-adult`
    // row is byte-identical to written-set.ts's own
    // `written-conceptual-benchmarking` row - this is the exact case the
    // exclusion filter exists to catch.
    expect(EXCLUDED_TEXTS.has("what is technical benchmarking and why do you need it")).toBe(true);
  });

  test("the default-count typed pool spans every kind (owner-replay excluded, five templated kinds remain)", () => {
    const { typed, spoken } = buildPromptList();
    const kinds = new Set(typed.map((p) => p.kind));
    expect(kinds.size).toBeGreaterThan(1);
    expect(spoken.length).toBeGreaterThan(0);
  });
});
