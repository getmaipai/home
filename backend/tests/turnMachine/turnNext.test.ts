// U2 (docs/plans/turn-machine-state-record-2026-09-22.md, "Acceptance"):
// the new path's own tests, mirroring conversationBench.test.ts's own
// stub pattern (the real runner, a stub chat backend, a fake SearXNG) -
// never a second, bespoke harness. Exercises turnNext.ts end to end
// (the machine, every node, the real DB) with scripted model behaviour,
// since no live engine is available in this suite.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { createBenchPeople, startRecordingProxy, startFakeSearxng, type BenchPeople, type FakeSearxng } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { CATALOG } from "@/lib/modelCatalog";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { getPendingAsk } from "@/lib/conversationHistory";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NO_RECORD_BUDGET } from "@/lib/turnMachine/budget";
import { ensureSubjectEntity } from "@/lib/subjects";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  people = createBenchPeople();
  // A real, measured budget lives on the 8B catalog entry (U2a); tests
  // select it by id so `resolveTurnBudget()` reads the same record
  // production does, never a hand-built test-only shape.
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function withStub<T>(
  opts: { reply?: (request: ChatCompletionRequest) => string; calls?: (request: ChatCompletionRequest) => { id: string; name: string; args: string }[] | undefined },
  fn: () => Promise<T>,
): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: opts.reply,
    scriptedToolCalls: (request) => {
      if (!request.tools || request.tools.length === 0) return undefined;
      return opts.calls?.(request)?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }));
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  // llmSupervisor.ts caches the resolved chat client against the URL
  // seen on its first call; a test that starts a second stub on a new
  // port (a resumed continuation, a second turn) needs a fresh
  // resolution or it keeps dialing the first stub's now-closed port
  // ("could not reach ..."). afterEach() resets it between tests, but
  // two withStub() calls inside the SAME test both need this too.
  __resetLlmSupervisorForTests();
  try {
    return await fn();
  } finally {
    proxy.stop();
    stub.stop();
  }
}

describe("turnNext.ts: a plain question, no tools", () => {
  test('"hi" is a text answer with every node in the trace', async () => {
    const result = await withStub({ reply: () => "Hello! How can I help?" }, () => runTurnNext(people.owner, "chat", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text.length).toBeGreaterThan(0);
    expect(result.value.source).toBe("model");
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    expect(row).toBeDefined();
    const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string }[] };
    const nodeNames = (stats.nodes ?? []).map((n) => n.node);
    // The state record's own acceptance: "all eight nodes present (ran
    // or skipped)" - "hi" never calls a tool, so policy/tool only
    // appear here via TraceRecorder.skip() (a code review, 2026-09-22:
    // it was never called, so these two were silently absent).
    for (const expected of ["safety", "commands", "context", "model", "policy", "tool", "answer", "output_gate"]) {
      expect(nodeNames).toContain(expected);
    }
  });
});

describe("turnNext.ts: the interim rule", () => {
  test("a world question runs the search tool and answers with sources", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result.value.reply.text.length).toBeGreaterThan(0);
      // A live acceptance run (U2d) caught buildTurnValue() (turnNext.ts)
      // never carrying plugin_id or sources onto TurnValue at all - every
      // scripted test here only checked reply.text, so this real gap
      // reached the live run undetected. conversationRunner.ts's own
      // scorer reads exactly these two top-level fields.
      expect(result.value.plugin_id).toBe("websearch");
      expect(result.value.sources?.length).toBeGreaterThan(0);
    } finally {
      searxng.stop();
    }
  });
});

describe("turnNext.ts: the household-subject rule", () => {
  test("a search naming a household member asks instead of running", async () => {
    // The household-subject rule (turn-machine-state-record-2026-09-22.md
    // "The interim rule", state-record acceptance's own "a household-
    // subject search asks"): a real roster entry, the same
    // ensureSubjectEntity() path ask01.test.ts already uses for a
    // household member's entity, so subjectRosterFor() (nodes/context.ts's
    // "roster" items) actually carries "Bramble" for policy.ts's own
    // speakerNamedAny() check to find.
    const made = ensureSubjectEntity(people.owner, { name: "Bramble", kind: "person" }, true);
    if (!made.ok) throw new Error(made.error);

    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "Bramble's science fair project" }) }];
          },
          reply: () => "searching",
        },
        () => runTurnNext(people.owner, "chat", "what's bramble's science fair project about"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.source).toBe("confirm");
      expect(searxng.queries.length).toBe(0);
      const ask = getPendingAsk(result.value.conversation_id);
      expect(ask).not.toBeNull();
      expect(ask?.packageId).toBe("websearch");
    } finally {
      searxng.stop();
    }
  });
});

describe("turnNext.ts: a custom household command reports its bare id", () => {
  test("command_id is the bare command id, never \"command:<id>\"", async () => {
    // A review caught commands.ts tagging this outcome's packageId as
    // "command:<id>" (an internal prefix meant for callId, copied
    // here too by mistake) - turnEngine.ts's own reference builder
    // reports the bare id (matchedCommand.id) on the wire.
    const { createCommand } = await import("@/lib/commands");
    const created = createCommand(people.owner, "movie night", "child", { kind: "reply", text: "Starting movie night mode." });
    if (!created.ok) throw new Error(created.error);
    const result = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "movie night"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.source).toBe("command");
    expect(result.value.command_id).toBe(created.value.id);
  });
});

describe("turnNext.ts: a matched bundled package reports plugin_id, never command_id", () => {
  test('"remember that ..." (a literal pattern on a bundled package) reports source "plugin" with plugin_id', async () => {
    // A SECOND live run (after the plugin_id/sources fix landed) still
    // read control-remember-pizza-night as "tool: ran none (source
    // command)": this test's own first draft had asserted source
    // "command"/command_id "remember", copying commands.ts's own via
    // ("pattern") straight to a source label without checking
    // turnEngine.ts's real convention - "remember" is a bundled
    // CATALOG package matched by a literal pattern (commands.ts's
    // second loop, via "pattern"), and the old path reports every
    // bundled-package match as source "plugin" with plugin_id,
    // whatever matched it; "command"/command_id is for a household's
    // own custom command only (matchCommand, via "command").
    // conversationRunner.ts's scorer reads plugin_id exclusively for
    // its "tool" check - it has no command_id fallback at all.
    const result = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "remember that pizza night is Friday"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
    expect(result.value.command_id).toBeUndefined();
  });
});

describe("turnNext.ts: budget.model_transitions false", () => {
  test("no tool call is ever offered, whatever the model would otherwise choose", async () => {
    const noToolsBudget = { ...NO_RECORD_BUDGET, model_transitions: false, rounds: 0 as const };
    const original = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget;
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = noToolsBudget;
    let sawTools = false;
    try {
      const result = await withStub(
        {
          reply: (request) => {
            if (request.tools && request.tools.length > 0) sawTools = true;
            return "The Pi answers on its own.";
          },
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      expect(sawTools).toBe(false);
    } finally {
      CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = original;
    }
  });
});

describe("turnNext.ts: consent and confirmation", () => {
  test("a consequential proposal parks in asked and resumes on yes", async () => {
    // lock-doors is consequential but not in the 8B's small ordinary
    // set (ORDINARY_DEFAULT_ORDER); a real household's ranked offer
    // (routing.ts, gone with the old path) has no new-path replacement
    // yet (BACKLOG's own open gap for the household's non-ordinary
    // packages), so this test offers it directly via the budget the
    // same way a future ranked set would, to exercise policy's own
    // consent gate for a real consequential manifest.
    const original = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget;
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...original!.tools_offered, "lock-doors"] };
    const parked = await withStub(
      {
        calls: (request) => (request.tools?.some((t) => t.function.name === "lock-doors") ? [{ id: "call-1", name: "lock-doors", args: "{}" }] : undefined),
        reply: () => "locking",
      },
      () => runTurnNext(people.owner, "chat", "lock the doors"),
    );
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = original;
    expect(parked.ok).toBe(true);
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    expect(parked.value.source).toBe("confirm");

    const ask = getPendingAsk(parked.value.conversation_id);
    expect(ask).not.toBeNull();
    expect(ask?.packageId).toBe("lock-doors");

    const resumed = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "yes", { conversationId: parked.value.conversation_id }));
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
    expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    // A review caught turnNext.ts forcing source to "confirm" for
    // every resumed action, whether it actually ran a package or not -
    // turnEngine.ts's own reference builder reports "plugin" (with
    // plugin_id) once the confirmed action really executes, matching
    // what conversationRunner.ts's scorer and any real client expect.
    expect(resumed.value.source).toBe("plugin");
    expect(resumed.value.plugin_id).toBe("lock-doors");
  });
});

describe("turnNext.ts: the commands node's own guards", () => {
  test("a temporary chat's \"remember that\" never bypasses the temporary-mode gate", async () => {
    // A code review (2026-09-22) caught the commands node's literal-
    // pattern loop with no CHAT-PARITY-02 guard (turnEngine.ts ~2792):
    // "remember" is consequential:false with routing.patterns AND
    // permissions ["memory:write"], so an unpatched loop runs it
    // straight from `commands` on the exact pattern match, before the
    // model or `policy`'s own temporary_mode check ever sees the turn.
    // The stub gives no scripted tool call, so a memory row can only
    // appear here via that bypass, never via the model choosing to
    // call `remember` itself.
    const { memoryRecords } = await import("@/db/schema");
    const result = await withStub({ reply: () => "Got it, but this won't stick around." }, () =>
      runTurnNext(people.owner, "chat", "remember that Friday is pizza night", { temporary: true }),
    );
    expect(result.ok).toBe(true);
    expect(db.select().from(memoryRecords).all().length).toBe(0);
  });
});

describe("turnNext.ts: policy refusals without a parked ask", () => {
  test("a child's tool call below its role answers with the min_role refusal line, not a blank reply", async () => {
    // A code review (2026-09-22) caught machine.ts's own `answer` step
    // with no producer for `policy`'s "every proposal refused, nothing
    // parked" exit (policyAllRefused) - it fell through to an empty
    // model_text reply where the state table promises "the refusal
    // line for min_role."
    const original = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget;
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...original!.tools_offered, "lock-doors"] };
    let result: Awaited<ReturnType<typeof runTurnNext>>;
    try {
      result = await withStub(
        {
          calls: (request) => (request.tools?.some((t) => t.function.name === "lock-doors") ? [{ id: "call-1", name: "lock-doors", args: "{}" }] : undefined),
          reply: () => "locking",
        },
        () => runTurnNext(people.child, "chat", "lock the doors"),
      );
    } finally {
      CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = original;
    }
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe("That one needs a grown-up.");
  });
});

describe("turnNext.ts: temporary chat", () => {
  test("writes no conversation_turns row, and its own context carries the second turn", async () => {
    const first = await withStub({ reply: () => "First reply, in the moment." }, () => runTurnNext(people.owner, "chat", "hello", { temporary: true }));
    expect(first.ok).toBe(true);
    if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");

    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, first.value.conversation_id)).all();
    expect(rows.length).toBe(0);

    let sawFirstTurn = false;
    const second = await withStub(
      {
        reply: (request) => {
          if (request.messages.some((m) => m.content.includes("First reply, in the moment."))) sawFirstTurn = true;
          return "Second reply.";
        },
      },
      () => runTurnNext(people.owner, "chat", "and then?", { conversationId: first.value.conversation_id }),
    );
    expect(second.ok).toBe(true);
    expect(sawFirstTurn).toBe(true);
  });
});

describe("turnNext.ts: reasoning is a second output", () => {
  async function modelNodeReasoning(turnId: string): Promise<{ emitted: boolean; withheld_for: string | null } | undefined> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; reasoning?: { emitted: boolean; withheld_for: string | null } }[] };
    return (stats.nodes ?? []).find((n) => n.node === "model")?.reasoning;
  }

  test("a child's turn emits no reasoning, and the trace says why", async () => {
    const result = await withStub({ reply: () => "<think>internal reasoning here</think>Hi there!" }, () => runTurnNext(people.child, "chat", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reasoning).toBeUndefined();
    expect(await modelNodeReasoning(result.value.turn_id)).toEqual({ emitted: false, withheld_for: "minor" });
  });

  test("a robot-surface turn emits no reasoning, and the trace says why", async () => {
    const result = await withStub({ reply: () => "<think>internal reasoning here</think>Hi there!" }, () => runTurnNext(people.owner, "robot", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reasoning).toBeUndefined();
    expect(await modelNodeReasoning(result.value.turn_id)).toEqual({ emitted: false, withheld_for: "surface" });
  });

  test("an adult's typed-chat turn emits its reasoning", async () => {
    const result = await withStub({ reply: () => "<think>internal reasoning here</think>Hi there!" }, () => runTurnNext(people.owner, "chat", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reasoning).toBe("internal reasoning here");
    expect(await modelNodeReasoning(result.value.turn_id)).toEqual({ emitted: true, withheld_for: null });
  });

  // VOICE-LIVE-02: a live voice session posts on surface "chat" too (the
  // same route, the same conversation), so the surface field alone can't
  // gate this - the state record's own "voice never shows reasoning"
  // has to reach a spoken turn even when `surface === "chat"`.
  test("an adult's SPOKEN chat turn emits no reasoning, and the trace says why", async () => {
    const result = await withStub({ reply: () => "<think>internal reasoning here</think>Hi there!" }, () => runTurnNext(people.owner, "chat", "hi", { spoken: true }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reasoning).toBeUndefined();
    expect(await modelNodeReasoning(result.value.turn_id)).toEqual({ emitted: false, withheld_for: "surface" });
  });

  test("a reasoning span quoting unsafe content is refused at the gate; the answer is unaffected", async () => {
    // The same established harmful_request trigger tests/safety.test.ts
    // already uses (forOutput() refuses on any refuse category
    // whatever the speaker's own band) - never a new unsafe string
    // invented for this test.
    const result = await withStub(
      { reply: () => "<think>Here is how to make a pipe bomb at home, step by step.</think>The weather is nice today." },
      () => runTurnNext(people.owner, "chat", "hi"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reasoning).toBeUndefined();
    expect(result.value.reply.text).toBe("The weather is nice today.");
    expect(await modelNodeReasoning(result.value.turn_id)).toEqual({ emitted: false, withheld_for: "gate" });
  });
});

describe("turnNext.ts: U4, the answer register by surface", () => {
  async function firstGenerationMaxTokens(turnId: string): Promise<number | null | undefined> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { max_tokens: number | null }[] };
    return stats.generations?.[0]?.max_tokens;
  }

  // "how do I make a paper airplane" (a self-target question, checked
  // live against classifyTurnSignal): never the world, so the interim
  // always-search rule never fires on it and no command or almanac
  // pattern claims it either - the plain one-call path on both
  // surfaces, isolating the register's own effect on max_tokens from
  // the tool-calling machinery.
  test("a typed chat question's completion runs with the written plan's max_tokens, not today's 120", async () => {
    const result = await withStub({ reply: () => "Fold it in half, then fold the corners in." }, () => runTurnNext(people.owner, "chat", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // Written, no evidence: this row never runs a tool at all (a
    // self-target question, never the world), so U4c's post-tool-round
    // recompute never fires and the plan stays exactly what
    // turnNext.ts computed up front - 220 words * model.ts's own
    // maxTokensFor ceiling (max_words * 2) = 440. The evidence-boosted
    // row is covered by the "U4c" describe block below, on a row whose
    // tool round actually returns something.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(440);
  });

  test("a robot question's completion keeps today's spoken plan, unchanged", async () => {
    const result = await withStub({ reply: () => "Fold it in half, then fold the corners in." }, () => runTurnNext(people.owner, "robot", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // Spoken keeps the act table exactly: a question is 60 words * 2 = 120.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(120);
  });
});

// U4c (docs/BACKLOG.md): the plan turnNext.ts computes up front always
// has evidence hardcoded to zero, since nothing has run yet at that
// point - correct for the first (forced-call) generation, but the
// machine's own `derivePlanFromEvidence` action (machine.ts, wired
// into the `tool` state's `onDone`) re-derives it from the tool
// round's real outcomes before the phrasing generation and before
// `answer`. The phrasing round is always the last entry in
// `state.generations` for these two-round tool-call turns (the forced
// call, then the phrase-from-result call), so reading the last
// generation's own max_tokens - not the first's - is what proves the
// recompute actually reached the request that matters.
describe("turnNext.ts: U4c, the plan recomputes from real tool-round evidence", () => {
  async function lastGenerationMaxTokens(turnId: string): Promise<number | null | undefined> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { max_tokens: number | null }[] };
    const generations = stats.generations ?? [];
    return generations[generations.length - 1]?.max_tokens;
  }

  test("a written question whose tool round returns one source gets the evidence-boosted plan row", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.sources?.length).toBeGreaterThan(0);
      // Written, evidence.sources >= 1: 360 words * maxTokensFor's
      // ceiling (max_words * 2) = 720, not the base row's 440.
      expect(await lastGenerationMaxTokens(result.value.turn_id)).toBe(720);
    } finally {
      searxng.stop();
    }
  });

  test("a written question whose tool round returns nothing keeps the base plan row", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          // The fake SearXNG's own "no results fixture" query (used
          // elsewhere for the empty_rows composer row) returns zero
          // results regardless of the real utterance - a succeeded
          // outcome with no sources, so evidence.sources stays 0 and
          // the base row should hold even though a tool round ran.
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "no results fixture" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "I couldn't find anything on that." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.sources?.length ?? 0).toBe(0);
      // Written, no real evidence despite the tool round running: the
      // base row, 220 words * 2 = 440, exactly like no tool round at all.
      expect(await lastGenerationMaxTokens(result.value.turn_id)).toBe(440);
    } finally {
      searxng.stop();
    }
  });
});

describe("turnNext.ts: GROUND-01, thinking_for_minors", () => {
  test("a minor's turn sends thinking:false by default", async () => {
    let sawThinking: unknown;
    const result = await withStub(
      {
        reply: (request) => {
          sawThinking = request.chat_template_kwargs?.enable_thinking;
          return "Hi there!";
        },
      },
      () => runTurnNext(people.child, "chat", "hi"),
    );
    expect(result.ok).toBe(true);
    expect(sawThinking).toBe(false);
  });

  test("an adult's turn with no toggle sends thinking:false too (THINK-DEFAULT-01: 0 is the default for everyone, not just a minor)", async () => {
    let sawThinking: unknown;
    const result = await withStub(
      {
        reply: (request) => {
          sawThinking = request.chat_template_kwargs?.enable_thinking;
          return "Hi there!";
        },
      },
      () => runTurnNext(people.owner, "chat", "hi"),
    );
    expect(result.ok).toBe(true);
    expect(sawThinking).toBe(false);
  });
});

describe("turnNext.ts: THINK-DEFAULT-01, thinking is the person's per-turn toggle", () => {
  test("an adult's turn with thinking: true sends thinking:true (the 8B's thinking_budget_tokens_toggled is 512)", async () => {
    let sawThinking: unknown;
    const result = await withStub(
      {
        reply: (request) => {
          sawThinking = request.chat_template_kwargs?.enable_thinking;
          return "Hi there!";
        },
      },
      () => runTurnNext(people.owner, "chat", "hi", { thinking: true }),
    );
    expect(result.ok).toBe(true);
    expect(sawThinking).toBe(true);
  });

  test("a minor's turn with thinking: true still sends thinking:false (the minor gate wins regardless of the toggle)", async () => {
    let sawThinking: unknown;
    const result = await withStub(
      {
        reply: (request) => {
          sawThinking = request.chat_template_kwargs?.enable_thinking;
          return "Hi there!";
        },
      },
      () => runTurnNext(people.child, "chat", "hi", { thinking: true }),
    );
    expect(result.ok).toBe(true);
    expect(sawThinking).toBe(false);
  });
});

describe("turnNext.ts: ENGINE-CONTRACT-02, a required miss falls to the builder row", () => {
  async function modelNodeOutcomes(turnId: string): Promise<{ ok?: boolean; required_miss?: boolean }[]> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean; required_miss?: boolean } }[] };
    return (stats.nodes ?? []).filter((n) => n.node === "model").map((n) => n.outcome ?? {});
  }

  test('a scripted engine that returns content to a required call produces a searched answer, the trace shows required_miss: true on model and a builder query, and the discarded text appears nowhere', async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const DISCARDED = "The current president of Chile is a made-up name from the model's own knowledge.";
    let calls = 0;
    try {
      const result = await withStub(
        {
          // The first (forced) call never returns a tool call at all -
          // the required miss, exactly A2/A3's own shape
          // (ENGINE-CONTRACT-01's dev.md finding) - and answers in
          // plain text instead; the second call (the builder row's own
          // phrasing round, tool_choice none) answers for real. Scripted
          // by call order, not by a tool-role message in the request -
          // the new path's phrasing round rebuilds its prompt from the
          // same context list every time, never injecting the tool
          // result back into the messages themselves (sources reach the
          // delivered reply through state.outcomes instead, answer.ts's
          // own "model_text" case) - a pre-existing gap, not this item's
          // to fix, so the test scripts on order to stay independent of
          // it.
          reply: () => {
            calls++;
            return calls === 1 ? DISCARDED : "The current president of Chile answers your question, sourced.";
          },
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      // Searched, sourced - the builder row ran a real search from the
      // engine's own query (the utterance), never the discarded text.
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result.value.plugin_id).toBe("websearch");
      expect(result.value.sources?.length).toBeGreaterThan(0);
      // The discarded text appears nowhere: not the reply, not stored
      // outcomes, not the trace.
      expect(result.value.reply.text).not.toContain(DISCARDED);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      expect(row?.replyText ?? "").not.toContain(DISCARDED);
      expect(row?.stats ?? "").not.toContain(DISCARDED);
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { callId: string; args?: Record<string, unknown> }[]) : [];
      expect(outcomes.some((o) => o.callId === "builder" && o.args?.expression === "who is the president of chile")).toBe(true);
      // required_miss: true on the FIRST model entry (the forced call
      // that missed); the trace never says it about a call that
      // honoured the choice.
      const modelOutcomes = await modelNodeOutcomes(result.value.turn_id);
      expect(modelOutcomes[0]?.required_miss).toBe(true);
    } finally {
      searxng.stop();
    }
  });

  test("a scripted engine that honours the call is unchanged", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile 2026" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.plugin_id).toBe("websearch");
      const modelOutcomes = await modelNodeOutcomes(result.value.turn_id);
      expect(modelOutcomes[0]?.required_miss).toBeUndefined();
    } finally {
      searxng.stop();
    }
  });

  // "U6: the flip verdict" regression A: control-search-mariners-explicit
  // and the hallucinated-name follow-up both showed a real
  // websearch/tool_call outcome with EMPTY args ({}) - the engine
  // half-committed to the call (an OFFERED one, tool_choice auto, not
  // even a forced one) with unparseable or empty arguments, policy
  // normalized undefined to {} and grounded it vacuously (nothing to
  // refuse in an empty object), and tool.ts's own schema validation
  // failed it, feeding a knowledge answer back. The fix widens the
  // verification past "required and missing" to "any websearch call,
  // forced or offered, without a real expression."
  test("an offered (not forced) websearch call with no valid expression also falls to the builder row (regression A)", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            // Empty args, the exact live-rerun shape (regression A):
            // toolCallFromWire's own parse succeeded but left nothing
            // useful, never a parse failure specifically - both collapse
            // to the same "no valid expression" verification either way.
            return [{ id: "call-1", name: "websearch", args: "{}" }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "Answered from the builder's own search, sourced." : "hi"),
        },
        // A greeting, not a world question: tool_choice is "auto" here,
        // never "required" - proving the verification isn't gated on
        // the interim rule's own forced call.
        () => runTurnNext(people.owner, "chat", "good morning"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result.value.plugin_id).toBe("websearch");
      const modelOutcomes = await modelNodeOutcomes(result.value.turn_id);
      expect(modelOutcomes[0]?.required_miss).toBe(true);
    } finally {
      searxng.stop();
    }
  });

  // A review caught the first cut discarding every tool call the model
  // made on a miss, not only the bad websearch one - a reply that
  // legitimately called another tool alongside an invalid websearch
  // call would have silently lost that other call too.
  test("a valid sibling tool call survives a websearch miss in the same reply", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [
              { id: "call-1", name: "timer", args: JSON.stringify({ expression: "5 minutes" }) },
              { id: "call-2", name: "websearch", args: "{}" },
            ];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "Timer set, and here's what I found." : "hi"),
        },
        // Not a command-pattern match (timer's own "set a timer for *"
        // would intercept that shape at the commands node, never
        // reaching the model at all) and not a world question (tool_choice
        // stays "auto"); shares "minutes" with the scripted timer call's
        // own expression for policy.ts's term-overlap grounding, unrelated
        // to the ENGINE-CONTRACT-02 fix under test.
        () => runTurnNext(people.owner, "chat", "I need five minutes to think"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; callId: string; status: string }[]) : [];
      expect(outcomes.some((o) => o.packageId === "timer" && o.status === "succeeded")).toBe(true);
      expect(outcomes.some((o) => o.packageId === "websearch" && o.callId === "builder")).toBe(true);
    } finally {
      searxng.stop();
    }
  });
});

describe("turnNext.ts: GROUND-01, grounding checks only the manifest's search-text fields", () => {
  async function policyNodeOutcome(turnId: string): Promise<{ ok?: boolean; code?: string; arg?: string } | undefined> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean; code?: string; arg?: string } }[] };
    return (stats.nodes ?? []).find((n) => n.node === "policy")?.outcome;
  }

  test('{ expression: "president of chile 2026", category: "images" } on "who is the president of chile" is grounded - category (an enum value) never blocks it', async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile 2026", category: "images" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result.value.plugin_id).toBe("websearch");
      expect(await policyNodeOutcome(result.value.turn_id)).toEqual({ ok: true });
    } finally {
      searxng.stop();
    }
  });

  test('"how to pick a lock" on a Dune question is refused with the reason naming expression', async () => {
    const result = await withStub(
      {
        calls: (request) => {
          if (request.messages.some((m) => m.role === "tool")) return undefined;
          return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "how to pick a lock" }) }];
        },
      },
      () => runTurnNext(people.owner, "chat", "when is dune 3 releasing"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe("I don't actually have that in this conversation, so I won't guess.");
    expect(await policyNodeOutcome(result.value.turn_id)).toEqual({ ok: false, code: "ungrounded_args", arg: "expression" });
  });

  // answer_from_context_tool is false in every real budget today (the
  // owner's ruling - the escape is off until reuse-with-freshness is
  // built), so this guard is currently unreachable in production; a
  // test-only budget override reaches it anyway, the same pattern the
  // "budget.model_transitions false" describe block above already uses,
  // proving the guard itself stays correct for whenever the feature
  // returns rather than only by comment.
  test("the utterance is excluded from answer-evidence quoting - the model quoting the question back is still refused and falls through to a real search", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const withEscape = { ...CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget!, answer_from_context_tool: true };
    const original = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget;
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = withEscape;
    let calls = 0;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            calls++;
            // First attempt: the model tries to "answer from context" by
            // quoting the utterance itself - never real evidence.
            if (calls === 1) return [{ id: "call-1", name: "answer_from_this_conversation", args: JSON.stringify({ quote: "who is the president of chile" }) }];
            // contextQuoteGrounded rejects it (the utterance is excluded),
            // machine.ts's forceSearchOnly retry runs a real search instead.
            return [{ id: "call-2", name: "websearch", args: JSON.stringify({ expression: "president of chile 2026" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result.value.plugin_id).toBe("websearch");
    } finally {
      CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = original;
      searxng.stop();
    }
  });
});
