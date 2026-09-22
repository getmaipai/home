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
