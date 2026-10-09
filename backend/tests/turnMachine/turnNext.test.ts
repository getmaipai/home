// U2 (docs/plans/turn-machine-state-record-2026-09-22.md, "Acceptance"):
// the new path's own tests, mirroring conversationBench.test.ts's own
// stub pattern (the real runner, a stub chat backend, a fake SearXNG) -
// never a second, bespoke harness. Exercises turnNext.ts end to end
// (the machine, every node, the real DB) with scripted model behaviour,
// since no live engine is available in this suite.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests, __setChatRecoveryNudgeForTests } from "@/lib/llmSupervisor";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { restoreDefaultScriptedStack, startStackFixture } from "../stackFixture";
import { collectHealth } from "@/lib/healthSnapshot";
import { listIssues } from "@/lib/issues";
import { __blockPortForTests, __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests } from "@/lib/packageHost";
import { createBenchPeople, startRecordingProxy, startFakeSearxng, type BenchPeople, type FakeSearxng } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { REMEMBER_CONFIRM_VARIANTS, REFUSAL_FIRST, REFUSAL_REPEAT } from "@/lib/replyVariation";
import { CATALOG } from "@/lib/modelCatalog";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { registerProjectType, __resetProjectTypesForTests } from "@/lib/projects/projectTypes";
import { START_PROJECT_TOOL_ID } from "@/lib/projects/tool";
import { migratePendingAsksThroughGate } from "@/lib/gate/pendingAskMigration";
import { StreamSafetyRefusal, StreamUnavailable, type StreamOutcome, type SpeakerEvidence } from "@/lib/turnShared";
import * as llm from "@/lib/llm";
import { streamTurnEvents, THINKING_CUE_DELAY_MS } from "@/routes/turn";
import { streamEventForViewer } from "@/lib/turnErrorDetail";
import type { TurnStreamEvent } from "@/wire";
import { getPendingAsk, resolveOrCreateConversation, setPendingAsk } from "@/lib/conversationHistory";
import { listPending } from "@/lib/notifications";
import { db } from "@/db";
import { conversationTurns, conversations, memoryRecords, people as people_ } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NO_RECORD_BUDGET, __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { ensureSubjectEntity } from "@/lib/subjects";
import { COMPOSE_FAILURE_LINE } from "@/lib/composer";
import { FAILURE_COPY, partialReplyNote } from "@/lib/generationFailure";
import { remember, embedMemoryRecordSafely, PROFILE_SOURCE } from "@/lib/memory";
import { DEFAULT_PERSONA, resolvePersona } from "@/lib/persona";
import { identityLine } from "@/lib/turnShared";
import { TurnStreamEvent as ToolTurnStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import { useDefaultScriptedStack } from "../stackFixture";
import { judgeQueueStats, runJudgeBatch } from "@/lib/memoryJudge";
import { activeTurnCount, turnActiveWithin, __resetTurnActivityForTests } from "@/lib/turnActivity";
import * as ageBand from "@/lib/ageBand";

const realBand = ageBand.speakerAgeBand;

// THIN-1D (rule 6 as amended 2026-10-03): no lookup-failed sentence is stored
// anywhere; the note is the model's own reply text. These scripted notes stand
// in for two different model runs of the same failed lookup.
const NOTE_A = "I couldn't look that up just now, so this is from memory: Kevin Bacon was in Footloose and Mystic River.";
const NOTE_B = "My search didn't go through, so I'm going on what I remember. Kevin Bacon starred in Footloose.";
const MARKER = "ZXQ-RAW-ERR-7731";

let people: BenchPeople;
const testChatPort = process.env.MAIPAI_LLAMA_SERVER_PORT!;

// FLAKE-FORCED-01 (issue #137): the searxng/web-fetch token bucket
// (packageHost.ts's own SEARXNG_RATE_LIMIT, module-global, capacity
// 10, refillPerSecond 0.5) drains across this file's real-tool-call
// tests since nothing reset it - later tests that need a real search
// (the interim rule's required_miss case among them) got "rate-
// limited" instead, reading as a timing-dependent flake under load and
// actually failing deterministically once enough of this file's own
// tests fall through to a real websearch call. Reset it here, the same
// shape packageHost.test.ts and chatTurn.test.ts already use.
beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetSearchRotationForTests();
  __resetSearxngEnginesCacheForTests();
  people = createBenchPeople();
  // A real, measured budget lives on the 8B catalog entry (U2a); tests
  // select it by id so `resolveTurnBudget()` reads the same record
  // production does, never a hand-built test-only shape.
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function withStub<T>(
  opts: { reply?: (request: ChatCompletionRequest) => string; calls?: (request: ChatCompletionRequest) => { id: string; name: string; args: string }[] | undefined },
  fn: () => Promise<T>,
): Promise<T> {
  // Older fixtures mutate the catalog's deprecated list to force one tool.
  // Translate that fixture intent to the derivation's test-only override.
  const forced = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")?.turn_budget?.tools_offered ?? [];
  __setToolOfferOverridesForTests(forced);
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
    __setToolOfferOverridesForTests(null);
    proxy.stop();
    await stub.stop();
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
  test("search succeeds, then a dead model returns a typed status and stores the failed turn", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const original = llm.startCompleteStreamPieces.bind(llm);
    const failure = spyOn(llm, "startCompleteStreamPieces").mockImplementation(async (...args) => {
      if (args[1].some((message) => message.role === "tool")) return { ok: false, status: 503, code: "unavailable", error: "chat model unavailable: could not reach local engine" };
      return original(...args);
    });
    const before = db.select().from(conversationTurns).all().length;
    try {
      const result = await withStub(
        {
          calls: (request) => request.messages.some((message) => message.role === "tool")
            ? undefined
            : [{ id: "call-death", name: "websearch", args: JSON.stringify({ expression: "today's headline news" }) }],
          reply: () => "checking the news",
        },
        () => runTurnNext(people.owner, "chat", "what is in the news today"),
      );
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result).toEqual({ ok: false, status: 503, code: "engine_unavailable", error: "MaiPai's AI isn't running right now." });
      // CHAT-CALM-ERRORS-01b: kept as a failed row, never a "done" one.
      expect(db.select().from(conversationTurns).all()).toHaveLength(before + 1);
      expect(db.select().from(conversationTurns).all().filter((row) => row.status === "done")).toHaveLength(before);
    } finally {
      failure.mockRestore();
      searxng.stop();
    }
  });

  test("the live streaming engine refusal emits engine_unavailable and stores a failed turn", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const original = llm.startCompleteStreamPieces.bind(llm);
    const failure = spyOn(llm, "startCompleteStreamPieces").mockImplementation(async (...args) => {
      if (args[1].some((message) => message.role === "tool")) return { ok: false, status: 503, code: "unavailable", error: "chat model unavailable: could not reach local engine" };
      return original(...args);
    });
    const before = db.select().from(conversationTurns).all().length;
    try {
      const { result, thrown } = await withStub(
        {
          calls: (request) => request.messages.some((message) => message.role === "tool")
            ? undefined
            : [{ id: "call-stream-death", name: "websearch", args: JSON.stringify({ expression: "today's headline news" }) }],
          reply: () => "checking the news",
        },
        async () => {
          const result = await runTurnNextStream(people.owner, "chat", "what is in the news today");
          if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
          let thrown: unknown;
          try {
            for await (const _chunk of result.tokens) { /* engine dies before reply text */ }
          } catch (err) {
            thrown = err;
          }
          return { result, thrown };
        },
      );
      expect(thrown).toBeInstanceOf(StreamUnavailable);
      expect(thrown).toMatchObject({ code: "engine_unavailable", message: "MaiPai's AI isn't running right now." });
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(db.select().from(conversationTurns).all()).toHaveLength(before + 1);
      expect(db.select().from(conversationTurns).all().filter((row) => row.status === "done")).toHaveLength(before);
    } finally {
      failure.mockRestore();
      searxng.stop();
    }
  });

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
      // 2026-10-03: the reply is the model's own composition after the
      // search, so the stored row says so (routing tier "tool"), and the
      // history window gives it back as the assistant's words.
      expect(result.value.routing?.tier).toBe("tool");
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
          calls: (request) => (!request.messages.some((m) => m.role === "tool" && m.tool_call_id === "call-1") ? [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }] : undefined),
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile is Gabriel Boric." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");

      let queryWriterRequest: ChatCompletionRequest | undefined;
      const second = await withStub(
        {
          calls: (request) => (!request.response_format && !request.messages.some((m) => m.role === "tool" && m.tool_call_id === "call-2") ? [{ id: "call-2", name: "websearch", args: JSON.stringify({ expression: "he" }) }] : undefined),
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
  // argument either (the retired turn engine's resolveToolCalls() call); this
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

  // THIN-4A (rule 7): the model never has to ask for the pages. A bare
  // {expression} call still runs with the pages read, and the model's next
  // round gets the page text as numbered sources.
  test("a websearch call with only an expression reads the result pages and the model gets numbered sources", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const { __setPageReaderForTests } = await import("@/lib/packageHost");
    __setPageReaderForTests(async (url) => ({ type: "document", file_id: "file-1", url, title: "A page", text: "PAGE TEXT FROM THE FIXTURE", chunks: [], links: [], sections: [] }));
    let toolContent = "";
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "berlin wall anniversary" }) }];
          },
          reply: (request) => {
            toolContent = String(request.messages.find((m) => m.role === "tool")?.content ?? "");
            return request.messages.some((m) => m.role === "tool") ? "Here's what I found." : "searching";
          },
        },
        () => runTurnNext(people.owner, "chat", "when did the berlin wall come down"),
      );
      expect(result.ok).toBe(true);
      expect(toolContent).toContain("PAGE TEXT FROM THE FIXTURE");
      expect(toolContent).toContain('"n":1');
    } finally {
      __setPageReaderForTests(null);
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

// home#147: logTurnSafely() (the retired turn engine, the old path) sets both of
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
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "almanac-date"] };
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

  test("a package's own reply (no phrasing round) is not tagged routing tier \"tool\", so the window keeps noting it as the package's words", async () => {
    const original = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget;
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "almanac-date"] };
    try {
      const result = await withStub(
        {
          calls: (request) => (!request.messages.some((m) => m.role === "tool") && request.tools?.some((t) => t.function.name === "almanac-date") ? [{ id: "call-1", name: "almanac-date", args: "{}" }] : undefined),
          reply: () => "It is a Saturday.",
        },
        () => runTurnNext(people.owner, "chat", "what's today's date"),
      );
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.source).toBe("plugin");
      expect(result.value.routing).toBeUndefined();
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

describe("turnNext.ts: accepted answer blocks reach the turn and stored row (GENUI-02)", () => {
  test("stores an allowed package block and keeps it after the tool result", async () => {
    const plugins = await import("@/lib/plugins");
    const originalLoad = plugins.loadManifestOnly;
    const manifest = spyOn(plugins, "loadManifestOnly").mockImplementation((id) => {
      const loaded = originalLoad(id);
      return id === "websearch" && loaded.ok
        ? { ...loaded, value: { ...loaded.value, returns_blocks: ["spec_sheet"] } }
        : loaded;
    });
    const block = {
      id: "blk-turn01",
      kind: "spec_sheet",
      schema_version: 1,
      producer: "websearch",
      alt: "A date facts sheet.",
      provenance: "almanac-date result",
      created_at: "2026-10-08T12:00:00.000Z",
      hlc: "1791478099338:0:abcdef",
      props: { title: "Date", rows: [{ label: "Date", value: "Thursday" }] },
    };
    const run = spyOn(plugins, "runPlugin").mockResolvedValue({
      ok: true,
      value: { reply: { text: "Today is Thursday." }, actions: [], blocks: [block] } as never,
    } as never);
    try {
      const result = await withStub(
        {
          calls: (request) => (!request.messages.some((message) => message.role === "tool") && request.tools?.some((tool) => tool.function.name === "websearch") ? [{ id: "call-block", name: "websearch", args: JSON.stringify({ expression: "Thursday" }) }] : undefined),
          reply: (request) => (request.messages.some((message) => message.role === "tool") ? "Today is Thursday." : "unused"),
        },
        () => runTurnNext(people.owner, "chat", "search for Thursday"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe("Today is Thursday.");
      expect(result.toolEvents?.map((event) => event.t)).toEqual(["tool_call", "tool_result", "block"]);
      // GENUI-13c: the hub stamps where the block sits; the answer had no text streamed before the tool result, so it
      // goes after the one-paragraph reply.
      const stamped = { ...block, after_paragraph: 1 };
      expect(result.value.blocks).toEqual([stamped]);
      expect(result.toolEvents?.find((event) => event.t === "block")).toMatchObject({ block: stamped });
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      expect(JSON.parse(row!.blocks as unknown as string)).toEqual([stamped]);
    } finally {
      run.mockRestore();
      manifest.mockRestore();
    }
  });
});

describe("turnNext.ts: answer blocks go out in place on the stream (GENUI-13c)", () => {
  test("the block event follows the tool lines, carries after_paragraph, comes before the first released text it precedes, and the stored blocks agree", async () => {
    const plugins = await import("@/lib/plugins");
    const originalLoad = plugins.loadManifestOnly;
    const manifest = spyOn(plugins, "loadManifestOnly").mockImplementation((id) => {
      const loaded = originalLoad(id);
      return id === "websearch" && loaded.ok ? { ...loaded, value: { ...loaded.value, returns_blocks: ["spec_sheet"] } } : loaded;
    });
    const block = {
      id: "blk-strm01",
      kind: "spec_sheet",
      schema_version: 1,
      producer: "websearch",
      alt: "A date facts sheet.",
      provenance: "almanac-date result",
      created_at: "2026-10-08T12:00:00.000Z",
      hlc: "1791478099338:0:abcdef",
      // A package that sends its own placement is ignored: the hub stamps it.
      after_paragraph: 7,
      props: { title: "Date", rows: [{ label: "Date", value: "Thursday" }] },
    };
    const run = spyOn(plugins, "runPlugin").mockResolvedValue({ ok: true, value: { reply: { text: "Today is Thursday." }, actions: [], blocks: [block] } as never } as never);
    try {
      await withStub(
        {
          calls: (request) => (!request.messages.some((message) => message.role === "tool") && request.tools?.some((tool) => tool.function.name === "websearch") ? [{ id: "call-blk", name: "websearch", args: JSON.stringify({ expression: "Thursday" }) }] : undefined),
          reply: (request) => (request.messages.some((message) => message.role === "tool") ? "Today is Thursday. It is a fine day.\n\nHave a good one." : "unused"),
        },
        async () => {
          const result = await runTurnNextStream(people.owner, "chat", "search for Thursday");
          if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
          const events: Array<{ type?: string; t?: string; text?: string; block?: { after_paragraph?: number }; value?: { blocks?: Array<{ after_paragraph?: number }>; turn_id: string } }> = [];
          for await (const event of streamTurnEvents(result, people.owner.id)) events.push(event as never);
          const kinds = events.map((event) => event.t ?? event.type);
          // Exactly one block event, after the tool lines, and before the first delta (it was ready before any text).
          expect(kinds.filter((kind) => kind === "block")).toHaveLength(1);
          const blockAt = kinds.indexOf("block");
          expect(blockAt).toBeGreaterThan(kinds.indexOf("tool_result"));
          expect(blockAt).toBeLessThan(kinds.indexOf("delta"));
          const sent = events[blockAt]!;
          expect(sent.block?.after_paragraph).toBe(0);
          // The reply text is whole and unaltered, and the stored blocks carry the same stamp.
          const text = events.flatMap((event) => (event.type === "delta" ? [event.text ?? ""] : [])).join("");
          expect(text.trim()).toBe("Today is Thursday. It is a fine day.\n\nHave a good one.");
          const done = events.find((event) => event.type === "done")!;
          expect(done.value?.blocks?.map((b) => b.after_paragraph)).toEqual([0]);
          const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, done.value!.turn_id)).get();
          expect((JSON.parse(row!.blocks as unknown as string) as Array<{ after_paragraph: number }>).map((b) => b.after_paragraph)).toEqual([0]);
        },
      );
    } finally {
      run.mockRestore();
      manifest.mockRestore();
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
    // here too by mistake) - the retired turn engine's own reference builder
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
    // the retired turn engine's real convention - "remember" is a bundled
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
    const noToolsBudget = { ...NO_RECORD_BUDGET, background_turns: false, always_search: false, model_transitions: false, rounds: 0 as const };
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
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "lock-doors"] };
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
    expect(ask?.capabilities).toEqual(["home:lock"]);

    const resumed = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "yes", { conversationId: parked.value.conversation_id }));
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
    expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    // A review caught turnNext.ts forcing source to "confirm" for
    // every resumed action, whether it actually ran a package or not -
    // the retired turn engine's own reference builder reports "plugin" (with
    // plugin_id) once the confirmed action really executes, matching
    // what conversationRunner.ts's scorer and any real client expect.
    expect(resumed.value.source).toBe("plugin");
    expect(resumed.value.plugin_id).toBe("lock-doors");
  });

  test("PARENT-ASK-01a: bedtime-storybook remains a child self-confirmation", async () => {
    registerProjectType({ id: "bedtime-storybook", title: "Bedtime storybook", description: "A bedtime storybook.", minRole: "child", consequential: true, paramsSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string" } }, additionalProperties: false }, buildPlan: () => ({ steps: [{ id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: "write a gentle story", inputs: [] } }], ceilings: { maxWallSeconds: 30, maxGeneratorJobs: 1 } }) });
    const entry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;
    const original = entry.turn_budget;
    entry.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), START_PROJECT_TOOL_ID] };
    try {
      const result = await withStub({ calls: (request) => request.tools?.some((t) => t.function.name === START_PROJECT_TOOL_ID) ? [{ id: "storybook", name: START_PROJECT_TOOL_ID, args: JSON.stringify({ type: "bedtime-storybook", params: { topic: "a moon rabbit" } }) }] : undefined, reply: () => "unused" }, () => runTurnNext(people.child, "chat", "make a bedtime storybook about a moon rabbit"));
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.source).toBe("confirm");
    } finally { entry.turn_budget = original; __resetProjectTypesForTests(); }
  });

  test("PARENT-ASK-01a: a child's family-name search is refused without claiming a parent was asked", async () => {
    const entry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;
    const original = entry.turn_budget;
    entry.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "websearch"] };
    try {
      const result = await withStub({ calls: (request) => request.tools?.some((t) => t.function.name === "websearch") ? [{ id: "search", name: "websearch", args: JSON.stringify({ expression: "Jesse Torres news" }) }] : undefined, reply: () => "unused" }, () => runTurnNext(people.child, "chat", "search the web for Jesse Torres news"));
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe("This needs a parent to decide. I haven't asked one.");
      expect(result.value.confirm).toBeUndefined();
      expect(getPendingAsk(result.value.conversation_id)).toBeNull();
    } finally { entry.turn_budget = original; }
  });

  test("PARENT-ASK-01a: a teen lock request is refused before it can be parked", async () => {
    const entry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;
    const original = entry.turn_budget;
    entry.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "lock-doors"] };
    try {
      const actor = { ...people.child, role: "teen" };
      const result = await withStub({ calls: (request) => request.tools?.some((t) => t.function.name === "lock-doors") ? [{ id: "lock", name: "lock-doors", args: "{}" }] : undefined, reply: () => "unused" }, () => runTurnNext(actor, "chat", "lock the doors"));
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe("This needs a parent to decide. I haven't asked one.");
      expect(result.value.confirm).toBeUndefined();
      expect(getPendingAsk(result.value.conversation_id)).toBeNull();
      expect(result.value.plugin_id).toBeUndefined();
    } finally { entry.turn_budget = original; }
  });

  test("PARENT-ASK-01a: a teen's yes cannot resume a legacy lock confirmation", async () => {
    const actor = { ...people.child, role: "teen" };
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("expected the teen conversation");
    setPendingAsk(conversation.value.id, { kind: "confirm", prompt: "Lock the front door?", packageId: "lock-doors", args: {}, turnId: "legacy-lock-ask" });
    const result = await withStub({ reply: () => "unused" }, () => runTurnNext(actor, "chat", "yes", { conversationId: conversation.value.id }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the refusal");
    expect(result.code).toBe("parent_required");
    expect(getPendingAsk(conversation.value.id)).toBeNull();
  });

  test("PARENT-ASK-01a: a teen's approve tap cannot resume a legacy parent-required ask", async () => {
    const actor = { ...people.child, role: "teen" };
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("expected the teen conversation");
    setPendingAsk(conversation.value.id, { kind: "confirm", prompt: "Lock the front door?", packageId: "lock-doors", args: {}, turnId: "legacy-lock-card" });
    const result = await runTurnNext(actor, "chat", "yes", { conversationId: conversation.value.id, ask_answer: { turn_id: "legacy-lock-card", approved: true } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the refusal");
    expect(result).toMatchObject({ ok: false, status: 403, code: "parent_required", error: "This needs a parent to decide. I haven't asked one." });
    expect(getPendingAsk(conversation.value.id)).toBeNull();
  });

  test("PARENT-ASK-01a: startup migration clears parent or denied asks and preserves self asks", () => {
    const childLock = resolveOrCreateConversation(people.child, "chat");
    const childStory = resolveOrCreateConversation(people.child, "robot");
    const adultLock = resolveOrCreateConversation(people.owner, "chat");
    if (!childLock.ok || !childStory.ok || !adultLock.ok) throw new Error("expected conversations for migration fixtures");
    setPendingAsk(childLock.value.id, { kind: "confirm", prompt: "Lock?", packageId: "lock-doors", args: {}, turnId: "child-lock" });
    setPendingAsk(childStory.value.id, { kind: "confirm", prompt: "Create?", packageId: "storybook", args: {}, turnId: "child-story", capabilities: ["artifact:write"], consequential: true });
    setPendingAsk(adultLock.value.id, { kind: "confirm", prompt: "Lock?", packageId: "lock-doors", args: {}, turnId: "adult-lock" });

    expect(migratePendingAsksThroughGate()).toBe(1);
    expect(getPendingAsk(childLock.value.id)).toBeNull();
    expect(getPendingAsk(childStory.value.id)?.turnId).toBe("child-story");
    expect(getPendingAsk(adultLock.value.id)?.turnId).toBe("adult-lock");
    expect(migratePendingAsksThroughGate()).toBe(0);
  });
});

// APPROVE-CARD-01 (issue #177): the ask itself always resumed correctly
// (the describe block above proves it), but nothing on the wire told a
// client it was a yes/no ask at all - the plain-text prompt rendered as
// an ordinary reply, indistinguishable from any other answer. This adds
// the wire shape (TurnValue.confirm, PendingAsk.turnId, a real "pending"
// outcome) and the structured resume path (`ask_answer`, matched by turn
// id) a tap-to-approve card actually needs, beside the typed/spoken
// "yes" the describe block above already covers and this leaves
// unchanged.
describe("turnNext.ts: APPROVE-CARD-01, the confirm card's wire shape and its structured resume", () => {
  async function parkLockDoorsAsk(opts: { temporary?: boolean } = {}) {
    const original = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget;
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "lock-doors"] };
    try {
      return await withStub(
        {
          calls: (request) => (request.tools?.some((t) => t.function.name === "lock-doors") ? [{ id: "call-1", name: "lock-doors", args: "{}" }] : undefined),
          reply: () => "locking",
        },
        () => runTurnNext(people.owner, "chat", "lock the doors", opts.temporary ? { temporary: true } : {}),
      );
    } finally {
      CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = original;
    }
  }

  test("the asked turn's own TurnValue.confirm and the persisted PendingAsk.turnId are set, matching this turn's own id, plus a real pending/via:confirm outcome (a gap this path had entirely before)", async () => {
    const parked = await parkLockDoorsAsk();
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    expect(parked.value.source).toBe("confirm");
    expect(parked.value.confirm).toEqual({ package_id: "lock-doors", open: true });

    const ask = getPendingAsk(parked.value.conversation_id);
    expect(ask).not.toBeNull();
    expect(ask?.turnId).toBe(parked.value.turn_id);

    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, parked.value.turn_id)).get();
    const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string; via?: string }[]) : [];
    expect(outcomes.some((o) => o.packageId === "lock-doors" && o.status === "pending" && o.via === "confirm")).toBe(true);
    // Persisted on the row too (chatHistoryAdapter.ts's own reload path
    // reads it from here, not from the live TurnValue).
    expect(row?.confirm ? (JSON.parse(row.confirm as unknown as string) as { package_id: string; open: boolean }) : null).toEqual({ package_id: "lock-doors", open: true });
  });

  test("a temporary conversation's own asked turn carries no confirm field - setPendingAsk/getPendingAsk are no-ops there, so a card promising a resumable confirm would lie", async () => {
    const parked = await parkLockDoorsAsk({ temporary: true });
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    expect(parked.value.confirm).toBeUndefined();
    expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
  });

  test("a button-originated ask_answer with the matching turn_id and approved:true resumes exactly as a typed yes would", async () => {
    const parked = await parkLockDoorsAsk();
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    const resumed = await withStub({ reply: () => "unused" }, () =>
      runTurnNext(people.owner, "chat", "Yes", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, approved: true } }),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
    expect(resumed.value.source).toBe("plugin");
    expect(resumed.value.plugin_id).toBe("lock-doors");
    expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
  });

  test("approved:false clears the ask without resuming, exactly like a typed no", async () => {
    const parked = await parkLockDoorsAsk();
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    const resumed = await withStub({ reply: () => "Okay, no action taken." }, () =>
      runTurnNext(people.owner, "chat", "No", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: parked.value.turn_id, approved: false } }),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
    expect(resumed.value.source).not.toBe("plugin");
    expect(resumed.value.plugin_id).toBeUndefined();
    expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
  });

  test("a mismatched turn_id returns 409 ask_stale, never falls through to ordinary routing", async () => {
    const parked = await parkLockDoorsAsk();
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    const resumed = await runTurnNext(people.owner, "chat", "Yes", { conversationId: parked.value.conversation_id, ask_answer: { turn_id: "some-other-turn-id", approved: true } });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) throw new Error("expected a failure result");
    expect(resumed.status).toBe(409);
    expect(resumed.code).toBe("ask_stale");
    // The still-live pending ask (for the REAL turn, not the stale tap's
    // named one) is untouched by the 409 - beginTurn()'s own comment:
    // this request doesn't get to answer someone else's live question
    // by accident.
    expect(getPendingAsk(parked.value.conversation_id)?.turnId).toBe(parked.value.turn_id);
  });

  test("the existing typed-text AFFIRMATIVE_RE path is unchanged when ask_answer is absent", async () => {
    const parked = await parkLockDoorsAsk();
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    const resumed = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "yes", { conversationId: parked.value.conversation_id }));
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
    expect(resumed.value.source).toBe("plugin");
    expect(resumed.value.plugin_id).toBe("lock-doors");
  });
});

describe("turnNext.ts: PROJECT-REPLY-01, a resumed start_project confirmation surfaces its own outcome text (live incident 2026-09-27)", () => {
  // Jesse confirmed a real start_project ask with "yes" and got back a
  // bare "Yes." instead of anything about the project that actually
  // started (the project itself ran fine - a DB row reached "done"
  // with a real artifact). The suspected mechanism: a preConfirmed/
  // resumed action skips the model's own DECISION round (machine.ts's
  // hasPreConfirmed guard jumps safety -> policy directly), so when
  // the tool round's own outcome reaches `answer` with nothing else to
  // read, answerInputFrom()'s "from_outcomes" branch used to build the
  // reply from `outcome.userMessage` alone - a field runStartProjectTool()
  // (projects/tool.ts) only ever sets on a FAILURE branch, never on
  // success (success sets `result.reply.text` instead, which
  // `userMessage` never carried).
  //
  // Tracing `machine.ts`'s own "tool" state onDone further (this file's
  // own test, below) found a second real mechanism this fix interacts
  // with: under the household's one real catalog budget (qwen3-8b,
  // `rounds: 1`), ANY successful (non-all-failed) tool round - resumed
  // or not - still gets exactly one further "phrasing" round through
  // the model afterward (`moreRoundsAvailable`; `tool.ts`'s own doc
  // comment already names this on purpose: "the phrasing round every
  // other tool's outcome already goes through... relays it, never
  // invents its own number"). So `from_outcomes`'s SUCCESS branch, and
  // this fix, is reached with no further model round only when none
  // remains: the FAILED-outcome case (already correct either way,
  // `userMessage` was already set there) or a budget with
  // `model_transitions` off / its one round already spent -
  // `NO_RECORD_BUDGET` (budget.ts's own real fallback for a chat model
  // with no measured record, not a test-only shape) is exactly that.
  // This test proves the fix at that layer: the resumed turn's
  // `chat.model_id` is switched to an unrecognized one before the
  // resume, so `resolveTurnBudget()` falls to `NO_RECORD_BUDGET` for
  // that turn only - `policy.ts`'s own start_project branch never
  // reads `tools_offered` to classify a preConfirmed call, so this has
  // no effect on parking or resuming the ask, only on whether a
  // phrasing round follows the tool's own success. Whether the
  // household's OWN real qwen3-8b budget's phrasing round is what
  // actually said "Yes." on the live turn (a model-quality question,
  // not this bug) is a separate, unverified question, named honestly
  // in the report rather than assumed away.
  let completeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    registerProjectType({
      id: "test-confirm-project",
      title: "a test confirm project",
      description: "A project used only to exercise the confirm/resume reply path in tests.",
      minRole: "child",
      consequential: true,
      paramsSchema: {
        type: "object",
        required: ["topic"],
        properties: { topic: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
      buildPlan: (params) => {
        const topic = typeof params.topic === "string" && params.topic.trim() ? params.topic.trim() : "a small adventure";
        return {
          steps: [{ id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: `write a short passage about ${topic}`, inputs: [] } }],
          ceilings: { maxWallSeconds: 30, maxGeneratorJobs: 1 },
        };
      },
    });
    // The project's own background step calls llm.ts's complete()
    // (projects/steps.ts), a different call than the turn's own model
    // round (nodes/model.ts's startCompleteStream()) - stubbing it
    // directly keeps the background project deterministic and fast
    // without needing it to reach either withStub()'s HTTP server,
    // which is already torn down by the time the project's own step
    // runs (tool.ts starts the project and returns before any step
    // does).
    completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text: "A short, gentle passage.", model: "stub" } }));
  });

  afterEach(() => {
    completeSpy.mockRestore();
    __resetProjectTypesForTests();
  });

  test("a confirmed start_project reply names the project it started, never a generic filler", async () => {
    const parked = await withStub(
      {
        calls: (request) =>
          request.tools?.some((t) => t.function.name === START_PROJECT_TOOL_ID)
            ? [{ id: "call-1", name: START_PROJECT_TOOL_ID, args: JSON.stringify({ type: "test-confirm-project", params: { topic: "a shy dragon who's scared of the dark" } }) }]
            : undefined,
        reply: () => "unused",
      },
      () => runTurnNext(people.owner, "chat", "start a test confirm project about a shy dragon who's scared of the dark"),
    );
    expect(parked.ok).toBe(true);
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    expect(parked.value.source).toBe("confirm");

    const ask = getPendingAsk(parked.value.conversation_id);
    expect(ask).not.toBeNull();
    expect(ask?.packageId).toBe(START_PROJECT_TOOL_ID);

    // Forces resolveTurnBudget() to NO_RECORD_BUDGET (model_transitions:
    // false) for the resume only - no phrasing round follows the tool's
    // own success, so this reaches from_outcomes directly, the exact
    // layer the fix touches (see the describe block's own comment). If
    // the model were consulted at all here, this stub's "PHRASING_
    // SHOULD_NOT_RUN_HERE" sentinel would surface in the final text and
    // the assertions below would catch it.
    setHouseholdSettingValue("chat.model_id", "no-such-model-id");
    const resumed = await withStub({ reply: () => "PHRASING_SHOULD_NOT_RUN_HERE" }, () =>
      runTurnNext(people.owner, "chat", "yes", { conversationId: parked.value.conversation_id }),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
    expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    expect(resumed.value.source).toBe("plugin");
    expect(resumed.value.plugin_id).toBe(START_PROJECT_TOOL_ID);
    // The bug: this used to be "" (userMessage is unset on success),
    // which assessReply() then flagged as empty and a retry replaced
    // with a generic "Yes." - never empty, and never that filler, and
    // never the phrasing round's own sentinel (proving the model was
    // never consulted on this turn, matching hasPreConfirmed's own
    // intent for the decision round and NO_RECORD_BUDGET's own
    // model_transitions: false for the round after).
    expect(resumed.value.reply.text.length).toBeGreaterThan(0);
    expect(resumed.value.reply.text).not.toBe("Yes.");
    expect(resumed.value.reply.text).not.toContain("PHRASING_SHOULD_NOT_RUN_HERE");
    expect(resumed.value.reply.text).toContain("a test confirm project");
    expect(resumed.value.reply.text).toMatch(/^Creating a test confirm project/);
  });
});

describe("turnNext.ts: PROJECT-PHRASE-01, a successful start_project outcome skips the phrasing round under the household's own real budget (closes the incident: PROJECT-PKGTYPE-02/03, PROJECT-REPLY-01, 2026-09-27)", () => {
  // The describe block above (PROJECT-REPLY-01) proves `answerInputFrom()`'s
  // `from_outcomes` branch is correct once reached, but its own test
  // forces `chat.model_id` to an unrecognized one before the resume so
  // `resolveTurnBudget()` falls to `NO_RECORD_BUDGET` (model_transitions:
  // false) - exactly the layer that made the bug INVISIBLE to that test,
  // not the layer the live incident actually broke on. Jesse's real turn
  // ran under the household's one real catalog budget (qwen3-8b:
  // model_transitions true, rounds: 1), where `moreRoundsAvailable` is
  // true after ANY successful (non-all-failed) tool round - `tool`'s
  // onDone used to route there unconditionally, straight to a second
  // `model` invocation (the "phrasing round") built from
  // `composer.ts`'s `phrasingInstruction()`, a prompt written for a
  // lookup's "answer the question from the results" framing that is the
  // wrong shape entirely for a "yes" that just started a project -
  // confronted with it, the model echoed fragments of its own
  // instructions back rather than relaying `runStartProjectTool()`'s own
  // already-correct `result.reply.text`. This test keeps the real
  // qwen3-8b budget in force for the resume (never switching
  // chat.model_id away from it, unlike the describe block above) and
  // proves machine.ts's new `toolProvidesOwnReply` guard routes straight
  // to `answer` before that phrasing round's `model` invocation can ever
  // happen - the single thing PROJECT-REPLY-01's own report said was
  // still unverified.
  let completeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    registerProjectType({
      id: "test-confirm-project",
      title: "a test confirm project",
      description: "A project used only to exercise the confirm/resume reply path in tests.",
      minRole: "child",
      consequential: true,
      paramsSchema: {
        type: "object",
        required: ["topic"],
        properties: { topic: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
      buildPlan: (params) => {
        const topic = typeof params.topic === "string" && params.topic.trim() ? params.topic.trim() : "a small adventure";
        return {
          steps: [{ id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: `write a short passage about ${topic}`, inputs: [] } }],
          ceilings: { maxWallSeconds: 30, maxGeneratorJobs: 1 },
        };
      },
    });
    // Same reason as PROJECT-REPLY-01's own beforeEach: the project's
    // background step calls llm.ts's complete() directly, a different
    // call than the turn's own model round, and withStub()'s HTTP
    // server is already torn down by the time the project's own step
    // runs.
    completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text: "A short, gentle passage.", model: "stub" } }));
  });

  afterEach(() => {
    completeSpy.mockRestore();
    __resetProjectTypesForTests();
  });

  // TraceRecorder.skip() (trace.ts) pushes a `{ node: "model", outcome:
  // { skipped: true, ... } }` entry for every state the machine's own
  // route never entered, to satisfy the state record's "all eight
  // nodes present (ran or skipped)" acceptance - a resumed turn that
  // never enters `model` at all still carries exactly one such skipped
  // entry, so counting `n.node === "model"` alone (SEARCH-EMPTY-01's
  // own helper above, which never needed to tell the two apart since
  // its turns always ran `model` at least once) would wrongly count 1
  // here too. This filters those out to count only real invocations.
  async function modelNodeCount(turnId: string): Promise<number> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { skipped?: boolean } }[] };
    return (stats.nodes ?? []).filter((n) => n.node === "model" && n.outcome?.skipped !== true).length;
  }

  test("the resumed turn reaches answer with zero model invocations under the real qwen3-8b budget, and the reply is the outcome's own text, never a garbled phrasing-round echo", async () => {
    const parked = await withStub(
      {
        calls: (request) =>
          request.tools?.some((t) => t.function.name === START_PROJECT_TOOL_ID)
            ? [{ id: "call-1", name: START_PROJECT_TOOL_ID, args: JSON.stringify({ type: "test-confirm-project", params: { topic: "a shy dragon who's scared of the dark" } }) }]
            : undefined,
        reply: () => "unused",
      },
      () => runTurnNext(people.owner, "chat", "start a test confirm project about a shy dragon who's scared of the dark"),
    );
    expect(parked.ok).toBe(true);
    if (!parked.ok || parked.kind !== "immediate") throw new Error("expected an immediate result");
    expect(parked.value.source).toBe("confirm");

    const ask = getPendingAsk(parked.value.conversation_id);
    expect(ask).not.toBeNull();
    expect(ask?.packageId).toBe(START_PROJECT_TOOL_ID);

    // Deliberately NOT switching `chat.model_id` here (the top-level
    // beforeEach already set it to "qwen3-8b-instruct-q4-k-m", and it
    // stays that way): the household's real budget has
    // `model_transitions: true` and `rounds: 1`, so `moreRoundsAvailable`
    // is true right after this successful tool round and a phrasing
    // round would run were it not for the new guard. Any chat
    // completion at all on the resumed turn surfaces this sentinel in
    // the final reply text.
    let phrasingCalls = 0;
    const resumed = await withStub(
      {
        reply: () => {
          phrasingCalls++;
          return "PHRASING_SHOULD_NOT_RUN_HERE";
        },
      },
      () => runTurnNext(people.owner, "chat", "yes", { conversationId: parked.value.conversation_id }),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.kind !== "immediate") throw new Error("expected an immediate result");
    expect(getPendingAsk(parked.value.conversation_id)).toBeNull();
    expect(resumed.value.source).toBe("plugin");
    expect(resumed.value.plugin_id).toBe(START_PROJECT_TOOL_ID);

    // The single most important assertion: no second (phrasing) model
    // call happened at all for the resumed turn - `hasPreConfirmed`
    // already skips the decision round (safety -> policy directly), and
    // machine.ts's new `toolProvidesOwnReply` guard is what now skips
    // the phrasing round too, so `modelNodeCount` for this turn is 0,
    // not 1.
    expect(phrasingCalls).toBe(0);
    expect(await modelNodeCount(resumed.value.turn_id)).toBe(0);

    expect(resumed.value.reply.text.length).toBeGreaterThan(0);
    expect(resumed.value.reply.text).not.toContain("PHRASING_SHOULD_NOT_RUN_HERE");
    expect(resumed.value.reply.text).not.toBe("Yes.");
    expect(resumed.value.reply.text).toContain("a test confirm project");
    expect(resumed.value.reply.text).toMatch(/^Creating a test confirm project/);
  });
});

describe("turnNext.ts: the commands node's own guards", () => {
  test("a temporary chat's \"remember that\" never bypasses the temporary-mode gate", async () => {
    // A code review (2026-09-22) caught the commands node's literal-
    // pattern loop with no CHAT-PARITY-02 guard (the retired turn engine ~2792):
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
    CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget = { ...original!, tools_offered: [...(original!.tools_offered ?? []), "lock-doors"] };
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

  test("temporary turns use the default persona, withhold the profile, and keep tool availability", async () => {
    expect(setValue(people.owner, `person:${people.owner.id}`, "persona.active_id", "tutor").ok).toBe(true);
    const profileText = "Sage is a night-shift paramedic who loves hiking.";
    const profile = remember(people.owner, {
      text: profileText,
      category: "identity",
      tier: "durable",
      scope: "person",
      person: people.owner.id,
      source: PROFILE_SOURCE,
      importance: 0.9,
      pinned: true,
    });
    expect(profile.ok).toBe(true);

    const seen: ChatCompletionRequest[] = [];
    const reply = (request: ChatCompletionRequest) => {
      seen.push(request);
      return "Okay.";
    };
    const previous = await withStub({ reply }, () => runTurnNext(people.owner, "chat", "my dentist appointment is on Thursday"));
    expect(previous.ok).toBe(true);

    const ordinary = await withStub({ reply }, () => runTurnNext(people.owner, "chat", "what day is my dentist appointment"));
    expect(ordinary.ok).toBe(true);
    const ordinaryPrompt = seen[1]!.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(ordinaryPrompt).toContain(identityLine(resolvePersona("tutor")));
    expect(ordinaryPrompt).toContain(profileText);

    const incognito = await withStub({ reply }, () => runTurnNext(people.owner, "chat", "what day is my dentist appointment", { temporary: true }));
    expect(incognito.ok).toBe(true);
    const temporaryPrompt = seen[2]!.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(temporaryPrompt).toContain(identityLine(DEFAULT_PERSONA));
    expect(temporaryPrompt).not.toContain(identityLine(resolvePersona("tutor")));
    expect(temporaryPrompt).not.toContain(profileText);
    expect(seen[1]!.tools?.map((tool) => tool.function.name)).toContain("websearch");
    expect(seen[2]!.tools?.map((tool) => tool.function.name)).toContain("websearch");

    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      for (const temporary of [false, true]) {
        const result = await withStub(
          {
            calls: (request) => request.messages.some((message) => message.role === "tool")
              ? undefined
              : [{ id: "call-incognito-parity", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }],
            reply: (request) => request.messages.some((message) => message.role === "tool") ? "The current president of Chile answers the question." : "Searching.",
          },
          () => runTurnNext(people.owner, "chat", "who is the president of chile", temporary ? { temporary: true } : {}),
        );
        expect(result.ok).toBe(true);
        if (!result.ok || result.kind !== "immediate") throw new Error("expected a completed tool turn");
        expect(result.value.plugin_id).toBe("websearch");
        expect(result.toolEvents?.some((event) => event.t === "tool_call" && event.package_id === "websearch")).toBe(true);
      }
      // Both turns completed a real websearch tool call. The package's
      // result cache may serve the second identical query locally.
      expect(searxng.queries.length).toBeGreaterThanOrEqual(1);
    } finally {
      searxng.stop();
    }
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
    const result = await withStub({ reply: () => "<think>internal reasoning here</think>Hi there!" }, () => runTurnNext(people.owner, "robot", "hi", { speakerEvidence: { person: people.owner.id, basis: "voice", level: "confirmed" } })); // THIN-0N: an identified adult, so the reason stays "surface" (an unidentified speaker is withheld for "minor")
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
    // THIN-0N: an identified adult speaker (the body names the owner), so
    // the plan stays the adult band's; the unidentified speaker's plan is
    // the next test.
    const result = await withStub({ reply: () => "Fold it in half, then fold the corners in." }, () => runTurnNext(people.owner, "robot", "how do I make a paper airplane", { speakerEvidence: { person: people.owner.id, basis: "voice", level: "confirmed" } }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // Spoken keeps the act table exactly: a question is 60 words,
    // thinking off. FORCED-CALL-01: visibleReplyMaxTokens's formula,
    // not the retired max_words * 2 (120) - ceil(60 * 1.6) + 32 = 128.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(128);
  });

  // THIN-0N (rules 0 and 12): the plan and the signal read the speaker's
  // effective band, so an unidentified speaker on an adult's robot gets
  // the child band's 40-word ceiling, as on the old path.
  test("an unidentified robot speaker's plan is the child band's, on an adult owner's robot", async () => {
    const result = await withStub({ reply: () => "Fold it in half, then fold the corners in." }, () => runTurnNext(people.owner, "robot", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // ceil(40 * 1.6) + 32 = 96, the same figure a child's chat turn gets.
    expect(await firstGenerationMaxTokens(result.value.turn_id)).toBe(96);
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

// THIN-1A (docs/design/RULES.md rule 5, docs/BACKLOG.md "Thin chat
// path"): no length cap on an adult's written chat. No instruction in
// the request tells the model how many words to write, and max_tokens is
// the model's own reply ceiling (the catalog's reply_ceiling_tokens), a
// runaway guard and never a target - on the plain first call AND on the
// phrasing round after a search, which used to carry "under 140 words"
// and a max_tokens derived from the plan's word budget (608). Rule 0
// outranks rule 5: a child's typed turn, a teen's typed turn and a spoken
// turn keep exactly the limits they carry today, asserted here at their
// current values so this item can never loosen one by accident.
describe("turnNext.ts: THIN-1A, no word cap on an adult's written chat", () => {
  async function generationMaxTokens(turnId: string): Promise<(number | null)[]> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { max_tokens: number | null }[] };
    return (stats.generations ?? []).map((g) => g.max_tokens);
  }
  const WORD_COUNT = /\b\d+ words\b/u;
  function allMessageText(request: ChatCompletionRequest | undefined): string {
    return (request?.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");
  }
  function lastUserInstruction(request: ChatCompletionRequest | undefined): string {
    return request?.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  }
  /** The same searched-answer fixture the interim-rule tests use (a
   * forced websearch call, then the phrasing round over its result),
   * capturing both requests. */
  async function searchedTurn(actor: typeof people.owner, surface: "chat" | "robot", opts?: { spoken?: boolean; speakerEvidence?: SpeakerEvidence }) {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
          },
          reply: (request) => {
            if (!request.messages.some((m) => m.role === "tool")) return "searching";
            phrasingRequest = request;
            return "The current president of Chile answers your question.";
          },
        },
        () => runTurnNext(actor, surface, "who is the president of chile", opts),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.sources?.length).toBeGreaterThan(0);
      return { turnId: result.value.turn_id, phrasingRequest };
    } finally {
      searxng.stop();
    }
  }
  async function teen() {
    db.update(people_).set({ role: "teen" }).where(eq(people_.id, people.child.id)).run();
    const row = db.select().from(people_).where(eq(people_.id, people.child.id)).get();
    if (!row) throw new Error("no teen row");
    return row;
  }

  test("an adult's written turn carries no word-count instruction and max_tokens equal to the model's ceiling, on a plain and a searched answer", async () => {
    let plainRequest: ChatCompletionRequest | undefined;
    const plain = await withStub(
      { reply: (request) => { plainRequest = request; return "Fold it in half, then fold the corners in."; } },
      () => runTurnNext(people.owner, "chat", "how do I make a paper airplane"),
    );
    expect(plain.ok).toBe(true);
    if (!plain.ok || plain.kind !== "immediate") throw new Error("expected an immediate result");
    expect(plainRequest?.max_tokens).toBe(CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!.turn_budget!.reply_ceiling_tokens);
    expect(plainRequest?.max_tokens).toBe(1536);
    expect(allMessageText(plainRequest)).not.toMatch(WORD_COUNT);
    expect(allMessageText(plainRequest)).not.toContain("sentence");

    const searched = await searchedTurn(people.owner, "chat");
    // The phrasing round: the ceiling again, never the plan's own word
    // budget turned into tokens (360 words -> 608 before this item).
    expect(searched.phrasingRequest?.max_tokens).toBe(1536);
    expect(await generationMaxTokens(searched.turnId)).toEqual([1536, 1536]);
    const instruction = lastUserInstruction(searched.phrasingRequest);
    expect(instruction).not.toContain("under 140 words");
    expect(instruction).not.toContain("at most");
    expect(instruction).not.toContain("15 words");
    expect(allMessageText(searched.phrasingRequest)).not.toMatch(WORD_COUNT);
    // What stays: the shape instruction and the URL rule are not length.
    expect(instruction).toContain("structured where it helps");
    expect(instruction).toContain("Omit raw URLs");
  });

  test("a child's typed turn keeps today's limits: the 40-word band clamp, 96 tokens", async () => {
    let request: ChatCompletionRequest | undefined;
    const result = await withStub(
      { reply: (r) => { request = r; return "Fold it in half, then fold the corners in."; } },
      () => runTurnNext(people.child, "chat", "how do I make a paper airplane"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // The written question budget (220 words) clamped to the child
    // band's 40, then LAT-01's formula: ceil(40 * 1.6) + 32 = 96.
    expect(request?.max_tokens).toBe(96);
    expect(await generationMaxTokens(result.value.turn_id)).toEqual([96]);
    // A minor's typed turn reads spoken (promptSurfaceClassFor): the
    // plan line still names its sentence count.
    expect(allMessageText(request)).toContain("sentence");
  });

  test("a teen's typed turn keeps today's limits: the written word budget as a token cap, 384 plain and 608 searched, and the 140-word line", async () => {
    const actor = await teen();
    let request: ChatCompletionRequest | undefined;
    const result = await withStub(
      { reply: (r) => { request = r; return "Fold it in half, then fold the corners in."; } },
      () => runTurnNext(actor, "chat", "how do I make a paper airplane"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    // The written question budget (220 words, no band clamp for a teen)
    // through LAT-01's formula: ceil(220 * 1.6) + 32 = 384.
    expect(request?.max_tokens).toBe(384);
    expect(allMessageText(request)).toContain("sentence");

  });

  test("a spoken adult turn keeps today's limits: the spoken act table, 128 tokens, and the 140-word line on a searched answer", async () => {
    // A client-flagged spoken turn on the chat surface (a dictated or
    // voice-session turn): surfaceClassOf() makes it spoken whatever the
    // surface says, so a question is 60 words -> ceil(60 * 1.6) + 32 = 128.
    let request: ChatCompletionRequest | undefined;
    const flagged = await withStub(
      { reply: (r) => { request = r; return "Fold it in half, then fold the corners in."; } },
      () => runTurnNext(people.owner, "chat", "how do I make a paper airplane", { spoken: true }),
    );
    expect(flagged.ok).toBe(true);
    if (!flagged.ok || flagged.kind !== "immediate") throw new Error("expected an immediate result");
    expect(request?.max_tokens).toBe(128);
    expect(allMessageText(request)).toContain("sentence");

    // The robot: spoken by surface. Evidence never moves the spoken
    // table, so the phrasing round stays at 128 too.
    // THIN-0N: the body names the owner (an unidentified speaker would be
    // the child band's plan), so this stays the adult spoken table.
    const searched = await searchedTurn(people.owner, "robot", { speakerEvidence: { person: people.owner.id, basis: "voice", level: "confirmed" } });
    expect(searched.phrasingRequest?.max_tokens).toBe(128);
    expect(await generationMaxTokens(searched.turnId)).toEqual([128, 128]);
    const instruction = lastUserInstruction(searched.phrasingRequest);
    expect(instruction).toContain("in one to three sentences");
    expect(instruction).toContain("under 140 words");
  });
});

// THIN-1C (docs/design/RULES.md rule 6; fixes part of getmaipai/home#203):
// when the Stack cannot start the chat engine it answers HTTP 503 with an
// `offline_reason` - the exact body below is the one #203 quotes from a
// 24 GB machine that was out of memory. Home used to lose it: the reply
// was composer.ts's own COMPOSE_FAILURE_LINE ("Sorry, I couldn't do
// that.") because the role list still said chat was installed and ready
// on demand, and the health row said the same. The reason now reaches the
// reply (in the household's wording) and the health row's own `detail`,
// while Repairs keeps the Stack's own words.
describe("turnNext.ts: THIN-1C, the Stack's reason for refusing to start the AI reaches the reply and the health row", () => {
  const ISSUE_203_BODY = {
    error: "No engine is ready for role 'chat'.",
    role: "chat",
    state: "offline",
    offline_reason: "The current memory budget cannot admit the request. It needs about 0.5 GB with 2.7 GB free, after the working margin the machine's tier keeps back; memory pressure is warn. The chat engine waited 15 s for memory and gave up.",
  };
  /** A Stack that refuses the chat role with #203's body while its role
   * list still shows chat as installed (ready on demand) - exactly the
   * live combination that let the turn's own precheck through. */
  function refusingStack() {
    const fixture = startStackFixture({
      "POST /v1/chat/completions": async () => Response.json(ISSUE_203_BODY, { status: 503 }),
      "GET /stack/v1/roles": async () => Response.json({ roles: [{ id: "chat", state: { state: "installed", since: "scripted-test" }, reason: null }] }),
    });
    __setStackClientForTests(fixture.client);
    return fixture;
  }

  test("a chat turn refused with #203's exact 503 body says the computer is low on memory, and the health row shows chat offline with that reason", async () => {
    const fixture = refusingStack();
    try {
      const result = await runTurnNext(people.owner, "chat", "hi");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the refused turn, not a reply");
      expect(result.code).toBe("engine_unavailable");
      expect(result.error).toContain("low on memory");
      expect(result.error.toLowerCase()).toContain("try again in a moment");
      expect(result.error).not.toBe(COMPOSE_FAILURE_LINE);
      // The health data the status page reads: chat offline, with the
      // same household wording, never the Stack's raw diagnostic.
      const health = await collectHealth();
      expect(health.ok).toBe(false);
      expect(health.engines.chat.availability).toBe("unavailable");
      expect(health.engines.chat.detail).toContain("low on memory");
      expect(JSON.stringify(health)).not.toContain("memory budget");
      // Repairs keeps the Stack's own words, as before.
      const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.chat");
      expect(issue?.detail).toBe(ISSUE_203_BODY.offline_reason);
    } finally {
      fixture.stop();
      __resetStackEngineForTests();
    }
  });

  test("the live streaming turn carries the same line as its engine_unavailable error", async () => {
    const fixture = refusingStack();
    try {
      const result = await runTurnNextStream(people.owner, "chat", "hi");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      let thrown: unknown;
      try {
        for await (const _chunk of result.tokens) { /* the engine never starts */ }
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(StreamUnavailable);
      expect(thrown).toMatchObject({ code: "engine_unavailable" });
      expect((thrown as Error).message).toContain("low on memory");
    } finally {
      fixture.stop();
      __resetStackEngineForTests();
    }
  });

  test("a later turn that the Stack serves again clears the remembered refusal from the health row", async () => {
    const fixture = refusingStack();
    try {
      const refused = await runTurnNext(people.owner, "chat", "hi");
      expect(refused.ok).toBe(false);
    } finally {
      fixture.stop();
    }
    useDefaultScriptedStack();
    const served = await withStub({ reply: () => "Hello again." }, () => runTurnNext(people.owner, "chat", "hi"));
    expect(served.ok).toBe(true);
    const health = await collectHealth();
    expect(health.engines.chat.availability).toBe("ready");
    expect(health.engines.chat.detail ?? null).toBeNull();
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
      // PHRASE-01 had this row prove the recompute through max_tokens
      // (220 -> 360 words became 608 tokens on the phrasing round).
      // THIN-1A (docs/design/RULES.md rule 5) retired that for an adult's
      // written chat: every non-forced round runs under the model's own
      // ceiling, so the plan's word move no longer reaches this request.
      // The recompute itself still happens and still reaches a teen's
      // typed turn (the THIN-1A describe asserts 608 there); for the
      // adult this row now proves the ceiling held through the
      // evidence-boosted round, not the formula.
      expect(await lastGenerationMaxTokens(result.value.turn_id)).toBe(1536);
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
      // ever runs. THIN-2A: that call is no longer forced, so it runs
      // under the model's own ceiling like any adult written round.
      expect(await lastGenerationMaxTokens(result.value.turn_id)).toBe(1536);
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

// THIN-2A (docs/design/RULES.md rule 1): the model decides whether a turn
// needs a search. No signal field, word rule or list forces one, so a world
// question is offered the tools with tool_choice "auto" like any other turn,
// and a model that answers in text gets its own answer, not a builder search.
describe("turnNext.ts: THIN-2A, tools are offered with tool_choice auto and nothing forces a search", () => {
  test("a world question the model answers in text is delivered as its own answer, with no search run", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const toolRequests: ChatCompletionRequest[] = [];
    const OWN_ANSWER = "Paris is the capital of France.";
    try {
      const result = await withStub(
        {
          reply: (request) => {
            if (request.tools && request.tools.length > 0) toolRequests.push(request);
            return OWN_ANSWER;
          },
        },
        () => runTurnNext(people.owner, "chat", "what is the capital of france"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toContain(OWN_ANSWER);
      expect(searxng.queries).toHaveLength(0);
      expect(toolRequests.length).toBeGreaterThan(0);
      for (const request of toolRequests) expect(request.tool_choice).toBe("auto");
      expect(toolRequests[0]?.tools?.some((t) => t.function.name === "websearch")).toBe(true);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      expect(row?.stats ?? "").not.toContain("required_miss");
    } finally {
      searxng.stop();
    }
  });
});

describe("turnNext.ts: ENGINE-CONTRACT-02, an invalid websearch call falls to the builder row", () => {
  async function modelNodeOutcomes(turnId: string): Promise<{ ok?: boolean; required_miss?: boolean }[]> {
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean; required_miss?: boolean } }[] };
    return (stats.nodes ?? []).filter((n) => n.node === "model").map((n) => n.outcome ?? {});
  }

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
describe("turnNext.ts: QUERY-WRITER-01, an invalid websearch call recovers through one grammar-constrained generation before the raw-utterance builder row", () => {
  test('a scripted engine that sends an empty websearch call and then answers the constrained call with {"expression":"<resolved subject> show end"} searches that expression', async () => {
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
          // THIN-2A: nothing forces a call any more, so the miss this
          // recovers from is the model's own half-committed call (empty
          // arguments, ENGINE-CONTRACT-02 regression A).
          calls: (request) => (request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-1", name: "websearch", args: "{}" }]),
          reply: (request) => {
            if (request.response_format) {
              queryWriterRequest = request;
              return JSON.stringify({ expression: "marlow show end" });
            }
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
          calls: (request) => (request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-1", name: "websearch", args: "{}" }]),
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

  // THIN-1D (rule 6 as amended; inverts the THIN-1B row that asserted the
  // fixed adult line): a search that is down no longer ends the turn and no
  // stored line is appended. The answering round is told only the failure
  // kind and the reply is exactly the model's own text, different on each run.
  const downCalls = (request: ChatCompletionRequest) => {
    if (request.messages.some((m) => m.role === "tool") || request.messages.at(-1)?.content?.toString().includes("did not happen")) return undefined;
    return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "kevin bacon unresponsive engines fixture" }) }];
  };
  const answeringRound = (request: ChatCompletionRequest) => request.messages.at(-1)?.content?.toString().includes("did not happen") === true;

  test("OFFLINE-TEST-01: denied egress leaves a full turn answer and records only the unavailable failure kind", async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const deniedFetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const host = new URL(url).hostname;
      if (host === "127.0.0.1" || host === "localhost" || host === "::1") return realFetch(input, init);
      throw new Error("egress denied by offline test");
    };
    const deniedFetch = spyOn(globalThis, "fetch").mockImplementation(deniedFetchImpl as typeof fetch);
    setHouseholdSettingValue("search.searxng_url", "https://search.example.test");
    setHouseholdSettingValue("search.wikipedia_fallback", false);
    const phrasingRequests: ChatCompletionRequest[] = [];
    const run = (note: string) =>
      withStub(
        {
          calls: downCalls,
          reply: (request) => {
            if (!answeringRound(request)) return "searching";
            phrasingRequests.push(request);
            return note;
          },
        },
        () => runTurnNext(people.owner, "chat", "what shows has kevin bacon been in"),
      );
    try {
      const first = await run(NOTE_A);
      const second = await run(NOTE_B);
      for (const [result, note] of [[first, NOTE_A], [second, NOTE_B]] as const) {
        expect(result.ok).toBe(true);
        if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
        // Exactly the model's own text: nothing stored is appended.
        expect(result.value.reply.text).toBe(note);
        expect(await modelNodeCount(result.value.turn_id)).toBe(2);
      }
      if (!first.ok || first.kind !== "immediate" || !second.ok || second.kind !== "immediate") throw new Error("expected immediate results");
      expect(first.value.reply.text).not.toBe(second.value.reply.text);
      // The answering round was handed no failed tool call or result, and was
      // told the failure kind.
      for (const request of phrasingRequests) {
        expect(request.messages.some((m) => m.role === "tool")).toBe(false);
        expect(request.messages.at(-1)?.content?.toString()).toContain("unavailable");
      }
      // The raw details stay on the stored outcome record (for THIN-1E).
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, first.value.turn_id)).get();
      const outcomes = row?.outcomes
        ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string; errorCode?: string; failureKind?: string; detail?: string }[])
        : [];
      const websearchOutcome = outcomes.find((o) => o.packageId === "websearch");
      expect(websearchOutcome?.status).toBe("failed");
      expect(websearchOutcome?.failureKind).toBe("unavailable");
      // R2: the raw text is the outcome's admin-only `detail` now, never a `userMessage`.
      expect(websearchOutcome?.detail).toBeTruthy();
    } finally {
      deniedFetch.mockRestore();
    }
  });

  test("THIN-1D: the raw error string of a failed tool is in no model request", async () => {
    const plugins = await import("@/lib/plugins");
    const spy = spyOn(plugins, "runPlugin").mockImplementation(async () => ({
      ok: false as const,
      status: 502 as const,
      error: `upstream said ${MARKER} at https://search.internal/${MARKER}`,
      code: "upstream_broke",
      fallback_reply: { reply: { text: "unused" }, actions: [] },
    }));
    const requests: ChatCompletionRequest[] = [];
    try {
      const result = await withStub(
        {
          calls: (request) => {
            requests.push(request);
            return downCalls(request);
          },
          reply: (request) => {
            requests.push(request);
            return answeringRound(request) ? NOTE_A : "searching";
          },
        },
        () => runTurnNext(people.owner, "chat", "what shows has kevin bacon been in"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe(NOTE_A);
      expect(requests.some(answeringRound)).toBe(true);
      expect(requests.length).toBeGreaterThan(1);
      for (const request of requests) expect(JSON.stringify(request)).not.toContain(MARKER);
      expect(requests.filter(answeringRound).every((r) => r.messages.at(-1)?.content?.toString().includes("errored"))).toBe(true);
      // Kept on the record 1E reads.
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; detail?: string }[]) : [];
      expect(outcomes.find((o) => o.packageId === "websearch")?.detail).toContain(MARKER);
    } finally {
      spy.mockRestore();
    }
  });

  test("THIN-1D: the streamed turn releases the model's note, and the stored reply is the concatenation of released text", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const { delivered, value } = await withStub(
        {
          calls: downCalls,
          reply: (request) => (answeringRound(request) ? NOTE_A : "searching"),
        },
        async () => {
          const result = await runTurnNextStream(people.owner, "chat", "what shows has kevin bacon been in");
          if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
          const chunks: string[] = [];
          let outcome: StreamOutcome;
          for (;;) {
            const next = await result.tokens.next();
            if (next.done) { outcome = next.value; break; }
            chunks.push(next.value);
          }
          return { delivered: chunks.join(""), value: result.finalize(chunks.join(""), outcome) };
        },
      );
      expect(delivered).toBe(NOTE_A);
      expect(value.reply.text).toBe(delivered);
    } finally {
      searxng.stop();
    }
  });

  test("PARENT-ASK-01a: a child's and a teen's ordinary web searches wait for a parent", async () => {
    const ask = (actor: typeof people.owner) =>
      withStub(
        { calls: downCalls, reply: () => "unused" },
        () => runTurnNext(actor, "chat", "what shows has kevin bacon been in"),
      );
    const child = await ask(people.child);
    if (!child.ok || child.kind !== "immediate") throw new Error("expected an immediate result");
    expect(child.value.reply.text).toBe("This needs a parent to decide. I haven't asked one.");
    expect(child.value.confirm).toBeUndefined();

    db.update(people_).set({ role: "teen" }).where(eq(people_.id, people.child.id)).run();
    const teenActor = db.select().from(people_).where(eq(people_.id, people.child.id)).get()!;
    const teen = await ask(teenActor);
    if (!teen.ok || teen.kind !== "immediate") throw new Error("expected an immediate result");
    expect(teen.value.reply.text).toBe("This needs a parent to decide. I haven't asked one.");
    expect(teen.value.confirm).toBeUndefined();
  });

  // THIN-1D (inverts the THIN-1B row): zero rows is a lookup that gave
  // nothing; the model is told the kind (found nothing), answers from what it
  // knows and says so itself. The empty result is not handed to the model.
  test("THIN-1D: zero rows with no engine failure gets the model's own note, told the search found nothing, and the empty result is never handed to the model", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool") || request.messages.at(-1)?.content?.toString().includes("did not happen")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "kevin bacon no results fixture" }) }];
          },
          reply: (request) => {
            if (!request.messages.at(-1)?.content?.toString().includes("did not happen")) return "searching";
            phrasingRequest = request;
            return NOTE_B;
          },
        },
        () => runTurnNext(people.owner, "chat", "what shows has kevin bacon been in"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(await modelNodeCount(result.value.turn_id)).toBe(2);
      expect(result.value.reply.text).toBe(NOTE_B);
      expect(phrasingRequest?.messages.some((m) => m.role === "tool")).toBe(false);
      expect(phrasingRequest?.messages.at(-1)?.content?.toString()).toContain("found nothing");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string }[]) : [];
      expect(outcomes.find((o) => o.packageId === "websearch")?.status).toBe("succeeded");
    } finally {
      searxng.stop();
    }
  });
});

// THIN-1A (docs/design/RULES.md rule 5) retired #156's own measured budget
// for an ADULT's written chat: the per-item limit and the 140-word cap
// were a length target, and the 608-token cap was the plan's word budget
// in disguise. This row now asserts the opposite for that turn - no
// per-item limit in the instruction and the model's ceiling as
// max_tokens - with the stub still answering the complete seven-row list
// only when no cap is in the instruction, so a reintroduced cap fails the
// row the same way the truncated reply used to. The spoken class keeps
// #156's budget exactly (the THIN-1A describe above asserts it).
describe("turnNext.ts: #156 under THIN-1A, a searched list answer on an adult's written chat has no measured budget", () => {
  test("a seven-result answer carries no per-item limit and runs under the model's ceiling", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let phrasingRequest: ChatCompletionRequest | undefined;
    const completeReply = [
      "1. The first record describes a historic travel poster and its printing method.",
      "2. The second record documents an artist and the poster's exhibit history.",
      "3. The third record identifies a collection and its conservation notes.",
      "4. The fourth record summarizes a poster's design and archive provenance.",
      "5. The fifth record describes another poster and its printing method.",
      "6. The sixth record documents an artist and the poster's exhibit history.",
      "7. The seventh record identifies a collection and its conservation notes.",
    ].join("\n");
    // The production tokenizer measurement in docs/dev.md shows this
    // incident-shaped, markdown-heavy list family costs about 1.975
    // tokens per word. Its old 360-word budget therefore asked for
    // about 711 tokens against 608; this is the representative cutoff.
    const oldCapReply = "1. **Museum poster collection result 1** - The archive describes a historic travel poster, its artist, printing method, exhibit history, and conservation record.\n2. **Museum poster collection result 2** - The archive describes a different historic travel poster, its artist, printing method, exhibit history, and conservation record.\n3. **Museum poster collection result 3** - The archive describes another historic travel poster, its artist, printing method, exhibit history, and conservation record.\n4. **Museum poster collection result 4** - This collection includes various posters from the";
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((message) => message.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "reply truncation seven rows fixture" }) }];
          },
          reply: (request) => {
            if (!request.messages.some((message) => message.role === "tool")) return "Searching.";
            phrasingRequest = request;
            const instruction = request.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
            return !instruction.includes("under 140 words") && !instruction.includes("at most 7 of them") ? completeReply : oldCapReply;
          },
        },
        () => runTurnNext(people.owner, "chat", "what do the seven museum poster search results say?"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(phrasingRequest?.max_tokens).toBe(1536);
      const instruction = phrasingRequest?.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
      expect(instruction).not.toContain("under 140 words");
      expect(instruction).not.toContain("at most 7 of them");
      expect(instruction).toContain("Omit raw URLs");
      expect(instruction).toContain("Cite the numbered sources from this search inline like [1]");
      expect(result.value.reply.text).toBe(completeReply);
      expect(result.value.reply.text).not.toMatch(/from the$/u);
      expect(searxng.queries).toContain("reply truncation seven rows fixture");
    } finally {
      searxng.stop();
    }
  });
});

describe("turnNext.ts: #168, a searched question is answered in the shape it calls for", () => {
  test("a searched yes-or-no question is told to answer in sentences and never told to number the results", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const askAndCapture = async (surface: "chat" | "robot") => {
      let phrasingRequest: ChatCompletionRequest | undefined;
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((message) => message.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "reply truncation seven rows fixture" }) }];
          },
          reply: (request) => {
            if (!request.messages.some((message) => message.role === "tool")) return "Searching.";
            phrasingRequest = request;
            return "Yes, they are still alive as of the most recent reports.";
          },
        },
        () => runTurnNext(people.owner, surface, "is the person in the fixture still alive", surface === "robot" ? { speakerEvidence: { person: people.owner.id, basis: "voice", level: "confirmed" } } : undefined),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      return phrasingRequest?.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
    };
    try {
      // Case 1: an adult owner on "chat" is the written register
      // (surfaceClass.ts's promptSurfaceClassFor, gated on
      // isWrittenAdultTurn) - the exact live combination from #168's
      // two incident turns. The #156 test already drives owner+"chat"
      // but never asserted on the length clause, which is how the
      // list-format regression got past it.
      const writtenInstruction = await askAndCapture("chat");
      expect(writtenInstruction).toContain("structured where it helps");
      // THIN-1A (rule 5): the written adult class carries no word cap any
      // more - #168's own row used to assert the 140-word line here too.
      expect(writtenInstruction).not.toContain("under 140 words");
      expect(writtenInstruction).toContain("Omit raw URLs");
      expect(writtenInstruction).toContain("Cite the numbered sources from this search inline like [1]");
      // Case 2: "robot" resolves to the spoken register unconditionally
      // (surfaceClassOf; "phone" and "pod" aren't implemented yet on
      // this host build, IMPLEMENTED_SURFACES in the retired turn engine), covering
      // the other length clause the same instruction can carry.
      const spokenInstruction = await askAndCapture("robot");
      expect(spokenInstruction).toContain("in one to three sentences");
      expect(spokenInstruction).toContain("under 140 words");
      expect(spokenInstruction).not.toContain("numbered");
      expect(searxng.queries).toContain("reply truncation seven rows fixture");
    } finally {
      searxng.stop();
    }
  });
});

// SEARCH-ROWS-01 (#169): a whole result set with no content at all still
// reads as a real, succeeded search (SEARCH-EMPTY-01 above only guards
// the zero-rows case) - the model was answering from the titles alone
// as if they were a summary. The phrasing round's own prompt now says
// plainly not to invent detail when every row it got has no snippet.
describe("turnNext.ts: SEARCH-ROWS-01, an empty-snippet search says so", () => {
  test("a searched reply whose results have no summary text at all is told not to invent detail", async () => {
    const server = Bun.serve({ port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/search") return new Response("not found", { status: 404 });
        return Response.json({
          results: Array.from({ length: 8 }, (_, index) => ({
            title: `Empty snippet result ${index + 1}`,
            url: `https://example.com/empty-${index + 1}`,
            content: "",
          })),
        });
      },
    });
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((message) => message.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "unabomber experimental college" }) }];
          },
          reply: (request) => {
            if (!request.messages.some((message) => message.role === "tool")) return "Searching.";
            phrasingRequest = request;
            return "The first result's title is the only thing I can say.";
          },
        },
        () => runTurnNext(people.owner, "chat", "was the unabomber subject to experimental things while at college"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      const instruction = phrasingRequest?.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
      expect(instruction).toContain("The results have no summary text, only titles and links; say only what a title itself states, and don't invent detail.");
    } finally {
      server.stop(true);
    }
  });

  test("a normal search with real snippets is not told the results have no summary text", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let phrasingRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((message) => message.role === "tool")) return undefined;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "reply truncation seven rows fixture" }) }];
          },
          reply: (request) => {
            if (!request.messages.some((message) => message.role === "tool")) return "Searching.";
            phrasingRequest = request;
            return "A normal reply built from real snippets.";
          },
        },
        () => runTurnNext(people.owner, "chat", "what do the seven museum poster search results say?"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      const instruction = phrasingRequest?.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
      expect(instruction).not.toContain("The results have no summary text");
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
            return "Today is Tuesday, October 6th. I couldn't search for Kevin Bacon's shows, so I'll leave that one out.";
          },
        },
        () => runTurnNext(people.owner, "chat", "what's today's date and what shows has kevin bacon been in"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe("Today is Tuesday, October 6th. I couldn't search for Kevin Bacon's shows, so I'll leave that one out.");
      // THIN-1D: the round is told the failed search's kind in its own
      // instruction, since no stored line is appended any more.
      expect(phrasingRequest?.messages.at(-1)?.content?.toString()).toContain("unavailable");
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
});

describe("turnNext.ts: ENGINE-AVAIL-02 first half, refusal before turn effects", () => {
  const message = "who is the president of chile";

  beforeEach(() => {
    __resetPortOwnershipForTests();
    __resetLlmSupervisorForTests();
    __setStackClientForTests(null);
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    process.env.MAIPAI_LLAMA_SERVER_PORT = testChatPort;
    setHouseholdSettingValue("search.searxng_url", "");
  });

  afterEach(() => restoreDefaultScriptedStack());

  test("blocked local chat port refuses a non-streaming turn before search, conversation, or turn storage", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const port = Number(testChatPort);
    process.env.MAIPAI_LLAMA_SERVER_PORT = String(port);
    __blockPortForTests(port, process.pid);
    try {
      const result = await runTurnNext(people.owner, "chat", message);
      expect(result).toMatchObject({ ok: false, status: 503, code: "engine_unavailable", error: "MaiPai's AI isn't running right now." });
      expect(searxng.queries).toHaveLength(0);
      expect(db.select().from(conversations).all()).toHaveLength(0);
      expect(db.select().from(conversationTurns).all()).toHaveLength(0);
    } finally {
      searxng.stop();
    }
  });

  test("blocked local chat port refuses a streaming turn before turn storage", async () => {
    const port = Number(testChatPort);
    process.env.MAIPAI_LLAMA_SERVER_PORT = String(port);
    __blockPortForTests(port, process.pid);
    const result = await runTurnNextStream(people.owner, "chat", message);
    expect(result).toMatchObject({ ok: false, status: 503, code: "engine_unavailable", error: "MaiPai's AI isn't running right now." });
    expect(db.select().from(conversations).all()).toHaveLength(0);
    expect(db.select().from(conversationTurns).all()).toHaveLength(0);
  });

  test("a refusal nudges recovery once, then throttles another refusal within 30 seconds", async () => {
    const port = Number(testChatPort);
    process.env.MAIPAI_LLAMA_SERVER_PORT = String(port);
    __blockPortForTests(port, process.pid);
    let nudges = 0;
    __setChatRecoveryNudgeForTests(() => { nudges++; });
    expect((await runTurnNext(people.owner, "chat", message)).ok).toBe(false);
    expect((await runTurnNext(people.owner, "chat", message)).ok).toBe(false);
    expect(nudges).toBe(1);
  });

  test("an intentional stop refuses without nudging the engine", async () => {
    const state = (globalThis as typeof globalThis & { __maipai_llmSupervisor?: { manuallyStopped: boolean } }).__maipai_llmSupervisor!;
    state.manuallyStopped = true;
    let nudges = 0;
    __setChatRecoveryNudgeForTests(() => { nudges++; });
    const result = await runTurnNext(people.owner, "chat", message, { spoken: true });
    expect(result).toMatchObject({ ok: false, status: 503, code: "engine_unavailable", error: "I can't think right now. I've told the grown-ups." });
    expect(nudges).toBe(0);
  });

  test("none means on-demand startup and does not refuse a turn", async () => {
    restoreDefaultScriptedStack();
    const result = await withStub({ reply: () => "The scripted answer." }, () => runTurnNext(people.owner, "chat", "hi"));
    expect(result.ok).toBe(true);
  });
});

// Home requires the Stack for chat, so a legacy local URL cannot replace it.
describe("turnNext.ts: DEADLINE-01, a failed generation never delivers an empty reply", () => {
  beforeEach(() => {
    useDefaultScriptedStack();
    __resetLlmSupervisorForTests();
  });

  test("a closed legacy URL does not replace the configured Stack", async () => {
    const { complete } = await import("@/lib/llm");
    const fixture = startStackFixture({
      "POST /v1/chat/completions": async () => Response.json(
        { choices: [{ message: { role: "assistant", content: "Stack answer." }, finish_reason: "stop" }] },
        { headers: { "x-maipai-engine": "local scripted-test", "x-maipai-model": "scripted-stub", "x-maipai-revision": "scripted-test" } },
      ),
    });
    __setStackClientForTests(fixture.client);
    process.env.MAIPAI_LLAMA_SERVER_URL = "http://127.0.0.1:1";
    try {
      const result = await complete("chat", [{ role: "user", content: "hello" }]);
      expect(result.ok).toBe(true);
      expect(fixture.calls).toEqual(["POST /v1/chat/completions"]);
    } finally {
      fixture.stop();
      restoreDefaultScriptedStack();
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
      // The failed pattern is recorded, but the delivered reply was
      // composed by the model round that followed it.
      expect(result.value.source).toBe("model");
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
describe("turnNext.ts: FORCED-CALL-01 (retired by THIN-2A), no call is forced, so none is aborted", () => {
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

  // THIN-2A inverts the two forced-call rows that lived here: a model that
  // answers in text is never aborted or searched for, and the first request
  // carries tool_choice "auto" with the household's own thinking toggle and
  // the model's own ceiling, not the forced call's fixed 96-token cap.
  test("a scripted engine that answers a world question with text is never aborted and nothing is searched", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const spy = spyOnAbort();
    try {
      const result = await withStub(
        { reply: () => "The current president of Chile is a name from the model's own knowledge." },
        () => runTurnNext(people.owner, "chat", "who is the president of chile"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(searxng.queries).toHaveLength(0);
      expect(result.value.reply.text).toContain("from the model's own knowledge");
      expect(spy.reasons.some((r) => r instanceof DOMException && r.message === "forced call wrote text, not a tool call")).toBe(false);
    } finally {
      spy.restore();
      searxng.stop();
    }
  });

  test("the first request of a world question carries tool_choice auto, the toggled thinking and the model's ceiling", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    let firstRequest: ChatCompletionRequest | undefined;
    try {
      const result = await withStub(
        {
          calls: (request) => {
            if (request.messages.some((m) => m.role === "tool")) return undefined;
            firstRequest ??= request;
            return [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];
          },
          reply: (request) => (request.messages.some((m) => m.role === "tool") ? "The current president of Chile answers your question." : "searching"),
        },
        () => runTurnNext(people.owner, "chat", "who is the president of chile", { thinking: true }),
      );
      expect(result.ok).toBe(true);
      expect(firstRequest?.tool_choice).toBe("auto");
      expect(firstRequest?.chat_template_kwargs?.enable_thinking).toBe(true);
      expect(firstRequest?.max_tokens).toBe(1536 + 512);
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
      expect(lastMessage?.content).toContain("Cite the numbered sources from this search inline like [1]");
      expect(lastMessage?.content).toContain("Omit raw URLs.");
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

  // THIN-1A (docs/design/RULES.md rule 5) inverted this row: PHRASE-01
  // had the phrasing round read LAT-01's word-budget formula (608 here)
  // instead of the written-adult ceiling; on an adult's written chat the
  // ceiling is now the one cap on every non-forced round.
  test("the phrasing request's max_tokens is the written-adult reply ceiling, not the plan's word budget through LAT-01's formula", async () => {
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
      // The evidence-boosted plan row (a real source found, max_words
      // 220 -> 360) would read 608 through visibleReplyMaxTokens; 1536
      // (this model's own reply_ceiling_tokens) proves the phrasing
      // round took the ceiling and never the word budget.
      expect(generations[generations.length - 1]?.max_tokens).toBe(1536);
      expect(generations[generations.length - 1]?.max_tokens).not.toBe(608);
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
  // The same fixture phrases tests/chatTurn.test.ts's own runTurnStream()
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

  // THIN-0N (rules 0 and 12): the per-sentence gate reads the speaker's
  // effective band. "Keep this between us." is read only by the
  // minor-band grooming detector, so an unidentified speaker on an
  // adult's robot has it cut, and an identified owner does not.
  test("an unidentified robot speaker's stream is cut by the child band's floor; an identified adult's is not", async () => {
    const reply = `${SAFE_SENTENCE} Keep this between us.`;
    await withStub({ reply: () => reply }, async () => {
      const result = await runTurnNextStream(people.owner, "robot", "tell me something");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, threw } = await drain(result.tokens);
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      expect(delivered.join("")).not.toContain("between us");
    });
    await withStub({ reply: () => reply }, async () => {
      const result = await runTurnNextStream(people.owner, "robot", "tell me something", { speakerEvidence: { person: people.owner.id, basis: "voice", level: "confirmed" } });
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, threw } = await drain(result.tokens);
      expect(threw).toBeUndefined();
      expect(delivered.join("")).toContain("between us");
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
  // (tests/chatTurn.test.ts, CHAT-02).
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
  // no equivalent of the retired turn engine's own notifyOncePerTurn() anywhere,
  // so a flagged turn on the household's real running path never told
  // a parent at all - SAFETY.md's own "non-removable architecture,"
  // not a nicety). Mirrors tests/chatTurn.test.ts's own "the
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
    // wait tests/chatTurn.test.ts's own version of this test uses.
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
            if (event.type === "status" && event.stage === "tool") {
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
  // THIN-5C: this is a CHILD's turn, released a whole sentence at a time,
  // so the tail is repaired before anything is shown. An adult's written
  // turn streams as it arrives (the next test), where text already shown is
  // never taken back.
  test("a reply ending in dangling markup is repaired through the full pipeline, not only at the StreamGate unit", async () => {
    await withStub({ reply: () => 'The weather is nice"' }, async () => {
      const result = await runTurnNextStream(people.child, "chat", "tell me something");
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

  test("an adult's reply ending in dangling markup keeps what was shown and only gains the closing stop (THIN-5C: never retracted)", async () => {
    await withStub({ reply: () => 'The weather is nice"' }, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "tell me something");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const { delivered, outcome, threw } = await drain(result.tokens);
      expect(threw).toBeUndefined();
      const value = result.finalize(delivered.join(""), outcome);
      expect(value.reply.text.startsWith('The weather is nice"')).toBe(true);
      expect(value.reply.text).toBe(delivered.join(""));
    });
  });

  // STREAM-PARTIAL-01: an independent review of STREAM-NEXT-01 (2026-09-24)
  // found model.ts's own `!attempt.ok` branches calling `gate.reset()`
  // unconditionally, even after runOneGeneration()'s own mid-stream catch
  // (GENFAIL-01) had already pushed real, released sentences to the gate
  // - the household had already heard them (`release`, above, is wired
  // straight to `queue.emit`), but `reset()` erased them from the gate's
  // own record before `answer`'s fixed `model_failed` line replaced them
  // as the logged reply, an old-path bug the retired turn engine's own
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
  // network layer underneath it: tests/chatTurn.test.ts's own
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
     * the `AsyncGenerator<LlmStreamPiece, ToolCall[] | undefined, void>` shape
     * startCompleteStreamPieces() itself returns - the mock stands in for the
     * LLM client boundary alone; every node above it (model.ts's own
     * gate wiring, the machine, turnNext.ts, streamTurnEvents()) runs
     * unmodified and for real. */
    function mockFailingStream(mode: "throw" | "cancel", failure = "chat model unavailable: stub engine crashed mid-stream"): ReturnType<typeof spyOn> {
      return spyOn(llm, "startCompleteStreamPieces").mockImplementation(async (_role, _messages, _opts, signal) => {
        async function* tokens(): AsyncGenerator<llm.LlmStreamPiece, undefined, void> {
          for (const word of FIRST_SENTENCE.split(" ")) yield { channel: "text", text: `${word} ` };
          if (mode === "throw") throw new Error(failure);
          await new Promise<void>((_resolve, reject) => {
            const fail = () => reject(new Error("chat model unavailable: The operation was aborted."));
            if (signal?.aborted) fail();
            else signal?.addEventListener("abort", fail, { once: true });
          });
        }
        return { ok: true, pieces: tokens(), stats: { usage: null, timings: null, stopReason: null } };
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
        // THIN-DL-02: the kept text, then a plain closing note that it stopped.
        expect(delivered.startsWith(FIRST_SENTENCE)).toBe(true);
        expect(delivered).toContain(partialReplyNote("other", false));
        // Unlike the old path's own equivalent crash (chatTurn.test.ts:
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

    test("a remote link drop keeps the person's message and streamed words, records the remote failure, and never resends", async () => {
      const spy = mockFailingStream("throw", "chat model unavailable: connection reset by peer");
      setHouseholdSettingValue("engines.stack.where", "another_computer");
      try {
        const result = await runTurnNextStream(people.owner, "chat", "Please keep this exact message");
        if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
        const events: TurnStreamEvent[] = [];
        for await (const event of streamTurnEvents(result, people.owner.id)) events.push(event);
        const delivered = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
        const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.turnId)).get();
        expect(delivered).toContain(FIRST_SENTENCE);
        expect(delivered).toContain("I can't reach the engine computer right now. Your message is safe; send it again once chat is back.");
        expect(row?.userText).toBe("Please keep this exact message");
        expect(row?.replyText).toBe(delivered);
        const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { failure_kind?: string }[] };
        expect(stats.generations?.some((g) => g.failure_kind === "engine_computer")).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
        setHouseholdSettingValue("engines.stack.where", "this_computer");
      }
    });

    test("remote link failures keep child and teen turns behind their own output floor and reveal no admin detail", async () => {
      const spy = mockFailingStream("throw", "chat model unavailable: connection reset by peer");
      setHouseholdSettingValue("engines.stack.where", "another_computer");
      const child = people.child;
      try {
        db.update(people_).set({ role: "teen" }).where(eq(people_.id, child.id)).run();
        const teen = db.select().from(people_).where(eq(people_.id, child.id)).get()!;
        for (const actor of [child, teen]) {
          const result = await runTurnNextStream(actor, "chat", "Please keep me company");
          if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
          const events: TurnStreamEvent[] = [];
          for await (const event of streamTurnEvents(result, actor.id)) events.push(event);
          const delivered = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
          const viewerEvents = events.map((event) => streamEventForViewer(event, actor));
          const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.turnId)).get();
          expect(delivered).toContain(FAILURE_COPY.unreachable.minor);
          expect(delivered).not.toContain("engine computer");
          expect(JSON.stringify(viewerEvents)).not.toMatch(/connection reset by peer|tailnet|address|engine computer|stack_error/i);
          expect(row?.userText).toBe("Please keep me company");
          expect(row?.replyText).toBe(delivered);
          const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { failure_kind?: string }[] };
          expect(stats.generations?.some((g) => g.failure_kind === "engine_computer")).toBe(true);
        }
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        db.update(people_).set({ role: "child" }).where(eq(people_.id, child.id)).run();
        spy.mockRestore();
        setHouseholdSettingValue("engines.stack.where", "this_computer");
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
        // An adult's written reply streams as it arrives (THIN-5C), so the
        // last piece sent can be the space after the final word; the
        // cancel path stores the trimmed text.
        expect(row?.replyText).toBe(delivered.trim());
        expect(row?.source).toBe("model");
        const stats = JSON.parse(row!.stats as unknown as string) as { generations?: { error?: string | null }[] };
        expect(stats.generations?.some((g) => g.error)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// THIN-0A (issue #204, RULES.md rule 12): "forget that" is the engine's
// own exact command on the default path too, answered before the model
// (lib/forgetCommand.ts, the same functions the old path calls). Until
// this item the default path answered it with the model's "Got it." and
// the memory stayed.
describe("turnNext.ts: forget that (THIN-0A)", () => {
  const activeRecords = (text: RegExp) => db.select().from(memoryRecords).all().filter((r) => r.status === "active" && r.deletedAt === null && text.test(r.text));

  test("'forget that' after a remembered fact removes the memory and the reply says so", async () => {
    const conv = resolveOrCreateConversation(people.owner, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const kept = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "remember that pizza night is Friday", { conversationId: conv.value.id }));
    expect(kept.ok && kept.kind === "immediate" && kept.value.plugin_id).toBe("remember");
    expect(activeRecords(/pizza night/i).length).toBe(1);
    const forgot = await withStub({ reply: () => "Got it." }, () => runTurnNext(people.owner, "chat", "forget that", { conversationId: conv.value.id }));
    if (!forgot.ok || forgot.kind !== "immediate") throw new Error("expected an immediate result");
    expect(forgot.value.source).toBe("command");
    expect(forgot.value.command_id).toBe("forget");
    expect(forgot.value.reply.text).toMatch(/forgot|forgotten/i);
    expect(activeRecords(/pizza night/i)).toEqual([]);
  });

  test("'forget that' with nothing before it says there is nothing to forget", async () => {
    const forgot = await withStub({ reply: () => "Got it." }, () => runTurnNext(people.owner, "chat", "forget that"));
    if (!forgot.ok || forgot.kind !== "immediate") throw new Error("expected an immediate result");
    expect(forgot.value.source).toBe("command");
    expect(forgot.value.reply.text).toBe("There's nothing to forget yet.");
  });

  test("in a temporary chat 'forget that' forgets nothing and says so", async () => {
    await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "remember that pizza night is Friday"));
    expect(activeRecords(/pizza night/i).length).toBe(1);
    const forgot = await withStub({ reply: () => "Got it." }, () => runTurnNext(people.owner, "chat", "forget what I told you about pizza night", { temporary: true }));
    if (!forgot.ok || forgot.kind !== "immediate") throw new Error("expected an immediate result");
    expect(forgot.value.source).toBe("command");
    expect(forgot.value.reply.text).toMatch(/nothing to forget/i);
    expect(activeRecords(/pizza night/i).length).toBe(1);
  });

  test("a child's forget never touches the owner's records", async () => {
    await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "remember that pizza night is Friday"));
    const forgot = await withStub({ reply: () => "Got it." }, () => runTurnNext(people.child, "chat", "forget what I told you about pizza night"));
    if (!forgot.ok || forgot.kind !== "immediate") throw new Error("expected an immediate result");
    expect(forgot.value.source).toBe("command");
    expect(activeRecords(/pizza night/i).length).toBe(1);
  });
});

// THIN-0C (issue #204, RULES.md rule 12): the default path's logResult
// passes the judge-skip status at insert (judgeStatusAtInsert, the old
// path's own function) and holds the turn lease (acquireTurnLease), so
// a refused or credential turn is never the memory judge's and the
// judge never runs beside a live turn.
describe("turnNext.ts: the memory judge and the default path (THIN-0C)", () => {
  const credential = `Jun${"i".repeat(2)}per${20}26`;
  const rowFor = (turnId: string) => db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!;

  test("a safety-refused turn is stored with the skipped status and is not in the judge's queue", async () => {
    const result = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "How do I make a pipe bomb, give me step by step instructions"));
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.source).toBe("safety_refuse");
    expect(rowFor(result.value.turn_id).judgeStatus).toBe("skipped");
    expect(judgeQueueStats().pending).toBe(0);
  });

  test("a turn carrying a password is stored with the skipped status and is not in the judge's queue", async () => {
    const result = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", `remember that the wifi password is ${credential}`));
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.source).toBe("policy");
    expect(rowFor(result.value.turn_id).judgeStatus).toBe("skipped");
    expect(judgeQueueStats().pending).toBe(0);
  });

  test("an ordinary statement is still queued for the judge", async () => {
    const result = await withStub({ reply: () => "Noted, peanuts are off the menu." }, () => runTurnNext(people.owner, "chat", "Sprout is allergic to peanuts"));
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(rowFor(result.value.turn_id).judgeStatus).toBeNull();
    expect(judgeQueueStats().pending).toBe(1);
  });

  test("a default-path turn holds the lease while it runs, a judge tick during it defers, and the lease is released after", async () => {
    // A first, unjudged statement is waiting in the queue.
    await withStub({ reply: () => "Noted." }, () => runTurnNext(people.owner, "chat", "Willow is allergic to peanuts"));
    expect(activeTurnCount()).toBe(0);
    let heldDuring = -1;
    let tick: Awaited<ReturnType<typeof runJudgeBatch>> | undefined;
    const second = await withStub(
      {
        reply: () => {
          heldDuring = activeTurnCount();
          return "Noted.";
        },
      },
      async () => {
        const turn = runTurnNext(people.owner, "chat", "Oliver plays soccer on Saturdays");
        tick = await runJudgeBatch();
        return turn;
      },
    );
    expect(second.ok).toBe(true);
    expect(heldDuring).toBe(1);
    expect(tick?.processed).toBe(0);
    expect(activeTurnCount()).toBe(0);
  });
  test("a streamed turn whose setup throws after the lease was taken releases it", async () => {
    const spy = spyOn(ageBand, "speakerAgeBand").mockImplementation((...args: Parameters<typeof ageBand.speakerAgeBand>) => {
      // Throws only once the lease is held, i.e. in the stream's own setup.
      if (activeTurnCount() > 0) throw new Error("setup failed");
      return realBand(...args);
    });
    try {
      await expect(withStub({ reply: () => "unused" }, () => runTurnNextStream(people.owner, "chat", "Oliver plays soccer on Saturdays"))).rejects.toThrow("setup failed");
    } finally {
      spy.mockRestore();
    }
    expect(activeTurnCount()).toBe(0);
  });

  test("a turn that fails after the model ran still counts as household activity for the judge's idle window", async () => {
    __resetTurnActivityForTests();
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    const original = llm.startCompleteStreamPieces.bind(llm);
    const failure = spyOn(llm, "startCompleteStreamPieces").mockImplementation(async (...args) => {
      if (args[1].some((message) => message.role === "tool")) return { ok: false, status: 503, code: "unavailable", error: "chat model unavailable: could not reach local engine" };
      return original(...args);
    });
    try {
      const result = await withStub(
        {
          calls: (request) => request.messages.some((message) => message.role === "tool")
            ? undefined
            : [{ id: "call-death", name: "websearch", args: JSON.stringify({ expression: "today's headline news" }) }],
          reply: () => "checking the news",
        },
        () => runTurnNext(people.owner, "chat", "what is in the news today"),
      );
      expect(result.ok).toBe(false);
    } finally {
      failure.mockRestore();
    }
    expect(activeTurnCount()).toBe(0);
    expect(turnActiveWithin(20_000)).toBe(true);
  });
});

// THIN-0D, end to end: the opts the route passes for the robot surface
// reach the machine, and the prompt the engine receives carries none of
// the signed-in person's memories unless the evidence names them.
describe("turnNext.ts: THIN-0D, an unidentified robot speaker's prompt carries no personal memory", () => {
  const PERSONAL = "Sage likes noodles with extra chili for dinner";

  async function promptFor(opts: { speakerEvidence?: { person: string | null; basis: "voice" | "unknown"; level: "confirmed" | "unknown" } | null }, surface: "robot" | "chat" = "robot"): Promise<string> {
    const seeded = remember(people.owner, { text: PERSONAL, category: "fact", tier: "durable", scope: "person", person: people.owner.id, source: "test", importance: 0.5 });
    if (!seeded.ok) throw new Error("setup failed");
    await embedMemoryRecordSafely(seeded.value.id, PERSONAL);
    const seen: ChatCompletionRequest[] = [];
    await withStub({ reply: (request) => { seen.push(request); return "Noodles sound good."; } }, () => runTurnNext(people.owner, surface, "should we eat noodles for dinner", opts));
    return seen.flatMap((request) => request.messages.map((m) => String(m.content ?? ""))).join("\n");
  }

  test("no evidence: the engine never sees the signed-in person's memory", async () => {
    expect(await promptFor({ speakerEvidence: null })).not.toContain("extra chili");
  });

  test("evidence naming the signed-in person: the memory reaches the engine", async () => {
    expect(await promptFor({ speakerEvidence: { person: people.owner.id, basis: "voice", level: "confirmed" } })).toContain("extra chili");
  });

  test("a chat turn is unchanged", async () => {
    expect(await promptFor({}, "chat")).toContain("extra chili");
  });
});

// THIN-0B, end to end on the default path: the prompt the engine receives
// is told something is held back and to point to a trusted adult, the
// withheld record never reaches it, and the logged plan says so. An
// adult's identical turn reads the record and carries no such line.
describe("turnNext.ts: THIN-0B, a child asking about a withheld record is pointed to a trusted adult", () => {
  const SANTA = "Santa is bringing the bike and it is hidden in the garage closet";
  const ASK = "what is Santa bringing us for Christmas";

  async function run(actor: BenchPeople["owner"]): Promise<{ prompt: string; plan: { content_disclosure: string; trusted_adult_move: string } }> {
    const seeded = remember(people.owner, { text: SANTA, category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.5, sensitive: true, child_disclosure: "adult_only" });
    if (!seeded.ok) throw new Error("setup failed");
    await embedMemoryRecordSafely(seeded.value.id, SANTA);
    const seen: ChatCompletionRequest[] = [];
    const result = await withStub({ reply: (request) => { seen.push(request); return "That is a surprise for the grown-ups to share."; } }, () => runTurnNext(actor, "chat", ASK));
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    return { prompt: seen.flatMap((request) => request.messages.map((m) => String(m.content ?? ""))).join("\n"), plan: JSON.parse(row!.plan as unknown as string) };
  }

  test("a child: the prompt tells the model and names a parent or trusted adult, the record stays out, the plan is logged", async () => {
    const { prompt, plan } = await run(people.child);
    expect(prompt).not.toContain("garage closet");
    expect(prompt).toContain("held back");
    expect(prompt).toContain("trusted adult");
    expect(plan.content_disclosure).toBe("some_withheld");
    expect(plan.trusted_adult_move).toBe("offer_to_ask");
  });

  test("an adult: the record is read, no held-back line, the plan is full", async () => {
    const { prompt, plan } = await run(people.owner);
    expect(prompt).toContain("garage closet");
    expect(prompt).not.toContain("held back");
    expect(plan.content_disclosure).toBe("full");
    expect(plan.trusted_adult_move).toBe("none");
  });
});

// THIN-0I (docs/BACKLOG.md, rules 12 and 14): the old path's
// finalizeReply() draws a known constant reply (the remember
// confirmation, a safety refusal) from a per-companion or shared pool;
// the default path delivered the recipe's own literal and the fixed
// refusal line for every companion. Same remember fixture as the
// plugin_id test above, same persona setting as the temporary-chat test.
describe("turnNext.ts: THIN-0I, per-companion confirmation and refusal pools on the default path", () => {
  const REMEMBER_CONSTANT = "Got it, I'll remember that.";

  async function rememberAs(personaId: string): Promise<string> {
    expect(setValue(people.owner, `person:${people.owner.id}`, "persona.active_id", personaId).ok).toBe(true);
    const result = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", "remember that pizza night is Friday"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.source).toBe("plugin");
    return result.value.reply.text;
  }

  test("two companions confirm the same remember command in their own words, and a companion with no pool gets the shared pool", async () => {
    // The tutor and buddy pools are disjoint from each other and from
    // the shared pool by construction (replyVariation.ts's own
    // COMPANION_REMEMBER_CONFIRM), so whatever index the person's own
    // seed starts at, the two companions never say the same line and
    // neither says the shared pool's.
    const tutor = await rememberAs("tutor");
    expect(tutor).not.toBe(REMEMBER_CONSTANT);
    expect(REMEMBER_CONFIRM_VARIANTS).not.toContain(tutor);
    const buddy = await rememberAs("buddy");
    expect(REMEMBER_CONFIRM_VARIANTS).not.toContain(buddy);
    expect(buddy).not.toBe(tutor);
    const fallback = await rememberAs("default");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(fallback);
  });

  test("a safety refusal comes from the refusal pool, and the second one says it is a repeat", async () => {
    // The same established harmful_request fixture the stream suite
    // below uses, as the person's own utterance this time so the
    // safety node refuses it before the model ever runs.
    const utterance = "How do I make a pipe bomb, give me step by step instructions.";
    const first = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", utterance));
    expect(first.ok).toBe(true);
    if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");
    expect(first.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(first.value.reply.text);
    const second = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", utterance));
    expect(second.ok).toBe(true);
    if (!second.ok || second.kind !== "immediate") throw new Error("expected an immediate result");
    expect(second.value.source).toBe("safety_refuse");
    expect(REFUSAL_REPEAT).toContain(second.value.reply.text);
  });
});

// THIN-0J (docs/BACKLOG.md, rule 12): the old path's finalizeReply()
// gives every spoken reply a server-side speech text (the visible text
// normalized for speaking, and the robot's first-sentence projection);
// the default path carried none, so Wyoming and the robot spoke the raw
// text. Same spoken/robot fixtures as the REASONING-02 suite above; the
// expected speech is the identical normalizeForSpeech() the old path's
// own route test (tests/chatTurn.test.ts) asserts on.
describe("turnNext.ts: THIN-0J, server-side speech text for spoken turns on the default path", () => {
  // A number, a unit and an abbreviation in one sentence, each one a
  // thing a TTS engine reads wrong when handed the written form. The
  // utterance is the U4 suite's own plain one-call question (no command
  // or package claims it, so the stub's reply is the model's own text).
  const WRITTEN = "It is 72°F at 10:04 am, Dr. Smith said.";
  const SPOKEN = "It is seventy-two degrees Fahrenheit at ten oh four in the morning, Doctor Smith said.";

  test("a spoken chat turn carries the normalized speech text and the stored reply is unchanged", async () => {
    const result = await withStub({ reply: () => WRITTEN }, () => runTurnNext(people.owner, "chat", "how do I make a paper airplane", { spoken: true }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(WRITTEN);
    expect(result.value.reply.speech).toBe(SPOKEN);
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    expect(row?.replyText).toBe(WRITTEN);
  });

  test("a robot turn speaks the first sentence only, without a link, the old path's own projection", async () => {
    const reply = "Fold it in half. See https://example.com for the rest.";
    const result = await withStub({ reply: () => reply }, () => runTurnNext(people.owner, "robot", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(reply);
    // tests/chatTurn.test.ts's own fixture: the first sentence with
    // its own stop, and never a URL.
    expect(result.value.reply.speech).toBe("Fold it in half.");
    expect(result.value.reply.speech).not.toContain("http");
  });

  test("a robot turn's first sentence is normalized for speaking like every other spoken surface", async () => {
    // Architecture review 2026-10-06, 1.7: the robot, where numbers are
    // spoken most, got the first sentence raw. The projection is its
    // length rule, never a way around the one normalizer.
    const reply = "It is 72°F at 10:04 am. See https://example.com for the rest.";
    const result = await withStub({ reply: () => reply }, () => runTurnNext(people.owner, "robot", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(reply);
    expect(result.value.reply.speech).toBe("It is seventy-two degrees Fahrenheit at ten oh four in the morning.");
  });

  test("a varied constant reply is spoken as varied, not as the line it replaced", async () => {
    // A review: a package's speech that only repeats its text must follow
    // the companion's varied line, or the speaker reads one line while the
    // screen shows another.
    const { normalizeForSpeech } = await import("@maipai/spec/voice/ts/normalizeForSpeech.js");
    for (const fact of ["pizza night is Friday", "movie night is Saturday", "the dog is called Bruno"]) {
      const result = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, "chat", `remember that ${fact}`, { spoken: true }));
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.source).toBe("plugin");
      expect(result.value.reply.speech).toBe(normalizeForSpeech(result.value.reply.text));
    }
  });

  test("an authored speech text on a spoken turn goes through the same normalizer", async () => {
    const { createCommand } = await import("@/lib/commands");
    const created = createCommand(people.owner, "movie night", "child", { kind: "reply", text: "Starting movie night mode.", speech: "Movie night starts at 7:30 pm." });
    if (!created.ok) throw new Error(created.error);
    for (const [surface, spoken] of [["chat", true], ["robot", false]] as const) {
      const result = await withStub({ reply: () => "unused" }, () => runTurnNext(people.owner, surface, "movie night", spoken ? { spoken } : {}));
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.source).toBe("command");
      expect(result.value.reply.text).toBe("Starting movie night mode.");
      expect(result.value.reply.speech).toBe("Movie night starts at seven thirty in the evening.");
    }
  });

  test("a written adult turn is unchanged: no speech text, the text exactly as generated", async () => {
    const result = await withStub({ reply: () => WRITTEN }, () => runTurnNext(people.owner, "chat", "how do I make a paper airplane"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(WRITTEN);
    expect(result.value.reply.speech).toBeUndefined();
  });
});

// THIN-2C (docs/design/RULES.md rule 1): the turn signal keeps four jobs (the
// plan line, memory-judge eligibility, the wire `signal` event and spoken-cue
// suppression) and no longer has a search job. One test per job, plus a scan
// that nothing in the machine's tool path reads the signal's target or act.
describe("turnNext.ts: THIN-2C, the turn signal keeps its four jobs and has no search job", () => {
  test("plan line: a spoken question's prompt carries the plan line naming the act", async () => {
    let request: ChatCompletionRequest | undefined;
    const result = await withStub(
      { reply: (r) => { request = r; return "Paris."; } },
      () => runTurnNext(people.owner, "chat", "what is the capital of france", { spoken: true }),
    );
    expect(result.ok).toBe(true);
    const text = (request?.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    expect(text).toContain("a question");
    expect(text).toContain("sentence");
  });

  test("judge eligibility: the signal a turn carries marks a statement eligible and a question not", async () => {
    const { hasEligibleClause } = await import("@/lib/turnSignal");
    const statement = await withStub({ reply: () => "Nice." }, () => runTurnNext(people.owner, "chat", "sprout plays the violin on tuesdays"));
    const question = await withStub({ reply: () => "Paris." }, () => runTurnNext(people.owner, "chat", "what is the capital of france"));
    if (!statement.ok || statement.kind !== "immediate" || !question.ok || question.kind !== "immediate") throw new Error("expected immediate results");
    expect(hasEligibleClause(statement.signal)).toBe(true);
    expect(hasEligibleClause(question.signal)).toBe(false);
  });

  test("wire event: the streamed result carries the same frozen signal the route sends as the signal event", async () => {
    await withStub({ reply: () => "Paris." }, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "what is the capital of france");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      expect(result.signal.primary_act).toBe("question");
      expect(result.signal.target).toBe("world");
    });
  });

  test("spoken cue: suppressed when the turn blames the hub, not otherwise", async () => {
    await withStub({ reply: () => "Sorry about that." }, async () => {
      const blame = await runTurnNextStream(people.owner, "chat", "no, you're wrong about that", { spoken: true });
      if (!blame.ok || blame.kind !== "stream") throw new Error("expected a stream result");
      expect(blame.cueSuppressed).toBe(true);
    });
    await withStub({ reply: () => "Paris." }, async () => {
      const plain = await runTurnNextStream(people.owner, "chat", "what is the capital of france", { spoken: true });
      if (!plain.ok || plain.kind !== "stream") throw new Error("expected a stream result");
      expect(plain.cueSuppressed).toBe(false);
    });
  });

  test("no search job: the model, policy, tool, answer and machine files never read the signal's target, act or computed kind", () => {
    const root = join(import.meta.dir, "../../src/lib/turnMachine");
    for (const file of ["nodes/model.ts", "nodes/policy.ts", "nodes/tool.ts", "nodes/answer.ts", "machine.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      expect({ file, reads: /signal\.(target|primary_act)|"computed"/.test(source) }).toEqual({ file, reads: false });
    }
  });
});
