import { describe, expect, test } from "bun:test";
import { cell, hashSplit, offeredSetMatch, renderReport, type HintRun } from "./composerHintScore";

const run = (over: Partial<HintRun>): HintRun => ({ rowId: "r1", group: "picture-request", rep: 1, arm: "off", calls: [], offered: 14, error: null, ...over });

describe("composer hint scorer", () => {
  test("rates are per row over repeats and the interval pairs the same rows", () => {
    const runs: HintRun[] = [];
    for (const id of ["a", "b", "c", "d"]) for (let rep = 1; rep <= 3; rep++) {
      runs.push(run({ rowId: id, rep, arm: "off", calls: rep === 1 ? ["generate_image"] : [] }));
      runs.push(run({ rowId: id, rep, arm: "on", calls: ["generate_image"] }));
    }
    const c = cell(runs, "picture", ["picture-request"]);
    expect(c.rows).toBe(4);
    expect(c.off).toBeCloseTo(1 / 3);
    expect(c.on).toBe(1);
    expect(c.interval!.diff).toBeCloseTo(2 / 3);
    expect(c.interval!.lo).toBeGreaterThan(0);
  });

  test("search means an evidence tool; any other counts the rest", () => {
    const runs = [run({ group: "timeless", calls: ["websearch"] }), run({ group: "timeless", arm: "on", calls: ["timer"] })];
    expect(cell(runs, "search", ["timeless"]).off).toBe(1);
    expect(cell(runs, "other", ["timeless"]).on).toBe(1);
    expect(cell(runs, "other", ["timeless"]).off).toBe(0);
  });

  test("an errored run is left out, and the offered count is compared", () => {
    const runs = [run({}), run({ arm: "on", offered: 14 }), run({ rowId: "r2", error: "x" }), run({ rowId: "r2", arm: "on" })];
    expect(offeredSetMatch(runs)).toEqual({ pairs: 1, same: 1 });
    expect(offeredSetMatch([run({}), run({ arm: "on", offered: 13 })])).toEqual({ pairs: 1, same: 0 });
  });

  test("the hash split is stable and roughly halves a set", () => {
    expect(hashSplit("fresh-ts-01")).toBe(hashSplit("fresh-ts-01"));
    const split = Array.from({ length: 90 }, (_, i) => hashSplit(`fresh-ts-${String(i).padStart(2, "0")}`));
    const held = split.filter((s) => s === "heldout").length;
    expect(held).toBeGreaterThan(25);
    expect(held).toBeLessThan(65);
  });

  test("the report names a row that moves", () => {
    const runs: HintRun[] = [];
    for (const id of ["a", "b", "c", "d", "e"]) for (let rep = 1; rep <= 3; rep++) {
      runs.push(run({ rowId: id, group: "plain", rep, arm: "off", calls: [] }));
      runs.push(run({ rowId: id, group: "plain", rep, arm: "on", calls: ["generate_image"] }));
    }
    expect(renderReport(runs)).toContain("picture tool called on a plain question: off 0.0%, on 100.0%");
    expect(renderReport(runs)).toContain("MOVES");
  });
});
