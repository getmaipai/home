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
    expect(fromBlocks.sections.map((s) => s.heading)).toEqual(["Reception"]);
    expect(fromBlocks.sections[0]!.text).toContain("It rated badly.");
    expect(fromBlocks.sections[0]!.text).toContain("- 36th");
    const fromExtract = articleFromExtract("T", "Opening line.\n\n== Production ==\nMade in 1984.\n\n=== Budget ===\nHalf.\n== Legacy ==\nLater.", "wikimedia");
    expect(fromExtract.lead).toBe("Opening line.");
    expect(fromExtract.sections.map((s) => s.heading)).toEqual(["Production", "Legacy"]);
    expect(fromExtract.sections[0]!.text).toContain("Budget:");
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
  test("the brief's guessed titles are looked up before the subject as worded and the question, and the first pick ends the passes", async () => {
    const seen: string[] = [];
    __setEntityPinForTests({
      finder: async (q) => { seen.push(q); return q === "Alder (2001 handbook)" ? [candidate("Alder (2001 handbook)"), candidate("Alder (2009 handbook)")] : [candidate("Unrelated")]; },
      writer: async () => '{"pick": 1}',
    });
    const b: Brief = { ...brief("the handbook"), titles: ["Alder (2001 handbook)", "Alder (handbook)"] };
    const { anchor } = await pinEntity(b, "the 2001 handbook, tell me more", person);
    expect(seen).toEqual(["Alder (2001 handbook)"]);
    expect(anchor?.title).toBe("Alder (2001 handbook)");
  });
});
