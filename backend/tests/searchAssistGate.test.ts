// ROUTER-BUILD-01f: the offline gate for the search assist head. Frozen embedding vectors for a
// held-out set are scored with the manifest through the shipped scorer, and the recall and
// false-search rates must hold at the floor. Offline, deterministic, no network.
//
// Until the signed weights release exists the manifest is the fixture head and the rows are a
// 2-dimensional stand-in set, so the rates below prove the gate arithmetic and wiring, not model
// quality. WHEN THE RELEASE LANDS: add the real frozen held-out vectors (768 dims) and the shipped
// manifest as a second GATE_SETS entry with RAW-01's floors (raw concat, tuned 0.67, held-out:
// recall 0.91, stable 0, no_tool 0, follow-ups 0; tolerance 0.02 on a 120-row set), see
// data-scratch/chat-ab/router-raw-01/REPORT.md.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { floorMisses, gateRates, readBenchManifest, type GateFloors, type GateRow } from "../scripts/bench/searchAssistGate";
import { parseSearchAssistManifest, type SearchAssistManifest } from "@/lib/searchAssist/weights";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../src/lib/searchAssist/__fixtures__/${name}`, import.meta.url), "utf8"));
const fixtureManifest = parseSearchAssistManifest(read("weights.json"));
const fixtureRows = (read("gate-rows.json") as { rows: GateRow[] }).rows;

interface GateSet {
  name: string;
  manifest: SearchAssistManifest;
  rows: GateRow[];
  floors: GateFloors;
  tolerance: number;
}

const GATE_SETS: GateSet[] = [
  {
    name: "fixture head on the stand-in rows",
    manifest: fixtureManifest,
    rows: fixtureRows,
    // Recorded from the frozen rows: 8 of 10 recency rows searched, 1 of 10 no_tool rows falsely searched.
    floors: { recallMin: 0.8, falseSearchStableMax: 0, falseSearchNoToolMax: 0.1, falseSearchFollowUpMax: 0 },
    tolerance: 0,
  },
];

describe("search assist gate", () => {
  for (const set of GATE_SETS) {
    test(`${set.name}: rates hold at the floor`, () => {
      const rates = gateRates(set.rows, set.manifest);
      expect(floorMisses(rates, set.floors, set.tolerance)).toEqual([]);
    });
  }

  test("the stand-in rates are exactly the recorded numbers", () => {
    const rates = gateRates(fixtureRows, fixtureManifest);
    expect(rates.n).toBe(26);
    expect(rates.recall).toBeCloseTo(0.8, 10);
    expect(rates.falseSearchStable).toBe(0);
    expect(rates.falseSearchNoTool).toBeCloseTo(0.1, 10);
    expect(rates.falseSearchFollowUp).toBe(0);
  });

  test("a head that drops a recency row fails the recall floor and says so", () => {
    const weaker: SearchAssistManifest = { ...fixtureManifest, thresholds: { websearch: { class: "recency", value: 0.95 } } };
    const misses = floorMisses(gateRates(fixtureRows, weaker), GATE_SETS[0]!.floors, 0);
    expect(misses.some((m) => m.startsWith("recall"))).toBe(true);
  });

  test("a head that searches everything fails the false-search floors", () => {
    const eager: SearchAssistManifest = { ...fixtureManifest, thresholds: { websearch: { class: "recency", value: 0.001 } } };
    const misses = floorMisses(gateRates(fixtureRows, eager), GATE_SETS[0]!.floors, 0);
    expect(misses.some((m) => m.startsWith("stable false"))).toBe(true);
    expect(misses.some((m) => m.startsWith("no_tool false"))).toBe(true);
    expect(misses.some((m) => m.startsWith("follow-up false"))).toBe(true);
  });

  test("tolerance lets one row of noise through and no more", () => {
    const rates = { n: 10, recall: 0.89, falseSearchStable: 0, falseSearchNoTool: 0, falseSearchFollowUp: 0 };
    const floors = { recallMin: 0.91, falseSearchStableMax: 0, falseSearchNoToolMax: 0, falseSearchFollowUpMax: 0 };
    expect(floorMisses(rates, floors, 0.02)).toEqual([]);
    expect(floorMisses({ ...rates, recall: 0.8 }, floors, 0.02)).toHaveLength(1);
  });

  test("a row whose vector does not fit the manifest is an error, not a silent pass", () => {
    expect(() => gateRates([{ id: "recency-bad-0", category: "recency", alone: [1, 0, 0] }], fixtureManifest)).toThrow(/does not fit/);
  });

  test("the gate rows hold vectors and ids only", () => {
    for (const row of fixtureRows) expect(Object.keys(row).every((k) => ["id", "category", "followUp", "alone", "pair"].includes(k))).toBe(true);
  });

  test("the bench weights seam reads a manifest file through the loader's own parser", () => {
    const path = new URL("../src/lib/searchAssist/__fixtures__/weights.json", import.meta.url).pathname;
    expect(readBenchManifest(path).classes).toEqual(fixtureManifest.classes);
    const gateRowsPath = new URL("../src/lib/searchAssist/__fixtures__/gate-rows.json", import.meta.url).pathname;
    expect(() => readBenchManifest(gateRowsPath)).toThrow();
  });
});
