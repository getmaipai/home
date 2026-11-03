// RESEARCH-TIER-01: the eval's pass condition. A made-up show and a made-up person stand in for the real case file.
// The credit check is a judge call; these tests drive it with a fake judge that answers from the prompt it is given.
import { describe, expect, test } from "bun:test";
import { creditPrompt, namesPerson, identificationPrompt, judgeCredits, judgeFabrication, judgeIdentification, judgeResearch, judgeResearchAnswer, type Judge, type ResearchCase } from "../scripts/bench/researchEval";
import real from "../scripts/bench/research-cases/v-series.json";

const CASE: ResearchCase = {
  id: "orbit-series",
  utterance: "the weekly show Orbit Station only had one season, what would have happened",
  production: "Orbit Station, the one-season weekly series of 1990 (not the earlier miniseries)",
  identifiers: ["1990", "weekly", "Orbit Station"],
  minIdentifiers: 2,
  topics: [
    { name: "why it ended", anyOf: ["cancel"] },
    { name: "what its makers planned", anyOf: ["second season"] },
    { name: "follow-ups", anyOf: ["novel"] },
  ],
  minSites: 3,
  watchedPeople: [{ name: "Alex Doe" }],
};
const sources = [{ url: "https://a.example/x" }, { url: "https://www.b.example/y" }, { url: "https://c.example/z", site: "c.example" }];
const EVIDENCE = "Alex Doe wrote the novel Orbit Station: Second Wave in 1995. The weekly show was run by Sam Roe. Alex Doe made the earlier miniseries.";
const GOOD = "Orbit Station, the weekly series of 1990, was cancelled after low ratings. Its writers planned a second season [1]. A novel followed [2]. Alex Doe wrote the sequel novel [3].";

/** A judge that reads only the prompt: it says "credit" for a sentence that puts the person in the weekly show, "other_work" for the novel or the miniseries. */
const judge: Judge = async (prompt) => {
  if (prompt.includes("about_this_work")) return JSON.stringify({ about_this_work: !/the earlier miniseries was/i.test(prompt) });
  const sentence = prompt.match(/Sentence: "([^"]*)"/)?.[1] ?? "";
  const evidence = prompt.match(/"""\n([\s\S]*?)\n"""/)?.[1] ?? "";
  const novel = /novel|miniseries/i.test(sentence);
  const kind = novel ? "other_work" : /show|series|executive producer|created|wrote|produced/i.test(sentence) ? "credit" : "context";
  const supported = kind === "credit" ? evidence.includes("Alex Doe ran the weekly show") : /novel/i.test(sentence) ? evidence.includes("Alex Doe wrote the novel") : true;
  return JSON.stringify({ kind, supported });
};

describe("the research eval", () => {
  test("an answer that covers every part from three sites passes, and a sourced sentence about another work is not a credit claim", async () => {
    const verdict = await judgeResearch(CASE, { answer: GOOD, sources, queries: [], evidence: EVIDENCE }, judge);
    expect(verdict.pass).toBe(true);
    expect(verdict.classified).toEqual([{ person: "Alex Doe", sentence: "Alex Doe wrote the sequel novel [3].", kind: "other_work", supported: true }]);
  });
  test("crediting the person with the weekly show, with no passage saying so, fails", async () => {
    const wrong = `${GOOD} The show was created by Alex Doe [1].`;
    const verdict = await judgeResearch(CASE, { answer: wrong, sources, queries: [], evidence: EVIDENCE }, judge);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.some((f) => f.startsWith("unsupported credit: Alex Doe"))).toBe(true);
  });
  test("placing the person in the show's production (demoted from executive producer) with no passage for it fails", async () => {
    const wrong = `${GOOD} Alex Doe clashed with the network and was demoted from executive producer toward the end.`;
    const verdict = await judgeResearch(CASE, { answer: wrong, sources, queries: [], evidence: EVIDENCE }, judge);
    expect(verdict.pass).toBe(false);
  });
  test("a credit claim that a fetched passage supports does not fail", async () => {
    const answer = `${GOOD} Alex Doe ran the weekly show with Sam Roe [1].`;
    const verdict = await judgeCredits(CASE, { answer, sources, queries: [], evidence: `${EVIDENCE} Alex Doe ran the weekly show.` }, judge);
    expect(verdict.failures).toEqual([]);
  });
  test("an unreadable judge answer fails closed", async () => {
    const verdict = await judgeCredits(CASE, { answer: "Alex Doe made it [1].", sources, queries: [], evidence: EVIDENCE }, async () => "I cannot tell");
    expect(verdict.failures.length).toBe(1);
  });
  test("the judge is told the exact production and the passages", () => {
    const prompt = creditPrompt(CASE, "Alex Doe", "Alex Doe made it.", "a passage");
    expect(prompt).toContain(CASE.production);
    expect(prompt).toContain("a passage");
  });
  test("identification: an opening without two of the case's identifiers fails, and a judge that says it is another work fails", async () => {
    const vague = await judgeIdentification(CASE, { answer: "The show was cancelled after one season.\n\nMore detail follows.", sources, queries: [] }, judge);
    expect(vague).toEqual(["the opening does not identify the work (0 of 2 identifiers)"]);
    const other = await judgeIdentification(CASE, { answer: "Orbit Station, the weekly series of 1990. The earlier miniseries was the real subject here.", sources, queries: [] }, judge);
    expect(other).toEqual(["the answer is not about the work asked about"]);
    expect(await judgeIdentification(CASE, { answer: GOOD, sources, queries: [] }, judge)).toEqual([]);
    expect(identificationPrompt(CASE, "opening")).toContain(CASE.production);
  });

  test("fabrication: a name no passage, query or question gives fails; names in the evidence or the question pass", () => {
    const run = { answer: `${GOOD} A producer named Victor Hale left. Sam Roe ran it.`, sources, queries: [], evidence: EVIDENCE };
    const failures = judgeFabrication(CASE, run);
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("Victor Hale");
    expect(failures[0]).not.toContain("Sam Roe");
    expect(judgeFabrication(CASE, { answer: GOOD, sources, queries: [], evidence: EVIDENCE })).toEqual([]);
  });

  test("fabrication: a marked sentence naming an ungiven name still fails; a name split by St. does not", () => {
    const marked = judgeFabrication(CASE, { answer: `${GOOD} Victor Hale left the show (not in the sources).`, sources, queries: [], evidence: EVIDENCE });
    expect(marked.length).toBe(1);
    expect(marked[0]).toContain("Victor Hale");
    const st = judgeFabrication(CASE, { answer: GOOD, sources, queries: [], evidence: `${EVIDENCE} Filmed at St. Jude Hall.` });
    expect(st).toEqual([]);
    expect(judgeFabrication(CASE, { answer: `${GOOD} It was filmed at St. Jude Hall.`, sources, queries: [], evidence: `${EVIDENCE} Filmed at St. Jude Hall.` })).toEqual([]);
  });

  test("fabrication: the bench uses the production matcher, so an ordinary first word seen in lower case does not fail a real name", () => {
    const evidence = `${EVIDENCE} Nathan Bates was a story editor. The credit was given to him.`;
    const ok = judgeFabrication(CASE, { answer: `${GOOD} Given Nathan Bates edited it.`, sources, queries: [], evidence });
    expect(ok).toEqual([]);
    const bad = judgeFabrication(CASE, { answer: `${GOOD} Given Victor Hale edited it.`, sources, queries: [], evidence });
    expect(bad.length).toBe(1);
    const marked = judgeFabrication(CASE, { answer: `${GOOD} Victor Hale edited it (not in the sources).`, sources, queries: [], evidence });
    expect(marked.length).toBe(1);
  });

  test("a wrong-subject answer fails the whole verdict even when it mentions every topic word", async () => {
    const wrong = "The earlier miniseries was cancelled; a second season was planned; a novel followed [1][2][3].";
    const verdict = await judgeResearch(CASE, { answer: wrong, sources, queries: [], evidence: EVIDENCE }, judge);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures[0]).toContain("does not identify");
  });

  test("the verdict records the pages read and the light-model seconds of the run", async () => {
    const verdict = await judgeResearch(CASE, { answer: GOOD, sources, queries: [], evidence: EVIDENCE, pagesRead: 9, lightModelSeconds: 21.5 }, judge);
    expect(verdict.pagesRead).toBe(9);
    expect(verdict.lightModelSeconds).toBe(21.5);
  });

  test("a watched person is named by their full name or by their family name alone", () => {
    expect(namesPerson("Alex Doe left.", "Alex Doe")).toBe(true);
    expect(namesPerson("Doe was demoted from executive producer.", "Alex Doe")).toBe(false);
    expect(namesPerson("Tolliver was demoted from executive producer.", "Rae Tolliver")).toBe(true);
    expect(namesPerson("Tolliverson left.", "Rae Tolliver")).toBe(false);
  });

  test("the credit prompt treats an offer to look something up, a remark about taste and another of their works as not a credit claim", () => {
    const prompt = creditPrompt(CASE, "Alex Doe", "I can dig for Alex Doe interviews.", "a passage");
    expect(prompt).toContain("an offer to look something up");
    expect(prompt).toContain("other works");
  });

  test("a missing part and too few sites fail with their reasons", () => {
    const verdict = judgeResearchAnswer(CASE, { answer: "It was cancelled. A novel followed.", sources: sources.slice(0, 1), queries: [] });
    expect(verdict.failures).toEqual(["missing topic: what its makers planned", "only 1 distinct sites, need 3"]);
  });
  test("the real case file is complete", () => {
    expect(real.topics.length).toBeGreaterThanOrEqual(4);
    expect(real.minSites).toBe(3);
    expect(real.watchedPeople.length).toBeGreaterThan(0);
    expect(real.production.length).toBeGreaterThan(20);
    expect(real.identifiers.length).toBeGreaterThanOrEqual(3);
  });
});
