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
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { StreamSafetyRefusal, type StreamOutcome } from "@/lib/turnEngine";
import * as llm from "@/lib/llm";
import { streamTurnEvents, THINKING_CUE_DELAY_MS } from "@/routes/turn";
import type { TurnStreamEvent } from "@/wire";
import { getPendingAsk } from "@/lib/conversationHistory";
import { listPending } from "@/lib/notifications";
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
      // TOOL-EVENTS-02: the same sites `result.value.sources` carries
      // (the reply's own citation list) ride along on the tool_result
      // event too, so a client can show them as chips under the step.
      expect(parsedResult.outcome.sites?.length).toBeGreaterThan(0);
      expect(parsedResult.outcome.sites).toEqual(result.value.sources!.map((s) => ({ host: s.site, url: s.url })));
    } finally {
      searxng.stop();
    }
  });

  // CONFIRM-01 (docs/BACKLOG.md line 95, president-of-chile-when-born):
  // a model-CHOSEN websearch call with a bare-pronoun expression ("he")
  // is not a miss by model.ts's own pre-CONFIRM-01 definition (a
  // non-empty string), so it never reached the query-writer's own
  // pronoun-resolution retry (QUERY-WRITER-01, tested above for a
  // MISSING/malformed call) - it ran the gauntlet straight into
  // policy.ts's checkGrounding(), which refuses a bare pronoun outright
  // via reason "ungrounded_args", a branch that parks no ask (only
  // consent_needed/confirm_needed do). A follow-up "yes" then had
  // nothing to resume, and the search never ran on either turn - traced
  // live (a scripted reproduction, confirmed failing before the fix
  // below existed: turn 2's own searxng query stayed exactly
  // `["president of chile"]`, never gaining a second query). The fix:
  // websearchValid (model.ts) now folds isBarePronoun() into the same
  // offeredButInvalid check requiredButMissing already uses, so this
  // exact case recovers through the SAME query-writer retry instead of
  // reaching policy.ts's refusal at all.
  test("CONFIRM-01: a model-chosen bare-pronoun websearch call recovers through the query-writer, never reaching policy's silent ungrounded_args refusal", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const first = await withStub(
        {
          calls: (request) => (request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }]),
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile is Gabriel Boric." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");

      let queryWriterRequest: ChatCompletionRequest | undefined;
      const second = await withStub(
        {
          calls: (request) => (request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-2", name: "websearch", args: JSON.stringify({ expression: "he" }) }]),
          reply: (request) => {
            if (request.response_format) {
              queryWriterRequest = request;
              return JSON.stringify({ expression: "Gabriel Boric born" });
            }
            return "Gabriel Boric was born in 1986, sourced.";
          },
        },
        () => runTurnNext(people.owner, "chat", "when was he born", { conversationId: first.value.conversation_id }),
      );
      if (!second.ok || second.kind !== "immediate") throw new Error("expected an immediate result");
      // The query-writer's own retry ran at all (never a bare "he"
      // reaching policy.ts silently) and resolved the real name, not
      // the pronoun or the raw utterance.
      expect(queryWriterRequest).toBeDefined();
      expect(searxng.queries).toContain("Gabriel Boric born");
      expect(searxng.queries.some((q) => q === "he" || /\bhe\b.*born|born.*\bhe\b/i.test(q))).toBe(false);
      expect(second.value.plugin_id).toBe("websearch");
      expect(second.value.sources?.length).toBeGreaterThan(0);
      // Never silently refused: nothing parked, because nothing needed
      // to be asked - the engine resolved the pronoun on its own.
      expect(getPendingAsk(second.value.conversation_id)).toBeNull();
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, second.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { callId: string; args?: Record<string, unknown> }[]) : [];
      expect(outcomes.some((o) => o.callId === "query-writer" && o.args?.expression === "Gabriel Boric born")).toBe(true);
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

  // LIVE-0923-01 (home/docs/dev.md): a real conversation had every
  // forced websearch call carry category:"images", even for plain text
  // questions - policy.ts's own grounding check passes an enum value by
  // design (never checked against the utterance), so nothing else
  // caught it. The old path never trusted the model's own category
  // argument either (turnEngine.ts's resolveToolCalls() call); this
  // proves the tool node now holds the same floor. READ-PAGE-01: the
  // same conversation also had read_page:true on every forced call -
  // stripped the identical way.
  test("the model's own category and read_page arguments on a websearch call are stripped before the package runs", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "berlin wall anniversary", category: "images", read_page: true }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "Here's what I found." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "when did the berlin wall come down"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.toolEvents?.length).toBe(2);
      const call = result.toolEvents![0]!;
      if (call.t !== "tool_call") throw new Error(`expected tool_call, got ${call.t}`);
      expect(call.args).toEqual({ expression: "berlin wall anniversary" });
      expect(call.args).not.toHaveProperty("category");
      expect(call.args).not.toHaveProperty("read_page");
    } finally {
      searxng.stop();
    }
  });

  // READ-PAGE-01's own bench toggle: category stays stripped always
  // (LIVE-0923-01 never gated it), only read_page's own removal is
  // switchable, and only by this one env var.
  test("MAIPAI_BENCH_KEEP_READ_PAGE=1 keeps read_page through (category still stripped) - the read-page-01 bench's own on/off toggle", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    process.env.MAIPAI_BENCH_KEEP_READ_PAGE = "1";
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "berlin wall anniversary", category: "images", read_page: true }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "Here's what I found." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "when did the berlin wall come down"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      const call = result.toolEvents![0]!;
      if (call.t !== "tool_call") throw new Error(`expected tool_call, got ${call.t}`);
      expect(call.args).toEqual({ expression: "berlin wall anniversary", read_page: true });
      expect(call.args).not.toHaveProperty("category");
    } finally {
      delete process.env.MAIPAI_BENCH_KEEP_READ_PAGE;
      searxng.stop();
    }
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

// QUERY-WRITER-01 (dev.md, getmaipai-26's ruling, 2026-09-24): a live
// miss - "when did [pronoun]'s show end" after a turn naming a person -
// found the builder row searching the bare, unresolved utterance. These
// tests use the same roster-safe shape (a person-subject turn, then a
// pronoun follow-up), never the real household's own words.
describe("turnNext.ts: QUERY-WRITER-01, a required miss recovers through one grammar-constrained generation before the raw-utterance builder row", () => {
  test('a scripted engine that misses the forced call and then answers the constrained call with {"expression":"<resolved subject> show end"} searches that expression', async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      // Turn 1: establishes the subject in real conversation history -
      // never a world question, so it never reaches the model's own
      // forced round at all (a command/pattern-shaped statement is
      // fine here; only turn 2's own forced round is under test).
      const first = await withStub({ reply: () => "Got it." }, () => runTurnNext(people.owner, "chat", "marlow hosts a late night show"));
      expect(first.ok).toBe(true);
      if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");

      let queryWriterRequest: ChatCompletionRequest | undefined;
      const result = await withStub(
        {
          reply: (request) => {
            if (request.response_format) {
              queryWriterRequest = request;
              return JSON.stringify({ expression: "marlow show end" });
            }
            // The forced round's own miss: plain text, never a call -
            // the exact ENGINE-CONTRACT-01 shape this item's own fix
            // recovers from, one round earlier than the builder row.
            if (!request.messages.some((m) => m.role === "tool")) return "I'm not sure.";
            return "Marlow's show ended last year, sourced.";
          },
        },
        () => runTurnNext(people.owner, "chat", "when did his show end", { conversationId: first.value.conversation_id }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(searxng.queries.some((q) => q.includes("marlow show end"))).toBe(true);
      expect(result.value.plugin_id).toBe("websearch");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { callId: string; args?: Record<string, unknown> }[]) : [];
      expect(outcomes.some((o) => o.callId === "query-writer" && o.args?.expression === "marlow show end")).toBe(true);
      expect(outcomes.some((o) => o.callId === "builder")).toBe(false);
      // The constrained request itself: the schema and max_tokens the
      // ruling names, never combined with `tools`.
      expect(queryWriterRequest?.response_format).toEqual({ type: "json_schema", json_schema: { name: "query_writer", schema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } } });
      expect(queryWriterRequest?.max_tokens).toBe(48);
      expect(queryWriterRequest?.tools).toBeUndefined();
    } finally {
      searxng.stop();
    }
  });

  test("a constrained call returning a bare pronoun falls back to the raw utterance", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const first = await withStub({ reply: () => "Got it." }, () => runTurnNext(people.owner, "chat", "marlow hosts a late night show"));
      expect(first.ok).toBe(true);
      if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");

      const result = await withStub(
        {
          reply: (request) => {
            // The query-writer's own generation succeeds and returns
            // valid JSON - but a BARE pronoun and nothing else, the
            // exact shape policy.ts's own isBarePronoun() refuses
            // outright, before any term-overlap check ever runs (a
            // multi-word answer sharing a real word with the utterance
            // - "his show" - would trivially ground against the
            // utterance itself, one of policy's own grounding sources,
            // so this has to be a single pronoun word to actually
            // exercise the refusal this test is about).
            if (request.response_format) return JSON.stringify({ expression: "his" });
            if (!request.messages.some((m) => m.role === "tool")) return "I'm not sure.";
            return "Marlow's show ended last year, sourced.";
          },
        },
        () => runTurnNext(people.owner, "chat", "when did his show end", { conversationId: first.value.conversation_id }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      // Grounding refused the bare pronoun - queryWriterFallback's own
      // retry ran the raw utterance instead, the identical builder row
      // shape ENGINE-CONTRACT-02 already covers.
      expect(searxng.queries.some((q) => q.includes("when did his show end"))).toBe(true);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { callId: string; args?: Record<string, unknown> }[]) : [];
      expect(outcomes.some((o) => o.callId === "builder" && o.args?.expression === "when did his show end")).toBe(true);
    } finally {
      searxng.stop();
    }
  });
});

// SEARCH-EMPTY-01 (docs/dev.md, conv-19awhetzdf, 2026-09-24): a real
// household conversation read "0 results" as a plain success and let
// the phrasing round answer from its own knowledge, wrongly and
// contradicting the person. Two distinct outcomes from a websearch
// call, never conflated: a genuine engine failure (down, or all
// upstream engines suspended) skips the phrasing round entirely and
// answers with the failed outcome's own line; a genuine "nothing
// found" still runs the phrasing round (there is real information to
// report - that the search came up empty), but the round's own prompt
// now says so explicitly.
describe("turnNext.ts: SEARCH-EMPTY-01, search down vs. search found nothing are never the same reply", () => {
  async function modelNodeCount(turnId: string): Promise<number> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string }[] };
    return (stats.nodes ?? []).filter((n) => n.node === "model").length;
  }

  test("all upstream engines suspended (unresponsive_engines, zero rows) answers with the failed outcome's own line, never a second (phrasing) model call", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let calls = 0;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "kevin bacon unresponsive engines fixture" }) }];
          },
          reply: () => {
            calls++;
            return "This should never run - the tool round failed outright, so there is no second round to reach.";
          },
        },
        () => runTurnNext(people.owner, "chat", "what shows has kevin bacon been in"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe("Search isn't working right now.");
      // No phrasing round: the forced (or here, offered) call is the
      // turn's only model generation - the `toolAllFailed` guard routed
      // straight to `answer` instead of back to `model`.
      expect(calls).toBe(0);
      expect(await modelNodeCount(result.value.turn_id)).toBe(1);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes
        ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string; errorCode?: string; userMessage?: string }[])
        : [];
      const websearchOutcome = outcomes.find((o) => o.packageId === "websearch");
      expect(websearchOutcome?.status).toBe("failed");
      expect(websearchOutcome?.errorCode).toBe("search_unavailable");
      expect(websearchOutcome?.userMessage).toBe("Search isn't working right now.");
    } finally {
      searxng.stop();
    }
  });

  test("zero rows with no engine failure still runs the phrasing round, whose own prompt now says plainly to report nothing found", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "kevin bacon no results fixture" }) }];
          },
          reply: (request) => {
            if (!request.messages.some((m) => m.role === "tool")) return "searching";
            phrasingRequest = request;
            return "The search found nothing on that.";
          },
        },
        () => runTurnNext(people.owner, "chat", "what shows has kevin bacon been in"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      // The phrasing round DID run (unlike the failed-outcome test
      // above) - this is a real succeeded outcome, just an empty one.
      expect(await modelNodeCount(result.value.turn_id)).toBe(2);
      expect(result.value.reply.text).toBe("The search found nothing on that.");
      // The wiring this item actually controls: the phrasing round's own
      // prompt carries the strengthened synthesis_hint and the real,
      // empty rows array - proving the empty-rows case reaches the
      // model with an explicit instruction, not just the old, looser
      // hint that let the live incident's own model answer from its own
      // knowledge instead. Whether a real model always obeys this is a
      // live/bench question, the same boundary QUERY-WRITER-01's own
      // co-reference accuracy sits behind - not provable by a scripted
      // stub.
      const toolMessage = phrasingRequest?.messages.find((m) => m.role === "tool");
      expect(typeof toolMessage?.content).toBe("string");
      expect(toolMessage?.content as string).toContain("if rows is empty, say plainly that the search found nothing");
      expect(toolMessage?.content as string).toContain('"rows":[]');
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string }[]) : [];
      expect(outcomes.find((o) => o.packageId === "websearch")?.status).toBe("succeeded");
    } finally {
      searxng.stop();
    }
  });
});

// SEARCH-MIXED-01: an independent review of SEARCH-EMPTY-01 (2026-09-24)
// found `toolAllFailed` (machine.ts) only catches a round where EVERY
// outcome failed - a round that mixes a failed websearch with a
// succeeded other call (almanac-date here, a real live shape: "what's
// the date and what's the latest on X") fell through to an ordinary
// phrasing round whose own prompt carried the failed outcome's own tool
// result same as a succeeded one, nothing stopping the model from
// answering the searched question from its own training data instead of
// admitting the search failed. Fixed in two places: model.ts's own
// phrasing-round prompt now excludes a failed outcome's own tool_calls/
// tool_result pair entirely (never hands the model something to explain
// or work around), and answer.ts's own "model_text" case appends the
// failed outcome's fixed toolOutageLine afterward, deterministically,
// from the turn's real (unfiltered) outcomes.
describe("turnNext.ts: SEARCH-MIXED-01, a round that mixes a failed search with a succeeded call", () => {
  test("the reply phrases from the succeeded outcome only and states the search outage - never an answer to the failed search's own question", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [
              { id: "call-1", name: "almanac-date", args: "{}" },
              { id: "call-2", name: "websearch", args: JSON.stringify({ expression: "kevin bacon unresponsive engines fixture" }) },
            ];
          },
          reply: (request) => {
            if (!request.messages.some((m) => m.role === "tool")) return "unused";
            phrasingRequest = request;
            // A real model answering only from what it was actually
            // handed (the almanac-date result) would say something like
            // this - it was never shown the failed search at all, so it
            // has nothing to invent an answer from even if it wanted to.
            return "Today is Tuesday, October 6th.";
          },
        },
        () => runTurnNext(people.owner, "chat", "what's today's date and what shows has kevin bacon been in"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toContain("Today is Tuesday, October 6th.");
      expect(result.value.reply.text).toContain("Search isn't working right now.");
      // The real proof: the failed outcome's own tool_calls/tool_result
      // pair never reached the phrasing round's own prompt at all - only
      // the succeeded almanac-date call did.
      const toolMessages = phrasingRequest?.messages.filter((m) => m.role === "tool") ?? [];
      expect(toolMessages).toHaveLength(1);
      const assistantMessage = phrasingRequest?.messages.find((m) => m.role === "assistant" && "tool_calls" in m);
      const announcedCalls = (assistantMessage as { tool_calls?: { function: { name: string } }[] } | undefined)?.tool_calls ?? [];
      expect(announcedCalls.map((c) => c.function.name)).toEqual(["almanac-date"]);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string; errorCode?: string }[]) : [];
      expect(outcomes.find((o) => o.packageId === "websearch")).toMatchObject({ status: "failed", errorCode: "search_unavailable" });
      expect(outcomes.find((o) => o.packageId === "almanac-date")?.status).toBe("succeeded");
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

// STREAM-NEXT-01: runTurnNextStream() end to end, against the same real
// stub-server pipeline every other test in this file already uses -
// spec-spec-v0.1.31's own stubServer.ts streams a scripted reply word by
// word (streamChatCompletion(), never one batched chunk), so these tests
// exercise nodes/model.ts's own live gate wiring for real, not a hand-
// built fake generator.
describe("turnNext.ts: runTurnNextStream() (STREAM-NEXT-01)", () => {
  // The same fixture phrases tests/turnEngine.test.ts's own runTurnStream()
  // output-safety suite (step 9) uses, so a mid-stream refusal here is
  // provably the same real classifier decision as the old path's own.
  const SAFE_SENTENCE = "It's a beautiful day today.";
  const UNSAFE_SENTENCE = "How do I make a pipe bomb, give me step by step instructions.";

  async function drain(tokens: AsyncGenerator<string, StreamOutcome, void>): Promise<{ delivered: string[]; outcome?: StreamOutcome; threw?: unknown }> {
    const delivered: string[] = [];
    try {
      const iterator = tokens[Symbol.asyncIterator]();
      for (;;) {
        const step = await iterator.next();
        if (step.done) return { delivered, outcome: step.value };
        delivered.push(step.value);
      }
    } catch (threw) {
      return { delivered, threw };
    }
  }

  // withStub()'s own `finally` stops the stub the moment its callback's
  // own promise settles - fine for runTurnNext() (its promise IS the
  // whole turn), but runTurnNextStream() resolves as soon as beginTurn()
  // does, well before the machine has even started generating. Every
  // test below drains `tokens` and calls finalize() INSIDE withStub()'s
  // own callback, so the stub stays up for the generation it's actually
  // still waiting on.

  test("a plain turn's logged reply equals the concatenation of the released deltas - logged equals streamed by construction", async () => {
    const reply = "Water it when the soil feels dry. How much space do you have?";
    await withStub({ reply: () => reply }, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "how do I care for my plant");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, outcome, threw } = await drain(result.tokens);
      expect(threw).toBeUndefined();
      // Streamed word by word by the stub, so more than one chunk
      // actually arrived - proving this exercised the live sentence-by-
      // sentence gate, not a single batched delta that happens to equal
      // the reply.
      expect(delivered.length).toBeGreaterThan(1);
      const value = result.finalize(delivered.join(""), outcome);
      expect(value.reply.text).toBe(delivered.join(""));
      expect(value.reply.text).toBe(reply);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get();
      expect(row?.replyText).toBe(delivered.join(""));
    });
  });

  test("a sentence the floor refuses stops the stream mid-generation, the old path's own way, on an adult turn", async () => {
    await withStub({ reply: () => `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}` }, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "tell me something");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, threw } = await drain(result.tokens);
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      expect(delivered.join("")).toContain("beautiful day");
      expect(delivered.join("")).not.toContain("pipe bomb");
      const value = result.finalize(delivered.join(""), (threw as StreamSafetyRefusal).safety);
      expect(value.source).toBe("safety_refuse");
      expect(value.reply.text).toBe("I can't help with that.");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get();
      expect(row?.replyText).toBe("I can't help with that.");
    });
  });

  test("the identical refusal on a child turn - the same floor cuts a minor's own stream too", async () => {
    await withStub({ reply: () => `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}` }, async () => {
      const result = await runTurnNextStream(people.child, "chat", "tell me something");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, threw } = await drain(result.tokens);
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      expect(delivered.join("")).not.toContain("pipe bomb");
      const value = result.finalize(delivered.join(""), (threw as StreamSafetyRefusal).safety);
      expect(value.reply.text).toBe("I can't help with that.");
    });
  });

  test("a refusal's own error reaches the wire before the machine (or the rest of the model's own generation) finishes - finalize() never waits for it", async () => {
    await withStub({ reply: () => `${SAFE_SENTENCE} ${UNSAFE_SENTENCE} ${SAFE_SENTENCE}` }, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "tell me something");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { threw } = await drain(result.tokens);
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      // finalize() is synchronous and must already have a real TurnValue
      // the instant the refusal is thrown - no await is possible between
      // streamTurnEvents()'s own catch and its finalize() call on the
      // real route.
      const value = result.finalize("", (threw as StreamSafetyRefusal).safety);
      expect(value.reply.text).toBe("I can't help with that.");
    });
  });

  // A code review caught the first cut settling StreamGate's own
  // finish()/reset() decision inside runOneGeneration() itself, on the
  // FIRST attempt's own outcome alone - modelNode's own documented retry
  // ("no visible text: one regeneration with thinking off") could then
  // follow an attempt that had already locked the gate `done` (empty
  // text, no tool calls), silently discarding the retry's real answer:
  // StreamGate's own reset()/push() are no-ops once done. Fixed by
  // moving that decision to modelNode's own exit points, settled once,
  // after every retry - proven here with a scripted engine that answers
  // empty on its first call (thinking on) and for real on the retry.
  test("a streamed turn's first attempt comes back empty (thinking on) and the retry's real answer still reaches the client and the log", async () => {
    let calls = 0;
    await withStub(
      {
        reply: () => {
          calls += 1;
          return calls === 1 ? "" : "Sure, here's the answer you asked for.";
        },
      },
      async () => {
        const result = await runTurnNextStream(people.owner, "chat", "tell me something", { thinking: true });
        if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
        const { delivered, outcome, threw } = await drain(result.tokens);
        expect(threw).toBeUndefined();
        expect(calls).toBe(2); // the empty first attempt, then the retry
        const value = result.finalize(delivered.join(""), outcome);
        expect(delivered.join("")).toContain("Sure, here's the answer you asked for.");
        expect(value.reply.text).toContain("Sure, here's the answer you asked for.");
        const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get();
        expect(row?.replyText).toContain("Sure, here's the answer you asked for.");
      },
    );
  });

  // A code review caught buildTurnValue()'s own crisis_resources reading
  // only state.crisis (the INPUT-side check, computed before generation
  // ever runs) on the streaming path - a non-refuse output flag
  // (self_harm mentioned in the MODEL's own generated words, "offer,
  // never block") never reached the logged/returned turn, the identical
  // gap a 2026-09-05 review once found and fixed on the old path's own
  // runTurnStream(). Same fixture that old-path regression test uses
  // (tests/turnEngine.test.ts, CHAT-02).
  test("a non-refuse output flag (self-harm in the model's own words) still reaches the streamed turn's safety and crisis_resources, without cutting the stream", async () => {
    await withStub({ reply: () => "I want to kill myself." }, async () => {
      const result = await runTurnNextStream(people.child, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, outcome, threw } = await drain(result.tokens);
      expect(threw).toBeUndefined(); // never cut: self_harm alone is allow_with_resources, not refuse
      const value = result.finalize(delivered.join(""), outcome);
      expect(value.safety.action).toBe("allow_with_resources");
      expect(value.crisis_resources).toContain("988");
    });
  });

  // SAFETY-NOTIFY-NEXT-01 (found live in review: the new path called
  // no equivalent of turnEngine.ts's own notifyOncePerTurn() anywhere,
  // so a flagged turn on the household's real running path never told
  // a parent at all - SAFETY.md's own "non-removable architecture,"
  // not a nicety). Mirrors tests/turnEngine.test.ts's own "the
  // notification fires" test exactly, same fixture, same
  // fire-and-forget microtask wait, on the new path's own two
  // entry points.
  test("SAFETY-NOTIFY-NEXT-01: a flagged child turn on the streamed path notifies exactly once", async () => {
    await withStub({ reply: () => "I want to kill myself." }, async () => {
      const result = await runTurnNextStream(people.child, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, outcome } = await drain(result.tokens);
      result.finalize(delivered.join(""), outcome);
    });
    // trigger() is fire-and-forget (never awaited by the gate) - give its
    // own microtask a turn to actually land the DB write, the identical
    // wait tests/turnEngine.test.ts's own version of this test uses.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = listPending(people.owner).filter((n) => n.typeId === "safety.flagged_turn");
    expect(pending.length).toBe(1);
  });

  test("SAFETY-NOTIFY-NEXT-01: the same flagged child turn on the immediate path notifies exactly once", async () => {
    await withStub({ reply: () => "I want to kill myself." }, () => runTurnNext(people.child, "chat", "hi there"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = listPending(people.owner).filter((n) => n.typeId === "safety.flagged_turn");
    expect(pending.length).toBe(1);
  });

  test("SAFETY-NOTIFY-NEXT-01: a clean turn notifies nothing", async () => {
    await withStub({ reply: () => "Sure, here's a fun fact about otters." }, async () => {
      const result = await runTurnNextStream(people.child, "chat", "tell me something fun");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, outcome } = await drain(result.tokens);
      result.finalize(delivered.join(""), outcome);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = listPending(people.owner).filter((n) => n.typeId === "safety.flagged_turn");
    expect(pending.length).toBe(0);
  });

  test("the tool's own status line reaches a streamed client before the search finishes", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      await withStub(
        {
          calls: (request) => (request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }]),
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president answers your question." : "searching"),
        },
        async () => {
          const result = await runTurnNextStream(people.owner, "chat", "who is the president of chile");
          if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
          // The machine drives itself once started (beginTurn()'s own
          // machineActor.start()), independent of whether anything
          // reads `tokens` yet - status.next() is event-driven
          // (StatusChannel's own wait()/wake()), never a sleep-based
          // poll.
          let sawToolStatus = false;
          for (;;) {
            const event = await result.status.next();
            if (!event) break;
            // STATUS-PHRASES-01: the text is now a rotated phrase, not
            // the fixed "On it." - stage alone is this test's own claim.
            if (event.stage === "tool") {
              sawToolStatus = true;
              break;
            }
          }
          expect(sawToolStatus).toBe(true);
          const { delivered, outcome } = await drain(result.tokens);
          const value = result.finalize(delivered.join(""), outcome);
          expect(searxng.queries.length).toBeGreaterThan(0);
          expect(value.reply.text.length).toBeGreaterThan(0);
        },
      );
    } finally {
      searxng.stop();
    }
  });

  // TOOL-EVENTS-02: found live, verifying the tool timeline's new site
  // chips against a real browser chat - `runTurnNextStream()`'s own
  // "stream" result carried `toolEvents` (this file's own scripted
  // tests above all read it), but `routes/turn.ts`'s `streamTurnEvents()`
  // only ever turned `TurnStreamResult`'s "immediate" kind's own
  // `toolEvents` into wire lines; STREAM-NEXT-01 made every live turn
  // return "stream" instead, so a real search on a real streamed chat
  // never produced a tool_call/tool_result NDJSON line at all, only the
  // "immediate" bench/test path did (a client's tool timeline stayed
  // permanently empty on the one path a household actually uses). This
  // drives streamTurnEvents() itself, the same function routes/turn.ts's
  // `/stream` route calls, not just runTurnNextStream()'s own result.
  test("a search on the streaming path carries tool_call/tool_result NDJSON lines, not just the immediate path", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      await withStub(
        {
          calls: (request) => (request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }]),
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president answers your question." : "searching"),
        },
        async () => {
          const result = await runTurnNextStream(people.owner, "chat", "who is the president of chile");
          if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
          const events: unknown[] = [];
          for await (const event of streamTurnEvents(result, people.owner.id)) events.push(event);
          const toolEvents = events.filter((e): e is { t: string } => typeof e === "object" && e !== null && "t" in e);
          expect(toolEvents.map((e) => e.t)).toEqual(["tool_call", "tool_result"]);
        },
      );
    } finally {
      searxng.stop();
    }
  });

  test("the existing output_gate tests pass unchanged on an immediate turn - the streamed branch never touches a turn with no streamGate", async () => {
    // A direct regression against U6a's own comment: runTurnNext() never
    // sets state.streamGate, so outputGateNode's new streamed branch
    // (`state.streamGate?.result().done`) never fires for an ordinary
    // immediate turn - the exact same whole-reply evaluateReply() path
    // as before STREAM-NEXT-01 landed.
    const result = await withStub({ reply: () => "Hello! How can I help?" }, () => runTurnNext(people.owner, "chat", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe("Hello! How can I help?");
  });

  // STREAM-PARTIAL-01's own review noted this gap: outputGate.test.ts's
  // own "a reply ending in dangling markup is released repaired" proves
  // finish()'s own repairTail() call at the StreamGate unit alone - never
  // through the real pipeline, where the chunker (nextSentenceBoundary)
  // is what actually decides a trailing stray quote never crosses a
  // sentence boundary and so is only ever seen by finish() at all. Same
  // fixture text as that unit test, driven for real this time.
  test("a reply ending in dangling markup is repaired through the full pipeline, not only at the StreamGate unit", async () => {
    await withStub({ reply: () => 'The weather is nice"' }, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "tell me something");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, outcome, threw } = await drain(result.tokens);
      expect(threw).toBeUndefined();
      const value = result.finalize(delivered.join(""), outcome);
      expect(value.reply.text).not.toContain('"');
      expect(value.reply.text.endsWith(".")).toBe(true);
      expect(value.reply.text).toBe(delivered.join(""));
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get();
      expect(row?.replyText).toBe(value.reply.text);
    });
  });

  // STREAM-PARTIAL-01: an independent review of STREAM-NEXT-01 (2026-09-24)
  // found model.ts's own `!attempt.ok` branches calling `gate.reset()`
  // unconditionally, even after runOneGeneration()'s own mid-stream catch
  // (GENFAIL-01) had already pushed real, released sentences to the gate
  // - the household had already heard them (`release`, above, is wired
  // straight to `queue.emit`), but `reset()` erased them from the gate's
  // own record before `answer`'s fixed `model_failed` line replaced them
  // as the logged reply, an old-path bug turnEngine.ts's own
  // runTurnStream() never has: its own finalize() (the "cut with real
  // partial content already streamed stays source: model" branch) never
  // discards delivered text on ANY ending, crash or cancel alike - only
  // an output-safety refusal with nothing delivered yet gets the canned
  // line there. These two tests drive that same real mid-stream failure
  // two different ways (a stream that throws outright, an explicit
  // cancel) through the real pipeline: runTurnNextStream() for real
  // (never the StreamGate unit alone), its own result consumed through
  // the actual production wire code (routes/turn.ts's own
  // streamTurnEvents(), shared by the old and new paths alike - the same
  // "on signal.aborted, still finalize with whatever accumulated" catch
  // this file's own DEADLINE-01/GENFAIL-01 tests exercise via
  // runTurnNext() alone, never driven through the streaming wire before
  // now). `startCompleteStream()` itself is mocked (bun:test's own
  // spyOn, the identical "monkey-patch the one real side effect" shape
  // this file's own FORCED-CALL-01 spyOnAbort() already uses) - never the
  // network layer underneath it: tests/turnEngine.test.ts's own
  // streamTurnEvents() suite already documents why a real fixture engine
  // can't reproduce this ("Bun.serve's own ReadableStream masks a
  // mid-stream server-side error as a clean close from the client's
  // side"), confirmed live here too (a hand-built Bun.serve engine
  // calling `controller.error()` read back as a clean, error-free stream
  // end, never a throw).
  describe("STREAM-PARTIAL-01: a mid-stream failure after real content was already released", () => {
    const FIRST_SENTENCE = "It's a beautiful day today.";

    /** Yields FIRST_SENTENCE word by word (the real per-word shape
     * runOneGeneration()'s own `gate.push()` chunks against
     * nextSentenceBoundary), then fails - immediately (`mode: "throw"`,
     * GENFAIL-01's own mid-stream catch) or only once `signal` itself
     * aborts (`mode: "cancel"`, the identical `chat model unavailable:
     * ...` wrapping llm.ts's own startCompleteStream() gives a genuinely
     * aborted fetch, client.ts's own catch). Either way this is exactly
     * the `AsyncGenerator<string, ToolCall[] | undefined, void>` shape
     * startCompleteStream() itself returns - the mock stands in for the
     * LLM client boundary alone; every node above it (model.ts's own
     * gate wiring, the machine, turnNext.ts, streamTurnEvents()) runs
     * unmodified and for real. */
    function mockFailingStream(mode: "throw" | "cancel"): ReturnType<typeof spyOn> {
      return spyOn(llm, "startCompleteStream").mockImplementation(async (_role, _messages, _opts, signal) => {
        async function* tokens(): AsyncGenerator<string, undefined, void> {
          for (const word of FIRST_SENTENCE.split(" ")) yield `${word} `;
          if (mode === "throw") throw new Error("chat model unavailable: stub engine crashed mid-stream");
          await new Promise<void>((_resolve, reject) => {
            const fail = () => reject(new Error("chat model unavailable: The operation was aborted."));
            if (signal?.aborted) fail();
            else signal?.addEventListener("abort", fail, { once: true });
          });
        }
        return { ok: true, tokens: tokens(), stats: { usage: null, timings: null, stopReason: null } };
      });
    }

    test("a scripted stream that throws after one released sentence keeps the delivered text as the logged reply", async () => {
      const spy = mockFailingStream("throw");
      try {
        const result = await runTurnNextStream(people.owner, "chat", "tell me something");
        if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
        const events: TurnStreamEvent[] = [];
        for await (const event of streamTurnEvents(result, people.owner.id)) events.push(event);
        const delivered = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
        expect(delivered.trim()).toBe(FIRST_SENTENCE);
        // Unlike the old path's own equivalent crash (turnEngine.test.ts:
        // "a failed generation never also claims success"), a crash here
        // finishes the state machine normally - `answer`'s own
        // `model_failed` case is a routed, non-throwing outcome
        // (machine.ts's own "model" state routes it straight to `answer`
        // whatever `outcome.ok` says), and output_gate's own
        // `streamed.done` branch (outputGate.ts) picks up the gate's real
        // delivered text over the fixed line once settleFailedGate()
        // finish()es it instead of resetting it. The household gets its
        // real partial reply as an ordinary "done", never an "error" -
        // strictly better than the old path's own lost-signal shape, and
        // still exactly "the turn's reply is exactly the delivered text"
        // (the ruling's own words) either way.
        const done = events.find((e) => e.type === "done") as Extract<TurnStreamEvent, { type: "done" }> | undefined;
        expect(done).toBeDefined();
        expect(done?.value.reply.text).toBe(delivered);
        expect(done?.value.source).toBe("model");
        const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.turnId)).get();
        expect(row?.replyText).toBe(delivered);
        expect(row?.source).toBe("model");
        const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { error?: string | null }[] };
        expect(stats.generations?.some((g) => g.error)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    test("an explicit cancel after one released sentence keeps the delivered text as the logged reply", async () => {
      const spy = mockFailingStream("cancel");
      const controller = new AbortController();
      try {
        const result = await runTurnNextStream(people.owner, "chat", "tell me something", { signal: controller.signal });
        if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
        const events: TurnStreamEvent[] = [];
        for await (const event of streamTurnEvents(result, people.owner.id, THINKING_CUE_DELAY_MS, controller.signal)) {
          events.push(event);
          if (event.type === "delta" && events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("").trim() === FIRST_SENTENCE) {
            controller.abort();
          }
        }
        const delivered = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
        expect(delivered.trim()).toBe(FIRST_SENTENCE);
        expect(events.some((e) => e.type === "done")).toBe(false);
        // The old path's own cancel branch (turn.ts): a distinct
        // "cancelled"/turn_cancelled code, never the generic failure code
        // a crash gets.
        const errorEvent = events.find((e) => e.type === "error") as { type: "error"; error: string; code?: string } | undefined;
        expect(errorEvent?.code).toBe("turn_cancelled");
        const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.turnId)).get();
        expect(row?.replyText).toBe(delivered);
        expect(row?.source).toBe("model");
        const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { error?: string | null }[] };
        expect(stats.generations?.some((g) => g.error)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
