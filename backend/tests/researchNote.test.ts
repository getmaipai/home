// RESEARCH-TIER-01: the Max note is topic-neutral. The same text goes to every Max question, so it names no kind of subject:
// the model picks the angles that matter for this question itself.
import { describe, expect, test } from "bun:test";
import { continuationInstruction, firstRoundNote } from "@/lib/turnMachine/research";

const QUESTIONS = [
  "is it safe to take ibuprofen with my blood pressure pills",
  "do I owe self-employment tax on a small side income in my state",
  "which is better for a family of five, a minivan or a three-row crossover",
  "why does the sky turn red at sunset but not at noon",
  "what happened to the old cannery on our town's waterfront",
  "the tv series V (the 80s one, not the 2000s one) only had one season, what would have happened",
];
const ENTERTAINMENT = /\b(franchise|miniseries|network|comics?|seasons?|series|remake|episodes?|sequel|reboot|cast|crew|film|movie)\b/i;

describe("the Max first-round note and nudge are topic-neutral", () => {
  test("the note names no entertainment words and asks for the five steps in order", () => {
    const note = firstRoundNote("max", 12);
    expect(note).not.toMatch(ENTERTAINMENT);
    for (const step of ["(1) Say exactly which subject", "(2) Find the authoritative or primary sources", "(3) Decide the 4 to 8 angles", "(4) If a search comes back thin", "(5) For any part still unanswered"]) expect(note).toContain(step);
    expect(note).toContain("up to 12 times");
  });

  test("it is the same text for a medical, a tax, a product, a science, a local-history and a V question (it does not read the question)", () => {
    const notes = QUESTIONS.map(() => firstRoundNote("max", 12));
    expect(new Set(notes).size).toBe(1);
  });

  test("the nudge adds nothing topic-specific beyond the person's own words", () => {
    for (const question of QUESTIONS) {
      const nudge = continuationInstruction("max", question, { queries: ["q one", "q two"], sites: ["a.example", "b.example"] }, 5);
      expect(nudge.replace(question, "")).not.toMatch(ENTERTAINMENT);
      expect(nudge).toContain("2 sites".replace("2 sites", "Sites read so far (2)"));
    }
  });
});
