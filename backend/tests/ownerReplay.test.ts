// U0a (docs/plans/simple-turn-pipeline-2026-09-22.md): the owner's
// replay set. Offline half (no live model, no network - the org's
// default testing rule): owner-replay.json loads and validates, and
// one representative row from each block runs through the real runner
// (conversationRunner.ts) behind the deterministic stub, the same
// double tests/conversationBench.test.ts's own withStubBench uses,
// proving the JSON-to-BenchConversation plumbing and the scorer wire
// up correctly end to end. The live acceptance run (real search
// behavior on the OLD path today, three repeats, every row) is
// scripts/bench/replay.ts --live, on demand, never part of this suite -
// see that file's header for why (engine contention, 2026-09-22).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { loadFixture, summarizeRepeats, interleavedPlan, computeBarSummary, type BarScore } from "../scripts/bench/replay";
import { runConversation, createBenchPeople, cleanupBenchPeople, backdateBenchRows, captureTurnLog, startRecordingProxy, startFakeHomeAssistant, startFakeSearxng, type RunDeps } from "../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

// FLAKE-FORCED-01 (issue #137): the searxng/web-fetch token bucket
// (packageHost.ts's own SEARXNG_RATE_LIMIT, module-global) drains
// across this file's real-tool-call tests same as turnNext.test.ts's;
// reset it here too, the same shape packageHost.test.ts and
// turnEngine.test.ts already use.
beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** The same stub-backed harness conversationBench.test.ts's own
 * withStubBench builds (not exported there - a small local mirror, the
 * established shape for a bench test in this directory). No scripted
 * tool calls: this proves the plumbing and the pipeline's own
 * deterministic decisions, never a live model's tool choice (see
 * replay.ts's header). */
async function withStubBench<T>(opts: { reply?: (request: ChatCompletionRequest) => string }, fn: (deps: RunDeps) => Promise<T>): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: opts.reply });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  const log = captureTurnLog();
  const people = createBenchPeople();
  const homeAssistant = startFakeHomeAssistant();
  const searxng = startFakeSearxng();
  try {
    return await fn({ people, proxy, log, drainJudge: async () => {}, backdate: (days, turnIds) => backdateBenchRows(people, days, turnIds), homeAssistant });
  } finally {
    log.stop();
    cleanupBenchPeople(people);
    homeAssistant.stop();
    searxng.stop();
    proxy.stop();
    await stub.stop();
  }
}

describe("owner-replay.json", () => {
  test("loads: every failed and control row has a unique id, a valid category, and at least one turn", () => {
    const fixture = loadFixture();
    expect(fixture.failed.length).toBeGreaterThan(0);
    expect(fixture.control.length).toBeGreaterThan(0);
    const ids = [...fixture.failed, ...fixture.control].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of [...fixture.failed, ...fixture.control]) expect(c.turns.length).toBeGreaterThan(0);
  });

  test("no row names a household member (the org PII rule: no name outside the persona roster, and this set names none at all)", () => {
    const fixture = loadFixture();
    const said = [...fixture.failed, ...fixture.control].flatMap((c) => c.turns.map((t) => t.say)).join(" ");
    // Every capitalized word in the set is either a sentence-initial
    // word or a real-world proper noun the plan itself names (France,
    // Apple, Seattle, Mariners, Chile is lower-cased on purpose in the
    // real trace, ChatGPT/Luna) - never a persona-roster or household
    // name.
    const caps = said.match(/\b[A-Z][a-z]+\b/g) ?? [];
    const ROSTER = ["alfred", "astro", "atlas", "bramble", "bruno", "clover", "cosmo", "daisy", "ember", "indigo", "iris", "juniper", "lucia", "marlow", "marsh", "mopey", "nadia", "nova", "oliver", "pippa", "quill", "raven", "riff", "rivet", "rover", "sage", "serena", "sprout", "tempo", "velvet", "vincent", "willow"];
    for (const word of caps) expect(ROSTER).not.toContain(word.toLowerCase());
  });

  test("scripted: 'hi' (a control row) calls no tool through the real pipeline", async () => {
    const fixture = loadFixture();
    const row = fixture.control.find((c) => c.id === "control-hi");
    if (!row) throw new Error("owner-replay.json is missing control-hi");
    await withStubBench({}, async (deps) => {
      const { scores } = await runConversation(row, deps);
      expect(scores.length).toBe(1);
      expect(scores[0]?.checks.find((c) => c.name === "tool")?.pass).toBe(true);
    });
  }, 30_000);

  test("scripted: the president-of-france-repeat row's plumbing runs both turns end to end (pass/fail is read from the real run, not asserted - this is the JSON-to-runner wiring test, not the acceptance run)", async () => {
    const fixture = loadFixture();
    const row = fixture.failed.find((c) => c.id === "president-of-france-repeat");
    if (!row) throw new Error("owner-replay.json is missing president-of-france-repeat");
    await withStubBench({}, async (deps) => {
      const { scores } = await runConversation(row, deps);
      expect(scores.length).toBe(2);
      expect(scores.every((s) => typeof s.pass === "boolean")).toBe(true);
    });
  }, 30_000);

  test("summarizeRepeats: a row counts as clean only when every repeat's every turn passed", () => {
    const rows = [{ id: "a", category: "failed" as const }, { id: "b", category: "control" as const }];
    const scoresByConversationId = new Map([
      ["a#1", [{ pass: true, turnIndex: 0, checks: [], observed: {} }]],
      ["a#2", [{ pass: false, turnIndex: 0, checks: [{ name: "tool", pass: false, detail: "ran none" }], observed: {} }]],
      ["a#3", [{ pass: true, turnIndex: 0, checks: [], observed: {} }]],
      ["b#1", [{ pass: true, turnIndex: 0, checks: [], observed: {} }]],
      ["b#2", [{ pass: true, turnIndex: 0, checks: [], observed: {} }]],
      ["b#3", [{ pass: true, turnIndex: 0, checks: [], observed: {} }]],
    ]);
    const verdicts = summarizeRepeats(rows, scoresByConversationId, 3);
    expect(verdicts.find((v) => v.id === "a")?.passRepeats).toBe(2);
    expect(verdicts.find((v) => v.id === "a")?.failures.length).toBeGreaterThan(0);
    expect(verdicts.find((v) => v.id === "b")?.passRepeats).toBe(3);
    expect(verdicts.find((v) => v.id === "b")?.failures.length).toBe(0);
  });

  // ENGINE-CONTRACT-01 (dev.md 2026-09-23): a repeat whose only bad
  // check is on a turn the engine itself never honoured a forced call
  // on is counted separately, never as an ordinary grounding failure.
  test("summarizeRepeats: a repeat failing only on requiredHonored:false is classed engine, not a real failure", () => {
    const rows = [{ id: "a", category: "failed" as const }];
    const scoresByConversationId = new Map([
      ["a#1", [{ pass: true, turnIndex: 0, checks: [], observed: {} }]],
      ["a#2", [{ pass: false, turnIndex: 0, checks: [{ name: "toolRan", pass: false, detail: "no tool ran" }], observed: { requiredHonored: false } }]],
      ["a#3", [{ pass: true, turnIndex: 0, checks: [], observed: {} }]],
    ]);
    const verdicts = summarizeRepeats(rows, scoresByConversationId, 3);
    const a = verdicts.find((v) => v.id === "a")!;
    expect(a.passRepeats).toBe(2);
    expect(a.engineRepeats).toBe(1);
    // Only repeat 2 made a tool_choice:"required" call at all -
    // forcedRepeats is the real denominator for "engine miss share",
    // never REPEATS itself (a review caught the first cut computing
    // this as a no-op that always equalled REPEATS).
    expect(a.forcedRepeats).toBe(1);
    expect(a.failures.some((f) => f.includes("engine (ENGINE-CONTRACT-01)"))).toBe(true);
  });
});

// RERUN-PROTOCOL-01 (dev.md "U6 rerun ruling" (c)): Fable's own
// acceptance protocol, unit-tested the way summarizeRepeats() already
// is - synthetic rows, no engine, no filesystem.
describe("interleavedPlan(): old, new, old, new per row before the next row", () => {
  test("two rows, two repeats: old/new alternate within a row, never across rows first", () => {
    const rows = [
      { id: "a", category: "failed" as const, conv: { id: "a", category: "knowledge" as const, turns: [] } },
      { id: "b", category: "control" as const, conv: { id: "b", category: "knowledge" as const, turns: [] } },
    ];
    const plan = interleavedPlan(rows, 2);
    expect(plan.map((s) => `${s.row.id}:${s.path}:${s.repeat}`)).toEqual(["a:old:1", "a:new:1", "a:old:2", "a:new:2", "b:old:1", "b:new:1", "b:old:2", "b:new:2"]);
  });

  test("one row, three repeats: six steps, old always immediately before new on the same repeat", () => {
    const rows = [{ id: "a", category: "failed" as const, conv: { id: "a", category: "knowledge" as const, turns: [] } }];
    const plan = interleavedPlan(rows, 3);
    expect(plan.length).toBe(6);
    for (let i = 0; i < plan.length; i += 2) {
      expect(plan[i]?.path).toBe("old");
      expect(plan[i + 1]?.path).toBe("new");
      expect(plan[i]?.repeat).toBe(plan[i + 1]?.repeat);
    }
  });
});

describe("computeBarSummary(): the bar's five conditions, each read off the interleaved run's own scores", () => {
  const FAILED_ROWS = ["president-of-france-repeat", "apple-announce-this-week", "search-mariners-game", "chatgpt-6-luna", "corey-feldman-michael-jackson-friendship"].map((id) => ({ id, category: "failed" as const }));
  const CONTROL_ROWS = ["control-search-mariners-explicit", "control-negative-spiderman", "control-negative-feeling-down"].map((id) => ({ id, category: "control" as const }));
  const ALL_ROWS = [...FAILED_ROWS, ...CONTROL_ROWS];
  const clean: BarScore = { pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok" } };
  function fullyClean(): Map<string, BarScore[]> {
    const m = new Map<string, BarScore[]>();
    for (const row of ALL_ROWS) for (let r = 1; r <= 3; r++) m.set(`${row.id}#${r}`, [clean]);
    return m;
  }

  test("all five conditions pass on an identical, fully clean run", () => {
    const scores = fullyClean();
    const conditions = computeBarSummary(scores, scores, ALL_ROWS, 3);
    expect(conditions.every((c) => c.pass)).toBe(true);
    expect(conditions.length).toBe(5);
  });

  test("condition 1 fails when a named failed row has a real check failure", () => {
    const newScores = fullyClean();
    newScores.set("president-of-france-repeat#1", [{ pass: false, turnIndex: 0, checks: [{ name: "tool", pass: false, detail: "ran none" }], observed: { totalMs: 100, reply: "ok" } }]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[0]?.pass).toBe(false);
  });

  test("condition 1 fails on an empty reply even when checks pass", () => {
    const newScores = fullyClean();
    newScores.set("apple-announce-this-week#2", [{ pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "" } }]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[0]?.pass).toBe(false);
  });

  test("condition 2 fails when a named control regresses", () => {
    const newScores = fullyClean();
    newScores.set("control-negative-spiderman#3", [{ pass: false, turnIndex: 0, checks: [{ name: "toolRan", pass: false, detail: "ran recall" }], observed: { totalMs: 100, reply: "ok" } }]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[1]?.pass).toBe(false);
  });

  // U6: the flip, decided (dev.md) - the old-path-ratio bar retired;
  // condition 3 now measures a generation's own decode rate
  // (predicted_n/predicted_ms) against this run's own reference rate
  // (the median across every timed generation), never one path's total
  // against the other's - a longer reply is not a regression, an idle
  // gap is.
  test("condition 3 passes when every generation decodes at the reference rate (a longer reply is not a regression)", () => {
    const newScores = fullyClean();
    // 100 tok/s reference, one row that's simply a much longer reply
    // (400 tokens, 4000ms) at the identical rate - never flagged.
    for (const row of ALL_ROWS) {
      newScores.set(`${row.id}#1`, [{ pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 1, predicted_n: 100, predicted_ms: 1000 }] } }]);
    }
    newScores.set("control-search-mariners-explicit#2", [{ pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 1, predicted_n: 400, predicted_ms: 4000 }] } }]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[2]?.pass).toBe(true);
  });

  test("condition 3 fails when one generation's decode time badly exceeds the reference rate (an idle gap)", () => {
    const newScores = fullyClean();
    for (const row of ALL_ROWS) {
      newScores.set(`${row.id}#1`, [{ pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 1, predicted_n: 100, predicted_ms: 1000 }] } }]);
    }
    // Same reference rate (100 tok/s -> 1000ms expected for 100 tokens),
    // but this one generation takes 5000ms - a real stall, not length.
    newScores.set("control-search-mariners-explicit#2", [{ pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 1, predicted_n: 100, predicted_ms: 5000 }] } }]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[2]?.pass).toBe(false);
    expect(conditions[2]?.detail).toContain("control-search-mariners-explicit#2");
  });

  test("condition 3 passes with no timed generations at all (nothing to measure)", () => {
    const scores = fullyClean();
    const conditions = computeBarSummary(scores, scores, ALL_ROWS, 3);
    expect(conditions[2]?.pass).toBe(true);
    expect(conditions[2]?.detail).toContain("no timed generations");
  });

  test("condition 4 fails when forced-search turns' median total is 10s or over", () => {
    const newScores = fullyClean();
    for (let r = 1; r <= 3; r++) newScores.set(`president-of-france-repeat#${r}`, [{ pass: true, turnIndex: 0, checks: [], observed: { totalMs: 11_000, reply: "ok", requiredHonored: true } }]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[3]?.pass).toBe(false);
  });

  test("condition 4 passes with no forced-search turns at all (nothing to measure)", () => {
    const scores = fullyClean();
    const conditions = computeBarSummary(scores, scores, ALL_ROWS, 3);
    expect(conditions[3]?.pass).toBe(true);
    expect(conditions[3]?.detail).toContain("no forced-search turns");
  });

  test("condition 5 fails when a multi-turn row's cached_tokens drops between turns", () => {
    const newScores = fullyClean();
    newScores.set("president-of-france-repeat#1", [
      { pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 500 }] } },
      { pass: true, turnIndex: 1, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 200 }] } },
    ]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[4]?.pass).toBe(false);
    expect(conditions[4]?.detail).toContain("president-of-france-repeat#1");
  });

  test("condition 5 passes when cached_tokens rises (or ties) across a multi-turn row", () => {
    const newScores = fullyClean();
    newScores.set("president-of-france-repeat#1", [
      { pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 3 }] } },
      { pass: true, turnIndex: 1, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 480 }] } },
    ]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[4]?.pass).toBe(true);
  });

  // U6: the flip, decided (dev.md) - control-ten-turn-spoken-drift#1's
  // own false failure: rerun 3 found the checker bridging straight over
  // a turn with no cache_n reading at all (its first generation's own
  // slot came back null), comparing the NEXT real reading against the
  // LAST one from before the gap - turn 3 read against turn 1 across
  // turn 2's own missing value, a scorer defect, not the mechanism
  // PHRASE-02 fixes. A gap resets the floor instead: the next real
  // reading is compared against nothing and always passes.
  test("condition 5 passes when a turn with no cache_n reading sits between two turns whose readings would otherwise look like a drop", () => {
    const newScores = fullyClean();
    newScores.set("president-of-france-repeat#1", [
      { pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 724 }] } },
      { pass: true, turnIndex: 1, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: null }] } },
      { pass: true, turnIndex: 2, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 701 }] } },
    ]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[4]?.pass).toBe(true);
  });

  test("condition 5 still fails on a real drop with no gap involved", () => {
    const newScores = fullyClean();
    newScores.set("president-of-france-repeat#1", [
      { pass: true, turnIndex: 0, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 730 }] } },
      { pass: true, turnIndex: 1, checks: [], observed: { totalMs: 100, reply: "ok", generationTrace: [{ cache_n: 701 }] } },
    ]);
    const conditions = computeBarSummary(fullyClean(), newScores, ALL_ROWS, 3);
    expect(conditions[4]?.pass).toBe(false);
  });
});
