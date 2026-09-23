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
import { loadFixture, summarizeRepeats } from "../scripts/bench/replay";
import { runConversation, createBenchPeople, cleanupBenchPeople, backdateBenchRows, captureTurnLog, startRecordingProxy, startFakeHomeAssistant, startFakeSearxng, type RunDeps } from "../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
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
    stub.stop();
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
