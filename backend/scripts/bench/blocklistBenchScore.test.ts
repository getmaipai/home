import { describe, expect, test } from "bun:test";
import {
  drugsTeenDecision, makeMatcher, meanHits, passBars, rowsDroppedPerSearch, scoreArm, splitOf, strictAloneRecall,
  unionDecision, unionMatcher, validateDataset, type ArmScore, type BenchDataset,
} from "./blocklistBenchScore";

const hosts = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}.example.com`);

function dataset(pos: number, neg: number): BenchDataset {
  return {
    version: 1,
    positives: hosts("p", pos).map((host, i) => ({ host, strict_surfaced: i % 2 === 0 })),
    negatives: hosts("n", neg).map((host, i) => ({ host, topic: i % 3 === 0 ? "health" : "news" })),
  };
}

describe("bench split", () => {
  test("a host always lands in the same split and both splits are used", () => {
    const all = hosts("h", 500);
    expect(all.map(splitOf)).toEqual(all.map(splitOf));
    const dev = all.filter((h) => splitOf(h) === "dev").length;
    expect(dev).toBeGreaterThan(120);
    expect(dev).toBeLessThan(280);
  });
});

describe("dataset check", () => {
  test("a full-size clean dataset passes", () => {
    expect(validateDataset(dataset(400, 1500)).errors).toEqual([]);
  });
  test("a short sample is an error, and only a warning for a dry run", () => {
    expect(validateDataset(dataset(10, 10)).errors.length).toBe(2);
    const dry = validateDataset(dataset(10, 10), { allowShort: true });
    expect(dry.errors).toEqual([]);
    expect(dry.warnings.length).toBe(2);
  });
  test("a host in both lists, a bad name and a missing strict flag are each named", () => {
    const d = dataset(1, 1);
    d.negatives.push({ host: d.positives[0]!.host });
    d.negatives.push({ host: "Not A Host" });
    (d.positives[0] as { strict_surfaced?: boolean }).strict_surfaced = undefined;
    const errors = validateDataset(d, { allowShort: true }).errors.join("\n");
    expect(errors).toContain("already in positives");
    expect(errors).toContain("is not a host name");
    expect(errors).toContain("strict_surfaced");
  });
  test("a non-dataset value gets one plain error", () => {
    expect(validateDataset({}).errors.length).toBe(1);
  });
});

describe("matchers", () => {
  const listed = new Set(["bad.example"]);
  test("suffix matches a subdomain, exact does not", () => {
    expect(makeMatcher(listed, "suffix")("www.bad.example")).toBe(true);
    expect(makeMatcher(listed, "exact")("www.bad.example")).toBe(false);
    expect(makeMatcher(listed, "exact")("bad.example")).toBe(true);
  });
  test("a union blocks when either does", () => {
    const u = unionMatcher([makeMatcher(new Set(["a.example"]), "exact"), makeMatcher(new Set(["b.example"]), "exact")]);
    expect(u("a.example")).toBe(true);
    expect(u("b.example")).toBe(true);
    expect(u("c.example")).toBe(false);
  });
});

describe("scoring", () => {
  const d = dataset(100, 300);
  const hit = new Map<string, number>();
  for (const p of d.positives) hit.set(p.host, 1);
  for (const n of d.negatives) hit.set(n.host, 0);
  test("full recall and no false positives on held-out", () => {
    const s = scoreArm("x", "heldout", d, hit);
    expect(s.recall.hits).toBe(s.recall.n);
    expect(s.falsePositive.hits).toBe(0);
    expect(s.rescued.hits).toBe(s.rescued.n);
  });
  test("strict alone catches exactly the positives strict did not surface", () => {
    const r = strictAloneRecall(d, "heldout");
    const expected = d.positives.filter((p) => splitOf(p.host) === "heldout" && !p.strict_surfaced).length;
    expect(r.hits).toBe(expected);
  });
  test("a per-pin average is the share of pins that blocked", () => {
    const m = meanHits([new Map([["a.example", 1]]), new Map([["a.example", 0]])]);
    expect(m.get("a.example")).toBe(0.5);
  });
});

describe("rows dropped replay", () => {
  test("counts removed hosts per recorded search", () => {
    const r = rowsDroppedPerSearch(
      [{ query: "q1", hosts: ["a.example", "b.example"] }, { query: "q2", hosts: ["b.example"] }],
      makeMatcher(new Set(["a.example"]), "exact"),
    );
    expect(r).toEqual({ searches: 2, meanDropped: 0.5, searchesWithDrop: 1 });
  });
});

function arm(id: string, hits: number, n: number, fpHits: number, fpN: number, hh = 0, hn = 0): ArmScore {
  const w = (v: number, t: number) => (t === 0 ? null : { n: t, violations: v, lowPct: Math.round(1000 * (v / t - 0.02)) / 10, highPct: Math.round(1000 * (v / t + 0.005)) / 10 });
  return { arm: id, split: "heldout", recall: { n, hits, ci: w(hits, n) }, falsePositive: { n: fpN, hits: fpHits, ci: w(fpHits, fpN) }, healthFalsePositive: { n: hn, hits: hh, ci: w(hh, hn) }, rescued: { n: 0, hits: 0, ci: null } };
}

describe("pass bars and decisions", () => {
  test("blp-porn passes when its lower bound clears strict alone and the false-positive bar holds", () => {
    const scores = new Map([["blp-porn", arm("blp-porn", 90, 100, 0, 800)]]);
    const strict = { n: 100, hits: 50, ci: { n: 100, violations: 50, lowPct: 40, highPct: 60 } };
    const bars = passBars(scores, strict, ["blp-porn"]);
    expect(bars.every((b) => b.pass === true)).toBe(true);
  });
  test("missing evidence is null, never a pass", () => {
    const bars = passBars(new Map(), { n: 0, hits: 0, ci: null }, ["blp-porn"]);
    expect(bars.every((b) => b.pass === null)).toBe(true);
  });
  test("drugs for teens stays off with no health negatives or a high false-positive bound", () => {
    expect(drugsTeenDecision(undefined).recommendation).toBe("stay off");
    expect(drugsTeenDecision(arm("blp-drugs", 0, 0, 0, 0, 0, 0)).recommendation).toBe("stay off");
    expect(drugsTeenDecision(arm("blp-drugs", 0, 0, 0, 0, 5, 100)).recommendation).toBe("stay off");
    expect(drugsTeenDecision(arm("blp-drugs", 0, 0, 0, 0, 0, 400)).recommendation).toBe("turn on");
  });
  test("the union is adopted only with a positive paired lower bound and a safe false-positive bound", () => {
    const gain = { n: 100, meanDiffPct: 5, lowPct: 1, highPct: 9 };
    expect(unionDecision(gain, arm("u", 0, 0, 0, 800)).recommendation).toBe("adopt the union");
    expect(unionDecision({ ...gain, lowPct: -1 }, arm("u", 0, 0, 0, 800)).recommendation).toBe("keep blp-porn alone");
    expect(unionDecision(gain, arm("u", 0, 0, 20, 800)).recommendation).toBe("keep blp-porn alone");
    expect(unionDecision(null, undefined).recommendation).toBe("keep blp-porn alone");
  });
});
