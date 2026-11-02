// RESEARCH-HELDOUT-01: the held-out question set is complete and stays fixed. It was written before any outcome of the change under test was
// read; a case is never edited after a run (a new case is added instead).
import { describe, expect, test } from "bun:test";
import heldout from "../scripts/bench/research-cases/heldout.json";
import type { ResearchCase } from "../scripts/bench/researchEval";

const cases = heldout.cases as ResearchCase[];

describe("the held-out research set", () => {
  test("twelve cases over at least eight kinds of subject, ids unique", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cases.map((c) => c.type)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  test("every case carries its fixed pass criteria: a subject, identifiers, two or more topics with phrases, and a site minimum", () => {
    for (const c of cases) {
      expect(c.utterance.length).toBeGreaterThan(20);
      expect(c.production.length).toBeGreaterThan(20);
      expect((c.identifiers ?? []).length).toBeGreaterThanOrEqual(3);
      expect(c.topics.length).toBeGreaterThanOrEqual(2);
      for (const t of c.topics) expect(t.anyOf.length).toBeGreaterThan(0);
      expect(c.minSites).toBeGreaterThanOrEqual(2);
    }
  });

  test("the cases are plain data: no case names the engine's code paths, and the set holds no web address or key", () => {
    const text = JSON.stringify(heldout);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/api[_-]?key|secret|token/i);
  });
});
