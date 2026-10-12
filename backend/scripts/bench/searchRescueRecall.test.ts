import { describe, expect, test } from "bun:test";
import { pairedBootstrap, rescueReport, rowRates, type RescueRun } from "./searchRescueRecall";

const base: Pick<RescueRun, "band" | "heldOut" | "followUp" | "error" | "laterCalls" | "shapes" | "pass" | "forbidden"> = { band: "adult", heldOut: false, followUp: false, error: null, laterCalls: [], shapes: [], pass: null, forbidden: null };
const run = (arm: string, row: string, category: string, over: Partial<RescueRun>): RescueRun => ({ ...base, arm, row, category, firstRound: { calls: [] }, fixtureQueries: 0, searches: 0, ...over });
const modelSearch = [{ name: "websearch", arguments: "{}" }];

describe("search rescue recall report (ROUTER-BUILD-01i)", () => {
  // Two recency rows, two reps each. Plain: row a searched once of two, row b never.
  // Rescue: row a searched by the model once and rescued once, row b rescued twice.
  const runs: RescueRun[] = [
    run("plain", "a", "recency", { firstRound: { calls: modelSearch }, searches: 1, fixtureQueries: 1 }),
    run("plain", "a", "recency", {}),
    run("plain", "b", "recency", {}),
    run("plain", "b", "recency", {}),
    run("assist_rescue", "a", "recency", { firstRound: { calls: modelSearch }, searches: 1, fixtureQueries: 1 }),
    run("assist_rescue", "a", "recency", { fixtureQueries: 1 }),
    run("assist_rescue", "b", "recency", { fixtureQueries: 1 }),
    run("assist_rescue", "b", "recency", { fixtureQueries: 1 }),
    run("plain", "s", "stable", {}),
    run("assist_rescue", "s", "stable", { fixtureQueries: 1 }),
    run("plain", "n", "no_tool", {}),
    run("assist_rescue", "n", "no_tool", {}),
  ];

  test("rescued turns count as searches in recall and in the false-search rates", () => {
    const r = rescueReport(runs);
    expect(r.recall!.plain.mean).toBe(0.25);
    expect(r.recall!.rescue.mean).toBe(1);
    expect(r.recall!.diff.mean).toBe(0.75);
    expect(r.falseSearch.stable).toEqual({ plain: 0, rescue: 1 });
    expect(r.falseSearch.no_tool).toEqual({ plain: 0, rescue: 0 });
    expect(r.rescued).toEqual({ recency: 3, stable: 1 });
    expect(r.floorMet).toBe(true); // every row searched on every repeat, so the interval collapses to 1
  });
  test("a row rate is the share of its repeats that searched", () => {
    expect([...rowRates(runs.filter((x) => x.arm === "plain" && x.category === "recency"))]).toEqual([["a", 0.5], ["b", 0]]);
  });
  test("the bootstrap is repeatable and needs two rows", () => {
    const rates = new Map([["a", 1], ["b", 0], ["c", 1]]);
    expect(pairedBootstrap(rates, null)).toEqual(pairedBootstrap(rates, null));
    expect(pairedBootstrap(new Map([["a", 1]]), null)).toBeNull();
  });
});
