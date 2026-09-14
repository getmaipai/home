// ACT-01: the one clause split, with ranges, that the router's shape and
// the turn signal both read. routing.test.ts covers utteranceShape()'s
// own verdicts; this file covers the cut itself.
import { describe, expect, test } from "bun:test";
import { readClauses, utteranceShape, shapeFromReading } from "@/lib/utteranceShape";

const openers = new Set(["add", "set", "remember", "turn"]);
const cut = (text: string) => readClauses(text, openers).clauses.map((c) => text.slice(c.start, c.end));

describe("readClauses()", () => {
  test("cuts on a comma and on 'and', keeps ranges into the original text, and folds a tag into the clause before it", () => {
    expect(cut("add oat milk to the list, and when is Pippa's appointment")).toEqual(["add oat milk to the list", "when is Pippa's appointment"]);
    expect(cut("what does ephemeral mean and remember that my dentist appointment is next week")).toEqual(["what does ephemeral mean", "remember that my dentist appointment is next week"]);
    expect(cut("it's on Friday, right?")).toEqual(["it's on Friday, right?"]);
    expect(cut("no, Friday, not Thursday")).toEqual(["no, Friday", "not Thursday"]);
  });

  test("a vocative is skipped (its offset kept); an interjection or an acknowledgment in front is a clause of its own", () => {
    const named = readClauses("hey Sage, what's the weather", openers);
    expect(named.clauses.map((c) => c.text)).toEqual(["what's the weather"]);
    expect(named.clauses[0]!.start).toBe("hey Sage, ".length);
    expect(cut("Sage, set a timer")).toEqual(["set a timer"]);
    expect(cut("ugh, Rover chewed my headphones")).toEqual(["ugh", "Rover chewed my headphones"]);
    expect(cut("thanks, that's all for tonight")).toEqual(["thanks", "that's all for tonight"]);
    expect(cut("Remember, I have a dentist appointment")).toEqual(["Remember", "I have a dentist appointment"]);
    expect(readClauses("hey remember to buy eggs", openers).clauses[0]!.text).toBe("remember to buy eggs");
  });

  test("a comma inside a quotation or after a speech verb is punctuation, not a cut", () => {
    expect(cut("Quill said, 'I hate seltzer'")).toEqual(["Quill said, 'I hate seltzer'"]);
    expect(cut('she said "no way, not today" and then she left')).toEqual(['she said "no way, not today"', "then she left"]);
  });

  test("a leading please is read on the turn, and the shape is the reading's projection", () => {
    const reading = readClauses("please, what time is it", openers);
    expect(reading.leadingPlease).toBe(true);
    expect(shapeFromReading(reading)).toBe("question");
    expect(utteranceShape("please, set a timer", openers)).toBe("command");
    expect(readClauses("", openers).clauses).toEqual([{ text: "", start: 0, end: 0, signal: "none", polite: false }]);
  });
});
