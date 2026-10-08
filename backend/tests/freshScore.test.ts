import { describe, expect, test } from "bun:test";
import dataset from "../scripts/bench/datasets/chat-ab-01.json";
import { evidenceFired, firstRoundCallsForStoredRun, replayResults, scoreRun, splitCallStages, summarizeFresh } from "../scripts/bench/freshScore";
import { join } from "node:path";

describe("SEARCH-FRESH-01 evidence scoring", () => {
  test("weather is accepted evidence for the two weather items", () => {
    for (const id of ["fresh-ts-10", "fresh-ts-24"]) {
      const item = dataset.fresh.items.find((row) => row.id === id)!;
      expect(item.acceptable_tools).toContain("weather");
      expect(evidenceFired(item.acceptable_tools, ["weather"])).toBe(true);
    }
  });
  test("replay fixture applies stage codes to the archived before cases", () => {
    const { results } = replayResults(join(import.meta.dir, "fixtures/search-fresh-before-no-pii.json"));
    const byId = new Map(results.map((row) => [row.id, row]));
    expect(byId.get("ts-10")?.stage_codes).toContain("D_HIT");
    expect(byId.get("ts-24")?.stage_codes).toContain("D_HIT");
    for (let i = 1; i <= 19; i++) {
      const row = byId.get(`archive-503-${String(i).padStart(2, "0")}`)!;
      expect(row.stage_codes).toContain("D_HIT");
      expect(row.stage_codes).toContain("X_503");
    }
    expect(byId.get("ts-04")?.stage_codes).toContain("Q_RESCUED");
    expect(byId.get("eclipse")?.stage_codes).toContain("Q_OFFTOPIC");
    expect(byId.get("eclipse")?.stage_codes).toContain("S_UNSUPPORTED_CITATION");
    expect(byId.get("eclipse")?.stage_codes).toContain("S_STALE");
    expect(byId.get("ts-16")?.stage_codes).toContain("V_CONTAMINATED");
  });
  test("first-round evidence excludes retry and query-writer calls", () => {
    const stages = splitCallStages([
      { toolCalls: ["weather", "almanac-date"] },
      { toolCalls: ["websearch"] },
      { toolCalls: [], responseFormat: { type: "json_schema" }, responseText: '{"expression":"movies coming this month"}' },
    ]);
    expect(stages).toEqual({ firstRoundCalls: ["weather", "almanac-date"], retryCalls: ["websearch"], queryWriterCalls: ['{"expression":"movies coming this month"}'] });
    expect(evidenceFired(["websearch"], stages.firstRoundCalls)).toBe(false);
  });
  test("failed lookups do not count as ordinary completed runs", () => {
    expect(summarizeFresh([
      { kind: "time-sensitive", searched: true, askedToSearch: false, failed: false },
      { kind: "time-sensitive", searched: false, askedToSearch: false, failed: true },
      { kind: "hard-negative", searched: false, askedToSearch: false, failed: false },
    ])).toEqual({
      "time-sensitive": { runs: 1, searched: 1, askedToSearch: 0 },
      timeless: { runs: 0, searched: 0, askedToSearch: 0 },
      "hard-negative": { runs: 1, searched: 0, askedToSearch: 0 },
    });
  });
  test("weather, stopped searches and 503 failures remain decision hits", () => {
    expect(scoreRun({ id: "x", gold: "must", acceptable_tools: ["weather"], calls: ["weather"] }).stage_codes).toContain("D_HIT");
    expect(scoreRun({ id: "y", gold: "must", acceptable_tools: ["websearch"], calls: ["websearch"], stoppedByBench: true }).stage_codes).toEqual(expect.arrayContaining(["D_HIT", "X_503"]));
  });
});
