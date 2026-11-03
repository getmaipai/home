// RESEARCH-PIPELINE-01 / RESEARCH-NOTES-01: the five stages of a research turn, each tested alone and then as a chain of typed hand-offs.
import { describe, expect, test } from "bun:test";
import {
  CLARIFY_MARK, clarifyingQuestion, analyse, analysisPrompt, askedBefore, briefBlock, briefPrompt, filterFindings, parseAnalysis, parseBrief, planData, replyBrief,
  researchQuestion, shouldAsk, understand, __setStageWritersForTests, ANSWER_WORDS, ANALYSIS_TOKENS, stageTimeoutMs, NAMES_FROM_SOURCES, ledgerForAnalysis, partsFor, repairJson, type Brief,
} from "@/lib/turnMachine/researchPipeline";
import { NOTE_EXCERPT_CHARS, notesLedger, pagePassages, parseNotes, quoteInPage, relevantExcerpt, settledNotes, writePageNotes, makeGate, type PageNote } from "@/lib/turnMachine/pageNotes";
import { evidenceBySource, parsePlannedQueries, shortKeywordQuery } from "@/lib/turnMachine/research";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

const note = (over: Partial<PageNote> & { url: string }): PageNote => ({ title: "T", kind: "reputable", topic: "why it ended", note: "It ended after low ratings.", quote: "ranked 57th of 77 shows that season", weight: 3, ...over });
const numberOf = (urls: string[]): Map<string, number> => new Map(urls.map((u, i) => [u, i + 1]));

describe("stage 1: what is this person asking", () => {
  test("the prompt carries the question and the conversation, names no subject, and asks for ambiguity only when nothing settles it", () => {
    const prompt = briefPrompt("which one is better value", "Person: I am looking at two laptops\nAssistant: Which two?");
    expect(prompt).toContain("which one is better value");
    expect(prompt).toContain("I am looking at two laptops");
    expect(prompt).toContain("ONLY when");
    expect(prompt).toContain("neither the question's own words nor the conversation so far settle it");
    expect(prompt).not.toMatch(/miniseries|franchise|series|network/i);
  });

  test("a brief reads from the model's JSON; ambiguity needs two readings; a reply that is not JSON gives none", () => {
    const ok = parseBrief('{"subject":"a TV show ending","answer_type":"an explanation","must_contain":["why it ended","what came next"],"ambiguous":false,"options":[],"assumption":"the 1984 series"}');
    expect(ok).toMatchObject({ subject: "a TV show ending", ambiguous: false, mustContain: ["why it ended", "what came next"] });
    expect(parseBrief('{"subject":"x","ambiguous":true,"options":["only one"]}')!.ambiguous).toBe(false);
    expect(parseBrief('{"subject":"x","ambiguous":true,"options":[],"question":"Which show do you mean?"}')).toMatchObject({ ambiguous: true, question: "Which show do you mean?" });
    expect(parseBrief('{"subject":"x","ambiguous":true,"options":["the 1984 series","the 2009 series","a third"]}')).toMatchObject({ ambiguous: true, options: ["the 1984 series", "the 2009 series", "a third"] });
    expect(parseBrief("no idea")).toBeNull();
    expect(parseBrief(null)).toBeNull();
  });

  test("the brief carries up to three guessed encyclopedia titles for the lookup, and the prompt asks for them", () => {
    const parsed = parseBrief(JSON.stringify({ subject: "a thing", titles: ["Alpha (2001 work)", "Alpha", "Alpha (work)", "Alpha (extra)", 7], answer_type: "x", must_contain: [], ambiguous: false, options: [], question: "", assumption: "" }));
    expect(parsed!.titles).toEqual(["Alpha (2001 work)", "Alpha", "Alpha (work)"]);
    expect(parseBrief(JSON.stringify({ subject: "a thing" }))!.titles).toEqual([]);
    expect(briefPrompt("q", "")).toContain('"titles"');
  });

  test("the brief prompt names the thing as the person named it and offers one title per work the words could mean", () => {
    const prompt = briefPrompt("q", "");
    expect(prompt).toContain("the thing itself, named as the person named it; never the kind of answer wanted and never a year or name the person did not say");
    expect(prompt).toContain("one per work or version the person's words could mean when the name is shared");
  });

  test("understand() hands the model's reading on, and a model that is down gives null", async () => {
    __setStageWritersForTests({ brief: async () => '{"subject":"a show","ambiguous":false,"options":[]}' });
    expect((await understand("q", ""))!.subject).toBe("a show");
    __setStageWritersForTests({ brief: async () => null });
    expect(await understand("q", "")).toBeNull();
    __setStageWritersForTests(undefined);
  });

  test("a question is asked once: an ambiguous brief asks, an earlier question of this kind in the conversation stops it, a settled brief never asks", () => {
    const ambiguous: Brief = { subject: "x", answerType: "", mustContain: [], ambiguous: true, options: ["the 1984 one", "the 2009 one"], question: "", assumption: "the 1984 one" };
    const settled: Brief = { ...ambiguous, ambiguous: false, options: [] };
    expect(shouldAsk(ambiguous, [{ role: "user", content: "q" }])).toBe(true);
    expect(shouldAsk(settled, [{ role: "user", content: "q" }])).toBe(false);
    expect(shouldAsk(null, [])).toBe(false);
    const asked = [{ role: "user", content: "q" }, { role: "assistant", content: clarifyingQuestion(ambiguous) }, { role: "user", content: "pick for me" }];
    expect(askedBefore(asked)).toBe(true);
    expect(shouldAsk(ambiguous, asked)).toBe(false);
  });

  test("a question that names no subject asks the model's own short question", () => {
    const noSubject: Brief = { subject: "a show", answerType: "", mustContain: [], ambiguous: true, options: [], question: "Which show do you mean?", assumption: "" };
    expect(clarifyingQuestion(noSubject)).toBe('Before I research this, which show do you mean? Say "pick for me" if you are not sure.');
    expect(shouldAsk(noSubject, [{ role: "user", content: "why did it end" }])).toBe(true);
  });

  test("after our question the person's reply is read as an answer to the original question", () => {
    const history = [{ role: "user", content: "why did it end" }, { role: "assistant", content: `${CLARIFY_MARK}, which one do you mean: A or B?` }, { role: "user", content: "pick for me" }];
    expect(researchQuestion(history, "pick for me")).toBe("why did it end (meaning: pick for me)");
    expect(researchQuestion([{ role: "user", content: "plain" }], "plain")).toBe("plain");
  });
});

describe("stage 2: what data is needed", () => {
  const brief: Brief = { subject: "a show ending", answerType: "an explanation", mustContain: ["why it ended"], ambiguous: false, options: [], question: "", assumption: "" };
  test("the plan carries the brief into the writer's prompt and returns sub-questions and searches (a name from memory stays: the tool node runs that search without it)", async () => {
    const prompts: string[] = [];
    const plan = await planData(async (prompt) => { prompts.push(prompt); return '{"sub_questions":["why it ended","what came next"],"queries":["the show ended why","Jane Smith show interview"]}'; }, brief, "why did the show end", 4);
    expect(prompts[0]).toContain(briefBlock(brief));
    expect(prompts[0]).toContain("sub_questions");
    expect(plan.subQuestions.slice(0, 2)).toEqual(["why it ended", "what came next"]);
    expect(plan.queries).toEqual(["the show ended why", "Jane Smith show interview"]);
  });
  test("a writer that is down gives an empty plan", async () => {
    expect(await planData(async () => null, brief, "q", 4)).toEqual({ subQuestions: [], queries: [] });
  });
});

describe("page notes", () => {
  const filler = (n: number): string => "The page talks about other things at some length. ".repeat(Math.ceil(n / 49)).slice(0, n);
  const fact = "Deep fact: the show ranked 57th of 77 shows that season, which led to the cancellation.";
  const page = `${filler(9_000)}\n${fact}\n${filler(3_000)}`;

  test("a long page is cut to the passages that share the most words with the question: a fact 9,000 characters in is reached, and the excerpt is short", () => {
    const excerpt = relevantExcerpt(page, "why did the show get cancelled, what ranking did it have");
    expect(excerpt).toContain(fact);
    expect(excerpt.length).toBeLessThanOrEqual(NOTE_EXCERPT_CHARS);
    expect(excerpt.length).toBeLessThan(page.length / 4);
  });

  test("passages: short lines are skipped, a very long paragraph is split near 600 characters, and a page with no newlines still yields passages", () => {
    const long = `${"A sentence about nothing in particular. ".repeat(60)}`;
    const passages = pagePassages(`tiny\n${long}`);
    expect(passages.length).toBeGreaterThan(2);
    expect(passages.every((p) => p.length <= 700)).toBe(true);
    expect(pagePassages("x\n\ny")).toEqual([]);
    expect(relevantExcerpt("short", "anything")).toBe("short");
  });

  test("the quote check keeps a note whose quote is in the page (curly quotes and spacing aside) and drops one that is not", () => {
    expect(quoteInPage("ranked 57th of 77   shows", "It ranked 57th of 77 shows that season")).toBe(true);
    expect(quoteInPage("it said “no”", 'It said "no" to all')).toBe(true);
    expect(quoteInPage("ranked first of 77 shows", "It ranked 57th of 77 shows that season")).toBe(false);
    const reply = JSON.stringify({ kind: "primary", notes: [{ topic: "ratings", note: "It ranked 57th.", quote: "ranked 57th of 77 shows", weight: 3 }, { topic: "ratings", note: "Invented.", quote: "was the most watched show of the decade", weight: 3 }] });
    const parsed = parseNotes(reply, "It ranked 57th of 77 shows that season");
    expect(parsed.notes.length).toBe(1);
    expect(parsed.dropped).toBe(1);
    expect(parsed.kind).toBe("primary");
  });

  test("writePageNotes makes ONE call over the relevant passages and keeps the deep note, its quote checked against the whole page", async () => {
    let calls = 0;
    const writer = async (prompt: string) => {
      calls += 1;
      const m = prompt.match(/Deep fact: [^.]*\./);
      return JSON.stringify({ kind: "reputable", notes: m ? [{ topic: "why it ended", note: "It ranked low.", quote: m[0], weight: 3 }] : [] });
    };
    const notes = await writePageNotes(writer, makeGate(2), "why did it end", { url: "https://a.example/p", title: "A", text: page }, undefined, Date.now, "why did it end ranking cancellation");
    expect(calls).toBe(1);
    expect(notes.map((n) => n.quote)).toEqual(["Deep fact: the show ranked 57th of 77 shows that season, which led to the cancellation."]);
  });

  test("notes still being written when the wait ends are left out, finished ones are used", async () => {
    const pending = new Map<string, Promise<PageNote[]>>([["a", Promise.resolve([note({ url: "a" })])], ["b", new Promise(() => {})]]);
    const got = await settledNotes(pending, 30);
    expect(got.map((n) => n.url)).toEqual(["a"]);
  });
});

describe("stage 3: grab and filter", () => {
  test("a repeated quote and a near-identical note are kept once, a thin note goes when stronger ones exist, a fan page goes when two better pages cover the part", () => {
    const urls = ["u1", "u2", "u3", "u4", "u5"];
    const notes = [
      note({ url: "u1", kind: "primary" }),
      note({ url: "u2", kind: "fan" }),
      note({ url: "u3", kind: "reputable", quote: "a second reputable quote here", note: "A different point about ratings and slots." }),
      note({ url: "u4", kind: "reputable", weight: 1, quote: "a thin remark nobody needs", note: "Thin remark." }),
      note({ url: "u5", kind: "fan", quote: "fan page only quote here", note: "Fan chatter.", topic: "fan talk" }),
    ];
    const findings = filterFindings(notes, numberOf(urls), 5_000);
    const kept = findings.notes.map((n) => n.url);
    expect(kept).toContain("u1");
    expect(kept).toContain("u3");
    expect(kept).not.toContain("u2");
    expect(kept).not.toContain("u4");
    expect(kept).toContain("u5");
    expect(findings.dropped).toBe(2);
    expect(findings.read).toBe(5);
  });

  test("the ledger stays inside its budget, groups by part, and takes the parts in turns", () => {
    const many = Array.from({ length: 30 }, (_, i) => note({ url: `u${i % 3}`, topic: `part ${i % 3}`, note: `Point number ${i} about this part.`, quote: `quote number ${i} lives in the page text` }));
    const ledger = notesLedger(many, numberOf(["u0", "u1", "u2"]), 900);
    expect(ledger.text.length).toBeLessThanOrEqual(900);
    expect(ledger.text).toContain("About part 0:");
    expect(ledger.text).toContain("About part 1:");
    expect(ledger.text).toContain("About part 2:");
    expect(ledger.dropped).toBeGreaterThan(0);
  });

  test("a claim check sees the deep quotes of a source as its passages", () => {
    const outcome = { callId: "c", packageId: "websearch", status: "succeeded", sources: [{ url: "https://a.example/p", title: "A" }], result: { data: { rows: [{ url: "https://a.example/p", title: "A", snippet: "s" }], pages: [{ url: "https://a.example/p", title: "A", text: "opening only" }] } } } as unknown as ToolExecutionOutcome;
    const evidence = evidenceBySource([outcome], [{ url: "https://a.example/p", quote: "ranked 57th of 77 shows" }]);
    expect(evidence[0]).toContain("opening only");
    expect(evidence[0]).toContain("ranked 57th of 77 shows");
  });
});

describe("stage 4: the analysis", () => {
  const valid = new Set([1, 2, 3]);
  const reply = JSON.stringify({
    claims: [
      { claim: "It ranked 57th of 77.", status: "established", sources: [1] },
      { claim: "A sequel was pitched.", status: "reported", sources: [2, 9] },
      { claim: "Nothing cited here.", status: "established", sources: [9] },
      { claim: "The network lost interest.", status: "inferred", sources: [] },
    ],
    conflicts: ["One page says March, another February."],
    gaps: ["No interview with the makers."],
    guesses: [{ guess: "It would have ended in a short second season.", because: ["low ratings", "a pitched sequel"], confidence: "medium", sources: [1, 2] }, { guess: "No reasons given.", because: [], confidence: "high", sources: [] }],
  });

  test("the analysis keeps only claims that cite real notes (an inferred one may cite none), drops a guess with no reasons, and keeps conflicts and gaps", () => {
    const analysis = parseAnalysis(reply, valid)!;
    expect(analysis.claims.map((c) => c.claim)).toEqual(["It ranked 57th of 77.", "A sequel was pitched.", "The network lost interest."]);
    expect(analysis.claims[1]!.sources).toEqual([2]);
    expect(analysis.claims[2]!.status).toBe("inferred");
    expect(analysis.guesses.length).toBe(1);
    expect(analysis.guesses[0]).toMatchObject({ confidence: "medium", sources: [1, 2] });
    expect(analysis.conflicts.length).toBe(1);
    expect(analysis.gaps.length).toBe(1);
    expect(parseAnalysis("nope", valid)).toBeNull();
  });

  test("analyse() sends the brief and the ledger to the model, and does nothing when there are no notes", async () => {
    const seen: string[] = [];
    __setStageWritersForTests({ analysis: async (prompt) => { seen.push(prompt); return reply; } });
    const brief: Brief = { subject: "a show ending", answerType: "an explanation", mustContain: ["why it ended"], ambiguous: false, options: [], question: "", assumption: "" };
    const findings = filterFindings([note({ url: "u1" })], numberOf(["u1"]), 3_000);
    const out = await analyse(brief, "why did it end", findings, valid, "max");
    expect(out!.claims.length).toBe(3);
    expect(seen[0]).toContain(briefBlock(brief));
    expect(seen[0]).toContain("ranked 57th of 77 shows that season");
    expect(seen[0]).toBe(analysisPrompt(brief, "why did it end", findings.ledger.text));
    const empty = filterFindings([], numberOf([]), 3_000);
    expect(await analyse(brief, "q", empty, valid, "max")).toBeNull();
    __setStageWritersForTests(undefined);
  });
});

describe("stage 5: the reply, and the chain of hand-offs", () => {
  test("the writing round is handed the analysis (established first, then guesses with their reasons, then gaps) and the ledger", () => {
    const analysis = parseAnalysis(JSON.stringify({ claims: [{ claim: "It ranked 57th of 77.", status: "established", sources: [1] }], conflicts: [], gaps: ["No interview."], guesses: [{ guess: "A short second season.", because: ["low ratings"], confidence: "low", sources: [1] }] }), new Set([1]))!;
    const text = replyBrief({ subject: "s", answerType: "an explanation", mustContain: ["why it ended"], ambiguous: false, options: [], question: "", assumption: "" }, analysis, "LEDGER TEXT", "I took this to mean the 1984 series.");
    expect(text.startsWith('Begin with one plain sentence saying what you took the question to mean: "I took this to mean the 1984 series."')).toBe(true);
    expect(text.indexOf("established:")).toBeLessThan(text.indexOf("Not found:"));
    expect(text.indexOf("Not found:")).toBeLessThan(text.indexOf("Guesses to present as guesses"));
    expect(text).toContain("- It ranked 57th of 77. [1]");
    expect(text).toContain("(low) A short second season. because low ratings [1]");
    expect(text).toContain("covering why it ended");
    expect(text.endsWith("LEDGER TEXT")).toBe(true);
  });

  test("brief -> plan -> findings -> analysis -> reply: the source numbers a note carries are the ones the reply cites", async () => {
    __setStageWritersForTests({
      brief: async () => '{"subject":"a show ending","answer_type":"an explanation","must_contain":["why it ended"],"ambiguous":false,"options":[],"assumption":""}',
      analysis: async () => '{"claims":[{"claim":"It ranked 57th of 77.","status":"established","sources":[2]}],"conflicts":[],"gaps":[],"guesses":[]}',
    });
    const brief = await understand("why did the show end", "");
    const plan = await planData(async () => '{"sub_questions":["why it ended"],"queries":["the show ended why"]}', brief, "why did the show end", 3);
    const findings = filterFindings([note({ url: "https://b.example/p" })], numberOf(["https://a.example/p", "https://b.example/p"]), 3_000);
    const analysis = await analyse(brief, "why did the show end", findings, new Set([1, 2]), "max");
    const reply = replyBrief(brief, analysis, findings.ledger.text, null);
    expect(plan.queries).toEqual(["the show ended why"]);
    expect(findings.ledger.text).toContain("- [2] (reputable)");
    expect(reply).toContain("- It ranked 57th of 77. [2]");
    __setStageWritersForTests(undefined);
  });
});

describe("planned searches are short plain keywords (RESEARCH-QUERY-04)", () => {
  test("quotes, OR and minus are taken out and a long query is cut to its first eight words", () => {
    const q = shortKeywordQuery('"season two" OR "third season" plans for the show on the network after the cancellation was announced');
    expect(q.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(q).not.toMatch(/["]| OR /);
    expect(shortKeywordQuery("plain short query")).toBe("plain short query");
  });

  test("a planner's list is cleaned: one-word and empty entries go, long ones are cut", () => {
    const queries = parsePlannedQueries(JSON.stringify({ queries: ["x", '"a b c" OR "d e f" g h i j k l m n', "good two"] }));
    expect(queries.length).toBe(2);
    expect(queries[0]!.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(queries[1]).toBe("good two");
  });

  test("planData keeps the same rules for the first round", async () => {
    const plan = await planData(async () => JSON.stringify({ sub_questions: ["a"], queries: ['"quoted phrase" OR "other phrase" with many more words than eight allow here', "short one"] }), null, "q", 4);
    expect(plan.queries.every((q) => q.split(/\s+/).length <= 8 && !q.includes('"'))).toBe(true);
    expect(plan.queries).toContain("short one");
  });
});

describe("coverage of the parts a good answer must cover (RESEARCH-COVERAGE-01)", () => {
  const brief: Brief = { subject: "s", answerType: "an explanation", mustContain: ["why it ended", "what came next"], ambiguous: false, options: [], question: "", assumption: "" };

  test("the parts are the brief's must-contain items then the plan's sub-questions, without repeats, at most eight", () => {
    expect(partsFor(brief, { subQuestions: ["why it ended", "who ran it", "what came next in later years"], queries: [] })).toEqual(["why it ended", "what came next", "who ran it"]);
    expect(partsFor(null, undefined)).toEqual([]);
    expect(partsFor({ ...brief, mustContain: ["a1 aa", "b1 bb", "c1 cc", "d1 dd", "e1 ee", "f1 ff", "g1 gg", "h1 hh", "i1 ii"] }, undefined).length).toBe(8);
    expect(partsFor({ ...brief, mustContain: ["a1 aa", "b1 bb", "c1 cc", "d1 dd"] }, { subQuestions: ["e1 ee", "f1 ff", "g1 gg", "h1 hh"], queries: [] }).length).toBe(8);
  });

  test("the analysis prompt lists the parts and asks which are covered; a part reported uncovered comes back in the question's own words", () => {
    const parts = ["why it ended", "what came next"];
    const prompt = analysisPrompt(brief, "q", "ledger", "", parts);
    expect(prompt).toContain("1. why it ended");
    expect(prompt).toContain('"covered": true');
    const reply = JSON.stringify({ claims: [{ claim: "It ended in 1999.", status: "established", sources: [1] }], conflicts: [], gaps: [], guesses: [], parts: [{ part: "Why it ended", covered: true }, { part: "what came next afterwards", covered: false }, { part: "invented part", covered: false }] });
    const analysis = parseAnalysis(reply, new Set([1]), parts);
    expect(analysis!.uncovered).toEqual(["what came next"]);
    expect(parseAnalysis(JSON.stringify({ claims: [], conflicts: [], gaps: [], guesses: [] }), new Set([1]), parts)!.uncovered).toEqual([]);
    expect(analysisPrompt(brief, "q", "ledger")).not.toContain("parts a good answer must cover");
  });

  test("the analysis asks for a claim per part first and scales the claim cap with the parts", () => {
    const many = ["a one", "b two", "c three", "d four", "e five", "f six"];
    const prompt = analysisPrompt(brief, "q", "ledger", "", many);
    expect(prompt).toContain("Write the claims part by part");
    expect(prompt).toContain("Read the article to its end");
    expect(prompt).toContain("at most 10 claims");
    expect(analysisPrompt(brief, "q", "ledger", "", ["x y"])).toContain("at most 8 claims");
    const claims = Array.from({ length: 12 }, (_, i) => ({ claim: `Claim ${i}.`, status: "established", sources: [1] }));
    const reply = JSON.stringify({ claims, conflicts: [], gaps: [], guesses: [] });
    expect(parseAnalysis(reply, new Set([1]), many)!.claims).toHaveLength(10);
    expect(parseAnalysis(reply, new Set([1]))!.claims).toHaveLength(8);
  });

  test("the writer brief never lists a part with text behind it as not found", () => {
    const analysis = { claims: [{ claim: "It ended in 1999.", status: "established" as const, sources: [1] }], conflicts: [], gaps: [], guesses: [], uncovered: ["what came next"] };
    const withRead = replyBrief(brief, analysis, "", null, { read: "## Aftermath\nA corrected edition followed." });
    expect(withRead).toContain("is never listed as not found");
    expect(withRead).not.toContain("if it does not speak to a part, write that the part was not found");
    expect(withRead).toContain("a fact you stated above is never listed there");
  });

  test("the writing round reads the section read for an uncovered part, or is told the part was not found in the sources, and aims at the style's word count", () => {
    const analysis = { claims: [{ claim: "It ended in 1999.", status: "established" as const, sources: [1] }], conflicts: [], gaps: [], guesses: [], uncovered: ["what came next"] };
    const withRead = replyBrief(brief, analysis, "", null, { read: "## Aftermath\nA corrected edition followed.", words: ANSWER_WORDS.max });
    expect(withRead).toContain("More of the article, read for the parts the notes did not cover");
    expect(withRead).toContain("A corrected edition followed.");
    expect(withRead).toContain(`about ${ANSWER_WORDS.max} words`);
    expect(withRead).not.toContain("Nothing in the notes or the article speaks to");
    const missing = replyBrief(brief, analysis, "", null, { missing: ["what came next"], words: ANSWER_WORDS.thinking });
    expect(missing).toContain('Nothing in the notes or the article speaks to: "what came next"');
    expect(missing).toContain("not found in the sources");
    expect(replyBrief(brief, analysis, "", null)).not.toContain("words");
  });

  test("the writing round's ledger keeps the notes the analysis cited and falls back to all notes when it cited none", () => {
    const a = note({ url: "https://a.example/p", quote: "first quote text here" });
    const b = note({ url: "https://b.example/p", quote: "second quote text here" });
    const numbers = numberOf(["https://a.example/p", "https://b.example/p"]);
    const analysis = { claims: [{ claim: "c", status: "established" as const, sources: [2] }], conflicts: [], gaps: [], guesses: [], uncovered: [] };
    const only = ledgerForAnalysis([a, b], analysis, numbers, 4_000);
    expect(only.text).toContain("second quote text here");
    expect(only.text).not.toContain("first quote text here");
    const all = ledgerForAnalysis([a, b], { ...analysis, claims: [] }, numbers, 4_000);
    expect(all.text).toContain("first quote text here");
    expect(all.text).toContain("second quote text here");
    expect(ledgerForAnalysis([a, b], null, numbers, 4_000).notes).toBe(2);
  });
});

describe("a reply cut off inside its JSON is repaired, not lost (RESEARCH-ANALYSIS-03)", () => {
  test("repairJson closes an open string and the open brackets, and drops a dangling key or comma", () => {
    expect(JSON.parse(repairJson('{"claims": [{"claim": "one", "sources": [1]}], "parts": [{"part": "a part", "covered": tr'))).toBeDefined();
    expect(JSON.parse(repairJson('{"a": [1, 2, 3,'))).toEqual({ a: [1, 2, 3] });
    expect(JSON.parse(repairJson('{"a": "text that was cut'))).toEqual({ a: "text that was cut" });
    expect(JSON.parse(repairJson('{"a": 1, "b":'))).toEqual({ a: 1 });
    expect(JSON.parse(repairJson('prefix {"x": {"y": "z\\"q'))).toEqual({ x: { y: 'z"q' } });
    expect(repairJson("no object here")).toBe("");
  });

  test("an analysis reply that stops partway still yields the claims and the parts reported before the cut", () => {
    const cut = '{"claims": [{"claim": "It ended in 1999.", "status": "established", "sources": [1]}], "parts": [{"part": "why it ended", "covered": true}, {"part": "what came next", "covered": false}], "conflicts": [], "gaps": ["a gap that was never fini';
    const analysis = parseAnalysis(cut, new Set([1]), ["why it ended", "what came next"]);
    expect(analysis).not.toBeNull();
    expect(analysis!.claims.length).toBe(1);
    expect(analysis!.uncovered).toEqual(["what came next"]);
  });

  test("the schema asks for the parts right after the claims, so a cut loses the less important tail", () => {
    const prompt = analysisPrompt(null, "q", "ledger", "", ["a part"]);
    expect(prompt.indexOf('"parts"')).toBeLessThan(prompt.indexOf('"conflicts"'));
    expect(prompt).toContain("each in one short sentence");
  });
});

describe("RESEARCH-PIN-05 and RESEARCH-PLAN-02: which one was read, and the angles an answer rests on", () => {
  const brief = null;
  const analysis = { claims: [{ claim: "It ended in 1999.", status: "established" as const, sources: [1] }], conflicts: [], gaps: [], guesses: [], uncovered: [] };
  test("a shared name makes the writer say in its first sentence which one it read, and name the others", () => {
    const text = replyBrief(brief, analysis, "", null, { pinned: { title: "Alpha (1984 television series)", alternatives: ["Alpha (1983 miniseries)"] } });
    expect(text).toContain('"Alpha (1984 television series)"');
    expect(text).toContain('"Alpha (1983 miniseries)"');
    expect(text).toContain("Say in the first sentence which one you took the question to mean");
    expect(replyBrief(brief, analysis, "", null, { pinned: { title: "Alpha", alternatives: [] } })).not.toContain("name is shared");
  });
  test("RESEARCH-NAMES-01: names the question never gave are kept out of the parts, the brief prompt and the plan prompt forbid them", async () => {
    const parsed = parseBrief('{"subject":"a show","must_contain":["the main characters (e.g., Alpha Beta, Gamma)","why it ended"]}')!;
    expect(partsFor(parsed, undefined, "what was the show about")).toEqual(["the main characters", "why it ended"]);
    const plan = { subQuestions: ["what Delta Epsilon said", "who is Zeta Omega", "what came next"], queries: [] };
    expect(partsFor(null, plan, "what happened Zeta Omega is a series")).toEqual(["who is Zeta Omega", "what came next"]);
    // Every part named something unknown: the parts stay, with the bracketed example list removed.
    const onlyNamed = parseBrief('{"subject":"a show","must_contain":["the cast (such as Alpha Beta)"]}')!;
    expect(partsFor(onlyNamed, undefined, "q")).toEqual(["the cast"]);
    const planned = await planData(async () => '{"sub_questions":["what Delta Epsilon said","who is Zeta Omega","what came next"],"queries":["the show ended why"]}', parsed, "why did the show end", 3, "", "Zeta Omega is a series");
    expect(planned.subQuestions.slice(0, 2)).toEqual(["who is Zeta Omega", "what came next"]);
    expect(briefPrompt("q", "")).toContain('add no detail of your own to "subject", "assumption" or "must_contain": name there no person, work, place or year the question does not name');
    let seen = "";
    await planData(async (prompt) => { seen = prompt; return '{"sub_questions": [], "queries": []}'; }, parsed, "q", 3);
    expect(seen).toContain("A sub-question names only what the question, the pinned subject or the person's words name; a part about people or works not named there is worded without names.");
  });
  test("the plan prompt asks for the sub-questions an answer rests on, without naming a topic", async () => {
    let seen = "";
    await planData(async (prompt) => { seen = prompt; return '{"sub_questions": [], "queries": []}'; }, { subject: "s", answerType: "", mustContain: [], ambiguous: false, options: [], question: "", assumption: "" }, "what would have happened", 3);
    expect(seen).toContain("why_it_stopped_or_changed");
    expect(seen).toContain("what_was_planned_or_announced");
  });
});

describe("an open question always gets the generic angles (ANGLE-FLOOR)", () => {
  const brief: Brief = { subject: "the show", answerType: "an explanation", mustContain: [], ambiguous: false, options: [], question: "", assumption: "" };
  const reply = JSON.stringify({ sub_questions: ["who made it"], angles: {}, queries: ["the show ended why"] });

  test("an empty angles reply for an open question still yields a what-came-after part", async () => {
    const plan = await planData(async () => reply, brief, "what happened to the show", 3);
    expect(plan.subQuestions.some((p) => /what came after/.test(p))).toBe(true);
    expect(plan.angleParts?.some((p) => /what came after/.test(p))).toBe(true);
    expect(plan.subQuestions.length).toBeLessThanOrEqual(8);
  });
  test("a closed how-to question gets none", async () => {
    const plan = await planData(async () => reply, brief, "how do I turn on subtitles", 3);
    expect(plan.subQuestions).toEqual(["who made it"]);
    expect(plan.angleParts).toEqual([]);
  });
  test("an equivalent part the model already wrote is not duplicated", async () => {
    const own = JSON.stringify({ sub_questions: ["what came after the show: follow-ups, revivals, later work"], angles: {}, queries: [] });
    const plan = await planData(async () => own, brief, "what happened to the show", 3);
    expect(plan.subQuestions.filter((p) => /what came after/.test(p))).toHaveLength(1);
  });
});

describe("every ask becomes its own part (RESEARCH-PLAN-GAPS-01)", () => {
  const brief: Brief = { subject: "the show", answerType: "an explanation", mustContain: ["a1 aa", "b1 bb", "c1 cc", "d1 dd", "e1 ee"], ambiguous: false, options: [], question: "", assumption: "" };

  test("the plan prompt tells the model to split compound asks and to cover the ending, what came after and what was planned but not done", async () => {
    let seen = "";
    await planData(async (prompt) => { seen = prompt; return "{}"; }, brief, "q", 3);
    expect(seen).toContain("separate sub-questions");
    expect(seen).toContain("what was planned but not done");
    expect(seen).toContain("3 to 8");
  });

  test("the plan keeps up to eight sub-questions", async () => {
    const subs = ["f1 ff", "g1 gg", "h1 hh", "i1 ii", "j1 jj", "k1 kk", "l1 ll", "m1 mm"];
    const plan = await planData(async () => JSON.stringify({ sub_questions: subs, queries: [] }), brief, "q", 3);
    expect(plan.subQuestions).toEqual(subs);
  });

  test("the angle parts reach the writer: a full brief and a long sub-question list cannot push them past the eight-part cap", async () => {
    const reply = JSON.stringify({ sub_questions: ["f1 ff", "g1 gg", "h1 hh", "i1 ii", "j1 jj", "k1 kk"], angles: { what_was_planned_or_announced: "what was planned next", what_came_after: "later sequels and revivals" }, queries: [] });
    const plan = await planData(async () => reply, brief, "q", 3);
    const parts = partsFor(brief, plan);
    expect(parts.length).toBe(8);
    expect(parts).toContain("what was planned next");
    expect(parts).toContain("later sequels and revivals");
    expect(parts.slice(0, 3)).toEqual(["a1 aa", "b1 bb", "c1 cc"]);
  });
});

describe("plan angles and the pick-retry (RESEARCH-ANGLES-01)", () => {
  const brief: Brief = { subject: "the show", answerType: "an explanation", mustContain: [], ambiguous: false, options: [], question: "", assumption: "" };

  test("the plan prompt asks for the angles as keys, each a sub-question or empty", async () => {
    let seen = "";
    await planData(async (prompt) => { seen = prompt; return "{}"; }, brief, "q", 3);
    expect(seen).toContain('"angles": {"why_it_stopped_or_changed": "", "what_was_planned_or_announced": "", "what_came_after": "", "who_said_what": "", "how_it_ended": "", "legacy_or_later_work": ""}');
    expect(seen).not.toContain("wherever they apply");
  });

  test("a non-empty angle joins the sub-questions after the model's own list; a repeat, an empty one and one naming an unknown name do not", async () => {
    const reply = JSON.stringify({ sub_questions: ["x"], angles: { what_came_after: "what came after it", why_it_stopped_or_changed: "", who_said_what: "what Delta Epsilon said", what_planned: "what came after it" }, queries: ["the show ended why"] });
    const plan = await planData(async () => reply, brief, "why did the show end", 3);
    expect(plan.subQuestions.slice(0, 2)).toEqual(["x", "what came after it"]);
    expect((await planData(async () => '{"sub_questions":["x"],"queries":[]}', brief, "q", 3)).subQuestions).toEqual(["x"]);
    expect((await planData(async () => '{"sub_questions":["x"],"angles":"none","queries":[]}', brief, "q", 3)).subQuestions).toEqual(["x"]);
  });

  test("the reply brief tells the writer to cover every part when parts are given, and the brief's items otherwise", () => {
    const analysis = { claims: [{ claim: "c", status: "established" as const, sources: [1] }], conflicts: [], gaps: [], guesses: [], uncovered: [] };
    const withItems: Brief = { ...brief, mustContain: ["m1"] };
    expect(replyBrief(withItems, analysis, "", null, { parts: ["p1", "p2"] })).toContain("covering p1; p2");
    expect(replyBrief(withItems, analysis, "", null)).toContain("covering m1");
  });
});

describe("the answer shape does not depend on the analysis", () => {
  const shapeBrief: Brief = { subject: "s", answerType: "an explanation", mustContain: ["m1"], ambiguous: false, options: [], question: "", assumption: "" };

  test("with no analysis the writer still gets the first-sentence rule, the parts, the shared-name line and the word target", () => {
    const text = replyBrief(shapeBrief, null, "", null, { parts: ["p1"], pinned: { title: "Alpha (1984 television series)", alternatives: ["Alpha (1983 miniseries)"] }, words: ANSWER_WORDS.max });
    expect(text).toContain("first sentence that names what the question is about");
    expect(text).toContain("covering p1");
    expect(text).toContain("name is shared");
    expect(text).toContain("Aim for about 450 words");
    expect(text).not.toContain("analysis");
    expect(text).toContain("Add no fact the notes and the article do not carry");
  });

  test("with an analysis the brief is the same as before the shape moved out of the analysed branch", () => {
    const analysis = { claims: [{ claim: "c", status: "established" as const, sources: [1] }], conflicts: [], gaps: [], guesses: [], uncovered: [] };
    const text = replyBrief(shapeBrief, analysis, "LEDGER", "I took this to mean x.", { parts: ["p1"], words: ANSWER_WORDS.max, pinned: { title: "Alpha", alternatives: ["Alpha B"] } });
    expect(text).toBe([
      `Begin with one plain sentence saying what you took the question to mean: "I took this to mean x."`,
      "Analysis of the notes (write the answer from it):",
      "established:\n- c [1]",
      `The subject's name is shared: besides "Alpha" there are "Alpha B". The notes and the article are about "Alpha". Say in the first sentence which one you took the question to mean (its name and year), and when the question's own details did not settle it, say so there and name the other.`,
      "Write the answer like this: the direct answer first, in a first sentence that names what the question is about in full (the subject by its proper name, with what identifies it, such as its year, place or version), covering p1. That first line is the identifying sentence itself, never a heading; then the established points with their [n]; then a section clearly labelled as your guesses, with the evidence behind each (only the guesses listed above, phrased freely: add no guess of your own, and name no person, company, place or title in it that the analysis or notes do not name); then what could not be found (only parts no source speaks to; a fact you stated above is never listed there). Add no fact the analysis and notes do not carry." + ` ${NAMES_FROM_SOURCES} ` + "Aim for about 450 words, and use more only if the question truly needs it.",
      "LEDGER",
    ].join("\n\n"));
  });

  test("the analysis stage asks the Stack for a timeout sized to its token budget, capped at 60 s", async () => {
    const { __setStackClientForTests, __resetStackEngineForTests } = await import("@/lib/stackEngine");
    const seen: Array<number | undefined> = [];
    __setStackClientForTests({
      chat: async (_req: unknown, opts?: { timeoutMs?: number }) => { seen.push(opts?.timeoutMs); return { data: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{}" } }] }, identity: { host: "local", build: "b", model: "m", healthy: null } }; },
    } as never);
    __setStageWritersForTests(undefined);
    try {
      const findings = { ledger: { text: "[1] note", notes: 1 } } as never;
      await analyse(null, "q", findings, new Set([1]), "max");
      await analyse(null, "q", findings, new Set([1]), "thinking");
    } finally {
      __resetStackEngineForTests();
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(stageTimeoutMs(320)).toBe(31_000);
    expect(stageTimeoutMs(5_000)).toBe(60_000);
    expect(seen[0]).toBe(stageTimeoutMs(ANALYSIS_TOKENS.max));
    expect(seen[1]).toBe(stageTimeoutMs(ANALYSIS_TOKENS.thinking));
  });
});
