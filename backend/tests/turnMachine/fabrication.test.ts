// RESEARCH-FABRICATION-01: names and quoted titles no source gives are marked; checkable uncited sentences are judged.
import { describe, expect, test } from "bun:test";
import { NOT_IN_SOURCES, hasFactCue, markUnsourcedNames, namesIn, withoutLabels } from "@/lib/turnMachine/fabrication";
import { CLAIM_UNCONFIRMED, checkClaims } from "@/lib/turnMachine/research";

describe("names", () => {
  test("runs of capitalized words and short quoted titles are names; one capitalized word, a calendar date or a sentence start is not", () => {
    expect(namesIn("Marcus Quillon wrote “The Long Road” in March 1999.").sort()).toEqual(["Marcus Quillon", "The Long Road"].sort());
    expect(namesIn("- My guess (high confidence): Any Visitors remaining on Earth would live under oversight [75].")).toEqual([]);
    expect(namesIn("**My guesses:**\n- The Cold War backdrop made the win feel bigger.")).toEqual(["Cold War"]);
    expect(namesIn("This made New York City the Atlantic home port for the Midwest.")).toEqual(["New York City"]);
    expect(namesIn('The title (e.g., "Baku Decision") is not stated.')).toEqual(["Baku Decision"]);
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
    // Both sides of the loosened rule: words that sit together in a source (a title and a surname, a given name between) are given; a name
    // assembled from words that each appear, but far apart in different passages, is still marked.
    expect(markUnsourcedNames("He was Coach Brooks.", "the head coach Herb Brooks led the team", "").marked).toBe(0);
    const apart = `Victor was the cook on the ship. ${"The crew sailed on through the long cold night. ".repeat(6)} Later the harbour master Hale signed the log.`;
    expect(markUnsourcedNames("She met Victor Hale.", apart, "").marked).toBe(1);
    expect(markUnsourcedNames("She met Victor Hale.", "Victor Hale signed the log", "").marked).toBe(0);
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

describe("a source's own name and invented guess names (bench 2026-11-02)", () => {
  // The writer cites a site by its display name ("Daily Health Digest"); the sources hold it only as a host (dailyhealthdigest.example).
  test("a name that is a source's host with the spaces taken out is given", () => {
    const evidence = "Bronchitis: Symptoms and treatment\ndailyhealthdigest.example https://www.dailyhealthdigest.example/articles/bronchitis";
    expect(markUnsourcedNames("Daily Health Digest lists these as reasons to see a doctor [6].", evidence, "").marked).toBe(0);
    // Not a free pass: the same words with no such host stay marked.
    expect(markUnsourcedNames("Daily Health Digest lists these as reasons to see a doctor [6].", "bronchitis notes from another-site.example", "").marked).toBe(1);
  });

  // The analysis held one guess; the writer added a second one naming a company no source gives. Marking it kept a name nobody can trace.
  test("a guess sentence that names something no source gives is dropped, a sourced fact with such a name is marked", () => {
    const text = "**My guesses**\nI infer the lead would clash with the captain [3]. I also guess the series would have explored Acme Holding Group more deeply [3].\n\nThe pilot aired in 2002 and Acme Holding Group sponsored it [3].";
    const out = markUnsourcedNames(text, "the lead clashed with the captain in 2002", "");
    expect(out.text).not.toContain("explored Acme Holding Group");
    expect(out.text).toContain("I infer the lead would clash with the captain [3].");
    expect(out.text).toContain(`Acme Holding Group sponsored it [3]${NOT_IN_SOURCES}.`);
  });
});
