// Fix E (docs/dev.md's "Chat reliability" - native tool calling, one
// round trip): Tier 2's own consequential confirmation gate and
// ask/confirm continuation, plus the model's native tool_calls decision
// itself. resolveToolCalls() (Session C step 2's attemptTier2Tools(),
// rewritten) takes the model's ALREADY-DECIDED ToolCall[] directly now -
// no scripted stub needed to exercise it at all, since it no longer
// makes its own completion call (that round trip is gone; the SAME
// completion that would have answered in plain text now carries the
// tool decision, read back by runTurn()/runTurnStream() before this
// function ever runs). resolvePendingAsk()/pendingAskFromPluginResult()
// are exported for the identical reason matchPattern()/route() are: a
// `consequential` fixture manifest needs no file on disk (the
// confirmation path never reaches runPlugin() at all), and no bundled
// recipe can produce `confirm`/`ask` yet (spec/interpreters/**'s `Step`
// union has no op for it - Session D's file), so that half is tested
// against a hand-built PluginResult.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { db } from "@/db";
import { people, memoryRecords, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { embedUtterance } from "@/lib/routing";
import { TestClient } from "./client";
import {
  resolveToolCalls,
  resolvePendingAsk,
  pendingAskFromPluginResult,
  runTurn,
  runTurnStream,
  selectOfferedTools,
  stickyOfferedTools,
  __resetStickyOfferedToolsForTests,
  ordinaryToolIds,
  routeSemantic,
  loadAllManifests,
  TIER2_AMBIGUOUS_FLOOR,
  type RankedCandidate,
  type PluginResultWithConfirmAsk,
} from "@/lib/turnEngine";
import type { ToolCall } from "@/lib/llm";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import { remember } from "@/lib/memory";
import { resolveOrCreateConversation, getPendingAsk, setPendingAsk } from "@/lib/conversationHistory";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("setup failed");
  return { actor, conversationId: conv.value.id };
}

const SAFE: SafetyResult = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-01-01T00:00:00.000Z" };

/** Fix E: points the chat backend at a fresh stub scripted to answer a
 * request with a REAL tool_calls reply (spec/llm/ts/stubServer.ts's own
 * scriptedToolCalls option) - only needed by the runTurn()/
 * runTurnStream() integration tests below, which exercise the whole
 * native-tool-calling round trip end to end; resolveToolCalls() itself
 * needs no model at all anymore. */
async function withScriptedToolCalls<T>(
  calls: (request: ChatCompletionRequest) => { id: string; name: string; args: string }[] | undefined,
  fn: () => Promise<T>,
  // REASONING-01: a model may reason before deciding to call a tool - a
  // review caught peekAndHandle() briefly mistaking that reasoning-only
  // prefix for "the model answered in prose, not a tool call." Optional,
  // so every existing caller of this helper is unaffected.
  reasoning?: (request: ChatCompletionRequest) => string | undefined,
): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedToolCalls: (request) => {
      if (!request.tools || request.tools.length === 0) return undefined;
      const scripted = calls(request);
      return scripted?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }));
    },
    scriptedReasoning: reasoning,
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

/** getmaipai/home#67 (live-found 2026-09-07: "nobody's told me"
 * replies to a natural follow-up the household never had to ask twice
 * for, once they said "look it up" outright): scripts the FIRST
 * completion (tool_choice "auto") to answer with `guessText` in plain
 * text - no call proposed, the exact shape that let a fabricated answer
 * reach guardReply() unguarded by any tool result - then scripts the
 * FORCED retry (tool_choice "required", turnEngine.ts's own response to
 * catching that guess as invention/unrelated_recall) with `forcedCalls`.
 * `guessText` is the caller's job to make a genuine household invention
 * (FAST-05: a claim about a person here with nothing behind it, such as
 * words put in a family member's mouth; a bare proper noun, date, or
 * number is general knowledge now and no longer counts) - this helper
 * doesn't validate that for you, the same way withScriptedToolCalls()
 * above doesn't validate its own scripted calls resolve. */
async function withScriptedGuessThenForcedTool<T>(guessText: string, forcedCalls: { id: string; name: string; args: string }[], fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedToolCalls: (request) => (request.tool_choice === "required" ? forcedCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } })) : undefined),
    scriptedChatReply: () => guessText,
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

/** FAST-04: runTurnStream() now resolves BEFORE the first token is read
 * (the tool-call peek moved inside the stream), so a test that returns
 * the stream result out of withScriptedToolCalls()'s callback would find
 * the stub already stopped by the time it iterates. Every streaming test
 * here drains inside the callback instead, the way routes/turn.ts does:
 * the iterator is driven by hand so the generator's own RETURN value
 * (a StreamOutcome - the `{ resolved }` shape a tool-resolved turn ends
 * with) can be read from the final step, not just the yielded deltas. */
async function drainStream(result: Awaited<ReturnType<typeof runTurnStream>>) {
  if (!result.ok || result.kind !== "stream") return { result, deltas: [] as string[], outcome: undefined };
  const iterator = result.tokens[Symbol.asyncIterator]();
  const deltas: string[] = [];
  let step = await iterator.next();
  while (!step.done) {
    deltas.push(step.value);
    step = await iterator.next();
  }
  return { result, deltas, outcome: step.value };
}

// Real bundled packages (backend/packages/remember, recall), used so the
// "a proposed call actually runs" tests exercise a real recipe through
// runPlugin() - deliberately network-free ones (org standard: "a unit
// test does not call a live model, a network service, or real
// hardware"), unlike weather/joke/trivia's own real HTTP fetches.
const REMEMBER_CANDIDATE: RankedCandidate = {
  id: "remember",
  score: 0.7,
  manifest: { id: "remember", version: "0.1.0", kind: "plugin", category: "utility", display: "Remember", description: "remember a fact", args: { type: "object", required: ["fact"], properties: { fact: { type: "string", minLength: 1 } } } } as never,
};
const RECALL_CANDIDATE: RankedCandidate = {
  id: "recall",
  score: 0.68,
  manifest: { id: "recall", version: "0.1.0", kind: "plugin", category: "utility", display: "Recall", description: "recall what's known about a topic", args: { type: "object", required: ["topic"], properties: { topic: { type: "string", minLength: 1 } } } } as never,
};
// No file on disk needed: the confirmation path returns before ever
// calling runPlugin(), so a fixture manifest object is the whole story.
const CONSEQUENTIAL_CANDIDATE: RankedCandidate = {
  id: "lock-front-door",
  score: 0.9,
  // FAST-03: the description is the real manifest shape (one imperative
  // sentence with a period), so the confirm prompt built from it can be
  // asserted as a grammatical question.
  manifest: { id: "lock-front-door", version: "0.1.0", kind: "plugin", category: "home", display: "Lock the front door", description: "Lock the front door.", consequential: true, args: {} } as never,
};

/** Every test below offers exactly the candidates it ranks, matching
 * real production behavior when the ranked list is no longer than
 * MAX_TIER2_TOOLS_OFFERED - the one test that deliberately does NOT do
 * this (a real 4th+ candidate that's ranked but never offered) builds
 * its own narrower `offeredIds` explicitly. */
function offeredFrom(ranked: RankedCandidate[]): Set<string> {
  return new Set(ranked.map((r) => r.id));
}

// CHAT-15 (docs/plans/media-conversation-program-2026-09-13.md step 2;
// docs/dev/session-a.md's design note): every proposal the model makes
// is retained on the turn, in model order, and one that will not run
// says why; the whole batch is validated before anything runs or asks.
describe("CHAT-15: resolveToolCalls() retains every proposal, and refuses with a reason", () => {
  const memoryTexts = () => db.select({ text: memoryRecords.text }).from(memoryRecords).all().map((r) => r.text);

  test("one success and one failure are retained together, each with its arguments, path and time", async () => {
    const { actor } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const calls: ToolCall[] = [
      { id: "c1", tool: "remember", args: { fact: "the wifi password is on the fridge" } },
      { id: "c2", tool: "recall", args: { topic: "the lost city of atlantis" } },
    ];
    const ranked = [REMEMBER_CANDIDATE, RECALL_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(value?.source).toBe("plugin");
    expect(outcomes.map((o) => [o.callId, o.packageId, o.status])).toEqual([
      ["c1", "remember", "succeeded"],
      ["c2", "recall", "failed"],
    ]);
    expect(outcomes[0]!.args).toEqual({ fact: "the wifi password is on the fridge" });
    expect(outcomes[0]!.via).toBe("tool_call");
    expect(outcomes[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(outcomes[1]!.errorCode).toBe("not_found");
    expect(outcomes[1]!.userMessage).toBe("I don't remember anything about that."); // household-safe, never a diagnostic
  });

  test("an invalid second argument set is refused before anything runs, and the valid call still runs", async () => {
    const { actor } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const calls: ToolCall[] = [
      { id: "c1", tool: "remember", args: { fact: "pizza night is Friday" } },
      { id: "c2", tool: "remember", args: { fct: "a typo, no fact" } },
    ];
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(value?.source).toBe("plugin");
    expect(outcomes.map((o) => [o.callId, o.status, o.reason])).toEqual([
      ["c1", "succeeded", undefined],
      ["c2", "rejected", "invalid_args"],
    ]);
    expect(memoryTexts()).toEqual(["pizza night is Friday"]); // the invalid one had no effect
  });

  test("malformed arguments (not an object) never reach a host", async () => {
    const { actor } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const calls = [
      { id: "c1", tool: "remember", args: ["pizza night is Friday"] },
      { id: "c2", tool: "remember", args: "pizza night is Friday" },
    ] as unknown as ToolCall[];
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(value).toBeNull();
    expect(outcomes.map((o) => [o.status, o.reason])).toEqual([
      ["rejected", "malformed"],
      ["rejected", "malformed"],
    ]);
    expect(memoryTexts()).toEqual([]);
  });

  test("a duplicate wire id in a batch, or a retry of a completed id, cannot repeat the call", async () => {
    const { actor } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const ranked = [REMEMBER_CANDIDATE];
    const twice: ToolCall[] = [
      { id: "c1", tool: "remember", args: { fact: "pizza night is Friday" } },
      { id: "c1", tool: "remember", args: { fact: "pizza night is Friday" } },
    ];
    await resolveToolCalls(twice, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(outcomes.map((o) => [o.status, o.reason])).toEqual([
      ["succeeded", undefined],
      ["rejected", "duplicate"],
    ]);
    // A redelivery of the same batch on the same turn (the stream's peek
    // and its retry share one outcomes list): nothing runs again.
    await resolveToolCalls([twice[0]!], offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(outcomes.map((o) => [o.status, o.reason])).toEqual([
      ["succeeded", undefined],
      ["rejected", "duplicate"],
      ["rejected", "duplicate"],
    ]);
    expect(memoryTexts()).toEqual(["pizza night is Friday"]);
  });

  test("a tool the model was not shown, and the third call, are retained as refused in model order", async () => {
    const { actor } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const calls: ToolCall[] = [
      { id: "c1", tool: "lock-front-door", args: {} },
      { id: "c2", tool: "remember", args: { fact: "one" } },
      { id: "c3", tool: "remember", args: { fact: "two" } },
      { id: "c4", tool: "remember", args: { fact: "three" } },
    ];
    const ranked = [REMEMBER_CANDIDATE];
    await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(outcomes.map((o) => [o.callId, o.status, o.reason])).toEqual([
      ["c1", "rejected", "not_offered"],
      ["c2", "succeeded", undefined],
      ["c3", "succeeded", undefined],
      ["c4", "rejected", "over_cap"],
    ]);
    expect(memoryTexts().sort()).toEqual(["one", "two"]);
  });

  test("a withheld argument (4a) is retained as pending even when its sibling fails, and both of two withheld calls are retained", async () => {
    const { actor } = await owner();
    const { loadAllManifests } = await import("@/lib/turnEngine");
    const timer = loadAllManifests().find((l) => l.id === "timer")!;
    const listAdd = loadAllManifests().find((l) => l.id === "list-add")!;
    const TIMER: RankedCandidate = { id: "timer", score: 0.8, manifest: timer.manifest };
    const LIST: RankedCandidate = { id: "list-add", score: 0.8, manifest: listAdd.manifest };
    // A failing sibling: recall of nothing beside a timer with an unsaid length.
    let outcomes: ToolExecutionOutcome[] = [];
    let ranked = [TIMER, RECALL_CANDIDATE];
    const value = await resolveToolCalls(
      [
        { id: "c1", tool: "recall", args: { topic: "atlantis" } },
        { id: "c2", tool: "timer", args: { expression: "ten minutes" } },
      ],
      offeredFrom(ranked),
      ranked,
      actor,
      "conv-1",
      "turn-1",
      SAFE,
      undefined,
      outcomes,
      "look up atlantis and set a timer",
    );
    expect(value).toBeNull(); // the failed lookup falls through to the model (the 4a review's rule)
    // Its question was never put, so it is not left parked forever.
    expect(outcomes.map((o) => [o.callId, o.status, o.reason])).toEqual([
      ["c1", "failed", undefined],
      ["c2", "rejected", "not_asked"],
    ]);
    // Two withheld action calls: both retained, one asked.
    outcomes = [];
    ranked = [TIMER, LIST];
    const asked = await resolveToolCalls(
      [
        { id: "c1", tool: "timer", args: { expression: "ten minutes" } },
        { id: "c2", tool: "list-add", args: { item: "it" } },
      ],
      offeredFrom(ranked),
      ranked,
      actor,
      "conv-1",
      "turn-2",
      SAFE,
      undefined,
      outcomes,
      "set a timer and add it to the list",
    );
    expect(asked?.source).toBe("confirm");
    expect(outcomes.map((o) => [o.callId, o.status, o.reason])).toEqual([
      ["c1", "pending", undefined],
      ["c2", "rejected", "not_asked"],
    ]);
  });

  test("a colliding wire id with a different call is not a duplicate; the same call again is", async () => {
    const { actor } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const ranked = [REMEMBER_CANDIDATE];
    await resolveToolCalls([{ id: "call_0", tool: "remember", args: { fact: "one" } }], offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    // A second completion in the same turn whose server restarted ids.
    await resolveToolCalls([{ id: "call_0", tool: "remember", args: { fact: "two" } }], offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    await resolveToolCalls([{ id: "call_0", tool: "remember", args: { fact: "two" } }], offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(outcomes.map((o) => [o.status, o.reason])).toEqual([
      ["succeeded", undefined],
      ["succeeded", undefined],
      ["rejected", "duplicate"],
    ]);
  });

  test("a consequential proposal asks once and executes none of the batch; its companion is retained as blocked", async () => {
    const { actor, conversationId } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const calls: ToolCall[] = [
      { id: "c1", tool: "remember", args: { fact: "pizza night is Friday" } },
      { id: "c2", tool: "lock-front-door", args: {} },
    ];
    const ranked = [CONSEQUENTIAL_CANDIDATE, REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, conversationId, "turn-1", SAFE, undefined, outcomes);
    expect(value?.source).toBe("confirm");
    expect(outcomes.map((o) => [o.callId, o.status, o.reason])).toEqual([
      ["c1", "rejected", "blocked_by_confirmation"],
      ["c2", "pending", undefined],
    ]); // model order, whatever settled first
    expect(outcomes[1]!.args).toEqual({});
    expect(memoryTexts()).toEqual([]); // nothing ran
    expect(getPendingAsk(conversationId)?.packageId).toBe("lock-front-door");
  });
});

describe("resolveToolCalls() (Fix E: the model's own native tool_calls decision, resolved)", () => {
  test("a real tool call runs the package with validated args", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "remember", args: { fact: "Friday is pizza night" } }];
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember");
    expect(value?.routing?.tier).toBe("tool");
  });

  test("two independent calls both run and their replies combine", async () => {
    const { actor } = await owner();
    const seeded = remember(actor, { text: "Friday is pizza night", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.8 });
    expect(seeded.ok).toBe(true);
    const calls: ToolCall[] = [
      { tool: "remember", args: { fact: "the wifi password is on the fridge" } },
      { tool: "recall", args: { topic: "pizza night" } },
    ];
    const ranked = [REMEMBER_CANDIDATE, RECALL_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember+recall");
  });

  // #93: a recall the model asked for that found nothing is a miss, not
  // an answer: its "I don't remember anything about that." never joins
  // a combined reply, and alone it is "ask again" (null), so the turn's
  // own retry without tools lets the model answer from what it knows.
  test("a recall that finds nothing is a failed not_found outcome: dropped from a combined reply, and alone it is null, never spoken", async () => {
    const { actor } = await owner();
    const outcomes: ToolExecutionOutcome[] = [];
    const both: ToolCall[] = [
      { tool: "remember", args: { fact: "the wifi password is on the fridge" } },
      { tool: "recall", args: { topic: "pizza night" } },
    ];
    const ranked = [REMEMBER_CANDIDATE, RECALL_CANDIDATE];
    const value = await resolveToolCalls(both, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined, outcomes);
    expect(value?.plugin_id).toBe("remember");
    expect(value?.reply.text).not.toContain("I don't remember anything about that.");
    expect(outcomes.find((o) => o.packageId === "recall")).toMatchObject({ status: "failed", errorCode: "not_found" });
    const alone = await resolveToolCalls([{ tool: "recall", args: { topic: "the second world war" } }], offeredFrom([RECALL_CANDIDATE]), [RECALL_CANDIDATE], actor, "conv-1", "turn-2", SAFE, undefined);
    expect(alone).toBeNull();
  });

  test("an invalid call (fails the package's own args schema) is 'ask again' - null, never a silent drop", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "remember", args: {} }]; // missing required `fact`
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  test("a call naming a tool that isn't a real candidate at all is dropped, not trusted", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "not-offered", args: {} }];
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  // A code review (2026-09-07) found the first cut of this function
  // validated a call's id against the FULL `ranked` list (every Tier 1
  // candidate), not the actually-offered subset (prepareTurn()'s own
  // `tools`, capped at MAX_TIER2_TOOLS_OFFERED) - a call naming a real,
  // ranked-but-unoffered candidate (the 4th-ranked one, say) passed the
  // old check and ran anyway, including reaching the confirm gate for a
  // `consequential` package that was never actually shown to the model.
  test("a call naming a real candidate that WAS ranked but was never actually offered is dropped, not run", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "recall", args: { topic: "pizza night" } }];
    // recall is a genuine candidate (present in `ranked`), but this
    // turn's own `offeredIds` (what prepareTurn() actually sent as
    // `tools`) only ever included remember - the exact "offered top few,
    // not the whole ranked list" gap the fix above closes.
    const value = await resolveToolCalls(calls, offeredFrom([REMEMBER_CANDIDATE]), [REMEMBER_CANDIDATE, RECALL_CANDIDATE], actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  test("an empty calls array is null (nothing to resolve)", async () => {
    const { actor } = await owner();
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls([], offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  test("a consequential package proposed by the model waits for confirmation instead of running", async () => {
    const { actor, conversationId } = await owner();
    const calls: ToolCall[] = [{ tool: "lock-front-door", args: {} }];
    const ranked = [CONSEQUENTIAL_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, conversationId, "turn-1", SAFE, undefined);
    expect(value?.source).toBe("confirm");
    expect(value?.plugin_id).toBe("lock-front-door");
    // FAST-03: the description folded into one grammatical question,
    // trailing period gone, first letter lowercased, nothing else changed.
    expect(value?.reply.text).toBe("Do you want me to lock the front door?");
    // A real, pending confirmation actually got stored - the whole point
    // of not just answering "sure" and forgetting about it.
    const pending = getPendingAsk(conversationId);
    expect(pending).toEqual({ kind: "confirm", prompt: value!.reply.text, packageId: "lock-front-door", args: {} });
  });

  test("a consequential proposal alongside a non-consequential one in the same batch: the consequential one wins the turn, the other is dropped (documented simplification)", async () => {
    const { actor, conversationId } = await owner();
    const calls: ToolCall[] = [
      { tool: "lock-front-door", args: {} },
      { tool: "remember", args: { fact: "pizza night is Friday" } },
    ];
    const ranked = [CONSEQUENTIAL_CANDIDATE, REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, conversationId, "turn-1", SAFE, undefined);
    expect(value?.source).toBe("confirm");
    expect(value?.plugin_id).toBe("lock-front-door");
  });
});

describe("runTurn()/runTurnStream() with native tool calling end to end (Fix E)", () => {
  test("runTurn(): a real tool call, scripted through the stub, runs the real package - one completion call, no separate grammar round trip", async () => {
    const { actor } = await owner();
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      // Deliberately NOT starting with "remember" (see the retry test's
      // own comment below) - this utterance must reach Tier 2 (offered
      // as a tool) rather than winning Tier 0's own literal pattern
      // outright, or the scripted tool_calls reply above would never
      // actually be exercised.
      () => runTurn(actor, "chat", "Friday is pizza night, can you remember that for me"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
    // The real proof this went through native tool calling, not a Tier 0
    // pattern win that happens to name the same package: only
    // resolveToolCalls() ever sets routing.tier "tool".
    expect(result.value.routing?.tier).toBe("tool");
    // REASONING-02: no reasoning was ever scripted for this completion,
    // so the field stays entirely absent - a tool call on its own never
    // invents one.
    expect(result.value.reasoning).toBeUndefined();
  });

  // REASONING-01: a review caught peekAndHandle() mistaking a purely-
  // reasoning prefix (the engine's own reasoning_content, synthesized
  // into a leading `<think>` chunk by llm.ts) for "the model already
  // answered in prose, not a tool call" - the exact regression this
  // proves is fixed, on both the blocking and the streaming path.
  test("runTurn(): a tool call still runs even when the model reasons first (thinking on)", async () => {
    const { actor } = await owner();
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      () => runTurn(actor, "chat", "Friday is pizza night, can you remember that for me", { thinking: true }),
      () => "the household wants this remembered, so I should call remember",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
    expect(result.value.routing?.tier).toBe("tool");
    // REASONING-02: the reasoning that led to this call was previously
    // discarded entirely (a REASONING-01 review finding) - it's now
    // carried on the returned TurnValue, the same tag-stripped string a
    // live `reasoning` wire event would have carried, AND on the row
    // (conversationHistory.ts's logTurn()), so a household's own record
    // of why the household's own memory got written isn't lost.
    expect(result.value.reasoning).toBe("the household wants this remembered, so I should call remember");
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    expect(row?.reasoning).toBe("the household wants this remembered, so I should call remember");
  });

  test("runTurnStream(): a tool call still resolves inside the stream even when the model reasons first (thinking on)", async () => {
    const { actor } = await owner();
    const { result, deltas, outcome } = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      async () => drainStream(await runTurnStream(actor, "chat", "Friday is pizza night, can you remember that for me", { thinking: true })),
      () => "the household wants this remembered, so I should call remember",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") return;
    // The reasoning prefix is neither shown as a delta nor surfaced as a
    // reasoning event for this turn shape (docs/dev.md's own named,
    // deliberate scope boundary) - what matters is the tool call still ran.
    expect(deltas).toEqual([]);
    expect(outcome && "resolved" in outcome).toBe(true);
    if (!outcome || !("resolved" in outcome)) return;
    expect(outcome.resolved.source).toBe("plugin");
    expect(outcome.resolved.plugin_id).toBe("remember");
    expect(outcome.resolved.routing?.tier).toBe("tool");
    // REASONING-02: peekAndHandle()'s own twin of the blocking fix above.
    expect(outcome.resolved.reasoning).toBe("the household wants this remembered, so I should call remember");
    // logTurnSafely() only runs inside finalize() (turnEngine.ts's own
    // "the ONE place" for the resolved-tool-call case) - drainStream()
    // above only drains the tokens generator, so the row exists only
    // once finalize() itself is called, the same as the sibling test
    // above this one that proves finalize() hands `outcome.resolved`
    // back unchanged.
    result.finalize("", outcome);
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, outcome.resolved.turn_id)).get();
    expect(row?.reasoning).toBe("the household wants this remembered, so I should call remember");
  });

  // REASONING-03 (owner's ruling, 2026-09-22, a privacy invariant, not
  // a setting): a child's reasoning is never persisted at all, on the
  // old path too - not just dropped from the response. Supersedes this
  // test's own old assertion ("the row still has it, the drop is
  // presentation-only"), which REASONING-02's write-side gate on
  // conversationHistory.ts's buildTurnRow() now makes untrue on
  // purpose: `thinking: true` here stands in for "a test budget forces
  // thinking on" (POST /api/turn's own client field, the belt-and-
  // braces route gate this same describe block's earlier tests already
  // prove forces `enable_thinking: false` server-side regardless - this
  // test is about what gets WRITTEN when a reasoning string somehow
  // reaches the write path anyway, via the scripted tool-call
  // reasoning below, never about whether the engine was asked to
  // think).
  test("POST /api/turn: a child's turn with thinking forced on writes an empty reasoning column, not just a hidden response field", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    const res = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      () => childClient.post("/api/turn", { text: "Friday is pizza night, can you remember that for me", thinking: true }),
      () => "the household wants this remembered, so I should call remember",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turn_id: string; reasoning?: string };
    expect(body.reasoning).toBeUndefined();
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, body.turn_id)).get();
    expect(row?.reasoning).toBeNull();
    // No reasoning in stats either - NodeExecution/GenerationInput carry
    // no raw reasoning text field at all (contract.ts's own shape), so
    // this is a structural guarantee, not a per-row scrub; the stored
    // stats blob is asserted here not to contain the household's words.
    const storedStats = row?.stats ? String(row.stats) : "";
    expect(storedStats).not.toContain("household wants this remembered");
  });

  test("runTurn(): every proposed call failing falls back to a second, plain completion - never a fabricated success", async () => {
    const { actor } = await owner();
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: "{}" }], // missing required `fact`
      // Deliberately NOT starting with "remember", and (since #77) not
      // ENDING in "please remember" either - remember's own
      // `routing.patterns` would win Tier 0 outright on either shape,
      // bypassing Tier 2 (and this test) entirely. Shares enough
      // vocabulary with the package's own routing.examples ("please
      // remember our wifi password is on the fridge") for the stub's
      // bag-of-words scorer to still offer it.
      () => runTurn(actor, "chat", "our wifi password is on the fridge, please remember this"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model"); // the retry's own plain reply, not a plugin result
  });

  // FAST-04: this used to assert `kind: "immediate"`, back when
  // runTurnStream() awaited the first token before returning and could
  // therefore know up front that the model had called a tool. The peek
  // now happens inside the stream, so a tool call resolves INSIDE it: a
  // "stream" result that yields no deltas at all and whose generator
  // returns `{ resolved }`, the package's complete TurnValue, which never
  // went through gateOutputSafety()/gateGuards() (a grounded package
  // reply must not be cut by the invention guard) and keeps every field
  // finalizeReply() gave it.
  test("runTurnStream(): a real tool call resolves inside the stream as one finished reply, never typed as deltas", async () => {
    const { actor } = await owner();
    const { result, deltas, outcome } = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      // Not starting with "remember" - see the runTurn() version of this
      // exact test for why (remember's own "remember *" pattern would
      // win Tier 0 outright otherwise, and this test would pass for the
      // wrong reason).
      async () => drainStream(await runTurnStream(actor, "chat", "Friday is pizza night, can you remember that for me")),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") return;
    expect(deltas).toEqual([]);
    expect(outcome && "resolved" in outcome).toBe(true);
    if (!outcome || !("resolved" in outcome)) return;
    expect(outcome.resolved.source).toBe("plugin");
    expect(outcome.resolved.plugin_id).toBe("remember");
    expect(outcome.resolved.routing?.tier).toBe("tool"); // the real proof, not just a same-shaped Tier 0 win
    expect(outcome.resolved.reply.text.length).toBeGreaterThan(0);
    // finalize() hands the resolved value back as-is (same object, every
    // field intact), never a "model" TurnValue rebuilt from the empty
    // delta text.
    const finalized = result.finalize("", outcome);
    expect(finalized).toBe(outcome.resolved);
    expect(finalized.reply.speech).toBe(outcome.resolved.reply.speech);
    expect(finalized.plugin_id).toBe("remember");
  });

  test("runTurnStream(): an ordinary reply (tools offered, model answers in plain text) streams normally, first delta included", async () => {
    const { actor } = await owner();
    // Same non-"remember"-prefixed shape as the two tests above, so this
    // utterance genuinely reaches Tier 2 (offered as a tool) rather than
    // winning Tier 0's own literal pattern outright - the scripted stub
    // has no scriptedToolCalls at all here, so it always falls through
    // to its default echo reply, exactly like a real model that looked
    // at the offered tools and answered in plain text instead.
    const result = await runTurnStream(actor, "chat", "Friday is pizza night, please remember - and tell me a bit about your day too");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("stream"); // proves this did NOT resolve as a tool call
    if (result.kind !== "stream") return;
    const deltas: string[] = [];
    for await (const delta of result.tokens) deltas.push(delta);
    expect(deltas.length).toBeGreaterThan(0);
  });

  // Jesse, live-found 2026-09-07: "what's the latest stephen king novel"
  // never got offered `websearch` at all - 0.66 against a 0.68 floor,
  // one keyword-choice away from the next miss regardless of how many
  // examples websearch's own manifest carries. `websearch` is now
  // ALWAYS offered (prepareTurn(), turnEngine.ts) regardless of its own
  // embedding score, letting the model's own native judgment decide -
  // proven here with an utterance that shares essentially no vocabulary
  // with anything (would score near zero under every candidate,
  // including websearch, under the stub's own bag-of-words scorer),
  // confirming this isn't the usual floor-clearing offer at all.
  test("runTurn(): websearch is offered even when nothing (including websearch itself) clears the ordinary Tier 2 floor", async () => {
    const { actor } = await owner();
    // Recorded independently of whether websearch's own real recipe
    // execution succeeds in this test env (no SearXNG configured) -
    // the offer itself is what's under test, not the resolution
    // outcome, so this can't pass or fail vacuously on that unrelated
    // failure the way asserting on the final TurnValue alone could.
    let sawWebsearchOffered = false;
    await withScriptedToolCalls(
      (request) => {
        if (request.tools?.some((t) => t.function.name === "websearch")) sawWebsearchOffered = true;
        return undefined; // let the stub's default echo answer either way
      },
      () => runTurn(actor, "chat", "good morning"),
    );
    expect(sawWebsearchOffered).toBe(true);
  });

  // getmaipai/home#67, live-found 2026-09-07: "is the movie any good"
  // -> "the odyssey ... nobody's told me" style follow-ups - the model,
  // offered a tool, answered in plain text with a guess instead of
  // calling it; guardReply() correctly caught the guess (an ungrounded
  // proper noun) and replaced it with an honest decline, but nothing
  // then gave the model a real chance to actually look it up, so the
  // household had to say "look it up" outright to get an answer at all.
  //
  // A code review on the first cut of this fix (2026-09-07) found the
  // forced retry offered the model the FULL tool set, not just lookup
  // tools - meaning a caught guess could be "fixed" by the model
  // inventing a call to `remember` instead, writing its own fabricated
  // fact to permanent memory with no confirmation, a worse outcome than
  // the honest decline it replaced. The tests below prove the corrected
  // scoping: the forced retry only ever offers `routing.always_offer`
  // candidates (websearch, the one bundled today), and a proposed call
  // to anything else is rejected outright, never run.
  test("runTurn(): forcing a tool after a guess only offers always_offer (lookup) candidates, never an action package like remember", async () => {
    const { actor } = await owner();
    let forcedToolNames: string[] = [];
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: (request) => {
        if (request.tool_choice !== "required") return undefined;
        forcedToolNames = request.tools?.map((t) => t.function.name) ?? [];
        return undefined; // let the stub's default echo answer either way - only the offered set is under test here
      },
      scriptedChatReply: () => "Your brother said it's playing at Xanadu Cinemas downtown.", // an ungrounded attributed quote the invention guard has to catch
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      // Same non-"remember"-prefixed shape as the tests above it - must
      // reach Tier 2 (offered as a tool, `remember` included) rather
      // than winning Tier 0's own literal pattern outright.
      await runTurn(actor, "chat", "our wifi password is on the fridge, please remember this");
    } finally {
      stub.stop();
    }
    expect(forcedToolNames.length).toBeGreaterThan(0);
    expect(forcedToolNames).toContain("websearch");
    expect(forcedToolNames).not.toContain("remember");
    expect(forcedToolNames).not.toContain("recall");
  });

  // A code review (2026-09-07) caught the invention pre-check building
  // its own guardSentence() context WITHOUT `replyHasQuestion`, unlike
  // the real guardReply() pass a few lines later (guards.ts's own
  // `fullReplyCtx`) - guardCapabilityClaim's own "a later sentence's '?'
  // exempts the whole reply" exemption could then disagree between the
  // two checks, misreading a genuinely fabricated first sentence as a
  // capability claim and silently skipping the retry for the exact turn
  // this fix exists to catch.
  test("runTurn(): the invention pre-check computes replyHasQuestion the same way guardReply() will, so an accepted-sounding opener with a real fabrication still triggers the retry", async () => {
    const { actor } = await owner();
    // CHAT-16 (K2): with the search the only lookup tool ranked, the
    // forced lookup skips the model's rung and runs the search with the
    // engine's query at once; the retained forced outcome is the proof
    // the retry ran (a `tool_choice: required` completion was the proof
    // before the composer took that call).
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: () => undefined,
      // Sentence 0 ("Sure, ...") matches ACCEPTS_RE with no "?" of its
      // own; sentence 1 carries the "?" that guardReply() uses to exempt
      // it. The attributed quote ("your brother said", grounded nowhere)
      // is the household invention the guard has to catch once the
      // capability-claim exemption correctly applies (FAST-05: this used
      // to be "13" from "PG-13", a bare number the retired scan caught).
      scriptedChatReply: () => "Sure, your brother said it's rated PG-13. Did you want showtimes?",
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      // REQUEST_RE-matching ("can you ...") so guardCapabilityClaim's
      // OTHER gate (ctx.outcomes/utterance check) doesn't already
      // exempt sentence 0 on its own, independent of replyHasQuestion.
      const result = await runTurn(actor, "chat", "can you check the odyssey's rating");
      if (!result.ok) throw new Error(result.error);
      const row = db.select({ outcomes: conversationTurns.outcomes }).from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes) as { packageId: string; via?: string }[]) : [];
      expect(outcomes.some((o) => o.packageId === "websearch" && o.via === "forced")).toBe(true);
    } finally {
      stub.stop();
    }
  });

  test("runTurn(): a forced call to a tool that isn't a lookup candidate is rejected, never run - no fact gets written on the model's own say-so", async () => {
    const { actor } = await owner();
    const result = await withScriptedGuessThenForcedTool(
      "Your brother said it's playing at Xanadu Cinemas downtown.",
      // The stub doesn't know about the fix's own scoping - scripts the
      // forced retry proposing `remember` anyway (a model that ignored
      // the offered set, or an older/misbehaving one) to prove
      // resolveToolCalls() itself is the real backstop, not just the
      // fact that websearch is what gets offered.
      [{ id: "call-1", name: "remember", args: '{"fact":"the odyssey is rated PG-13"}' }],
      () => runTurn(actor, "chat", "our wifi password is on the fridge, please remember this"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Rejected (not offered as a lookup candidate) -> resolveToolCalls()
    // returns null -> falls back to the honest decline, never a
    // "plugin" result claiming remember ran.
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).not.toContain("Xanadu");
    const written = db.select().from(memoryRecords).where(eq(memoryRecords.text, "the odyssey is rated PG-13")).all();
    expect(written).toHaveLength(0);
  });

  test("runTurn(): forcing the lookup tool still fails to resolve (bad args) - falls back to the model's own honest decline, never a silent drop", async () => {
    const { actor } = await owner();
    const result = await withScriptedGuessThenForcedTool(
      "Your brother said it's playing at Xanadu Cinemas downtown.",
      [{ id: "call-1", name: "websearch", args: "{}" }], // missing required `expression` - resolveToolCalls() rejects it
      () => runTurn(actor, "chat", "our wifi password is on the fridge, please remember this"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).not.toContain("Xanadu"); // guardReply() still caught the original guess
  });

  test("runTurn(): a guess that only cuts a LATER sentence is never retried - the already-honest earlier sentence stands as is", async () => {
    const { actor } = await owner();
    // "Noted." (sentence 1, clean) then the ungrounded guess (sentence
    // 2) - guardReply() only ever fully replaces a reply when the
    // OFFENDING sentence is the first one; here it just cuts sentence 2
    // and keeps sentence 1, so the forced-retry fix must never fire at
    // all (proven by scripting NO scriptedToolCalls response, which
    // would surface as a mismatched reply if the retry ran anyway).
    const result = await withScriptedGuessThenForcedTool(
      "Noted. Your brother said it's playing at Xanadu Cinemas downtown.",
      [{ id: "call-1", name: "websearch", args: '{"expression":"the odyssey showtimes"}' }],
      () => runTurn(actor, "chat", "our wifi password is on the fridge, please remember this"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).toBe("Noted.");
  });

  // runTurnStream() deliberately does NOT get the retry-with-a-forced-
  // tool-call fix above (see turnEngine.ts's own comment on the revert):
  // buffering a whole first sentence before the function can even return
  // would block the stream's first byte on an unbounded wait, caught
  // live by tests/openai.test.ts's own cancellation test timing out.
  // This documents the real, current behavior instead - the guess still
  // streams token by token, and gateGuards() still catches it (same as
  // before this session's fix) rather than a household ever hearing a
  // fabricated answer.
  test("runTurnStream(): a guessed (ungrounded) answer still streams normally - gateGuards() catches it downstream, no retry", async () => {
    const { actor } = await owner();
    const { result, deltas } = await withScriptedGuessThenForcedTool(
      "Your brother said it's playing at Xanadu Cinemas downtown.",
      [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      async () => drainStream(await runTurnStream(actor, "chat", "our wifi password is on the fridge, please remember this")),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") return;
    expect(deltas.length).toBeGreaterThan(0); // the honest replacement line, at least
    expect(deltas.join("")).not.toContain("Xanadu"); // gateGuards() catches it before it reaches the household
  });
});

describe("resolvePendingAsk()", () => {
  test("no pendingAsk set: null, proceed with normal routing", async () => {
    const { actor, conversationId } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("hello", actor, conv.value, [], "turn-1", SAFE, undefined);
    expect(value).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  test("kind: confirm, an affirmative reply runs the pending package and clears it", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "pizza night is Friday" } });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("yes", actor, conv.value, [], "turn-2", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember");
    expect(getPendingAsk(conversationId)).toBeNull(); // single-shot
  });

  test("kind: confirm, a negative reply declines without running anything and clears it", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "pizza night is Friday" } });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("no thanks", actor, conv.value, [], "turn-2", SAFE, undefined);
    expect(value?.source).toBe("confirm");
    expect(value?.reply.text).toContain("won't");
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  // CHAT-15: an answer that is neither a whole-message yes nor a no
  // runs nothing and is asked once more, plainly; a second unclear
  // answer clears the confirmation and routes as itself.
  test("kind: confirm, an unclear reply asks 'yes or no?' once and runs nothing; the second clears and falls through", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "pizza night is Friday" } });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const outcomes: ToolExecutionOutcome[] = [];
    const first = await resolvePendingAsk("yes, but don't do it", actor, conv.value, [], "turn-2", SAFE, undefined, outcomes);
    expect(first?.source).toBe("confirm");
    expect(first?.reply.text).toBe("Remember that? Yes or no?");
    expect(outcomes.map((o) => o.status)).toEqual(["pending"]);
    expect(getPendingAsk(conversationId)?.clarified).toBe(true);
    const dropped: ToolExecutionOutcome[] = [];
    const second = await resolvePendingAsk("what's on my list", actor, conv.value, [], "turn-3", SAFE, undefined, dropped);
    expect(second).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
    expect(dropped.map((o) => [o.status, o.reason, o.via])).toEqual([["rejected", "unconfirmed", "confirm"]]); // the history says it was dropped, not parked forever
  });

  test("kind: confirm, consent is the whole message: 'yes please.' runs it, 'yes, but don't do it' and 'yes if it is cheap' do not", async () => {
    const { actor, conversationId } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    for (const [answer, runs] of [
      ["yes please.", true],
      ["Sure thing!", true],
      ["ok, go ahead", true],
      ["yeah, sure", true],
      ["yes yes", true],
      ["yes I am sure", true],
      ["Yes,", true],
      ["yes, but don't do it", false],
      ["yes if it is cheap", false],
      ["yes, delete them", false],
    ] as const) {
      setPendingAsk(conversationId, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "pizza night is Friday" } });
      const outcomes: ToolExecutionOutcome[] = [];
      const value = await resolvePendingAsk(answer, actor, conv.value, [], `turn-${answer.length}`, SAFE, undefined, outcomes);
      expect(runs ? value?.source : value?.reply.text).toBe(runs ? "plugin" : "Remember that? Yes or no?");
      expect(outcomes[0]?.status).toBe(runs ? "succeeded" : "pending");
      expect(outcomes[0]?.via).toBe("confirm");
      setPendingAsk(conversationId, null);
    }
  });

  test("kind: ask, the next utterance binds to the package's own required arg and runs it", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "ask", prompt: "Remember what?", packageId: "remember", args: {} });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const loaded = [{ id: "remember", manifest: REMEMBER_CANDIDATE.manifest }];
    const value = await resolvePendingAsk("pizza night is Friday", actor, conv.value, loaded, "turn-2", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember");
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  test("kind: ask, a package that can't bind a raw-text continuation (no manifest found) falls through to null rather than guessing", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "ask", prompt: "Remember what?", packageId: "remember", args: {} });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("pizza night is Friday", actor, conv.value, [], "turn-2", SAFE, undefined); // loaded=[] - manifest not found
    expect(value).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
  });
});

describe("pendingAskFromPluginResult()", () => {
  test("a result carrying confirm stores a PendingAsk and returns its prompt", async () => {
    const { conversationId } = await owner();
    const result: PluginResultWithConfirmAsk = { actions: [], confirm: { prompt: "Really delete it?" } };
    const pending = pendingAskFromPluginResult("some-package", { id: "1" }, result, conversationId);
    expect(pending).toEqual({ prompt: "Really delete it?" });
    expect(getPendingAsk(conversationId)).toEqual({ kind: "confirm", prompt: "Really delete it?", packageId: "some-package", args: { id: "1" } });
  });

  test("a result carrying ask stores a PendingAsk with expects", async () => {
    const { conversationId } = await owner();
    const result: PluginResultWithConfirmAsk = { actions: [], ask: { prompt: "Which one?", expects: "a list item name" } };
    const pending = pendingAskFromPluginResult("some-package", {}, result, conversationId);
    expect(pending).toEqual({ prompt: "Which one?" });
    expect(getPendingAsk(conversationId)).toEqual({ kind: "ask", prompt: "Which one?", packageId: "some-package", args: {}, expects: "a list item name" });
  });

  test("an ordinary result (neither field) returns null and stores nothing", async () => {
    const { conversationId } = await owner();
    const result: PluginResultWithConfirmAsk = { actions: [], reply: { text: "Done." } };
    const pending = pendingAskFromPluginResult("some-package", {}, result, conversationId);
    expect(pending).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
  });
});

// ROUTE-01 (docs/dev/session-a.md, getmaipai/home#80): the Tier 2 offer
// has no similarity floor any more; the bot's shape guard decides
// between the top three plus always-offer (a command) and always-offer
// alone (a question or first-person statement no deterministic tier
// placed).
describe("ROUTE-01: the offer without a floor, and the shape guard in front of it", () => {
  const manifest = (id: string, always_offer = false) => ({ id, description: id, args: {}, routing: always_offer ? { always_offer: true } : {} }) as unknown as RankedCandidate["manifest"];
  const ranked: RankedCandidate[] = [
    { id: "remember", score: 0.41, manifest: manifest("remember") },
    { id: "recall", score: 0.33, manifest: manifest("recall") },
    { id: "define", score: 0.2, manifest: manifest("define") },
    { id: "trivia", score: 0.1, manifest: manifest("trivia") },
    { id: "websearch", score: 0.05, manifest: manifest("websearch", true) },
  ];

  // ROUTE-02: the ordinary set is always-offer alone here (the bare
  // minimum a household can have), so ROUTE-01's own rules show plainly.
  const alwaysOnly = ["websearch"];

  test("selectOfferedTools(): a command-shaped turn offers the top three plus always-offer, with every score under the old floor", () => {
    expect(ranked[0]!.score).toBeLessThan(TIER2_AMBIGUOUS_FLOOR);
    expect(selectOfferedTools(ranked, "command", alwaysOnly).map((t) => t.id)).toEqual(["websearch", "remember", "recall", "define"]);
  });

  test("selectOfferedTools(): a question or first-person turn no tier placed offers the always-offer set alone, never the top three by rank", () => {
    expect(selectOfferedTools(ranked, "question", alwaysOnly).map((t) => t.id)).toEqual(["websearch"]);
    expect(selectOfferedTools(ranked, "first_person", alwaysOnly).map((t) => t.id)).toEqual(["websearch"]);
    expect(selectOfferedTools(ranked, "statement", alwaysOnly).map((t) => t.id)).toEqual(["websearch"]);
  });

  test("selectOfferedTools(): a question Tier 1 placed (threshold and margin) but could not fire still offers that one candidate", () => {
    const placed: RankedCandidate[] = [{ id: "recall", score: 0.8, manifest: manifest("recall") }, ...ranked.filter((r) => r.id !== "recall")];
    expect(selectOfferedTools(placed, "question", alwaysOnly).map((t) => t.id)).toEqual(["websearch", "recall"]);
    // Two close scores are ambiguity, not a placement: the margin rule holds here too.
    const close: RankedCandidate[] = [{ id: "recall", score: 0.8, manifest: manifest("recall") }, { id: "remember", score: 0.76, manifest: manifest("remember") }, ...ranked.filter((r) => r.id !== "recall" && r.id !== "remember")];
    expect(selectOfferedTools(close, "question", alwaysOnly).map((t) => t.id)).toEqual(["websearch"]);
  });

  test("selectOfferedTools(): a package already in the ordinary set is offered once, in the set's place", () => {
    const top: RankedCandidate[] = [{ id: "websearch", score: 0.9, manifest: manifest("websearch", true) }, ...ranked.filter((r) => r.id !== "websearch")];
    expect(selectOfferedTools(top, "command", alwaysOnly).map((t) => t.id)).toEqual(["websearch", "remember", "recall"]);
  });

  // #80's own shape, with a wording no Tier 0 pattern catches (147cd28
  // covers the "please remember" endings) and, under the stub's
  // bag-of-words scorer, a top score under the old floor: before this
  // item the offered set was websearch alone and the model could not
  // have chosen remember however clear the sentence was.
  test("runTurn(): an utterance under the old floor now reaches the remember package when the model chooses it", async () => {
    const { actor } = await owner();
    const text = "Friday is pizza night, keep that in mind";
    const { winner, ranked: real } = await routeSemantic(text, actor, loadAllManifests(), await embedUtterance(text));
    expect(winner).toBeNull();
    expect(real[0]!.score).toBeLessThan(TIER2_AMBIGUOUS_FLOOR);
    expect(real.slice(0, 3).map((r) => r.id)).toContain("remember");
    let offered: string[] = [];
    const result = await withScriptedToolCalls(
      (request) => {
        offered = (request.tools ?? []).map((t) => t.function.name);
        return offered.includes("remember") ? [{ id: "call-1", name: "remember", args: JSON.stringify({ fact: "Friday is pizza night" }) }] : undefined;
      },
      () => runTurn(actor, "chat", text),
    );
    expect(offered).toContain("remember");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
  });

  test("runTurn(): a question no tier placed is offered the ordinary set alone, never a guessed package", async () => {
    const { actor } = await owner();
    let offered: string[] | undefined;
    await withScriptedToolCalls(
      (request) => {
        offered = (request.tools ?? []).map((t) => t.function.name);
        return undefined;
      },
      () => runTurn(actor, "chat", "who won the 1998 world cup"),
    );
    // ROUTE-02: the ordinary set (a household with no usage yet: the
    // default order plus always-offer), and nothing by rank.
    expect(offered).toEqual(ordinaryToolIds(loadAllManifests(), { byPlugin: [] }));
    expect(offered).toContain("websearch");
  });

  test("a [route] trace line is printed once per decision with tier, shape, top, runner-up, margin and the offered ids", async () => {
    const { actor } = await owner();
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      const line = args.map(String).join(" ");
      if (line.startsWith("[route] ")) lines.push(line);
      original(...args);
    };
    try {
      await withScriptedToolCalls(
        () => undefined,
        () => runTurn(actor, "chat", "the plumber's number is 555 9876 extension 12, keep that on file"),
      );
    } finally {
      console.log = original;
    }
    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0]!.slice("[route] ".length)) as Record<string, unknown>;
    expect(record.tier).toBe("tier2");
    expect(record.shape).toBe("statement");
    expect(record.winner).toBeNull();
    expect((record.top as { id: string; score: number }).id).toBeString();
    expect(typeof (record.top as { score: number }).score).toBe("number");
    expect(record.runner_up).toBeDefined();
    expect(typeof record.margin).toBe("number");
    expect(record.offered).toContain("websearch");
    expect(JSON.stringify(record)).not.toContain("plumber"); // ids and numbers, never the utterance
  });
});

// LAT-02/U1 (docs/plans/simple-turn-pipeline-2026-09-22.md): the
// offered set stays stable within a conversation, so the prompt cache
// survives. selectOfferedTools() itself, and every test above, is
// unchanged - stickyOfferedTools() wraps it with a per-conversation
// union.
describe("LAT-02/U1: the sticky per-conversation offered set", () => {
  const manifest = (id: string, always_offer = false) => ({ id, description: id, args: {}, routing: always_offer ? { always_offer: true } : {} }) as unknown as RankedCandidate["manifest"];
  const ranked: RankedCandidate[] = [
    { id: "remember", score: 0.41, manifest: manifest("remember") },
    { id: "recall", score: 0.33, manifest: manifest("recall") },
    { id: "define", score: 0.2, manifest: manifest("define") },
    { id: "trivia", score: 0.1, manifest: manifest("trivia") },
    { id: "websearch", score: 0.05, manifest: manifest("websearch", true) },
  ];
  const alwaysOnly = ["websearch"];

  beforeEach(() => __resetStickyOfferedToolsForTests());

  test("two consecutive command-shaped turns in the same conversation earning the same candidate produce the identical tools block", () => {
    const first = stickyOfferedTools("conv-a", ranked, "command", alwaysOnly);
    const second = stickyOfferedTools("conv-a", ranked, "command", alwaysOnly);
    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
    expect(first).toEqual(second);
  });

  test("a lookup candidate earned on turn 1 stays offered on turn 2, even when turn 2's own utterance would not have earned it", () => {
    // Turn 1: a command shape earns the top three plus always-offer -
    // "remember" and "recall" are earned live this turn too (returned
    // below), but only "define" (a typed-source lookup, isStickyEligible())
    // carries into a later turn; stickyOfferedTools() sorts the sticky
    // extras by id (never by score), the same stability convention the
    // ordinary set already uses, so this is not selectOfferedTools()'s
    // own score order.
    const turn1 = stickyOfferedTools("conv-b", ranked, "command", alwaysOnly);
    expect(turn1.map((t) => t.id)).toEqual(["websearch", "define", "recall", "remember"]);
    // Turn 2: a question shape that Tier 1 placed nothing for would, on
    // its own, offer only the always-offer set (selectOfferedTools()'s
    // own rule, proven in ROUTE-01 above) - the sticky set keeps the
    // one lookup candidate turn 1 earned, a superset of the always-offer
    // set, but "remember" and "recall" are gone: they were never sticky.
    const turn2 = stickyOfferedTools("conv-b", ranked, "question", alwaysOnly);
    expect(turn2.map((t) => t.id)).toEqual(["websearch", "define"]);
    expect(selectOfferedTools(ranked, "question", alwaysOnly).map((t) => t.id)).toEqual(["websearch"]); // the un-wrapped function is unaffected
  });

  test("a later turn earning one more lookup candidate only grows the set, in id order after the ordinary prefix", () => {
    const turn1 = stickyOfferedTools("conv-c", ranked, "question", alwaysOnly); // earns nothing beyond always-offer
    expect(turn1.map((t) => t.id)).toEqual(["websearch"]);
    const placed: RankedCandidate[] = [{ id: "define", score: 0.8, manifest: manifest("define") }, ...ranked.filter((r) => r.id !== "define")];
    const turn2 = stickyOfferedTools("conv-c", placed, "question", alwaysOnly); // Tier 1 placed "define" this turn
    expect(turn2.map((t) => t.id)).toEqual(["websearch", "define"]);
    const turn3 = stickyOfferedTools("conv-c", ranked, "question", alwaysOnly); // back to earning nothing new - "define" stays
    expect(turn3.map((t) => t.id)).toEqual(["websearch", "define"]);
  });

  // Found live by this item's own gate run (conversationBench.test.ts's
  // "consequential-once" and "never-mind-on-an-ask" rows): a package
  // that WRITES or ACTS (remember, timer, lock-doors) must never stay
  // reachable past the turn that earned it, or a later, unrelated turn
  // can fire it with a stale or absent argument - `consequential` alone
  // was not a wide enough gate (`timer` is not consequential and still
  // triggers the identical class of bug), so isStickyEligible() allows
  // only a typed-source lookup (websearch, or ruleNames.ts's own
  // isTypedSourcePackage: define/convert/math/trivia/weather/news/
  // sports/currency/knowledge/media-lookup/almanac*), never a write or
  // an action.
  test("a write package (remember, earned but not a lookup) is offered live but never made sticky", () => {
    const writeHeavy: RankedCandidate[] = [
      { id: "remember", score: 0.9, manifest: manifest("remember") },
      { id: "websearch", score: 0.05, manifest: manifest("websearch", true) },
    ];
    const turn1 = stickyOfferedTools("conv-g", writeHeavy, "command", alwaysOnly);
    expect(turn1.map((t) => t.id)).toEqual(["websearch", "remember"]); // earned live this turn
    const turn2 = stickyOfferedTools("conv-g", ranked, "question", alwaysOnly); // an unrelated later turn
    expect(turn2.map((t) => t.id)).toEqual(["websearch"]); // "remember" did not persist
  });

  test("two different conversations never share a sticky set", () => {
    stickyOfferedTools("conv-d", ranked, "command", alwaysOnly);
    const other = stickyOfferedTools("conv-e", ranked, "question", alwaysOnly);
    expect(other.map((t) => t.id)).toEqual(["websearch"]);
  });

  // A code review (2026-09-22) on this item: a sticky id that later
  // joins the ordinary set (an install changed ordinaryToolIdsForInstalled()'s
  // own memoized key mid-conversation) must never be offered twice.
  test("a sticky candidate that later joins the ordinary set is never offered twice", () => {
    const turn1 = stickyOfferedTools("conv-h", ranked, "command", alwaysOnly); // earns "define" (sticky)
    expect(turn1.map((t) => t.id)).toContain("define");
    // A later turn's ordinary set now includes "define" too (as if a
    // usage-stats change promoted it - ROUTE-02's own mechanism).
    const widerOrdinary = ["define", "websearch"];
    const turn2 = stickyOfferedTools("conv-h", ranked, "question", widerOrdinary);
    const ids = turn2.map((t) => t.id);
    expect(ids.filter((id) => id === "define").length).toBe(1);
    expect(ids).toEqual(["define", "websearch"]);
  });

  test("a candidate already in the ordinary set is never duplicated into the sticky extras", () => {
    const top: RankedCandidate[] = [{ id: "websearch", score: 0.9, manifest: manifest("websearch", true) }, ...ranked.filter((r) => r.id !== "websearch")];
    const turn1 = stickyOfferedTools("conv-f", top, "command", alwaysOnly);
    expect(turn1.map((t) => t.id)).toEqual(["websearch", "recall", "remember"]); // extras sorted by id
    const turn2 = stickyOfferedTools("conv-f", ranked, "question", alwaysOnly);
    expect(turn2.map((t) => t.id).filter((id) => id === "websearch").length).toBe(1);
  });
});

// ROUTE-02 (docs/dev/session-a.md): the ordinary tool set, byte-identical
// across ordinary turns so the prompt prefix survives; a command turn
// appends only the extras the set lacks.
describe("ROUTE-02: a stable ordinary tool set", () => {
  const manifest = (id: string, always_offer = false) => ({ id, description: id, args: {}, kind: "plugin", routing: always_offer ? { always_offer: true } : {} }) as unknown as RankedCandidate["manifest"];
  const installed = ["weather", "remember", "trivia", "recall", "websearch", "timer", "joke", "define", "remind", "lights-on"].map((id) => ({ id, manifest: manifest(id, id === "websearch") }));

  const tool = (n: number) => ({ tool: n });

  test("ordinaryToolIds(): the most used by Tier 2 wins first, a multi-call id counting for both, the default order on ties, always-offer always present, sorted by id", () => {
    const usage = { byPlugin: [{ pluginId: "joke", count: 9, tier: tool(9) }, { pluginId: "define+trivia", count: 4, tier: tool(4) }, { pluginId: "trivia", count: 1, tier: tool(1) }] };
    // joke 9, trivia 5 (define 4 misses the cut at N=2); always-offer on top
    expect(ordinaryToolIds(installed, usage)).toEqual(["joke", "trivia", "websearch"]);
    // A tie is broken by the default order, then by id.
    expect(ordinaryToolIds(installed, { byPlugin: [{ pluginId: "joke", count: 2, tier: tool(2) }, { pluginId: "recall", count: 2, tier: tool(2) }, { pluginId: "timer", count: 2, tier: tool(2) }] })).toEqual(["recall", "timer", "websearch"]);
  });

  test("ordinaryToolIds(): an empty household gets always-offer plus the default order", () => {
    expect(ordinaryToolIds(installed, { byPlugin: [] })).toEqual(["recall", "remember", "websearch"]);
  });

  test("ordinaryToolIds(): pattern and embedding wins do not count, so a household's timer habit never evicts the memory pair (code review)", () => {
    const usage = { byPlugin: [{ pluginId: "timer", count: 40, tier: { pattern: 40, embedding: 0, keyword: 0, tool: 0 } }, { pluginId: "weather", count: 30, tier: { pattern: 25, embedding: 5, keyword: 0, tool: 0 } }] };
    expect(ordinaryToolIds(installed, usage)).toEqual(["recall", "remember", "websearch"]);
  });

  test("ordinaryToolIds(): the same inputs give the same set every time, whatever the input order", () => {
    const usage = { byPlugin: [{ pluginId: "joke", count: 3, tier: tool(3) }, { pluginId: "timer", count: 3, tier: tool(3) }] };
    const a = ordinaryToolIds(installed, usage);
    const b = ordinaryToolIds([...installed].reverse(), { byPlugin: [...usage.byPlugin].reverse() });
    expect(a).toEqual(b);
    expect(a).toEqual(["joke", "timer", "websearch"]);
  });

  test("ordinaryToolIds(): a package in the stats that is no longer installed is ignored", () => {
    expect(ordinaryToolIds(installed, { byPlugin: [{ pluginId: "gone", count: 99, tier: tool(99) }] })).toEqual(["recall", "remember", "websearch"]);
  });

  test("selectOfferedTools(): the ordinary set comes first in id order, a command's extras after it, nothing twice", () => {
    const ranked: RankedCandidate[] = [
      { id: "joke", score: 0.5, manifest: manifest("joke") },
      { id: "remember", score: 0.4, manifest: manifest("remember") },
      { id: "trivia", score: 0.3, manifest: manifest("trivia") },
      { id: "recall", score: 0.2, manifest: manifest("recall") },
      { id: "websearch", score: 0.1, manifest: manifest("websearch", true) },
    ];
    const ordinary = ["recall", "remember", "websearch"];
    expect(selectOfferedTools(ranked, "command", ordinary).map((t) => t.id)).toEqual(["recall", "remember", "websearch", "joke", "trivia"]);
    expect(selectOfferedTools(ranked, "statement", ordinary).map((t) => t.id)).toEqual(["recall", "remember", "websearch"]);
    expect(selectOfferedTools(ranked, "question", ordinary).map((t) => t.id)).toEqual(["recall", "remember", "websearch"]);
  });

  test("runTurn(): a command turn's request renders the ordinary base first, in its fixed order, then the extras", async () => {
    const { actor } = await owner();
    let names: string[] = [];
    await withScriptedToolCalls(
      (request) => {
        names = (request.tools ?? []).map((t) => t.function.name);
        return undefined;
      },
      () => runTurn(actor, "chat", "tell me something nice about mornings"),
    );
    const base = ordinaryToolIds(loadAllManifests(), { byPlugin: [] });
    expect(names.slice(0, base.length)).toEqual(base); // the cached prefix
    expect(names.length).toBeGreaterThan(base.length); // "tell" is a command opener: extras follow
    expect(new Set(names).size).toBe(names.length);
  });

  test("runTurn(): two consecutive conversational turns send byte-identical tool lists", async () => {
    const { actor } = await owner();
    const seen: string[] = [];
    await withScriptedToolCalls(
      (request) => {
        seen.push(JSON.stringify(request.tools));
        return undefined;
      },
      async () => {
        await runTurn(actor, "chat", "good morning");
        await runTurn(actor, "chat", "I'm feeling kind of down");
        await runTurn(actor, "chat", "who won the 1998 world cup");
      },
    );
    expect(seen.length).toBe(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    const ids = (JSON.parse(seen[0]!) as { function: { name: string } }[]).map((t) => t.function.name);
    expect(ids).toContain("websearch");
    expect(ids).toContain("remember"); // the default order on a household with no usage yet
    expect(ids).toEqual([...ids].sort());
  });
});

// CHAT-04 (a code review): the streaming path guards each sentence with
// a context read at the moment of the check, so an outcome pushed by
// resolveToolCalls() inside the stream (every proposed call failed, then
// the no-tools retry) reaches the action-claim guard. A prepare-time
// snapshot carried empty outcomes and narrated "nothing ran" where the
// blocking path said "failed"; both paths now say the same thing.
describe("CHAT-04: a failed tool call inside the stream reaches the action-claim guard on both paths", () => {
  async function withFailedRememberThenClaim<T>(fn: () => Promise<T>): Promise<T> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: (request) => {
        if (!request.tools || request.tools.length === 0) return undefined;
        return [{ id: "call-1", type: "function" as const, function: { name: "remember", arguments: "{}" } }]; // missing required `fact`: fails
      },
      scriptedChatReply: () => "I saved that to your memory.",
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn();
    } finally {
      stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  }
  const UTTERANCE = "our wifi password is on the fridge, please remember this";

  test("runTurnStream(): the retry's save claim is narrated as the failure the remember call reported, never as 'nothing ran'", async () => {
    const { actor } = await owner();
    const { deltas } = await withFailedRememberThenClaim(async () => drainStream(await runTurnStream(actor, "chat", UTTERANCE)));
    expect(deltas.join("").trim()).toBe("That didn't get saved.");
  });

  test("runTurn(): the blocking path says the same", async () => {
    const { actor } = await owner();
    const result = await withFailedRememberThenClaim(() => runTurn(actor, "chat", UTTERANCE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reply.text).toBe("That didn't get saved.");
  });
});
