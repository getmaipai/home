// SEARCH-SOURCES-01: the one reciprocal-rank-fusion function that episode recall
// and the web-source blend share.
import { describe, expect, test } from "bun:test";
import { RRF_K, reciprocalRankFusion } from "@/lib/retrieval/rrf";

const id = (x: string) => x;

describe("reciprocalRankFusion", () => {
  test("k is 60 and a single list keeps its order with score 1/(60+rank+1)", () => {
    expect(RRF_K).toBe(60);
    const out = reciprocalRankFusion([["a", "b", "c"]], id);
    expect(out.map((e) => e.item)).toEqual(["a", "b", "c"]);
    expect(out[0]!.score).toBeCloseTo(1 / 61, 12);
    expect(out[2]!.score).toBeCloseTo(1 / 63, 12);
  });

  test("an item two lists return sums its scores and outranks single-list items", () => {
    const out = reciprocalRankFusion([["a", "shared"], ["b", "shared"]], id);
    expect(out[0]!.item).toBe("shared");
    expect(out[0]!.score).toBeCloseTo(2 / 62, 12);
    expect(out.map((e) => e.item)).toEqual(["shared", "a", "b"]);
  });

  test("a tie keeps first appearance: list order, then rank", () => {
    const out = reciprocalRankFusion([["a1", "a2"], ["b1", "b2"]], id);
    expect(out.map((e) => e.item)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  test("keyed items fuse by key; item is the first occurrence and last the latest", () => {
    const out = reciprocalRankFusion([[{ k: "x", from: 1 }], [{ k: "x", from: 2 }]], (r) => r.k);
    expect(out).toHaveLength(1);
    expect(out[0]!.item.from).toBe(1);
    expect(out[0]!.last.from).toBe(2);
  });

  test("an empty input fuses to nothing", () => {
    expect(reciprocalRankFusion([], id)).toEqual([]);
    expect(reciprocalRankFusion([[], []], id)).toEqual([]);
  });
});
