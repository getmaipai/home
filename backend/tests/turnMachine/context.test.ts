// CONTEXT-RECALL-01 (dev.md "The owner's three live turns on the new
// path", (2)): contextNode's own recall call, direct unit tests -
// faster and more precise than a full turnNext.ts run for exactly what
// this item changes (bare recall(actor, utterance), keyword overlap,
// no tier floor -> the old path's real recall call, tier floors
// gating on a real query vector). Uses the same real stub embedding
// path memory.test.ts's own STUB_DURABLE_MIN_COSINE floor is
// calibrated for (stubServer.ts's bag-of-words embedding: two texts
// that share vocabulary land closer together in cosine terms, two
// that share none stay near-orthogonal), never a hand-built vector or
// a mocked recall() - the tier floor is the real thing under test.
import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "../reset-db";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { remember, embedMemoryRecordSafely } from "@/lib/memory";
import { contextNode } from "@/lib/turnMachine/nodes/context";
import type { TurnState } from "@/lib/turnMachine/contract";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

const SIGNAL = new AbortController().signal;

/** contextNode only ever reads state.actor/state.surface/
 * state.conversationId (resolveOrCreateConversation's own inputs) -
 * the same minimal-real-state pattern outputGate.test.ts already uses
 * for a node whose tested branch reads only part of TurnState. */
function stateFor(actor: BenchPeople["owner"]): TurnState {
  return { actor, surface: "chat", conversationId: "" } as TurnState;
}

describe("contextNode: CONTEXT-RECALL-01, recall like the old path, tier-floor gated", () => {
  test("a small-talk utterance with a seeded unrelated memory produces a context with no memory item", async () => {
    const seeded = remember(people.owner, { text: "Friday is pizza night", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.5 });
    if (!seeded.ok) throw new Error("setup failed");
    // Synchronous, deterministic: remember()'s own embed-on-write runs
    // unawaited (memory.ts's own "void embedMemoryRecordSafely(...)"),
    // so a test that recalls right after would race it. Calling the
    // same exported function directly, awaited, stores the real vector
    // before contextNode ever runs - no sleep, no retry loop.
    await embedMemoryRecordSafely(seeded.value.id, "Friday is pizza night");

    const { output } = await contextNode(stateFor(people.owner), { utterance: "this is the new reply engine" }, SIGNAL);
    expect(output.items.some((item) => item.source === "memory")).toBe(false);
  });

  test("'I'm feeling kind of down' with a seeded memory about the speaker still produces that memory item", async () => {
    const text = "Sage said she's feeling kind of down about work this week";
    const seeded = remember(people.owner, { text, category: "fact", tier: "durable", scope: "person", person: people.owner.id, source: "test", importance: 0.5 });
    if (!seeded.ok) throw new Error("setup failed");
    await embedMemoryRecordSafely(seeded.value.id, text);

    const { output } = await contextNode(stateFor(people.owner), { utterance: "I'm feeling kind of down" }, SIGNAL);
    expect(output.items.some((item) => item.source === "memory" && item.text === text)).toBe(true);
  });

  // "No rule, no signal switch" (the owner's own words, dev.md): an
  // inform turn about the speaker is exactly where memory should
  // personalize, the same tier floor and frame as a question - nothing
  // here branches on primary_act, only the query vector's own cosine
  // against each candidate's stored vector.
  test("caps at MAX_MEMORY_SNIPPETS (5) even when more than five records clear the floor", async () => {
    for (let i = 0; i < 7; i++) {
      const seeded = remember(people.owner, { text: `the household's spare key is hidden in spot number ${i}`, category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.5 });
      if (!seeded.ok) throw new Error("setup failed");
      await embedMemoryRecordSafely(seeded.value.id, `the household's spare key is hidden in spot number ${i}`);
    }
    const { output } = await contextNode(stateFor(people.owner), { utterance: "where is the spare key hidden" }, SIGNAL);
    expect(output.items.filter((item) => item.source === "memory").length).toBeLessThanOrEqual(5);
  });
});
