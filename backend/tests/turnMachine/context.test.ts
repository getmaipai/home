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
import { remember, embedMemoryRecordSafely, recall } from "@/lib/memory";
import { contextNode, MEMORY_CONTEXT_MIN_SCORE } from "@/lib/turnMachine/nodes/context";
import type { TurnState } from "@/lib/turnMachine/contract";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";
import { injectVector } from "../fixtures/injectVector";

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

// MEMORY-FLOOR-01 (getmaipai/home, found live LIVE-0923-01 (6)): a
// weak-but-nonzero match must never become a context item. The tier
// floor above (CONTEXT-RECALL-01) already excludes most unrelated
// memories through the stub's own bag-of-words cosine - genuinely
// disjoint vocabulary lands near-orthogonal, so it never reaches
// recall()'s own scored list at all. This floor guards the narrower
// case that one doesn't cover: a candidate that DOES clear it (or
// goes through recall()'s own keyword-fallback branch, which has no
// floor at all - "no query vector... or no stored vector yet",
// memory.ts's own comment) but whose real composite score is still
// weak. A record that clears its tier's own cosine floor already
// scores above MEMORY_CONTEXT_MIN_SCORE on the cosine weight alone
// (COSINE_WEIGHT=0.7 against a floor of 0.37-0.62 depending on tier
// and backend, memory.ts), so a genuinely weak, non-forced match can
// only exist on the keyword-fallback branch - reached here by giving
// the candidate's own stored vector a `preprocess` that can never
// match a real query vector's (`EMBED_PREPROCESS = "v1"`, llm.ts, the
// one value every real embed call ever stamps), so `identityMatch`
// (memory.ts) is false regardless of whether the stub embed backend
// is up, slow, or races `remember()`'s own unawaited embed-on-write -
// deterministic without depending on that race's outcome (a re-review
// of the first cut of these tests found the stub backend genuinely
// running in this suite, `getEmbedBackendKind() === "stub"`, so a
// version relying on `embedQueryForRecall()` simply failing here was
// wrong on the mechanism, even though its pass/fail outcome happened
// to be stable).
describe("MEMORY-FLOOR-01: a weak match never becomes a context item, a pinned one always can", () => {
  // Exercises contextNode itself (the function this item actually
  // changed), not recall() plus a test-local reimplementation of its
  // filter - a re-review of the first cut of these tests (this diff)
  // found none of them called contextNode at all, so a regression in
  // its real filter line (context.ts) would have passed every one of
  // them.
  test("a keyword-fallback match below the floor is excluded", async () => {
    const text = "the household spare battery charger cable is stored inside the hallway closet cabinet";
    const seeded = remember(people.owner, { text, category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.5 });
    if (!seeded.ok) throw new Error("setup failed");
    await __drainBackgroundWorkForTests();
    injectVector(seeded.value.id, [1], "mismatch", "mismatch-preprocess");

    // One shared word ("hallway") over a wide combined vocabulary
    // scores well under the floor - confirmed via recall() directly
    // during design (score 0.056), kept as an assertion below so a
    // change to tokenize()/scoring that drifts this above the floor
    // fails loudly here instead of silently stopping to prove anything.
    const direct = recall(people.owner, "quick check on the hallway light switch situation please", { bumpUsage: false });
    const directMatch = direct.find((m) => m.record.id === seeded.value.id);
    expect(directMatch).toBeDefined();
    expect(directMatch!.score).toBeLessThan(MEMORY_CONTEXT_MIN_SCORE);
    expect(directMatch!.forceInclude).toBeFalsy();

    const { output } = await contextNode(stateFor(people.owner), { utterance: "quick check on the hallway light switch situation please" }, SIGNAL);
    expect(output.items.some((item) => item.source === "memory" && item.text === text)).toBe(false);
  });

  test("the same weak keyword-fallback match still surfaces when pinned", async () => {
    const text = "the household spare battery charger cable is stored inside the hallway closet cabinet";
    const seeded = remember(people.owner, { text, category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.5, pinned: true });
    if (!seeded.ok) throw new Error("setup failed");
    await __drainBackgroundWorkForTests();
    injectVector(seeded.value.id, [1], "mismatch", "mismatch-preprocess");

    const direct = recall(people.owner, "quick check on the hallway light switch situation please", { bumpUsage: false });
    const directMatch = direct.find((m) => m.record.id === seeded.value.id);
    expect(directMatch).toBeDefined();
    expect(directMatch!.score).toBeLessThan(MEMORY_CONTEXT_MIN_SCORE);
    expect(directMatch!.forceInclude).toBe(true);

    const { output } = await contextNode(stateFor(people.owner), { utterance: "quick check on the hallway light switch situation please" }, SIGNAL);
    expect(output.items.some((item) => item.source === "memory" && item.text === text)).toBe(true);
  });

  // A review of the first cut of this floor caught it checking only
  // `record.pinned`, silently dropping a weak-cosine ENTITY match
  // recall() itself force-included (`forceInclude = row.pinned ||
  // isEntityMatch`, memory.ts) - the exact case a household member
  // asking about a named entity relies on even when nothing specific
  // is stored (memory.ts's own comment: "the model has to abstain on
  // the attribute"). A second review pass then caught this test's own
  // premise as false: on the keyword-fallback path (the only path
  // reachable from contextNode in this file, per the comment above),
  // isEntityMatch's own unconditional `score += 0.5` (memory.ts) means
  // ANY keyword-fallback entity match scores at least 0.5 - already
  // above MEMORY_CONTEXT_MIN_SCORE on its own, forceInclude or not - so
  // "weak" is only constructible on the cosine path, which needs a real
  // query vector contextNode has no test hook to control. This test
  // therefore calls recall() directly with a hand-injected, genuinely
  // negative cosine (injectVector, the same pattern memory.test.ts's own
  // "a pinned record with a genuinely negative cosine score still
  // surfaces" test already established for the pinned half of
  // forceInclude - see that test's own comment for why cosine, unlike
  // keyword overlap, can go negative at all), the one honest way to
  // drive an entity match's real composite score below the floor.
  test("a weak entity match still surfaces via recall()'s own forceInclude, not just a pinned one", () => {
    const entity = remember(people.owner, { text: "Sprout: the family dog, a golden retriever", category: "thing", tier: "durable", scope: "household", source: "test", importance: 0.5, record_kind: "entity" });
    if (!entity.ok) throw new Error("setup failed");
    const seeded = remember(people.owner, { text: "Sprout needs new dog tags engraved eventually", category: "event", tier: "episodic", scope: "household", source: "test", importance: 0 });
    if (!seeded.ok) throw new Error("setup failed");
    injectVector(seeded.value.id, [-1, 0, 0, 0]);

    const matches = recall(people.owner, "Sprout", { bumpUsage: false, queryVector: { vector: new Float32Array([1, 0, 0, 0]), space: "test", dims: 4, preprocess: "v1" } });
    const match = matches.find((m) => m.record.id === seeded.value.id);
    expect(match).toBeDefined();
    expect(match!.score).toBeLessThan(MEMORY_CONTEXT_MIN_SCORE);
    expect(match!.forceInclude).toBe(true);

    const kept = matches.filter((m) => m.forceInclude || m.score >= MEMORY_CONTEXT_MIN_SCORE);
    expect(kept.some((m) => m.record.id === seeded.value.id)).toBe(true);
  });
});
