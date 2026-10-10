import { describe, expect, test } from "bun:test";
import ks1 from "./datasets/ks-bench-01.json";
import ks2 from "./datasets/ks-bench-02.json";

const count = <T>(items: T[], pick: (item: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[pick(item)] = (out[pick(item)] ?? 0) + 1;
  return out;
};

describe("KS-BENCH-01 corpus", () => {
  test("has 90 adult, 20 child and 10 spoken rows with the design's category split", () => {
    expect(count(ks1.rows, (r) => r.band)).toEqual({ adult: 90, child: 20, spoken: 10 });
    const adult = ks1.rows.filter((r) => r.band === "adult");
    expect(count(adult, (r) => r.category)).toEqual({ stable: 30, recency: 30, no_tool: 30 });
  });
  test("fixes 25 held-out rows and keeps ids and prompts unique", () => {
    expect(ks1.rows.filter((r) => r.heldOut)).toHaveLength(25);
    expect(new Set(ks1.rows.map((r) => r.id)).size).toBe(120);
    expect(new Set(ks1.rows.map((r) => r.prompt)).size).toBe(120);
  });
  test("every category names the call shapes it accepts and forbids", () => {
    for (const row of ks1.rows) expect(Object.keys(ks1.arms)).toContain(row.category);
  });
});

describe("KS-BENCH-02 queries", () => {
  test("has 100 queries, 20 of each kind, with 25 held out (5 per kind)", () => {
    expect(ks2.queries).toHaveLength(100);
    expect(count(ks2.queries, (q) => q.kind)).toEqual({ exact: 20, misspelled: 20, ambiguous: 20, topic: 20, longtail: 20 });
    expect(ks2.queries.filter((q) => q.heldOut)).toHaveLength(25);
    expect(count(ks2.queries.filter((q) => q.heldOut), (q) => q.kind)).toEqual({ exact: 5, misspelled: 5, ambiguous: 5, topic: 5, longtail: 5 });
    expect(new Set(ks2.queries.map((q) => q.id)).size).toBe(100);
  });
  test("every ambiguous query expects a disambiguation and no other kind does", () => {
    for (const q of ks2.queries) {
      expect("expectDisambiguation" in q).toBe(q.kind === "ambiguous");
    }
  });
});
