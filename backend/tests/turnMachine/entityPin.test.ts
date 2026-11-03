// RESEARCH-PIN-01: the subject of a research question is pinned to one article before any search, and every search carries that
// article's name and years. Pure functions plus the pick, on five kinds of subject (none of them named in the code).
import { afterEach, describe, expect, test } from "bun:test";
import { __setEntityPinForTests, anchorBlock, anchorFor, anchorQuery, articleFromBlocks, articleFromExtract, parsePick, pickPrompt, pinEntity, plainQuery, type EntityCandidate } from "@/lib/turnMachine/entityPin";
import type { Brief } from "@/lib/turnMachine/researchPipeline";
import type { PersonRow } from "@/types";

const person = {} as PersonRow;
const brief = (subject: string): Brief => ({ subject, answerType: "an explanation", mustContain: [], ambiguous: false, options: [], question: "", assumption: "" });
afterEach(() => __setEntityPinForTests(undefined));

const SUBJECTS = [
  { title: "Harbor Lights (1984 television series)", years: ["1984"], base: "Harbor Lights", bare: "lights cancelled why", expected: "lights cancelled why Harbor Lights 1984" },
  { title: "Gout", years: [], base: "Gout", bare: "treatment options for flare ups", expected: "treatment options for flare ups Gout" },
  { title: "Meridian (smartphone)", years: [], base: "Meridian", bare: "battery life comparison", expected: "Meridian smartphone battery life comparison" },
  { title: "Stonebridge, Ohio", years: [], base: "Stonebridge, Ohio", bare: "founding history", expected: "Stonebridge, Ohio founding history" },
  { title: "The Last Voyage (2011 film)", years: ["2011"], base: "The Last Voyage", bare: "ending explained", expected: "ending explained The Last Voyage 2011" },
];

describe("the anchor", () => {
  test("an article title becomes a base name, the years in its qualifier and a phrase a search can carry", () => {
    const a = anchorFor("Harbor Lights (1984 television series)", null, "Harbor Lights is an American series.");
    expect(a.baseName).toBe("Harbor Lights");
    expect(a.years).toEqual(["1984"]);
    expect(a.phrase).toBe("Harbor Lights 1984 television series");
    expect(a.lead).toContain("American series");
    expect(anchorFor("Gout", null).years).toEqual([]);
    expect(anchorFor("Gout", null).phrase).toBe("Gout");
  });

  for (const s of SUBJECTS) {
    test(`${s.title}: a bare search is given its subject's name and years`, () => {
      const anchor = anchorFor(s.title, null);
      expect(anchor.years).toEqual(s.years);
      const q = anchorQuery(s.bare, anchor);
      expect(q.toLowerCase()).toContain(s.base.toLowerCase().split(",")[0]!);
      for (const y of s.years) expect(q).toContain(y);
      expect(q.split(/\s+/).length).toBeLessThanOrEqual(8 + anchor.phrase.split(/\s+/).length);
    });
  }

  test("a search that already names the subject and year is left alone, and one over eight words keeps the anchor's words", () => {
    const anchor = anchorFor("Harbor Lights (1984 television series)", null);
    expect(anchorQuery("Harbor Lights 1984 cast interview", anchor)).toBe("Harbor Lights 1984 cast interview");
    const long = anchorQuery("Harbor Lights 1984 why was the show cancelled after only one season on the network", anchor);
    expect(long.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(long).toContain("Harbor");
    expect(long).toContain("1984");
  });

  test("a long article title does not crowd the question out of the search", () => {
    const anchor = anchorFor("Comparison of Northfield and Eastgate savings accounts (2019 reference list)", null);
    expect(anchor.phrase.split(/\s+/).length).toBeGreaterThan(4);
    const q = anchorQuery("which option has lower fees and better yield for retirement savers", anchor);
    const words = q.split(/\s+/);
    expect(words.length).toBeLessThanOrEqual(8);
    expect(q).toContain("Comparison of");
    expect(q).toContain("2019");
    const question = new Set("which option has lower fees and better yield for retirement savers".split(" "));
    expect(words.filter((w) => question.has(w)).length).toBeGreaterThanOrEqual(4);
    // the same words are never repeated in the final search
    const dup = anchorQuery("Comparison Comparison of savings savings accounts fees fees", anchor);
    const lower = dup.toLowerCase().split(/\s+/);
    expect(new Set(lower).size).toBe(lower.length);
  });

  test("a short anchor keeps its whole phrase and the question's words as before", () => {
    const anchor = anchorFor("Quiet Harbor (2011 film)", null);
    expect(anchor.phrase.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(anchorQuery("ending explained", anchor)).toBe("Quiet Harbor 2011 film ending explained");
    expect(anchorQuery("Meridian smartphone battery", anchorFor("Meridian (smartphone)", null))).toBe("Meridian smartphone battery");
  });

  test("quotes, OR, minus signs and site: operators are taken out, and no anchor means only that cleaning", () => {
    expect(plainQuery('"season two" OR "third season" -fan site:example.com plans')).toBe("season two third season fan plans");
    expect(anchorQuery('"a b" OR c', null)).toBe("a b c");
  });

  test("the writer's prompt block names the pinned article, and is empty without one", () => {
    expect(anchorBlock(null)).toBe("");
    const block = anchorBlock(anchorFor("Gout", null, "Gout is a form of arthritis."));
    expect(block).toContain("Gout");
    expect(block).toContain("arthritis");
  });
});

describe("articles read whole", () => {
  test("blocks become a lead and level 2 sections; a plain extract does the same", () => {
    const fromBlocks = articleFromBlocks("T", [
      { type: "paragraph", inlines: [{ type: "text", text: "Opening." }] },
      { type: "heading", level: 2, id: "a", text: "Reception" },
      { type: "paragraph", inlines: [{ type: "text", text: "It rated badly." }] },
      { type: "heading", level: 3, id: "b", text: "Ratings" },
      { type: "list", ordered: false, items: [[{ type: "text", text: "36th" }]] },
    ], "library");
    expect(fromBlocks.lead).toBe("Opening.");
    expect(fromBlocks.sections.map((s) => s.heading)).toEqual(["Reception", "Reception: Ratings"]);
    expect(fromBlocks.sections[0]!.text).toContain("It rated badly.");
    expect(fromBlocks.sections[1]!.text).toContain("- 36th");
    const fromExtract = articleFromExtract("T", "Opening line.\n\n== Production ==\nMade in 1984.\n\n=== Budget ===\nHalf.\n== Legacy ==\nLater.", "wikimedia");
    expect(fromExtract.lead).toBe("Opening line.");
    expect(fromExtract.sections.map((s) => s.heading)).toEqual(["Production", "Production: Budget", "Legacy"]);
    expect(fromExtract.sections[1]!.text).toContain("Half.");
  });
});

describe("pinning", () => {
  const candidate = (title: string, snippet = ""): EntityCandidate => ({ title, snippet, load: async () => ({ title, lead: `${title} opening.`, sections: [], source: "library" }) });

  test("the model's pick is parsed as a 1-based index; anything else is no pick", () => {
    expect(parsePick('{"pick": 2}', 3)).toBe(1);
    expect(parsePick('{"pick": 0}', 3)).toBeNull();
    expect(parsePick('{"pick": 9}', 3)).toBeNull();
    expect(parsePick("not json", 3)).toBeNull();
    expect(parsePick(null, 3)).toBeNull();
  });

  test("the pick is made on the question alone: the stage-1 paraphrase of the subject is not in the prompt", () => {
    const prompt = pickPrompt("why did it end", "a paraphrase with an invented 1983 detail", [{ title: "A", snippet: "x" }]);
    expect(prompt).not.toContain("invented 1983");
    expect(prompt).toContain("EVERY detail the question states");
  });

  test("the pick prompt lists the candidates and the question and names no subject of its own", () => {
    const prompt = pickPrompt("why did it end", "a show", [{ title: "A (2001 series)", snippet: "x" }, { title: "A (franchise)", snippet: "y" }]);
    expect(prompt).toContain("1. A (2001 series)");
    expect(prompt).toContain("2. A (franchise)");
    expect(prompt).toContain("why did it end");
  });

  test("a picked candidate becomes the anchor, with its article", async () => {
    __setEntityPinForTests({ finder: async () => [candidate("Alpha (franchise)"), candidate("Alpha (1984 television series)")], writer: async () => '{"pick": 2}' });
    const { anchor, candidates } = await pinEntity(brief("the series"), "why did the 1980s series end", person);
    expect(candidates).toBe(2);
    expect(anchor?.title).toBe("Alpha (1984 television series)");
    expect(anchor?.years).toEqual(["1984"]);
    expect(anchor?.article?.lead).toContain("opening");
  });

  test("RESEARCH-PIN-05: candidates that share the picked one's base name are kept as alternatives, other names are not", async () => {
    __setEntityPinForTests({ finder: async () => [candidate("Alpha (1983 miniseries)"), candidate("Alpha (1984 television series)"), candidate("Alpha (franchise)"), candidate("Beta (1984 television series)")], writer: async () => '{"pick": 2}' });
    const { anchor } = await pinEntity(brief("the series"), "why did the 1980s series end", person);
    expect(anchor?.title).toBe("Alpha (1984 television series)");
    expect(anchor?.alternatives).toEqual(["Alpha (1983 miniseries)", "Alpha (franchise)"]);
    __setEntityPinForTests({ finder: async () => [candidate("Alpha (1984 television series)"), candidate("Beta (franchise)")], writer: async () => '{"pick": 1}' });
    expect((await pinEntity(brief("x"), "q", person)).anchor?.alternatives).toBeUndefined();
  });

  test("no clear candidate, no candidates, a model that is down, or no brief all give no anchor", async () => {
    __setEntityPinForTests({ finder: async () => [candidate("A"), candidate("B")], writer: async () => '{"pick": 0}' });
    expect((await pinEntity(brief("x"), "q", person)).anchor).toBeNull();
    __setEntityPinForTests({ finder: async () => [], writer: async () => '{"pick": 1}' });
    expect((await pinEntity(brief("x"), "q", person)).anchor).toBeNull();
    __setEntityPinForTests({ finder: async () => [candidate("A")], writer: async () => null });
    expect((await pinEntity(brief("x"), "q", person)).anchor).toBeNull();
    expect((await pinEntity(null, "q", person)).anchor).toBeNull();
  });

  test("a lookup that throws gives no anchor and no crash", async () => {
    __setEntityPinForTests({ finder: async () => { throw new Error("library down"); }, writer: async () => '{"pick": 1}' });
    expect((await pinEntity(brief("x"), "q", person)).anchor).toBeNull();
  });

  test("the candidate set is widened until a pick is made: the subject, then the question, then the live search", async () => {
    const seen: { q: string; live: boolean | undefined }[] = [];
    const prompts: string[] = [];
    __setEntityPinForTests({
      finder: async (q, _p, _s, opts) => {
        seen.push({ q, live: opts?.live });
        if (q === "a subject" && !opts?.live) return [candidate("Unrelated one"), candidate("Unrelated two")];
        if (q === "the whole question") return [candidate("Unrelated one"), candidate("Unrelated three")];
        return [candidate("Right (2020 film)")];
      },
      writer: async (prompt) => { prompts.push(prompt); return prompt.includes("Right (2020 film)") ? '{"pick": 1}' : '{"pick": 0}'; },
    });
    const { anchor, candidates } = await pinEntity(brief("a subject"), "the whole question", person);
    expect(seen).toEqual([{ q: "a subject", live: false }, { q: "the whole question", live: false }, { q: "a subject", live: true }]);
    expect(prompts.length).toBe(3);
    expect(anchor?.title).toBe("Right (2020 film)");
    expect(candidates).toBe(4);
  });

  test("a pass that only offers titles already seen adds no pick, and the passes stop at the first pick", async () => {
    let picks = 0;
    const passes: string[] = [];
    __setEntityPinForTests({
      finder: async (q) => { passes.push(q); return [candidate("Same one"), candidate("Same two")]; },
      writer: async () => { picks += 1; return '{"pick": 0}'; },
    });
    expect((await pinEntity(brief("s"), "the question", person)).anchor).toBeNull();
    expect(picks).toBe(1);
    expect(passes.length).toBe(3);
    picks = 0;
    __setEntityPinForTests({ finder: async () => [candidate("A"), candidate("B")], writer: async () => { picks += 1; return '{"pick": 2}'; } });
    expect((await pinEntity(brief("s"), "q", person)).anchor?.title).toBe("B");
    expect(picks).toBe(1);
  });
});

describe("title-shaped lookups first", () => {
  const candidate = (title: string): EntityCandidate => ({ title, snippet: "", load: async () => ({ title, lead: `${title} opening.`, sections: [], source: "library" }) });
  test("the brief's guessed titles are all looked up before the subject as worded and the question, and the first pick ends the passes", async () => {
    const seen: string[] = [];
    __setEntityPinForTests({
      finder: async (q) => { seen.push(q); return q === "Alder (2001 handbook)" ? [candidate("Alder (2001 handbook)"), candidate("Alder (2009 handbook)")] : [candidate("Unrelated")]; },
      writer: async () => '{"pick": 1}',
    });
    const b: Brief = { ...brief("the handbook"), titles: ["Alder (2001 handbook)", "Alder (handbook)"] };
    const { anchor } = await pinEntity(b, "the 2001 handbook, tell me more", person);
    expect(seen).toEqual(["Alder (2001 handbook)", "Alder (handbook)"]);
    expect(anchor?.title).toBe("Alder (2001 handbook)");
  });
  test("several brief titles are all looked up before the first pick, so the pick prompt offers both works", async () => {
    const queries: string[] = [];
    const prompts: string[] = [];
    __setEntityPinForTests({
      finder: async (q) => { queries.push(q); return q === "Alder (2001 film)" ? [candidate("Alder (2001 film)")] : [candidate("Alder (2009 film)")]; },
      writer: async (prompt) => { prompts.push(prompt); return '{"pick": 1}'; },
    });
    const b: Brief = { ...brief("the film"), titles: ["Alder (2001 film)", "Alder (2009 film)"] };
    const { anchor, candidates } = await pinEntity(b, "how did the film end", person);
    expect(queries).toEqual(["Alder (2001 film)", "Alder (2009 film)"]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Alder (2001 film)");
    expect(prompts[0]).toContain("Alder (2009 film)");
    expect(candidates).toBe(2);
    expect(anchor?.alternatives).toEqual(["Alder (2009 film)"]);
  });

  test("merged title candidates are capped at eight", async () => {
    const prompts: string[] = [];
    __setEntityPinForTests({
      finder: async (q) => Array.from({ length: 5 }, (_, n) => candidate(`${q} ${n}`)),
      writer: async (prompt) => { prompts.push(prompt); return '{"pick": 1}'; },
    });
    await pinEntity({ ...brief("s"), titles: ["T1", "T2", "T3"] }, "q", person);
    expect(prompts[0]!.split("\n").filter((l) => /^\d+\. /.test(l))).toHaveLength(8);
  });

  test("a lookup offers up to eight candidates: a fitting sibling at rank six is not cut", async () => {
    const titles = ["Alder (1990 film)", "Alder (1995 film)", "Alder (2001 film)", "Alder (2003 film)", "Alder (2005 film)", "Alder (2009 miniseries)"];
    __setEntityPinForTests({ finder: async () => titles.map((t) => candidate(t)), writer: async () => '{"pick": 6}' });
    const { anchor, candidates } = await pinEntity(brief("Alder"), "q", person);
    expect(candidates).toBe(6);
    expect(anchor?.title).toBe("Alder (2009 miniseries)");
  });

  test("a colon subtitle does not hide a sibling: it is reported in alternatives", async () => {
    __setEntityPinForTests({ finder: async () => [candidate("Alder: The Beginning"), candidate("Alder: The Return"), candidate("Beta: The Return")], writer: async () => '{"pick": 1}' });
    const { anchor } = await pinEntity(brief("x"), "q", person);
    expect(anchor?.title).toBe("Alder: The Beginning");
    expect(anchor?.alternatives).toEqual(["Alder: The Return"]);
  });

  test("the pick prompt asks for the candidate that fits every stated detail and unsettles on a continuation", () => {
    const prompt = pickPrompt("q", "s", [{ title: "A", snippet: "x" }]);
    expect(prompt).toContain("whose opening fits EVERY detail the question states");
    expect(prompt).toContain("or 0 when no candidate fits them all");
    expect(prompt).toContain("An overview of a wider subject is the pick only when the question's details span more than one of the narrower candidates");
    expect(prompt).toContain("continued, followed or reworked another");
    expect(prompt).toContain('{"pick": 1, "settled": true, "also": 0}');
  });
});

describe("the pick is asked again when the reply is not the JSON object (RESEARCH-ANGLES-01)", () => {
  const candidate = (title: string): EntityCandidate => ({ title, snippet: "", load: async () => ({ title, lead: `${title} opening.`, sections: [], source: "library" }) });
  test("a prose reply is followed by one more call on the same candidates; the second reply decides and both are kept", async () => {
    const prompts: string[] = [];
    const replies = ["I think the second one fits best.", '{"pick":2,"settled":true,"also":0}'];
    __setEntityPinForTests({
      finder: async () => [candidate("Alpha (franchise)"), candidate("Alpha (1984 television series)")],
      writer: async (prompt) => { prompts.push(prompt); return replies[prompts.length - 1] ?? null; },
    });
    const { anchor, debug } = await pinEntity(brief("the series"), "why did the 1980s series end", person);
    expect(anchor?.title).toBe("Alpha (1984 television series)");
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toBe(`${prompts[0]}\nYour reply must be only the JSON object.`);
    expect(debug?.replies).toEqual(replies);
  });

  test("two unparsable replies pin nothing and a down model is not asked twice", async () => {
    let calls = 0;
    __setEntityPinForTests({ finder: async () => [candidate("A"), candidate("B")], writer: async () => { calls++; return "no idea"; } });
    expect((await pinEntity(brief("x"), "q", person)).anchor).toBeNull();
    calls = 0;
    __setEntityPinForTests({ finder: async () => [candidate("A"), candidate("B")], writer: async () => { calls++; return null; } });
    expect((await pinEntity(brief("x"), "q", person)).anchor).toBeNull();
    expect(calls).toBe(1);
  });
});

