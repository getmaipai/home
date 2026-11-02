// RESEARCH-BACKBONE-01: the pinned article's lead and the sections that bear on the question reach the writing round uncut, within a
// budget, chosen by the article's real headings. A fact 9,000 characters into an article must arrive.
import { afterEach, describe, expect, test } from "bun:test";
import { BACKBONE_CHARS, __setBackboneWriterForTests, allocate, backboneBlock, backboneSource, choosePrompt, overlapChoice, parseChosen, pickBackbone, readMoreSections } from "@/lib/turnMachine/backbone";
import { anchorFor, type ArticleText } from "@/lib/turnMachine/entityPin";

afterEach(() => __setBackboneWriterForTests(undefined));

const filler = (word: string, n: number): string => `${word} filler text that says little. `.repeat(n);
const article = (): ArticleText => ({
  title: "Harbor Lights (1984 television series)",
  lead: "Harbor Lights is a television series that aired for one season. It was made by a small studio.",
  source: "library",
  book: "wikipedia_en_all_maxi",
  path: "Harbor_Lights_(1984_TV_series)",
  sections: [
    { heading: "Premise", text: filler("premise", 60) },
    { heading: "Cast", text: filler("cast", 40) },
    { heading: "Reception", text: `${filler("ratings", 30)} The show fell to 57th of 77 in the ratings and was cancelled in March 1985.` },
    { heading: "Aftermath", text: "The producers discussed three ways to finish the story, and a sequel was proposed in 1989." },
    { heading: "Comic books", text: "A publisher released eighteen issues continuing the story." },
    { heading: "References", text: filler("reference", 50) },
  ],
});
const anchor = () => anchorFor("Harbor Lights (1984 television series)", article());

describe("choosing the sections", () => {
  test("the prompt lists the real headings with their sizes and the parts of the question", () => {
    const prompt = choosePrompt("why did it end", ["why it ended", "what came after"], article().sections);
    expect(prompt).toContain("3. Reception (");
    expect(prompt).toContain("why it ended; what came after");
  });

  test("the model's numbers are read as 1-based indexes, deduplicated and kept in range; garbage is no choice", () => {
    expect(parseChosen('{"sections": [3, 4, 3, 9, "x"]}', 5)).toEqual([2, 3]);
    expect(parseChosen("nope", 5)).toBeNull();
    expect(parseChosen('{"sections": []}', 5)).toBeNull();
    expect(parseChosen(null, 5)).toBeNull();
  });

  test("the overlap fallback prefers the sections whose heading and opening share words with the parts", () => {
    const picked = overlapChoice(["ratings cancelled", "sequel proposed"], article().sections);
    expect(picked.slice(0, 2).sort()).toEqual([2, 3]);
  });
});

describe("the backbone", () => {
  test("a fact deep in the article reaches the text: lead first, the chosen sections in article order, no references", async () => {
    __setBackboneWriterForTests(async () => '{"sections": [4, 3]}');
    const bb = await pickBackbone(anchor(), "why did it end", ["why it ended", "what came after"]);
    expect(bb).not.toBeNull();
    expect(bb!.text.startsWith("Harbor Lights is a television series")).toBe(true);
    expect(bb!.text).toContain("57th of 77");
    expect(bb!.text).toContain("a sequel was proposed in 1989");
    expect(bb!.headings).toEqual(["Reception", "Aftermath"]);
    expect(bb!.text.indexOf("## Reception")).toBeLessThan(bb!.text.indexOf("## Aftermath"));
    expect(bb!.text).not.toContain("reference filler");
    expect(bb!.chars).toBeLessThanOrEqual(BACKBONE_CHARS);
  });

  test("a model that is down falls back to the word overlap, and an empty fallback takes the first sections", async () => {
    __setBackboneWriterForTests(async () => null);
    const bb = await pickBackbone(anchor(), "ratings and the sequel", ["ratings cancelled", "sequel proposed"]);
    expect(bb!.headings).toContain("Reception");
    expect(bb!.headings).toContain("Aftermath");
    const none = await pickBackbone(anchor(), "zzz", ["qqq"]);
    expect(none!.headings.length).toBeGreaterThan(0);
  });

  test("the budget holds: a long section is cut at a sentence and later sections are dropped, never the lead", async () => {
    __setBackboneWriterForTests(async () => '{"sections": [1, 2, 3, 4, 5]}');
    const bb = await pickBackbone(anchor(), "q", ["a"], { budget: 1_500 });
    expect(bb!.chars).toBeLessThanOrEqual(1_500);
    expect(bb!.text.startsWith("Harbor Lights")).toBe(true);
  });

  test("an anchor with no article gives no backbone", async () => {
    expect(await pickBackbone(anchorFor("Gout", null, "Gout is arthritis."), "q", [])).toBeNull();
  });

  test("an article with a lead and no sections is the lead alone", async () => {
    const lone = { ...article(), sections: [] };
    const bb = await pickBackbone(anchorFor(lone.title, lone), "q", []);
    expect(bb!.headings).toEqual([]);
    expect(bb!.text).toContain("aired for one season");
  });

  test("the block names the article and the number the writer cites it by; an article that is no source is background the writer is told not to cite", async () => {
    __setBackboneWriterForTests(async () => '{"sections": [3]}');
    const bb = (await pickBackbone(anchor(), "q", []))!;
    expect(backboneBlock(bb, 7)).toContain("cite it as [7]");
    expect(backboneBlock(bb, 7)).toContain("Harbor Lights (1984 television series)");
    expect(backboneBlock(bb, null)).toContain("do not cite it");
    expect(backboneBlock(bb, null)).not.toContain("[");
  });

  test("the article is a source of the reply: a library article by its library address, a live one by its public address", () => {
    const lib = backboneSource(article());
    expect(lib?.title).toBe("Harbor Lights (1984 television series)");
    expect(lib?.kind).toBe("reference");
    const live = backboneSource({ title: "Gout", lead: "Gout is arthritis.", sections: [], source: "wikimedia", url: "https://en.wikipedia.org/wiki/Gout" });
    expect(live?.url).toBe("https://en.wikipedia.org/wiki/Gout");
    expect(live?.kind).toBe("web");
    expect(backboneSource({ title: "X", lead: "", sections: [], source: "library" })).toBeNull();
  });
});

describe("the budget is shared, so a long early section does not starve the one that holds the answer (RESEARCH-COVERAGE-01)", () => {
  const long = (): ArticleText => ({
    title: "Alder (handbook)",
    lead: "Alder is a handbook.",
    source: "library",
    book: "wikipedia_en_all_maxi",
    path: "Alder_(handbook)",
    sections: [
      { heading: "Contents", text: `${filler("contents", 900)}` },
      { heading: "Editions", text: `${filler("editions", 400)}` },
      { heading: "Withdrawal", text: "The publisher withdrew the handbook in 1999 after complaints about its accuracy, and a corrected edition followed in 2001." },
    ],
  });

  test("allocate gives equal shares, lets short sections leave their share to the cut ones, and never exceeds the room", () => {
    expect(allocate([100, 100, 100], 300)).toEqual([100, 100, 100]);
    expect(allocate([10_000, 10_000], 1_000)).toEqual([500, 500]);
    expect(allocate([50, 10_000], 1_000)).toEqual([50, 950]);
    expect(allocate([], 1_000)).toEqual([]);
    expect(allocate([100], 0)).toEqual([0]);
    expect(allocate([700, 700, 700], 1_000).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1_000);
  });

  test("with two long early sections chosen first, the late short section that answers the question is still in the text", async () => {
    __setBackboneWriterForTests(async () => '{"sections": [1, 2, 3]}');
    const a = anchorFor("Alder (handbook)", long());
    const bb = await pickBackbone(a, "why was it withdrawn", ["why it was withdrawn"]);
    expect(bb!.text).toContain("withdrew the handbook in 1999");
    expect(bb!.headings).toEqual(["Contents", "Editions", "Withdrawal"]);
    expect(bb!.chars).toBeLessThanOrEqual(BACKBONE_CHARS);
    expect(bb!.seen).toEqual(["Contents", "Editions", "Withdrawal"]);
  });

  test("the sections not read are kept for a targeted second read, which takes only parts it is asked for and no search", async () => {
    __setBackboneWriterForTests(async () => '{"sections": [1]}');
    const a = anchorFor("Alder (handbook)", long());
    const bb = await pickBackbone(a, "q", ["a"], { budget: 3_000 });
    expect(bb!.unread.map((s) => s.heading)).toEqual(["Editions", "Withdrawal"]);
    __setBackboneWriterForTests(async () => '{"sections": [2]}');
    const more = await readMoreSections(bb!.unread, "why was it withdrawn", ["why it was withdrawn"]);
    expect(more.headings).toEqual(["Withdrawal"]);
    expect(more.text).toContain("withdrew the handbook in 1999");
    expect(await readMoreSections([], "q", ["a"])).toEqual({ text: "", headings: [] });
    expect(await readMoreSections(bb!.unread, "q", [])).toEqual({ text: "", headings: [] });
  });
});
