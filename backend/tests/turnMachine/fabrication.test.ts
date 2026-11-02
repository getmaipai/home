// RESEARCH-FABRICATION-01: names and quoted titles no source gives are marked; checkable uncited sentences are judged.
import { describe, expect, test } from "bun:test";
import { NOT_IN_SOURCES, hasFactCue, markUnsourcedNames, namesIn, withoutLabels } from "@/lib/turnMachine/fabrication";
import { CLAIM_UNCONFIRMED, checkClaims } from "@/lib/turnMachine/research";

describe("names", () => {
  test("runs of capitalized words and short quoted titles are names; one capitalized word, a calendar date or a sentence start is not", () => {
    expect(namesIn("Marcus Quillon wrote “The Long Road” in March 1999.").sort()).toEqual(["Marcus Quillon", "The Long Road"].sort());
    expect(namesIn("It rained in March. On Tuesday the road closed.")).toEqual([]);
    expect(namesIn("The Federal Reserve of the United States raised rates.").length).toBeGreaterThan(0);
  });

  test("a sentence is checkable when it has a figure or a name", () => {
    expect(hasFactCue("It cost 40 dollars.")).toBe(true);
    expect(hasFactCue("Dr. Anna Marsh disagreed.")).toBe(true);
    expect(hasFactCue("That is probably how it went.")).toBe(false);
  });
});

describe("marking", () => {
  const evidence = "A page says Anna Marsh built the bridge in 1868 for the county.";
  test("a name in the evidence or in the question passes; one in neither is marked at the end of its sentence, punctuation kept", () => {
    const text = "Anna Marsh built the bridge. A man called Victor Hale paid for it! Did Rosa Lund ask?";
    const result = markUnsourcedNames(text, evidence, "Did Rosa Lund ask about it");
    expect(result.marked).toBe(1);
    expect(result.text).toContain(`Victor Hale paid for it${NOT_IN_SOURCES}!`);
    expect(result.text).toContain("Anna Marsh built the bridge.");
    expect(result.text).toContain("Did Rosa Lund ask?");
  });

  test("matching ignores case, spacing and curly quotes; a sentence already marked is left alone", () => {
    expect(markUnsourcedNames("It was called “The Long Road”.", "a book, the long   road, was published", "").marked).toBe(0);
    const once = markUnsourcedNames("Victor Hale paid.", "", "");
    expect(markUnsourcedNames(once.text, "", "").marked).toBe(0);
  });

  test("a name with connecting words is looked up as written, a quote's closing comma is not part of the title, and words the sources give separately are given", () => {
    // Live run 2026-11-02: "Wedding of the Waters" was looked up as "Wedding Waters" and "Barge Canal," with its comma, so true sentences were marked.
    expect(namesIn('The ceremony was the Wedding of the Waters.')).toContain("Wedding of the Waters");
    expect(namesIn('The state built the "Barge Canal," widening it.')).toContain("Barge Canal");
    expect(markUnsourcedNames("The ceremony was the Wedding of the Waters.", "a ceremony called the wedding of the waters", "").marked).toBe(0);
    expect(markUnsourcedNames("She was known as Countess Lovelace.", "Ada, Countess of Lovelace, wrote notes", "").marked).toBe(0);
    expect(markUnsourcedNames("She met Victor Hale.", "Ada, Countess of Lovelace, wrote notes", "").marked).toBe(1);
  });
});

describe("uncited sentences", () => {
  test("only an uncited sentence with a figure or a name goes to the judge, and an unsupported one is marked without losing its words", async () => {
    const judged: string[] = [];
    const judge = async (prompt: string) => { judged.push(prompt); return '{"supported": false}'; };
    const result = await checkClaims("It cost 40 dollars in total. That is usually how it goes. Fine [1].", ["passage one"], judge, { uncitedPassages: "the notes say it cost 20" });
    expect(judged.length).toBe(2);
    expect(result.text).toContain(`It cost 40 dollars in total${CLAIM_UNCONFIRMED}.`);
    expect(result.text).toContain("That is usually how it goes.");
    const none = await checkClaims("It cost 40 dollars in total.", ["x"], judge);
    expect(none.checked).toBe(0);
  });
});

describe("section labels and the words between two quotes are not names (found on the held-out set)", () => {
  const answer = "**Established Points**\n- Anna Marsh built the bridge in 1868.\n\n## My Guesses\nWhat Could Not Be Found:\n**What the sources say:** the county paid.\nThey called it “The Long Road” and “Marsh Bridge” in print.";
  test("headings, bold-only lines, label lines and a bold label opening a line are dropped before names are read", () => {
    const kept = withoutLabels(answer);
    expect(kept).not.toContain("Established Points");
    expect(kept).not.toContain("My Guesses");
    expect(kept).not.toContain("What Could Not Be Found");
    expect(kept).not.toContain("What the sources say");
    expect(kept).toContain("Anna Marsh built the bridge in 1868.");
    expect(kept).toContain("the county paid.");
  });

  test("only real names remain, and the text between two quoted titles is not a quoted title", () => {
    expect(namesIn(answer).sort()).toEqual(["Anna Marsh", "Marsh Bridge", "The Long Road"].sort());
    expect(namesIn('He read "Alpha" and "Beta" aloud.').sort()).toEqual(["Alpha", "Beta"]);
    expect(namesIn('He read "alpha" and "beta" aloud.')).toEqual([]);
  });

  test("a bold name inside a sentence is still a name", () => {
    expect(namesIn("Then **Anna Marsh** arrived and left.")).toEqual(["Anna Marsh"]);
  });
});
