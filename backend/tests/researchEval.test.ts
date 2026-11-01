// RESEARCH-TIER-01: the eval's pass condition. A made-up show and a made-up person stand in for the real case file.
import { describe, expect, test } from "bun:test";
import { judgeResearchAnswer, type ResearchCase } from "../scripts/bench/researchEval";
import real from "../scripts/bench/research-cases/v-series.json";

const CASE: ResearchCase = {
  id: "orbit-series",
  utterance: "the weekly show Orbit Station only had one season, what would have happened",
  topics: [
    { name: "why it ended", anyOf: ["cancel"] },
    { name: "what its makers planned", anyOf: ["second season"] },
    { name: "follow-ups", anyOf: ["novel"] },
  ],
  minSites: 3,
  wrongAttributions: [{ name: "Alex Doe" }],
};
const sources = [{ url: "https://a.example/x" }, { url: "https://www.b.example/y" }, { url: "https://c.example/z", site: "c.example" }];
const GOOD = "It was cancelled after low ratings. Its writers planned a second season [1]. A novel followed [2]. Alex Doe made the earlier miniseries but did not write the weekly show [3].";

describe("the research eval", () => {
  test("an answer that covers every part from three sites and credits the right people passes", () => {
    expect(judgeResearchAnswer(CASE, { answer: GOOD, sources, queries: [] })).toEqual({ pass: true, failures: [], sites: 3 });
  });
  test("crediting the wrong person fails", () => {
    const wrong = "It was cancelled. Its makers planned a second season. A novel followed. The show was created by Alex Doe [1].";
    const verdict = judgeResearchAnswer(CASE, { answer: wrong, sources, queries: [] });
    expect(verdict.pass).toBe(false);
    expect(verdict.failures).toContain("wrong attribution: Alex Doe");
  });
  test("a missing part and too few sites fail with their reasons", () => {
    const verdict = judgeResearchAnswer(CASE, { answer: "It was cancelled. A novel followed.", sources: sources.slice(0, 1), queries: [] });
    expect(verdict.failures).toEqual(["missing topic: what its makers planned", "only 1 distinct sites, need 3"]);
  });
  test("the real case file is complete", () => {
    expect(real.topics.length).toBeGreaterThanOrEqual(4);
    expect(real.minSites).toBe(3);
    expect(real.wrongAttributions.length).toBeGreaterThan(0);
  });
});
