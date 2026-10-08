import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clusterRate, comparePaired, exactMcNemar, exactSignTest, guardHeldout, hashValue, iccAcrossParaphrases, iccAcrossRepeats, pairedFamilyBootstrap, perItemMeans, wilson } from "../scripts/bench/routeStats";
import { simulateRouteStats } from "../scripts/bench/routeStatsSim";

describe("SEARCH-FRESH-01 route statistics", () => {
  test("Wilson interval matches the standard 5/10 result", () => {
    const got = wilson(5, 10); expect(got.estimate).toBe(0.5); expect(got.low).toBeCloseTo(0.2366, 3); expect(got.high).toBeCloseTo(0.7634, 3);
  });
  test("exact McNemar and sign tests use two-sided exact binomial tails", () => {
    expect(exactMcNemar(5, 0)).toBeCloseTo(0.0625, 10); expect(exactMcNemar(4, 1)).toBeCloseTo(0.375, 10); expect(exactMcNemar(0, 0)).toBe(1);
    expect(exactSignTest([1, 1, 0, -1])).toEqual({ positive: 2, negative: 1, ties: 1, p: 1 });
  });
  test("per-item means and family pairing retain all repeats with deterministic bounds", () => {
    const a = [
      { id: "a1", family: "f1", rep: 1, evidence: false }, { id: "a1", family: "f1", rep: 2, evidence: false },
      { id: "a2", family: "f1", rep: 1, evidence: false }, { id: "a2", family: "f1", rep: 2, evidence: false },
      { id: "b1", family: "f2", rep: 1, evidence: true }, { id: "b1", family: "f2", rep: 2, evidence: true },
    ];
    const b = a.map((r) => ({ ...r, evidence: r.family === "f1" ? true : r.evidence }));
    expect(perItemMeans(a).get("a1")).toEqual({ family: "f1", mean: 0, n: 2 });
    expect(pairedFamilyBootstrap(a, b, 1000, 17)).toEqual({ estimate: 2/3, low: 0, high: 1 });
    const bca = pairedFamilyBootstrap(a, b, 1000, 17, "bca");
    expect(bca.estimate).toBeCloseTo(2/3); expect(bca.low).toBeLessThanOrEqual(bca.high);
    const result = comparePaired(a, b, 1000, 17);
    expect(result.difference).toBeCloseTo(2/3); expect(result.discordant).toEqual({ aOnly: 0, bOnly: 2 });
    expect(result.mcnemarP).toBe(0.5); expect(result.signP).toBe(1);
  });
  test("single arm cluster interval reports effective n and conservative Wilson bound", () => {
    const rows = [
      { id: "a", rep: 1, evidence: true }, { id: "a", rep: 2, evidence: false },
      { id: "b", rep: 1, evidence: true }, { id: "b", rep: 2, evidence: true },
      { id: "c", rep: 1, evidence: false }, { id: "c", rep: 2, evidence: false },
    ];
    const got = clusterRate(rows, 1000, 5);
    expect(got.estimate).toBeCloseTo(0.5); expect(got.n_eff).toBeCloseTo(4.6698754855688955, 8); expect(got.low).toBe(0); expect(got.high).toBe(1);
    expect(Math.min(got.wilson.low, got.low)).toBe(0);
  });
  test("ICC reports repeat and paraphrase grouping", () => {
    const rows = [
      { id: "a1", family: "f1", rep: 1, evidence: true }, { id: "a1", family: "f1", rep: 2, evidence: true },
      { id: "a2", family: "f1", rep: 1, evidence: true }, { id: "a2", family: "f1", rep: 2, evidence: false },
      { id: "b1", family: "f2", rep: 1, evidence: false }, { id: "b1", family: "f2", rep: 2, evidence: false },
      { id: "b2", family: "f2", rep: 1, evidence: false }, { id: "b2", family: "f2", rep: 2, evidence: true },
    ];
    expect(iccAcrossRepeats(rows)).toBeCloseTo(1/7, 8); expect(iccAcrossParaphrases(rows)).toBeCloseTo(0.2, 8);
  });
  test("held-out scoring requires a matching, unburned plan and appends a ledger entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "route-heldout-"));
    try {
      const planPath = join(dir, "plan.json"), ledgerPath = join(dir, "ledger.json");
      const plan = { splitHash: "split-1", configurations: [{ hash: "config-1" }] };
      writeFileSync(planPath, JSON.stringify(plan));
      expect(() => guardHeldout({ split: "heldout", configurationHash: "config-1", splitHash: "split-1" })).toThrow("requires --plan");
      expect(() => guardHeldout({ split: "heldout", planFile: planPath, configurationHash: "config-2", splitHash: "split-1", ledgerFile: ledgerPath })).toThrow("not frozen");
      expect(() => guardHeldout({ split: "heldout", planFile: planPath, configurationHash: "config-1", splitHash: "other", ledgerFile: ledgerPath })).toThrow("hash mismatch");
      guardHeldout({ split: "heldout", planFile: planPath, configurationHash: "config-1", splitHash: "split-1", ledgerFile: ledgerPath, now: "fixed-time" });
      expect(JSON.parse(readFileSync(ledgerPath, "utf8")).entries[0]).toMatchObject({ planHash: hashValue(JSON.stringify(plan)), configurationHash: "config-1", splitHash: "split-1" });
      expect(() => guardHeldout({ split: "heldout", planFile: planPath, configurationHash: "config-1", splitHash: "split-1", ledgerFile: ledgerPath })).toThrow("already has a held-out ledger entry");
      writeFileSync(planPath, JSON.stringify({ ...plan, burnedSplitHashes: ["split-1"] }));
      expect(() => guardHeldout({ split: "heldout", planFile: planPath, configurationHash: "config-1", splitHash: "split-1", ledgerFile: ledgerPath })).toThrow("marked burned");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("seeded fast simulation validates 90% percentile-bound coverage through rho_f 0.2", () => {
    const cells = simulateRouteStats({ datasets: 200, bootstrapDraws: 500, seed: 0xe058, rates: [0.9], rhoFs: [0,0.1,0.2], differences: [0], rhoR: 0.1 });
    expect(cells).toHaveLength(3);
    for (const cell of cells) expect(cell.coverage).toBeGreaterThanOrEqual(0.93);
    for (const cell of cells) expect(cell.coverage).toBeLessThanOrEqual(0.97);
  });
});
