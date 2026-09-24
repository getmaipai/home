// U2 (docs/plans/turn-machine-state-record-2026-09-22.md, "Acceptance"):
// the new path's own tests, mirroring conversationBench.test.ts's own
// stub pattern (the real runner, a stub chat backend, a fake SearXNG) -
// never a second, bespoke harness. Exercises turnNext.ts end to end
// (the machine, every node, the real DB) with scripted model behaviour,
// since no live engine is available in this suite.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
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
import { COMPOSE_FAILURE_LINE } from "@/lib/composer";
import { remember, embedMemoryRecordSafely } from "@/lib/memory";
import { TurnStreamEvent as ToolTurnStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";

let people: BenchPeople;

// FLAKE-FORCED-01 (issue #137): the searxng/web-fetch token bucket
// (packageHost.ts's own SEARXNG_RATE_LIMIT, module-global, capacity
// 10, refillPerSecond 0.5) drains across this file's real-tool-call
// tests since nothing reset it - later tests that need a real search
// (the interim rule's required_miss case among them) got "rate-
// limited" instead, reading as a timing-dependent flake under load and
// actually failing deterministically once enough of this file's own
// tests fall through to a real websearch call. Reset it here, the same
// shape packageHost.test.ts and turnEngine.test.ts already use.
beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
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
      // TOOL-EVENTS-01(b): the tool node's own wire events, validated
      // against the spec's own Zod schema (spec/stack/ts/turn-stream-
      // event.ts, the same import chatModelAdapter.ts's frontend
      // consumer parses each NDJSON line with) - a real websearch call
      // through the tool node produces a call then a result, in that
      // order, each a real parse, not just a shape assumption.
      expect(result.toolEvents?.length).toBe(2);
      const [call, resultEvent] = result.toolEvents!;
      const parsedCall = ToolTurnStreamEvent.parse(call);
      const parsedResult = ToolTurnStreamEvent.parse(resultEvent);
      if (parsedCall.t !== "tool_call") throw new Error(`expected tool_call, got ${parsedCall.t}`);
      expect(parsedCall.package_id).toBe("websearch");
      expect(parsedCall.args).toEqual({ expression: "president of chile" });
      if (parsedResult.t !== "tool_result") throw new Error(`expected tool_result, got ${parsedResult.t}`);
      expect(parsedResult.call_id).toBe(parsedCall.call_id);
      expect(parsedResult.package_id).toBe("websearch");
      expect(parsedResult.outcome.error_code).toBeUndefined();
    } finally {
      searxng.stop();
    }
  });

  test("a turn that runs no tool carries no toolEvents field", async () => {
    const result = await withStub({ reply: () => "Hi there!" }, () => runTurnNext(people.owner, "chat", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.toolEvents).toBeUndefined();
  });
});

// home#147: logTurnSafely() (turnEngine.ts, the old path) sets both of
// these from the turn's own outcomes; buildTurnValue() (this file)
// never did, so the weather/almanac card had nothing to build from on
// the new path even before persistence entered into it - the card
// never showed, live or after a reload, with the new engine on.
// almanac-date is the package under test rather than weather: zero
// args, no network (`offline: "full"`, no `data_sources` in its own
// manifest), so this stays deterministic and offline without a fetch
// mock weather's own real Open-Meteo permissions would need -
// structuredPartForOutcomes() reads the outcome the identical way for
// both packages (composer.test.ts's own "structuredPartForOutcomes"
// describe block proves the function itself; this proves the wiring).
// Forcing it into tools_offered and scripting the call (the
// "consequential proposal" test's own technique, above) sidesteps the
// routing question entirely - a real, separate finding, reported but
// not fixed here, same as the issue's own text draws that line.
describe("turnNext.ts: structured_part and artifact reach TurnValue (home#147)", () => {
  test("a successful almanac-date outcome carries a structured_part spec sheet on the new path", async () => {
    const original = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget;
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...original!.tools_offered, "almanac-date"] };
    try {
      const result = await withStub(
        {
          calls: (request) => (request.tools?.some((t) => t.function.name === "almanac-date") ? [{ id: "call-1", name: "almanac-date", args: "{}" }] : undefined),
          reply: () => "unused",
        },
        () => runTurnNext(people.owner, "chat", "what's today's date"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.source).toBe("plugin");
      expect(result.value.plugin_id).toBe("almanac-date");
      expect(result.value.structured_part).toBeDefined();
      expect(result.value.structured_part?.kind).toBe("spec_sheet");
      expect(result.value.structured_part?.tool_id).toBe("almanac-date");
      expect(result.value.structured_part?.rows.some((r) => r.label === "Date")).toBe(true);
    } finally {
      CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = original;
    }
  });

  test("a turn with no structured-part-bearing outcome carries no structured_part", async () => {
    const result = await withStub({ reply: () => "Hello!" }, () => runTurnNext(people.owner, "chat", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.structured_part).toBeUndefined();
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
  test("a typed chat question's completion runs with the reply floor's ceiling, not today's 120", async () => {
    const result = await withStub({ reply: () => "Fold it in half, then fold the corners in." }, () => runTurnNext(people.owner, "chat", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // The reply floor (U4b-2): a written, non-brevity, adult turn's
    // max_tokens comes from the budget's own reply_ceiling_tokens
    // (1536 on the test catalog's qwen3-8b entry), not FORCED-CALL-01's
    // shared visibleReplyMaxTokens formula (which every OTHER turn
    // still uses, replyMaxTokensFor's own fallback) - the plan's own
    // length numbers (max_words: 220 here) stay room the model's own
    // end-of-reply decides inside, never a ceiling read out in full
    // every time.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(1536);
  });

  test("a robot question's completion keeps today's spoken plan, unchanged", async () => {
    const result = await withStub({ reply: () => "Fold it in half, then fold the corners in." }, () => runTurnNext(people.owner, "robot", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // Spoken keeps the act table exactly: a question is 60 words,
    // thinking off. FORCED-CALL-01: visibleReplyMaxTokens's formula,
    // not the retired max_words * 2 (120) - ceil(60 * 1.6) + 32 = 128.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(128);
  });

  test("a minor's typed chat question keeps the max_words-derived cap, not the reply ceiling", async () => {
    const result = await withStub({ reply: () => "Fold it in half, then fold the corners in." }, () => runTurnNext(people.child, "chat", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // The reply floor is a written-class, adult-only backstop
    // (turn-machine-state-record-2026-09-22.md, "The reply floor"): a
    // minor's plan.age_band is never "adult", so replyMaxTokensFor
    // falls through to LAT-01's shared visibleReplyMaxTokens formula
    // even though the surface is still written - the written question
    // budget (220 words) clamped to the child band's own 40-word
    // ceiling, then ceil(40 * 1.6) + 32 = 96.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(96);
  });

  test("an adult's typed chat question with thinking on adds the toggled budget on top of the reply ceiling", async () => {
    let sawThinking: unknown;
    const result = await withStub(
      {
        reply: (request) => {
          sawThinking = request.chat_template_kwargs?.enable_thinking;
          return "Fold it in half, then fold the corners in.";
        },
      },
      () => runTurnNext(people.owner, "chat", "how do I make a paper airplane", { thinking: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(sawThinking).toBe(true);
    // 1536 (reply_ceiling_tokens) + 512 (thinking_budget_tokens_toggled,
    // the 8B's toggled-on value) = 2048: room for the reasoning span
    // ahead of the visible reply, not just the reply alone.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(2048);
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
      // PHRASE-01 (dev.md "The written prompt on tier 1, decided"'s own
      // follow-up) superseded this row's own original comment: the
      // phrasing round's own max_tokens no longer comes from
      // replyMaxTokensFor's flat reply_ceiling_tokens backstop (1536
      // regardless of evidence) - it is LAT-01's visibleReplyMaxTokens
      // formula directly, so the evidence recompute's own max_words
      // move (220 -> 360 words here) DOES change it: Math.ceil(360*1.6)
      // + 32 = 608, thinking off. This row's own tool result is real (a
      // source found), so the ordinary phrasing generation actually
      // runs and reads it, unlike the empty-rows row below.
      expect(await lastGenerationMaxTokens(result.value.turn_id)).toBe(608);
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
      // A zero-result tool round never reaches a second LLM call at
      // all: composer.ts's own "empty_rows" mode (model_calls: 0)
      // writes the canned no-results line directly, so the forced
      // call is the ONLY (and so also the last) generation this turn
      // ever runs. FORCED_CALL_MAX_TOKENS (96) applies regardless of
      // plan, evidence, or the reply floor's own ceiling, since there
      // is no ordinary/phrasing generation here for either to ever
      // apply to.
      expect(await lastGenerationMaxTokens(result.value.turn_id)).toBe(96);
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

// DEADLINE-01 (dev.md "U6 rerun ruling" (a)): a generation that never
// finishes at all (the model node's own deadline, a dead engine) used
// to deliver an empty string through answer as if the model had
// genuinely said nothing - a genuinely dead MAIPAI_LLAMA_SERVER_URL
// (a closed, real port - a real connection refusal, not a mock) drives
// runOneGeneration's own `started.ok === false` path directly, no
// scripting needed.
describe("turnNext.ts: DEADLINE-01, a failed generation never delivers an empty reply", () => {
  async function deadEngineUrl(): Promise<string> {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {});
    const url = stub.url;
    stub.stop();
    return url;
  }

  test("an ordinary question whose generation fails gets the model_failed fixed line, never an empty reply", async () => {
    process.env.MAIPAI_LLAMA_SERVER_URL = await deadEngineUrl();
    __resetLlmSupervisorForTests();
    const result = await runTurnNext(people.owner, "chat", "how do I make a paper airplane");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(COMPOSE_FAILURE_LINE);
    expect(result.value.reply.text.length).toBeGreaterThan(0);
    // GENFAIL-01 (dev.md "generation_failed is never blind again"): the
    // failed attempt now leaves its own row in stats.generations[],
    // carrying the real reason (llm.ts's own caught message) rather
    // than being absent from the trace entirely - previously the only
    // record of this failure was the model node's own bare outcome
    // code, with nothing saying whether the engine refused the request
    // or was simply unreachable.
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as {
      generations?: { error?: string | null }[];
      nodes?: { node: string; outcome?: { ok?: boolean; code?: string; message?: string } }[];
    };
    expect(stats.generations?.length).toBeGreaterThan(0);
    expect(stats.generations?.[0]?.error).toBeTruthy();
    // The row's own second ask: not just the generation record, but
    // stats.nodes[]'s own `model` entry too, so a reader doesn't have
    // to cross-reference two different arrays to see why the turn
    // failed.
    const modelNodeEntry = (stats.nodes ?? []).find((n) => n.node === "model");
    expect(modelNodeEntry?.outcome?.message).toBeTruthy();
    expect(modelNodeEntry?.outcome?.message).toBe(stats.generations?.[0]?.error ?? undefined);
  });

  test("an interim-rule turn whose forced generation fails still runs the builder row's real search", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    process.env.MAIPAI_LLAMA_SERVER_URL = await deadEngineUrl();
    __resetLlmSupervisorForTests();
    try {
      const result = await runTurnNext(people.owner, "chat", "who is the president of chile");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      // The forced call failed outright (the same dead engine), so the
      // builder row ran the search for real - proven by the search
      // itself, not by the final reply text (the phrasing round hits
      // the identical dead engine and also fails, delivering the fixed
      // model_failed line as the turn's own honest outcome - a fully
      // dead engine breaking both rounds, not a bug in the fallback).
      expect(searxng.queries.length).toBeGreaterThan(0);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { callId: string; args?: Record<string, unknown> }[]) : [];
      expect(outcomes.some((o) => o.callId === "builder" && o.args?.expression === "who is the president of chile")).toBe(true);
      // A review caught the first cut marking this required_miss: true,
      // the same flag ENGINE-CONTRACT-02 uses for "a successful
      // generation whose cache state disagreed with required" - a
      // genuine generation failure is a different thing and must never
      // be counted there; the model node's own trace entry keeps the
      // real failure code instead.
      const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean; code?: string; required_miss?: boolean } }[] };
      const modelOutcomes = (stats.nodes ?? []).filter((n) => n.node === "model").map((n) => n.outcome ?? {});
      expect(modelOutcomes[0]?.required_miss).toBeUndefined();
      expect(modelOutcomes[0]?.ok).toBe(false);
      expect(modelOutcomes[0]?.code).toBeDefined();
    } finally {
      searxng.stop();
    }
  });
});

// GENFAIL-01 (dev.md, the coordinator's own live regression report,
// 2026-09-23): the household saw every generation in a fresh
// conversation fail once its own recall matched real memory rows (the
// household's first conversation, extracted), while an identical fresh
// conversation with nothing to recall worked. Jesse's own words for the
// acceptance test: this turn, on a fresh conversation with two
// remembered rows, answers from the model, never the failure line.
// Direct message-shape reproduction (this session's own side requests
// straight to the live engine on 8788, contextToMessages() output with
// real seeded, matched memory rows, bypassing the hub) got a clean 200
// both with and without the memory block present - never reproduced a
// rejection this way, so this test proves the shape is fine against a
// scripted engine; it cannot rule out a transient cause (engine load,
// a timeout) this suite has no way to simulate. GENFAIL-01's own
// generations[].error field (added above) is what turns the NEXT live
// occurrence from a blind code into a real cause.
describe("turnNext.ts: GENFAIL-01, a fresh conversation with real matched memory still answers", () => {
  test('"this is the new reply engine" with two seeded, matched memory rows answers from the model, never the failure line', async () => {
    // Worded to share real vocabulary with the utterance so
    // CONTEXT-RECALL-01's own tier floor actually surfaces them (an
    // unrelated seed, tried first while diagnosing this live, correctly
    // recalls nothing - not what reached the engine in the household's
    // own incident, where the first conversation's own turns, on this
    // exact subject, had already become memories).
    for (const text of ["the household said this is the new reply engine and it seemed to work", "asked what time it is in Tokyo and got an answer"]) {
      const seeded = remember(people.owner, { text, category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.5 });
      if (!seeded.ok) throw new Error("setup failed");
      await embedMemoryRecordSafely(seeded.value.id, text);
    }

    const result = await withStub({ reply: () => "Cool, let me know how it goes." }, () => runTurnNext(people.owner, "chat", "this is the new reply engine"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).not.toBe(COMPOSE_FAILURE_LINE);
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });
});

// COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): end to end,
// real turn machine, the Wikipedia 404 case as its own fixture (an MCP
// error string with a Wikipedia URL, once delivered verbatim). music's
// own "look up the artist *" (an imperative wildcard, kept under
// OPENER-01) is the live pattern winner here rather than knowledge's
// (OPENER-01 removed none of knowledge's real manifest patterns, but a
// live "who was *"/"what is *" utterance never classifies as directive
// in the first place - commands.test.ts's own direct, spied tests
// cover that shape instead); "look up the artist Radiohead" genuinely
// classifies `directive` (proven live building OPENER-01's own
// commandOpeners wiring), so this is a real pattern winner failing for
// real, not a forced signal override.
describe("turnNext.ts: COMMAND-FAIL-01, a failed pattern outcome continues the turn", () => {
  test('a failed pattern outcome never reaches the person as text; the model round runs and its own reply is delivered; the trace carries the failed outcome', async () => {
    const plugins = await import("@/lib/plugins");
    // The scripted stub below offers no tool_calls, so the model never
    // proposes a second plugin call this turn - music's own pattern
    // match (the directive-classified opener) is the only runPlugin()
    // call a fresh "look up the artist Radiohead" turn makes.
    const spy = spyOn(plugins, "runPlugin").mockImplementation(async () => ({
      ok: false as const,
      status: 502 as const,
      error: "MCP error -32000: fetch failed: 404 https://musicbrainz.org/ws/2/artist?query=Radiohead",
      code: "not_found",
      fallback_reply: { reply: { text: "Sorry, I'm having trouble looking that up right now." }, actions: [] },
    }));
    try {
      const result = await withStub({ reply: () => "I couldn't look that up, but Radiohead is a British rock band." }, () => runTurnNext(people.owner, "chat", "look up the artist Radiohead"));
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      // buildTurnValue()'s own source label is derived from the LAST
      // outcome's `via` alone (turnNext.ts ~303), never its `status` -
      // a real, separate finding filed for the coordinator, out of
      // this item's own files (commands.ts/answer.ts/outputGate.ts):
      // a failed-but-continued pattern outcome reports `source:
      // "plugin"` even though the reply text genuinely came from the
      // model round below. The reply TEXT is this item's own contract.
      expect(result.value.reply.text).not.toContain("MCP error");
      expect(result.value.reply.text).not.toContain("musicbrainz");
      expect(result.value.reply.text).not.toBe(COMPOSE_FAILURE_LINE);
      expect(result.value.reply.text.length).toBeGreaterThan(0);

      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string; errorCode?: string; userMessage?: string }[]) : [];
      const musicOutcome = outcomes.find((o) => o.packageId === "music");
      expect(musicOutcome?.status).toBe("failed");
      expect(musicOutcome?.errorCode).toBe("not_found");
      expect(musicOutcome?.userMessage).toContain("MCP error");

      const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean } }[] };
      const commandsEntry = (stats.nodes ?? []).find((n) => n.node === "commands");
      expect(commandsEntry?.outcome?.ok).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

// FORCED-CALL-01 (dev.md "The owner's three live turns on the new
// path", (1)): the interim rule's `required` generation once ran a
// full 440-token knowledge answer to completion (live, "what time is
// it in Tokyo", 11.6 s) before the builder fallback ever started -
// llm.ts streams a tool call as `tool_calls` fragments, never text, so
// with thinking off any text delta on a forced call already IS the
// miss. model.ts now aborts the generation right there (a child
// AbortController chained off the node's own signal, mirroring
// deadline.ts's nodeSignal shape) instead of paying for the rest of
// a doomed reply, and the phrasing/ordinary round's own cap comes from
// LAT-01's one shared formula (visibleReplyMaxTokens), retiring
// maxTokensFor's second, max_words * 2 formula (proven above, U4/U4c).
describe("turnNext.ts: FORCED-CALL-01, a forced call that misses costs under a second", () => {
  // The stub streams every word of a scripted reply synchronously in
  // one tick (stubServer.ts's own `start(controller)`), so on
  // localhost the whole HTTP response is already sitting in the fetch
  // layer's own buffer before this test's JS ever gets to read a
  // second delta - a real network race the abort would win against a
  // slow engine, but not something a deterministic unit test can prove
  // by racing the recording proxy's own `aborted` flag. What IS
  // deterministic, and what "abort on it" (dev.md "The owner's three
  // live turns", (1)) actually means in code, is that model.ts's own
  // controller.abort() call fires with its own documented reason - so
  // this test spies on AbortController.prototype.abort itself, the
  // real side effect model.ts's abort produces, rather than a race.
  function spyOnAbort(): { reasons: unknown[]; restore(): void } {
    const reasons: unknown[] = [];
    const original = AbortController.prototype.abort;
    AbortController.prototype.abort = function abort(this: AbortController, reason?: unknown): void {
      reasons.push(reason);
      original.call(this, reason);
    };
    return { reasons, restore: () => { AbortController.prototype.abort = original; } };
  }

  test("a scripted engine that answers a required call with text is aborted after its first delta and the turn searches through the builder with required_miss: true", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const spy = spyOnAbort();
    try {
      const result = await withStub(
        {
          // The forced call never scripts a tool call at all (`calls`
          // returns undefined), so it falls to `reply` and answers in
          // plain text - the miss. The phrasing round (the second
          // request, carrying a tool-role message) answers for real.
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question, sourced." : "The current president of Chile is a made-up name the model should never get to finish saying."),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result.value.plugin_id).toBe("websearch");
      expect(result.value.sources?.length).toBeGreaterThan(0);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean; required_miss?: boolean } }[] };
      const modelOutcomes = (stats.nodes ?? []).filter((n) => n.node === "model").map((n) => n.outcome ?? {});
      expect(modelOutcomes[0]?.required_miss).toBe(true);
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { callId: string; args?: Record<string, unknown> }[]) : [];
      expect(outcomes.some((o) => o.callId === "builder" && o.args?.expression === "who is the president of chile")).toBe(true);
      // The proof this item is actually about: model.ts's own
      // early-abort branch really fired, with its own documented
      // reason, not just that the reply got discarded after arriving
      // whole (ENGINE-CONTRACT-02's own, unmodified test above already
      // covers "discarded eventually"; this proves "aborted, not read
      // to the end").
      expect(spy.reasons.some((r) => r instanceof DOMException && r.message === "forced call wrote text, not a tool call")).toBe(true);
    } finally {
      spy.restore();
      searxng.stop();
    }
  });

  test("a required request carries thinking: false and max_tokens: 96 whatever the budget's thinking", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let forcedRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            forcedRequest ??= request;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        // The household's own thinking toggled ON for this turn (the
        // 8B's thinking_budget_tokens_toggled is 512, THINK-DEFAULT-01) -
        // the exact case the row names: a required call's thinking:false
        // and max_tokens:96 hold regardless of the budget's own thinking.
        () => runTurnNext(people.owner, "chat", "who is the president of chile", { thinking: true }),
      );
      expect(result.ok).toBe(true);
      expect(forcedRequest?.tool_choice).toBe("required");
      expect(forcedRequest?.chat_template_kwargs?.enable_thinking).toBe(false);
      expect(forcedRequest?.max_tokens).toBe(96);
    } finally {
      searxng.stop();
    }
  });

  test("a scripted call reply is untouched", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const spy = spyOnAbort();
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
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean; required_miss?: boolean } }[] };
      const modelOutcomes = (stats.nodes ?? []).filter((n) => n.node === "model").map((n) => n.outcome ?? {});
      expect(modelOutcomes[0]?.required_miss).toBeUndefined();
      // The new abort logic only fires on a text delta; a tool-calls
      // stream never trips it, so it never runs at all here.
      expect(spy.reasons.some((r) => r instanceof DOMException && r.message === "forced call wrote text, not a tool call")).toBe(false);
    } finally {
      spy.restore();
      searxng.stop();
    }
  });
});

// PHRASE-01 (dev.md "The written prompt on tier 1, decided"'s own
// follow-up): the phrasing round after a forced or offered tool call
// continues that SAME request's own messages (composer.ts's own
// assistant/tool-result shape appended, never a fresh contextToMessages()
// rebuild from state.context, which discarded the cached prefix and
// produced a fresh, cache-missing prompt), the same tools block with
// tool_choice "none", and LAT-01's visibleReplyMaxTokens for max_tokens
// instead of the written-adult reply-ceiling backstop.
describe("turnNext.ts: PHRASE-01, the phrasing round continues the forced call's own prompt", () => {
  test("the phrasing request's messages begin with the forced request's own messages byte for byte, then an assistant tool_call and a tool result", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let forcedRequest: ChatCompletionRequest | undefined;
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) {
              phrasingRequest ??= request;
              return undefined;
            }
            forcedRequest ??= request;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      expect(forcedRequest).toBeDefined();
      expect(phrasingRequest).toBeDefined();
      const forcedCount = forcedRequest!.messages.length;
      for (let i = 0; i < forcedCount; i++) {
        expect(phrasingRequest!.messages[i]).toEqual(forcedRequest!.messages[i]);
      }
      const assistantMessage = phrasingRequest!.messages[forcedCount];
      expect(assistantMessage?.role).toBe("assistant");
      expect(assistantMessage?.tool_calls?.[0]?.function.name).toBe("websearch");
      const toolMessage = phrasingRequest!.messages[forcedCount + 1];
      expect(toolMessage?.role).toBe("tool");
      expect(toolMessage?.tool_call_id).toBe(assistantMessage?.tool_calls?.[0]?.id);
      // One more user-role message closes the request: the plan line
      // plus phrasingInstruction, never compositionInstruction's own
      // frozen (old-path) text.
      const lastMessage = phrasingRequest!.messages[phrasingRequest!.messages.length - 1];
      expect(lastMessage?.role).toBe("user");
      expect(lastMessage?.content).toContain("use the results above as support");
      expect(lastMessage?.content).not.toContain("from the tool results above");
    } finally {
      searxng.stop();
    }
  });

  test("the phrasing request carries the same tools block as the forced request, with tool_choice \"none\"", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let forcedRequest: ChatCompletionRequest | undefined;
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) {
              phrasingRequest ??= request;
              return undefined;
            }
            forcedRequest ??= request;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      expect(forcedRequest?.tools?.length).toBeGreaterThan(0);
      expect(phrasingRequest?.tools).toEqual(forcedRequest?.tools);
      expect(phrasingRequest?.tool_choice).toBe("none");
    } finally {
      searxng.stop();
    }
  });

  test("the phrasing request's max_tokens is LAT-01's visibleReplyMaxTokens formula for the plan, not the written-adult reply-ceiling backstop", async () => {
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
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { max_tokens: number | null }[] };
      const generations = stats.generations ?? [];
      // U4c's own sibling test (above) independently confirmed this
      // exact fixture's own evidence-boosted plan row (a real source
      // found, max_words 220 -> 360) produces visibleReplyMaxTokens(360,
      // false) = 608 - the written-adult reply_ceiling_tokens backstop
      // (1536, this model's own catalog entry) would read completely
      // differently, so 608 here proves the formula switch, not a
      // coincidence of two constants landing on the same number.
      expect(generations[generations.length - 1]?.max_tokens).toBe(608);
      expect(generations[generations.length - 1]?.max_tokens).not.toBe(1536);
    } finally {
      searxng.stop();
    }
  });

  // ENVELOPE-NONE-01 (a code review, 2026-09-23): tool_choice "none"
  // stops the engine's own grammar from emitting a native tool call,
  // but runOneGeneration's own envelopeToolCall() check reads the
  // model's own visible text regardless of tool_choice - a stub
  // standing in for an engine that doesn't honour "none" (the same
  // near-tie behaviour this codebase already documents for
  // "required") must not be allowed to reopen a second tool round.
  test("a phrasing round whose first attempt carries a tool call anyway is treated as text, never a second search, and retries once for a real answer", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let phrasingAttempts = 0;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (!request.messages.some((m) => m.role === "tool")) {
              // the forced round: a real search call
              return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
            }
            // the phrasing round: misbehaves on its first attempt (the
            // engine misbehaviour ENVELOPE-NONE-01 guards against, a
            // stray tool call despite tool_choice "none"), then
            // complies on the retry ENVELOPE-NONE-01 now forces.
            phrasingAttempts++;
            return phrasingAttempts === 1 ? [{ id: "call-2", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }] : undefined;
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      // One websearch query only: the phrasing round's own phantom call
      // on its first attempt never reached the tool node a second time.
      expect(searxng.queries.length).toBe(1);
      expect(phrasingAttempts).toBe(2);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toContain("The current president of Chile answers your question.");
    } finally {
      searxng.stop();
    }
  });

  // The rounds-fragility half of the same review finding is fixed by
  // reading `input.toolsAllowed` (machine.ts's own `roundsUsed <
  // budget.rounds`, already computed and already exercised by every
  // other test in this file that reaches a second model invocation)
  // instead of `outcomes.length > 0` alone - not given its own test
  // here, since no catalog entry in this codebase sets `budget.rounds`
  // above 1 today and `RunTurnNextOpts` has no override for it; adding
  // one would be new test-only wire surface for a path nothing can
  // reach yet. The fix is provably safe by two other facts already
  // covered above: every existing case here still passes unchanged
  // (today's `rounds: 1` means `toolsAllowed` is `false` at exactly the
  // same point `outcomes.length > 0` was `true`, so the two conditions
  // agree everywhere the suite can reach), and the branch a genuine
  // second round now falls into is the plain "offer tools" `else`
  // branch a few lines down, the same one the interim-rule and
  // offered-turn tests already exercise.
});
