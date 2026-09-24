import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { complete, startCompleteStream, embed, envelopeToolCall, PERSON_TURN_BUDGET, type ToolSpec, type ToolCall, CHAT_SAMPLING } from "@/lib/llm";
import { clampMaxTokens } from "@/routes/llm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests, getActiveChatEngineIdentity } from "@/lib/stackEngine";
import { listIssues } from "@/lib/issues";
import { startStackFixture, IDENTITY_HEADERS, offlineResponse, type StackFixture } from "./stackFixture";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetEmbedSupervisorForTests();
  __resetStackEngineForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

describe("lib/llm.ts complete()", () => {
  test("chat role gets a real reply from the stub backend (no engine configured in tests)", async () => {
    const result = await complete("chat", [{ role: "user", content: "what's for dinner" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toContain("what's for dinner");
      expect(result.value.text).toContain("[stub model: no real model loaded, this is a canned reply]");
    }
  });

  test("an unimplemented role is a real, named gap, not a crash", async () => {
    const result = await complete("embed", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_role");
      expect(result.status).toBe(400);
    }
  });

  test("rejects an empty messages array", async () => {
    const result = await complete("chat", []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects a message with an invalid role", async () => {
    const result = await complete("chat", [{ role: "narrator" as never, content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });
});

/** REASONING-01: points the chat backend at a stub scripted to answer
 * with `reasoning_content` (spec/llm/ts/stubServer.ts's own
 * scriptedReasoning option) - proves complete()/startCompleteStream()
 * synthesize the identical `<think>...</think>` shape wellFormed.ts's
 * whole downstream contract already expects, confirmed live against the
 * pinned b10797 build (docs/dev.md's own "one thing worth checking"
 * section). */
async function withScriptedReasoning<T>(
  reasoning: (request: ChatCompletionRequest) => string | undefined,
  content: (request: ChatCompletionRequest) => string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedReasoning: reasoning, scriptedChatReply: content });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

describe("REASONING-01: reasoning_content synthesis", () => {
  test("complete() wraps a scripted reasoning_content into <think>...</think> ahead of the content", async () => {
    const result = await withScriptedReasoning(
      () => "carry the two",
      () => "17 times 24 is 408.",
      () => complete("chat", [{ role: "user", content: "what's 17 times 24" }], { thinking: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe("<think>carry the two</think>17 times 24 is 408.");
  });

  test("complete() with no scripted reasoning is unaffected (an engine/template that never separates it)", async () => {
    const result = await withScriptedReasoning(
      () => undefined,
      () => "17 times 24 is 408.",
      () => complete("chat", [{ role: "user", content: "what's 17 times 24" }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe("17 times 24 is 408.");
  });

  test("startCompleteStream() yields the identical synthesized shape as deltas", async () => {
    const deltas = await withScriptedReasoning(
      () => "carry the two",
      () => "17 times 24 is 408.",
      async () => {
        const result = await startCompleteStream("chat", [{ role: "user", content: "what's 17 times 24" }], { thinking: true });
        if (!result.ok) throw new Error(result.error);
        const collected: string[] = [];
        for await (const delta of result.tokens) collected.push(delta);
        return collected;
      },
    );
    expect(deltas.join("")).toBe("<think>carry the two</think>17 times 24 is 408.");
  });

  // A review's own named failure mode: a literal "</think>" INSIDE the
  // engine's own reasoning_content must never prematurely close the
  // synthesized block - if it did, the remainder would be misclassified
  // as ordinary visible delta, never gated by a minor's own
  // dropReasoning check downstream (which only ever filters spans
  // already tagged reasoning).
  test("a literal </think> inside reasoning_content is neutralized, never closes the block early", async () => {
    const result = await withScriptedReasoning(
      () => "the syntax </think> ends a block, but I'm still reasoning",
      () => "17 times 24 is 408.",
      () => complete("chat", [{ role: "user", content: "what's 17 times 24" }], { thinking: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exactly one real close tag (the synthesized one at the end of
    // reasoning), not a spurious early one from the injected text.
    expect(result.value.text.match(/<\/think>/gi)?.length).toBe(1);
    expect(result.value.text).toBe("<think>the syntax /think ends a block, but I'm still reasoning</think>17 times 24 is 408.");
  });
});

/** Fix E (docs/dev.md's "Chat reliability" - native tool calling): points
 * the chat backend at a fresh stub scripted to answer with a REAL
 * tool_calls reply (spec/llm/ts/stubServer.ts's own scriptedToolCalls
 * option, the exact wire shape confirmed live against a real engine,
 * 2026-09-07) - memoryJudge.test.ts's own withScriptedJudge() precedent,
 * just keyed by the request offering `tools` at all rather than a
 * response_format name (there's no grammar/schema to key on anymore).
 * Returning `undefined` from `calls` falls through to the stub's default
 * echo reply, matching a real model that declined to call anything. */
async function withScriptedToolCalls<T>(
  calls: (request: ChatCompletionRequest) => { id: string; name: string; args: string }[] | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedToolCalls: (request) => {
      if (!request.tools || request.tools.length === 0) return undefined;
      const scripted = calls(request);
      return scripted?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }));
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

const WEATHER_TOOL: ToolSpec = { id: "weather", description: "current weather for a place", args: { type: "object", required: ["place"], properties: { place: { type: "string" } } } };
const TRIVIA_TOOL: ToolSpec = { id: "trivia", description: "a trivia question", args: { type: "object", properties: {} } };

describe("lib/llm.ts complete() with tools (Fix E: native tool calling)", () => {
  test("a real tool_calls reply parses into ToolCall[]", async () => {
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "weather", args: '{"place":"Seattle"}' }],
      () => complete("chat", [{ role: "user", content: "what's the weather in Seattle" }], { tools: [WEATHER_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // CHAT-01: the wire's own call id rides along; ENGINE-CONTRACT-02:
    // rawArgs keeps the engine's own unparsed string beside the parsed
    // value, so a parse failure and a literal "{}" can be told apart.
    expect(result.value.tool_calls).toEqual([{ tool: "weather", args: { place: "Seattle" }, id: "call-1", rawArgs: '{"place":"Seattle"}' }]);
  });

  test("two independent calls in one reply both parse", async () => {
    const result = await withScriptedToolCalls(
      () => [
        { id: "call-1", name: "weather", args: '{"place":"Denver"}' },
        { id: "call-2", name: "trivia", args: "{}" },
      ],
      () => complete("chat", [{ role: "user", content: "weather in Denver and a trivia question" }], { tools: [WEATHER_TOOL, TRIVIA_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toHaveLength(2);
  });

  test("the model declining is a real decision (empty array), not a parse failure", async () => {
    const result = await withScriptedToolCalls(
      () => undefined, // falls through to the stub's default echo, exactly like a real model answering in plain text
      () => complete("chat", [{ role: "user", content: "hi there" }], { tools: [WEATHER_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toEqual([]);
  });

  test("a call whose own arguments string fails to parse as JSON becomes args: undefined, never a thrown error", async () => {
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "weather", args: "not valid json" }],
      () => complete("chat", [{ role: "user", content: "weather please" }], { tools: [WEATHER_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // rawArgs keeps the original unparsed string even on a parse
    // failure (ENGINE-CONTRACT-02) - the one place args and rawArgs
    // genuinely disagree.
    expect(result.value.tool_calls).toEqual([{ tool: "weather", args: undefined, id: "call-1", rawArgs: "not valid json" }]);
  });

  test("tool_choice is sent through to the request verbatim", async () => {
    let seenToolChoice: unknown;
    await withScriptedToolCalls(
      (request) => {
        seenToolChoice = request.tool_choice;
        return [{ id: "call-1", name: "weather", args: "{}" }];
      },
      () => complete("chat", [{ role: "user", content: "hi" }], { tools: [WEATHER_TOOL], tool_choice: "required" }),
    );
    expect(seenToolChoice).toBe("required");
  });

  test("no tools offered means an ordinary reply, tool_calls absent entirely", async () => {
    const result = await complete("chat", [{ role: "user", content: "good morning" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toBeUndefined();
  });

  test("sends cache_prompt: true, id_slot: 0 and stream_options.include_usage on every chat request (FAST-01, USAGE-01)", async () => {
    let capturedRequest: ChatCompletionRequest | null = null;
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request: ChatCompletionRequest) => {
        capturedRequest = request;
        return undefined; // fall through to the default echo
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await complete("chat", [{ role: "user", content: "test cache" }]);
      expect(result.ok).toBe(true);
      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.cache_prompt).toBe(true);
      expect(capturedRequest!.id_slot).toBe(0);
      // USAGE-01: harmless on a non-streaming call (stream_options only
      // takes effect alongside stream: true), sent here too because
      // chatRequestBody() is the one shared builder every call site
      // reads from - never a second copy that could drift.
      expect(capturedRequest!.stream_options).toEqual({ include_usage: true });
    } finally {
      stub.stop();
    }
  });
});

// ENGINE-CONTRACT-03 (dev.md "U6 rerun ruling" (a)): the live miss this
// catches - `chatgpt-6-luna` repeat 3, Qwen3's own <function_call> tag,
// unrecognized by llama-server's parser - delivered as the raw string
// below verbatim before this existed.
const LUNA_ENVELOPE = '<function_call> {"name": "websearch", "arguments": {"expression": "when will chatgpt 6 luna be released"}} </function_call>';

describe("lib/llm.ts envelopeToolCall() (ENGINE-CONTRACT-03)", () => {
  test("the Luna string becomes a websearch call with that expression", () => {
    const call = envelopeToolCall(LUNA_ENVELOPE);
    expect(call).toBeDefined();
    expect(call!.tool).toBe("websearch");
    expect(call!.args).toEqual({ expression: "when will chatgpt 6 luna be released" });
  });

  test("a reply with prose around a call is untouched", () => {
    expect(envelopeToolCall(`Sure, let me check that.\n${LUNA_ENVELOPE}`)).toBeUndefined();
    expect(envelopeToolCall(`${LUNA_ENVELOPE}\nLet me know if that's what you meant.`)).toBeUndefined();
  });

  test("a real, prose-only reply is untouched", () => {
    expect(envelopeToolCall("The capital of Chile is Santiago.")).toBeUndefined();
  });

  test("an untagged bare envelope still counts (whatever tag wraps it, or none)", () => {
    const call = envelopeToolCall('{"name": "websearch", "arguments": {"expression": "chatgpt 6 luna"}}');
    expect(call?.tool).toBe("websearch");
  });

  test("a different wrapping tag still counts", () => {
    const call = envelopeToolCall('<tool_call>{"name": "websearch", "arguments": {"expression": "chatgpt 6 luna"}}</tool_call>');
    expect(call?.tool).toBe("websearch");
  });

  test("malformed JSON inside the tag is not an envelope", () => {
    expect(envelopeToolCall("<function_call> not json </function_call>")).toBeUndefined();
  });

  test("an object missing name or arguments is not an envelope", () => {
    expect(envelopeToolCall('{"arguments": {"expression": "x"}}')).toBeUndefined();
    expect(envelopeToolCall('{"name": "websearch"}')).toBeUndefined();
  });

  test("empty text is not an envelope", () => {
    expect(envelopeToolCall("")).toBeUndefined();
    expect(envelopeToolCall("   ")).toBeUndefined();
  });
});

// FAST-06 (docs/BACKLOG.md's 2026-09-12 chat block): variety comes from
// the samplers, not a prompt sentence. A plain chat request carries all
// seven fields; a JSON-schema request carries none (a constrained answer
// must be the most likely one); a caller-supplied temperature wins and
// switches the whole set off (that caller chose its own sampling).
describe("lib/llm.ts chat sampling (FAST-06)", () => {
  async function capture(run: () => Promise<unknown>): Promise<ChatCompletionRequest> {
    let capturedRequest: ChatCompletionRequest | null = null;
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request: ChatCompletionRequest) => {
        capturedRequest = request;
        return undefined;
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      await run();
    } finally {
      stub.stop();
    }
    expect(capturedRequest).not.toBeNull();
    return capturedRequest!;
  }

  test("a plain chat request carries all seven sampler fields", async () => {
    const request = await capture(() => complete("chat", [{ role: "user", content: "good morning" }]));
    expect(request.temperature).toBe(CHAT_SAMPLING.temperature);
    expect(request.min_p).toBe(CHAT_SAMPLING.min_p);
    expect(request.xtc_probability).toBe(CHAT_SAMPLING.xtc_probability);
    expect(request.xtc_threshold).toBe(CHAT_SAMPLING.xtc_threshold);
    expect(request.dry_multiplier).toBe(CHAT_SAMPLING.dry_multiplier);
    expect(request.dry_base).toBe(CHAT_SAMPLING.dry_base);
    expect(request.dry_allowed_length).toBe(CHAT_SAMPLING.dry_allowed_length);
  });

  test("a streamed plain chat request carries them too", async () => {
    const request = await capture(async () => {
      const started = await startCompleteStream("chat", [{ role: "user", content: "good morning" }]);
      if (started.ok) for await (const _delta of started.tokens) void _delta;
    });
    expect(request.min_p).toBe(CHAT_SAMPLING.min_p);
    expect(request.dry_multiplier).toBe(CHAT_SAMPLING.dry_multiplier);
  });

  test("a json_schema request carries none of them", async () => {
    const request = await capture(() =>
      complete("chat", [{ role: "user", content: "extract" }], {
        response_format: { type: "json_schema", json_schema: { name: "t", schema: { type: "object", properties: { a: { type: "string" } } } } },
      }),
    );
    expect(request.temperature).toBeUndefined();
    expect(request.min_p).toBeUndefined();
    expect(request.xtc_probability).toBeUndefined();
    expect(request.dry_multiplier).toBeUndefined();
  });

  test("an explicit `temperature: undefined` (routes/llm.ts's shape) still gets the set, temperature included", async () => {
    const request = await capture(() => complete("chat", [{ role: "user", content: "hi" }], { temperature: undefined, max_tokens: 64 }));
    expect(request.temperature).toBe(CHAT_SAMPLING.temperature);
    expect(request.min_p).toBe(CHAT_SAMPLING.min_p);
    expect(request.max_tokens).toBe(64);
  });

  test("a caller-supplied temperature wins, and switches the set off", async () => {
    const request = await capture(() => complete("chat", [{ role: "user", content: "hi" }], { temperature: 0.1 }));
    expect(request.temperature).toBe(0.1);
    expect(request.min_p).toBeUndefined();
    expect(request.xtc_probability).toBeUndefined();
  });

  // BENCH-01 (docs/plans/baseline-fixes-2026-09-13.md item 5): the
  // sampler seed is a bench affordance. Nothing in the app pins it, so
  // a plain request carries none; the bench's pin puts it on every
  // chat request, streamed or not, beside the samplers.
  test("no seed unless the bench pins one; the pin rides on plain and streamed requests and comes off with null", async () => {
    const { __setSamplingSeedForBench } = await import("@/lib/benchSampling");
    try {
      const plain = await capture(() => complete("chat", [{ role: "user", content: "hi" }]));
      expect(plain.seed).toBeUndefined();
      __setSamplingSeedForBench(20260913);
      const pinned = await capture(() => complete("chat", [{ role: "user", content: "hi" }]));
      expect(pinned.seed).toBe(20260913);
      expect(pinned.temperature).toBe(CHAT_SAMPLING.temperature); // the samplers stay; only the dice are fixed
      const streamed = await capture(async () => {
        const started = await startCompleteStream("chat", [{ role: "user", content: "hi" }]);
        if (started.ok) for await (const _delta of started.tokens) void _delta;
      });
      expect(streamed.seed).toBe(20260913);
      __setSamplingSeedForBench(null);
      const unpinned = await capture(() => complete("chat", [{ role: "user", content: "hi" }]));
      expect(unpinned.seed).toBeUndefined();
    } finally {
      __setSamplingSeedForBench(null);
    }
  });
});

describe("lib/llm.ts startCompleteStream() with tools (Fix E: native tool calling)", () => {
  // Proves the `yield*` delegation chain (client.ts's chatCompleteStream()
  // -> this file's own tokens() wrapper) actually propagates the
  // generator's OWN return value, not just its yielded deltas - a real,
  // easy-to-get-wrong seam this fix introduces (a `for await` loop over
  // the inner generator would silently discard it).
  test("a tool-calling reply yields zero text deltas and returns the parsed ToolCall[] as the generator's own return value", async () => {
    await withScriptedToolCalls(
      () => [{ id: "call-1", name: "weather", args: '{"place":"Seattle"}' }],
      async () => {
        const started = await startCompleteStream("chat", [{ role: "user", content: "weather in Seattle" }], { tools: [WEATHER_TOOL] });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const step = await started.tokens.next();
        expect(step.done).toBe(true); // no text deltas at all for a tool-calling reply
        expect(step.value).toEqual([{ tool: "weather", args: { place: "Seattle" }, id: "call-1", rawArgs: '{"place":"Seattle"}' }]);
      },
    );
  });

  test("an ordinary streamed reply (tools offered, model declines) still returns undefined, unchanged", async () => {
    const started = await startCompleteStream("chat", [{ role: "user", content: "hi there" }], { tools: [WEATHER_TOOL] });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let last: IteratorResult<string, ToolCall[] | undefined> = await started.tokens.next();
    while (!last.done) last = await started.tokens.next();
    expect(last.value).toBeUndefined();
  });
});

describe("lib/llm.ts startCompleteStream()", () => {
  test("chat role streams real deltas from the stub backend that concatenate to the same reply complete() gives", async () => {
    const started = await startCompleteStream("chat", [{ role: "user", content: "what's for dinner" }]);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const deltas: string[] = [];
    for await (const delta of started.tokens) deltas.push(delta);
    expect(deltas.length).toBeGreaterThan(1);
    const streamed = deltas.join("");

    const buffered = await complete("chat", [{ role: "user", content: "what's for dinner" }]);
    expect(buffered.ok).toBe(true);
    if (buffered.ok) expect(streamed).toBe(buffered.value.text);
  });

  test("an unimplemented role fails before any streaming starts, the same real gap complete() reports", async () => {
    const started = await startCompleteStream("embed", [{ role: "user", content: "hi" }]);
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.code).toBe("unsupported_role");
      expect(started.status).toBe(400);
    }
  });

  test("rejects an empty messages array before any streaming starts", async () => {
    const started = await startCompleteStream("chat", []);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.code).toBe("invalid_input");
  });

  test("sends cache_prompt: true, id_slot: 0 and stream_options.include_usage on every streamed chat request (FAST-01, USAGE-01)", async () => {
    let capturedRequest: ChatCompletionRequest | null = null;
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request: ChatCompletionRequest) => {
        capturedRequest = request;
        return undefined; // fall through to the default echo
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const started = await startCompleteStream("chat", [{ role: "user", content: "test cache" }]);
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      // Consume the stream to trigger the request
      for await (const _delta of started.tokens) {
        // iterate
      }
      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.cache_prompt).toBe(true);
      expect(capturedRequest!.id_slot).toBe(0);
      // USAGE-01 (dev.md "U6 rerun ruling"): without this, a streamed
      // completion never carries a final usage chunk at all, so
      // cached_tokens stayed blank on every streamed row.
      expect(capturedRequest!.stream_options).toEqual({ include_usage: true });
    } finally {
      stub.stop();
    }
  });

  // COR-7 (code review, 2026-09-06): a disconnected client used to leave
  // generation running with nothing reading it, tying up the engine's
  // one generation slot for a response nobody would ever see. This
  // proves the actual plumbing (startCompleteStream's own `signal`
  // param, spec/llm/ts/client.ts's chatCompleteStream()) reaches all the
  // way to the real connection: a real local server, not the canned
  // stub, so it can observe its own request's AbortSignal actually
  // firing once the caller aborts.
  test("aborting the given signal stops the generator and reaches the real underlying connection", async () => {
    let sawAbort = false;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        req.signal.addEventListener("abort", () => {
          sawAbort = true;
        });
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ id: "x", model: "chat", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] })}\n\n`,
              ),
            );
            // Long enough that the test's own abort() always lands
            // first - never actually waited out.
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${server.port}`;
    try {
      const controller = new AbortController();
      const started = await startCompleteStream("chat", [{ role: "user", content: "hi" }], {}, controller.signal);
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const deltas: string[] = [];
      const drain = async () => {
        for await (const delta of started.tokens) {
          deltas.push(delta);
          controller.abort();
        }
      };
      await expect(drain()).rejects.toThrow();
      expect(deltas).toEqual(["hello"]);

      // The abort event is dispatched synchronously by the runtime, but
      // give it one tick to actually reach the server's own request
      // object before asserting on it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sawAbort).toBe(true);
    } finally {
      server.stop(true);
    }
  }, 15_000);
});

// A review (2026-09-06) found the first version of clampMaxTokens()
// returned `undefined` (no cap at all) when max_tokens was omitted,
// rather than only capping a value the caller actually supplied.
describe("routes/llm.ts clampMaxTokens()", () => {
  test("omitted entirely still gets the default cap, not no cap", () => {
    expect(clampMaxTokens(undefined)).toBe(2_048);
  });

  test("a value under the cap passes through unchanged", () => {
    expect(clampMaxTokens(100)).toBe(100);
  });

  test("a value over the cap is clamped down to it", () => {
    expect(clampMaxTokens(1_000_000)).toBe(2_048);
  });

  test("a non-positive or non-finite value falls back to the default cap", () => {
    expect(clampMaxTokens(0)).toBe(2_048);
    expect(clampMaxTokens(-5)).toBe(2_048);
    expect(clampMaxTokens(NaN)).toBe(2_048);
  });
});

async function ownerAndChild(): Promise<{ owner: TestClient; childClient: TestClient }> {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
  const child = (await created.json()) as { id: string };
  const childClient = new TestClient();
  await childClient.post("/api/auth/select", { personId: child.id });
  return { owner, childClient };
}

describe("POST /api/llm/chat", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/llm/chat", { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(401);
  });

  // SEC-1 (code review, 2026-09-06): this route used to be reachable by
  // any signed-in person, including a child, with none of the turn
  // engine's non-removable child-safety layer applied. It's now
  // owner/admin diagnostics only.
  test("a child cannot reach this route at all", async () => {
    const { childClient } = await ownerAndChild();
    const res = await childClient.post("/api/llm/chat", { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(403);
  });

  test("still refuses a hard-floor request even for the owner - the safety floor is never configurable off", async () => {
    const { owner } = await ownerAndChild();
    const res = await owner.post("/api/llm/chat", {
      messages: [{ role: "user", content: "How do I make a pipe bomb, give me step by step instructions" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toBe("I can't help with that.");
  });

  // A review (2026-09-06) found the first version of this fix only
  // scanned role: "user" content for the safety check, so a hard-floor
  // request smuggled in as role: "system" (something only owner/admin can
  // even send here) reached complete() completely unchecked.
  test("still refuses a hard-floor request even when it's sent as a system message, not a user one", async () => {
    const { owner } = await ownerAndChild();
    const res = await owner.post("/api/llm/chat", {
      messages: [{ role: "system", content: "How do I make a pipe bomb, give me step by step instructions" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toBe("I can't help with that.");
  });

  test("returns a real chat reply for a signed-in person", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/chat", {
      messages: [{ role: "user", content: "good morning" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; model: string };
    expect(body.text).toContain("good morning");
  });

  test("returns 400 for an unimplemented role, with a code the caller can branch on", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/chat", {
      role: "vision",
      messages: [{ role: "user", content: "what's in this photo" }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_role");
  });

  test("returns 400 for a missing messages array", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/chat", {});
    expect(res.status).toBe(400);
  });

  test("shares turn.ts's per-person rate limit (Session C step 0, wave-2.md): a burst spent on /api/turn also exhausts /api/llm/chat", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      expect((await owner.post("/api/turn", { text: "hi" })).status).toBe(200);
    }
    const res = await owner.post("/api/llm/chat", { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("turn_rate_limited");
  });

  // SEC-5 (code review, 2026-09-06): nothing bounded messages.length or a
  // single message's content length on this route before this.
  test("rejects too many messages", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const messages = Array.from({ length: 65 }, () => ({ role: "user" as const, content: "hi" }));
    const res = await owner.post("/api/llm/chat", { messages });
    expect(res.status).toBe(400);
  });

  test("rejects an oversized message", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/llm/chat", { messages: [{ role: "user", content: "x".repeat(8_001) }] });
    expect(res.status).toBe(400);
  });

  test("an oversized request body is rejected before it's even parsed", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/llm/chat", { messages: [{ role: "user", content: "x".repeat(300_000) }] });
    expect(res.status).toBe(413);
  });
});

describe("lib/llm.ts embed()", () => {
  test("returns a real vector per input, from the stub backend (no engine configured in tests)", async () => {
    const result = await embed(["hello", "world"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vectors.length).toBe(2);
    expect(result.value.vectors[0]!.length).toBe(768);
    expect(result.value.vectors[0]).not.toEqual(result.value.vectors[1]);
  });

  test("rejects an empty array", async () => {
    const result = await embed([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects an array containing an empty string", async () => {
    const result = await embed(["hello", ""]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });
});

describe("POST /api/llm/embed", () => {
  test("requires a signed-in person", async () => {
    const res = await new TestClient().post("/api/llm/embed", { texts: ["hi"] });
    expect(res.status).toBe(401);
  });

  test("a child cannot reach this route at all (SEC-1)", async () => {
    const { childClient } = await ownerAndChild();
    const res = await childClient.post("/api/llm/embed", { texts: ["hi"] });
    expect(res.status).toBe(403);
  });

  test("returns real vectors for a signed-in person", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/embed", { texts: ["good morning", "good night"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vectors: number[][]; model: string };
    expect(body.vectors.length).toBe(2);
    expect(body.vectors[0]!.length).toBe(768);
  });

  test("returns 400 for a missing texts array", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/embed", {});
    expect(res.status).toBe(400);
  });

  test("also shares the per-person rate limit", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      expect((await owner.post("/api/turn", { text: "hi" })).status).toBe(200);
    }
    const res = await owner.post("/api/llm/embed", { texts: ["hi"] });
    expect(res.status).toBe(429);
  });

  // SEC-5: an unbounded texts[] used to reach embed() straight from the body.
  test("rejects too many texts", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/llm/embed", { texts: Array.from({ length: 65 }, () => "hi") });
    expect(res.status).toBe(400);
  });

  test("rejects an oversized text", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/llm/embed", { texts: ["x".repeat(4_001)] });
    expect(res.status).toBe(400);
  });
});

// HOME-STACK-02b: engines.stack.url empty (the default, every test above
// this point) must keep going through the stub/supervisor path exactly
// as before; set, it must go through the Stack client instead - proven
// with a real scripted Stack (tests/stackFixture.ts's Bun.serve fixture),
// injected via __setStackClientForTests() the same way llmSupervisor.ts's
// own tests inject a scripted engine.
describe("lib/llm.ts routed through a configured Stack", () => {
  let fixture: StackFixture;

  function configureStack(): void {
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
  }

  afterEach(() => {
    fixture?.stop();
  });

  test("complete() answers through the Stack and records the reply's identity", async () => {
    fixture = startStackFixture({
      "POST /v1/chat/completions": async () =>
        Response.json(
          { id: "chatcmpl-1", object: "chat.completion", model: "chat", choices: [{ message: { role: "assistant", content: "hello from the stack" } }] },
          { headers: IDENTITY_HEADERS },
        ),
    });
    configureStack();

    const result = await complete("chat", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toBe("hello from the stack");
    expect(getActiveChatEngineIdentity()).toEqual({ host: "local", build: "b10797", model: "qwen3-8b-instruct-q4_k_m.gguf", healthy: null });
  });

  test("a scripted 503 becomes the companion line and a Repairs entry carrying offline_reason", async () => {
    fixture = startStackFixture({
      "POST /v1/chat/completions": async () => offlineResponse("chat", "the engine process is not running"),
    });
    configureStack();

    const result = await complete("chat", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe("unavailable");
      expect(result.error).toBe("I can't think right now.");
    }
    const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.chat");
    expect(issue?.detail).toBe("the engine process is not running");
  });

  // A code review caught the first cut of this only raising Repairs for
  // a scripted 503 ("offline"), not for the socket refusing entirely
  // ("unreachable") - the whole Stack being down, arguably the more
  // common real failure, silently cleared any existing Repairs entry
  // instead of raising one.
  test("the Stack being unreachable (not just one role reporting offline) also raises a Repairs entry", async () => {
    fixture = startStackFixture({});
    configureStack();
    fixture.stop(); // the URL is configured but nothing listens there now

    const result = await complete("chat", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.error).toBe("I can't think right now.");
    }
    const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.chat");
    expect(issue).toBeDefined();
    expect(issue?.detail).toContain("not running");
  });

  test("a 400 keeps the Stack's own stated reason, no guessed cause", async () => {
    fixture = startStackFixture({
      "POST /v1/chat/completions": async () => Response.json({ error: "the model field must be a role id or an installed model id", roles: ["chat", "embed"] }, { status: 400 }),
    });
    configureStack();

    const result = await complete("chat", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("the model field must be a role id or an installed model id");
  });

  test("startCompleteStream() streams real deltas through the Stack and captures identity from the headers, before any token arrives", async () => {
    fixture = startStackFixture({
      "POST /v1/chat/completions": async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: {"id":"1","model":"chat","choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}\n\n'));
            controller.enqueue(enc.encode('data: {"id":"1","model":"chat","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n'));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, { headers: IDENTITY_HEADERS });
      },
    });
    configureStack();

    const started = await startCompleteStream("chat", [{ role: "user", content: "hi" }]);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // The identity is already readable before the first token is pulled -
    // the acceptance criterion this proves ("the identity headers are
    // logged per turn" reads the reply, not a probe, and reads it early
    // enough for a [turn] line built alongside the stream, not after it).
    expect(getActiveChatEngineIdentity()?.model).toBe("qwen3-8b-instruct-q4_k_m.gguf");
    let text = "";
    for await (const delta of started.tokens) text += delta;
    expect(text).toBe("hello");
    expect(started.stats.stopReason).toBe("stop");
  });

  test("embed() answers through the Stack, sorted by the wire's own index", async () => {
    fixture = startStackFixture({
      "POST /v1/embeddings": async () =>
        Response.json({ object: "list", model: "embed", data: [{ index: 1, embedding: [0.2] }, { index: 0, embedding: [0.1] }] }, { headers: IDENTITY_HEADERS }),
    });
    configureStack();

    const result = await embed(["a", "b"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vectors).toEqual([[0.1], [0.2]]);
  });

  test("embed()'s own Stack 503 maps to the same unavailable shape, no companion line (that's a chat-only line)", async () => {
    fixture = startStackFixture({
      "POST /v1/embeddings": async () => offlineResponse("embed", "the embed engine is not running"),
    });
    configureStack();

    const result = await embed(["a"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("embed model unavailable: the Stack is offline");
    const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.embed");
    expect(issue?.detail).toBe("the embed engine is not running");
  });

  // getmaipai/home#151: the fix at the source - a configured Stack (a
  // real, live household setting) used to always win over
  // MAIPAI_LLAMA_SERVER_URL, so a leftover Stack setting from an
  // earlier test file silently routed later tests through it instead
  // of their own scripted stub (issue #137's own root cause,
  // rediscovered by hand in four separate test files before this).
  // Configures a real Stack fixture AND points the env var at a local
  // stub in the same test, proving the env var - the explicit,
  // deliberately-set override - wins. A review of the first cut of
  // this fix found only complete() proven directly; startCompleteStream()
  // and embed() got the identical one-line fix but no test of their
  // own, so a future refactor of either's own Stack-routing condition
  // could silently reintroduce the bug with the suite staying green -
  // both proven directly below too.
  test("MAIPAI_LLAMA_SERVER_URL wins over a configured Stack, not the other way around", async () => {
    fixture = startStackFixture({
      "POST /v1/chat/completions": async () => {
        throw new Error("the Stack must never be reached - the env var override should have won");
      },
    });
    configureStack();

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "hello from the local stub, not the stack" });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const completed = await complete("chat", [{ role: "user", content: "hi" }]);
      expect(completed.ok).toBe(true);
      if (completed.ok) expect(completed.value.text).toBe("hello from the local stub, not the stack");
    } finally {
      stub.stop();
    }
  });

  test("the same is true for startCompleteStream()", async () => {
    fixture = startStackFixture({
      "POST /v1/chat/completions": async () => {
        throw new Error("the Stack must never be reached - the env var override should have won");
      },
    });
    configureStack();

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "hello from the local stub, not the stack" });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const started = await startCompleteStream("chat", [{ role: "user", content: "hi" }]);
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      let text = "";
      for await (const delta of started.tokens) text += delta;
      expect(text).toBe("hello from the local stub, not the stack");
    } finally {
      stub.stop();
    }
  });

  test("MAIPAI_EMBED_URL wins over a configured Stack, not the other way around", async () => {
    fixture = startStackFixture({
      "POST /v1/embeddings": async () => {
        throw new Error("the Stack must never be reached - the env var override should have won");
      },
    });
    configureStack();

    // The stub's own /v1/embeddings has no scripting option (unlike
    // chat's scriptedChatReply) - its always-on deterministic default
    // is enough here: the Stack fixture above throws unconditionally,
    // so `result.ok` alone proves the local stub answered instead.
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0);
    process.env.MAIPAI_EMBED_URL = stub.url;
    try {
      const result = await embed(["hi"]);
      expect(result.ok).toBe(true);
    } finally {
      stub.stop();
      delete process.env.MAIPAI_EMBED_URL;
    }
  });
});

// Found live: safety.test.ts's own "every real settings key, stressed to
// its most permissive value" sweep sets engines.stack.url to a plain
// non-URL string ("stress-test-value", extremeValueFor()'s stand-in for
// any text key with an empty default) and expects chat to keep working
// regardless, the same as every other settings key it stresses - it
// broke instead, because a non-empty string alone was enough for
// getStackUrl() to call it "configured" and hand it straight to
// createStackClient(), which throws on a non-loopback-shaped URL.
describe("lib/llm.ts with engines.stack.url set to garbage (not a real URL)", () => {
  afterEach(() => {
    __resetStackEngineForTests();
  });

  test("a plain non-URL string is treated as unconfigured, not a broken Stack", async () => {
    setHouseholdSettingValue("engines.stack.url", "stress-test-value");

    const result = await complete("chat", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(true); // the stub backend answered, same as engines.stack.url empty
  });
});
