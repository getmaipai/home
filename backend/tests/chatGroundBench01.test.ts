import { describe, expect, test } from "bun:test";
import { QUESTIONS, REPEATS, makePlan, scoreQuestion, type RecordedRun } from "../scripts/bench/chat-ground-bench-01";

describe("CHAT-GROUND-BENCH-01 offline fixture and scoring", () => {
  test("includes the grounding replays, fresh-information cases, and four no-search controls", () => {
    expect(QUESTIONS.map((question) => question.id)).toEqual([
      "replay-brazil-president",
      "replay-election-question",
      "replay-election-followup",
      "replay-citation-followup",
      "chile-election-cold",
      "france-warm-repeat",
      "france-warm-repeat-again",
      "control-wwii-year",
      "control-australia-capital",
      "control-haiku-rain",
      "control-arithmetic",
    ]);
    expect(QUESTIONS.filter((question) => question.group === "control")).toHaveLength(4);
    expect(QUESTIONS.find((question) => question.id === "replay-election-followup")?.conversation)
      .toEqual(["wasnt there an election yesterday though"]);
  });

  test("plans ten reps per question and carries context labels", () => {
    const plan = makePlan();
    expect(REPEATS).toBe(10);
    expect(plan).toHaveLength(QUESTIONS.length * REPEATS);
    expect(plan.filter((row) => row.id === "france-warm-repeat")).toHaveLength(10);
    expect(plan.filter((row) => row.id === "france-warm-repeat").every((row) => row.context === "warm")).toBe(true);
    expect(plan[0]?.rep).toBe(1);
    expect(plan[9]?.rep).toBe(10);
  });

  test("scores search, citation markers, cannot-browse language and timing without auto-judging invention", () => {
    const runs: RecordedRun[] = [
      { searched: true, reply: "It is X [1].", firstTextMs: 200, firstTokenToolCallProbability: 0.6, inventedFact: "review" },
      { searched: false, reply: "I cannot browse that now.", firstTextMs: 300, firstTokenToolCallProbability: null },
      { searched: true, reply: "Here is an answer [2].", firstTextMs: null, firstTokenToolCallProbability: 0.2 },
      { searched: false, reply: "Known fact.", firstTextMs: 100, inventedFact: "no" },
    ];
    expect(scoreQuestion("sample", runs)).toEqual({
      id: "sample",
      runs: 4,
      searchRate: 0.5,
      citationMarkerRate: 0.5,
      inventedFactJudgement: "annotated",
      cannotBrowseRate: 0.25,
      meanFirstTextMs: 200,
      firstTokenToolCallProbability: 0.4,
      firstTokenToolCallSamples: 2,
    });
  });

  test("reports missing observations as unavailable rather than inventing zero rates", () => {
    expect(scoreQuestion("empty", [])).toEqual({
      id: "empty",
      runs: 0,
      searchRate: null,
      citationMarkerRate: null,
      inventedFactJudgement: "manual review",
      cannotBrowseRate: null,
      meanFirstTextMs: null,
      firstTokenToolCallProbability: null,
      firstTokenToolCallSamples: 0,
    });
  });
});
