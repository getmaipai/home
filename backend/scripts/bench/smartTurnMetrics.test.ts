import { describe, expect, test } from "bun:test";
import { parseVoiceSelection, scoreRows, type BenchRow } from "./smartTurnMetrics";

describe("Smart Turn bench helpers", () => {
  test("selects every preset or validates a chosen comma-separated subset", () => {
    expect(parseVoiceSelection("all", ["alba", "anna"])).toEqual(["alba", "anna"]);
    expect(parseVoiceSelection(" anna, alba ", ["alba", "anna"])).toEqual(["anna", "alba"]);
    expect(() => parseVoiceSelection("missing", ["alba"])).toThrow("unknown voice preset");
    expect(() => parseVoiceSelection("alba,alba", ["alba"])).toThrow("duplicate");
  });

  test("reports correct rates and nearest-rank latency percentiles", () => {
    const rows: BenchRow[] = [
      { text: "done", finished: true, voice: "alba", pad: 600, complete: true, probability: 0.9, ms: 10 },
      { text: "done", finished: true, voice: "anna", pad: 600, complete: false, probability: 0.2, ms: 20 },
      { text: "cut", finished: false, voice: "alba", pad: 600, complete: false, probability: 0.1, ms: 30 },
      { text: "cut", finished: false, voice: "anna", pad: 600, complete: true, probability: 0.8, ms: 40 },
    ];
    expect(scoreRows(rows)).toEqual({ finishedTotal: 2, finishedCorrect: 1, unfinishedTotal: 2, unfinishedCorrect: 1, falseComplete: 1, medianMs: 20, p90Ms: 40 });
  });
});
