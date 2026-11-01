// RESEARCH-TIER-01: the eval's pass condition. A made-up show and a made-up person stand in for the real case file.
// The credit check is a judge call; these tests drive it with a fake judge that answers from the prompt it is given.
import { describe, expect, test } from "bun:test";
import { creditPrompt, judgeCredits, judgeResearch, judgeResearchAnswer, type Judge, type ResearchCase } from "../scripts/bench/researchEval";
import real from "../scripts/bench/research-cases/v-series.json";

const CASE: ResearchCase = {
  id: "orbit-series",
  utterance: "the weekly show Orbit Station only had one season, what would have happened",
  production: "Orbit Station, the one-season weekly series of 1990 (not the earlier miniseries)",
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
const GOOD = "It was cancelled after low ratings. Its writers planned a second season [1]. A novel followed [2]. Alex Doe wrote the sequel novel [3].";

/** A judge that reads only the prompt: it says "credit" for a sentence that puts the person in the weekly show, "other_work" for the novel or the miniseries. */
const judge: Judge = async (prompt) => {
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
  test("a missing part and too few sites fail with their reasons", () => {
    const verdict = judgeResearchAnswer(CASE, { answer: "It was cancelled. A novel followed.", sources: sources.slice(0, 1), queries: [] });
    expect(verdict.failures).toEqual(["missing topic: what its makers planned", "only 1 distinct sites, need 3"]);
  });
  test("the real case file is complete", () => {
    expect(real.topics.length).toBeGreaterThanOrEqual(4);
    expect(real.minSites).toBe(3);
    expect(real.watchedPeople.length).toBeGreaterThan(0);
    expect(real.production.length).toBeGreaterThan(20);
  });
});
