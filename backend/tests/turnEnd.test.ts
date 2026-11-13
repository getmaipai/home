// TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 4): the end-of-turn predictor on a labelled set. Every row names the
// lowest level at which the edge partial counts as finished (`none`, `gentle`, `natural`); the rows are what the recognizer gives at
// a pause (a period after any segment, a question mark on a question, no punctuation now and then).
import { describe, expect, test } from "bun:test";
import { firesAt, predictTurnEnd, stepDown, UNFINISHED_BELOW } from "@/lib/turnEnd";
import { ACKNOWLEDGEMENT_CLIPS } from "@/lib/replyVariation";
import { evaluateSafety } from "@/lib/safety";

const LABELLED: ReadonlyArray<[text: string, level: "none" | "gentle" | "natural"]> = [
  // Finished questions and requests: gentle.
  ["What is a good name for a small grey cat?", "gentle"],
  ["Is it going to rain tomorrow?", "gentle"],
  ["How long should I boil an egg?", "gentle"],
  ["Tell me a fun fact about owls.", "gentle"],
  ["What rhymes with orange?", "gentle"],
  ["Set a timer for ten minutes.", "gentle"],
  ["Remind me to call the dentist on Friday.", "gentle"],
  ["Can you play some quiet music?", "gentle"],
  ["What is five times five?", "gentle"],
  ["Who wrote Pride and Prejudice?", "gentle"],
  ["Turn the kitchen light off.", "gentle"],
  // Plain statements with a period: natural (a pause after a complete thought that is not a question).
  ["I had a long day at work.", "natural"],
  ["The dog ate my sandwich.", "natural"],
  ["My sister is coming over tomorrow.", "natural"],
  // Unpunctuated but complete: natural.
  ["what is a good name for a small grey cat", "natural"],
  ["I think we should go to the beach", "natural"],
  // Mid-sentence pauses: none.
  ["I want to.", "none"],
  ["I want to, uh.", "none"],
  ["I want to... uh...", "none"],
  ["So I was thinking that.", "none"],
  ["Can you tell me about the.", "none"],
  ["And then I.", "none"],
  ["Set a timer for.", "none"],
  ["What is a good name for a.", "none"],
  ["Remind me to call the dentist and.", "none"],
  ["It was like, you know,", "none"],
  ["Let me think, I mean.", "none"],
  ["Because.", "none"],
  // A bare trailing number after a preposition: neither level (ten what?).
  ["Set a timer for ten.", "none"],
  ["Turn it up to five", "none"],
  // One or two words: not enough to act on, with or without a period.
  ["Okay.", "none"],
  ["Yes", "none"],
  ["Hello there.", "none"],
  // A question that ends on a number is finished.
  ["What is twenty plus three?", "gentle"],
  // Sentences that end on a pronoun, a particle or an auxiliary are finished (the first live day started nothing on these).
  ["What time is it?", "gentle"],
  ["Turn the lights on.", "none"], // a weak ending without a question mark: the held run starts, no sound plays
  ["How are you?", "gentle"],
  ["What is the weather like?", "gentle"],
  ["Can you tell me about it?", "gentle"],
  ["What did you do?", "gentle"],
  ["I would rather not.", "none"], // weak endings: the held run starts, no sound plays
  ["I think so.", "none"],
  ["what time is it", "natural"],
];

describe("TALK-OVER-01: the end-of-turn predictor", () => {
  test(`the labelled set (${LABELLED.length} rows) matches row by row`, () => {
    const wrong = LABELLED.filter(([text, level]) => predictTurnEnd(text).level !== level).map(([text, level]) => `${JSON.stringify(text)}: expected ${level}, got ${predictTurnEnd(text).level} (${predictTurnEnd(text).reason}, ${predictTurnEnd(text).score})`);
    expect(wrong).toEqual([]);
  });

  test("a weak ending is not unfinished (a held run starts) but earns no sound without a question mark", () => {
    expect(predictTurnEnd("Turn the lights on.").unfinished).toBe(false);
    expect(predictTurnEnd("Turn the lights on.").level).toBe("none");
    expect(predictTurnEnd("What is it for?").level).toBe("gentle");
  });

  test("an obviously unfinished fragment is marked so no held run starts on it; a finished sentence is not", () => {
    expect(predictTurnEnd("What is a good name for a.").unfinished).toBe(true);
    expect(predictTurnEnd("I want to, uh.").unfinished).toBe(true);
    expect(predictTurnEnd("What is a good name for a small grey cat?").unfinished).toBe(false);
    expect(predictTurnEnd("Set a timer for ten.").unfinished).toBe(false); // ambiguous, not plainly mid-sentence
    expect(predictTurnEnd("What is a good name for a.").score).toBeLessThan(UNFINISHED_BELOW);
  });

  test("gentle fires only on gentle cases; natural fires on both; off never", () => {
    expect(firesAt("gentle", "gentle")).toBe(true);
    expect(firesAt("gentle", "natural")).toBe(false);
    expect(firesAt("natural", "gentle")).toBe(true);
    expect(firesAt("natural", "natural")).toBe(true);
    expect(firesAt("natural", "none")).toBe(false);
    expect(firesAt("off", "gentle")).toBe(false);
  });

  test("back-off steps natural to gentle to off and stays at off", () => {
    expect(stepDown("natural")).toBe("gentle");
    expect(stepDown("gentle")).toBe("off");
    expect(stepDown("off")).toBe("off");
  });

  test("the predictor is pure", () => {
    const a = predictTurnEnd("Is it going to rain tomorrow?");
    const b = predictTurnEnd("Is it going to rain tomorrow?");
    expect(a).toEqual(b);
  });
});

describe("TALK-OVER-01: the acknowledgement clip pool (rule 10, section 3b item 4)", () => {
  test("every clip passes the output floor for every band, and the pool is short and content-free", () => {
    expect(ACKNOWLEDGEMENT_CLIPS.length).toBeGreaterThanOrEqual(2);
    for (const clip of ACKNOWLEDGEMENT_CLIPS) {
      expect(clip.split(/\s+/).length).toBeLessThanOrEqual(2);
      for (const band of ["child", "teen", "adult"] as const) {
        const result = evaluateSafety(clip, band, "reply");
        expect({ clip, band, action: result.action }).toEqual({ clip, band, action: "allow" });
      }
    }
  });
});
