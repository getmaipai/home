// A deterministic, offline stand-in for llama-server's OpenAI-compatible
// HTTP surface (4.11), for testing the client and the hub's router
// skeleton without a real GGUF or engine binary. Never used against a
// real household: the router (backend/src/lib/llmSupervisor.ts) only
// starts this when neither MAIPAI_LLAMA_SERVER_URL nor
// MAIPAI_LLAMA_SERVER_BIN/MAIPAI_CHAT_MODEL_PATH is configured, i.e. dev
// and test by default, same spirit as spec/emulators/ts/host-emulator.ts
// for the package host. Every reply is prefixed "[stub model: no real
// model loaded, this is a canned reply]", mirroring the emulator's own
// llm.complete wording, so a canned answer can never be mistaken for a
// real one downstream.
import type { ChatCompletionRequest, ChatCompletionResponse, EmbeddingRequest, EmbeddingResponse, ToolCallWire } from "./types.js";

export interface StubLlmServerHandle {
  url: string;
  stop: () => void;
}

const STUB_PREFIX = "[stub model: no real model loaded, this is a canned reply]";

function stubReplyText(request: ChatCompletionRequest): string {
  const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
  const echoed = lastUser?.content ?? "(no user message)";
  return `${STUB_PREFIX} ${echoed}`;
}

function handleChatCompletion(request: ChatCompletionRequest): ChatCompletionResponse {
  return {
    id: `stub-${Date.now()}`,
    model: request.model || "stub-chat",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: stubReplyText(request) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/** Real word-by-word SSE, the same line shape a real llama-server sends
 * (spec/llm/README.md), so the streaming client/turn-engine path is
 * exercised for real in tests rather than degenerating into one big
 * chunk. Split on spaces, each word (plus its trailing space, so
 * concatenating every delta reproduces the original text exactly) is its
 * own chunk. `text` defaults to the usual echo reply; a caller (the
 * scripted-reply path below, added for session-a-intelligence.md step 9's
 * own output-safety-gate tests, which need a MODEL reply that differs
 * from the input - the default echo can't ever produce that by
 * construction) can override it with any string. */
function streamChatCompletion(request: ChatCompletionRequest, text: string = stubReplyText(request)): ReadableStream<Uint8Array> {
  const words = text.split(" ");
  const id = `stub-${Date.now()}`;
  const model = request.model || "stub-chat";
  const encoder = new TextEncoder();
  const sseLine = (choice: unknown) =>
    encoder.encode(`data: ${JSON.stringify({ id, model, choices: [choice] })}\n\n`);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseLine({ index: 0, delta: { role: "assistant" }, finish_reason: null }));
      words.forEach((word, i) => {
        const content = i === 0 ? word : ` ${word}`;
        controller.enqueue(sseLine({ index: 0, delta: { content }, finish_reason: null }));
      });
      controller.enqueue(sseLine({ index: 0, delta: {}, finish_reason: "stop" }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

/** Fix E: the streaming shape of a scripted tool_calls reply, fragmented
 * across at least two chunks per call (an id+name-only fragment, then
 * the whole arguments string) so a test genuinely exercises
 * client.ts's own per-index concatenation rather than handing it one
 * already-complete call - matches what a real engine actually does
 * (confirmed live, 2026-09-07: id/name arrive once, arguments streams in
 * pieces), just coarser-grained than character-by-character since the
 * accumulation logic under test doesn't care how many pieces arrived,
 * only that they're in order per index. `content` stays empty
 * throughout, the same as a real tool-calling reply. */
function streamToolCallsCompletion(request: ChatCompletionRequest, toolCalls: ToolCallWire[]): ReadableStream<Uint8Array> {
  const id = `stub-${Date.now()}`;
  const model = request.model || "stub-chat";
  const encoder = new TextEncoder();
  const sseLine = (choice: unknown) =>
    encoder.encode(`data: ${JSON.stringify({ id, model, choices: [choice] })}\n\n`);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseLine({ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }));
      toolCalls.forEach((call, index) => {
        controller.enqueue(
          sseLine({
            index: 0,
            delta: { tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name } }] },
            finish_reason: null,
          }),
        );
        controller.enqueue(
          sseLine({ index: 0, delta: { tool_calls: [{ index, function: { arguments: call.function.arguments } }] }, finish_reason: null }),
        );
      });
      controller.enqueue(sseLine({ index: 0, delta: {}, finish_reason: "tool_calls" }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// 768: nomic-embed-text-v1.5's real output dimension (backend/src/lib/
// embedAssets.ts), so a test asserting on vector shape exercises the
// real number, not an arbitrary stub-only one. Deterministic (same text
// always yields the same vector, different text a different one) via a
// plain string hash seeding a simple PRNG - no real semantic meaning,
// same "canned but real code path" posture the chat stub's
// STUB_PREFIX-echo already has.
const EMBEDDING_DIMENSIONS = 768;

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function vectorFromSeed(seed: number, dims: number): number[] {
  let s = seed || 1;
  const vector: number[] = [];
  for (let i = 0; i < dims; i++) {
    // mulberry32, a small deterministic PRNG - good enough for "stable,
    // distinct-per-input" without pulling in a real hashing/RNG library
    // for a canned test double.
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    vector.push((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
  }
  return vector;
}

// Bag-of-words, not a single whole-string hash (session-a-intelligence.md
// step 5, found live: the original whole-string version made every two
// DIFFERENT texts land near-orthogonal regardless of shared vocabulary -
// real for genuinely unrelated text, but it also meant an embedding
// backend now genuinely wired into recall()'s cosine floor (step 5)
// would wrongly floor out a memory whose text keyword-overlaps a query
// perfectly, just because the stub's noise happened to land below the
// floor for that pair. Summing each shared word's own deterministic
// vector means two texts that share vocabulary land closer together in
// cosine terms and two that share none stay near-orthogonal - a real,
// if crude, lexical-similarity signal (classic bag-of-words averaging,
// not a shortcut invented for this test double), enough to let a stub-
// backed test meaningfully exercise "shares words -> higher cosine"
// without needing a real model.
function stubEmbedding(text: string): number[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [text];
  const sum = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of words) {
    const wordVector = vectorFromSeed(hashString(word), EMBEDDING_DIMENSIONS);
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) sum[i]! += wordVector[i]!;
  }
  return sum;
}

function handleEmbeddings(request: EmbeddingRequest): EmbeddingResponse {
  const inputs = Array.isArray(request.input) ? request.input : [request.input];
  return {
    model: request.model || "stub-embed",
    data: inputs.map((text, index) => ({ index, embedding: stubEmbedding(text) })),
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export interface StubLlmServerOptions {
  /** Session-a-intelligence.md step 6: the memory judge's tests need a
   * SPECIFIC canned JSON reply per test case (a possessive resolved a
   * certain way, a particular dedupe decision), not the generic
   * echo-the-user's-message reply every other test relies on. Returning
   * a value here overrides the default reply for exactly that request
   * (a string is sent verbatim as the message content, anything else is
   * JSON.stringify'd first, matching what a real json_schema-constrained
   * llama-server reply looks like on the wire); returning `undefined`
   * (or omitting this option) falls through to the existing default -
   * every current call site is unaffected. Applies to a streaming
   * request too (step 9): the scripted text is streamed word-by-word the
   * same way the default echo reply always was, needed for testing
   * turnEngine.ts's output-safety gate, which requires a MODEL reply
   * that genuinely differs from the input - the default echo can never
   * produce that by construction. */
  scriptedChatReply?: (request: ChatCompletionRequest) => unknown;
  /** Fix E: a scripted tool_calls reply, checked BEFORE scriptedChatReply
   * on any request - returning a non-empty array makes this request
   * answer as a real tool-calling reply (empty content, `finish_reason:
   * "tool_calls"`, both non-streaming and streaming - the exact shape
   * confirmed live against a real engine, 2026-09-07), the only way a
   * test can exercise turnEngine.ts's own tool-calling path without a
   * real model. Returning `undefined` (or omitting this option) falls
   * through to scriptedChatReply/the default echo, unaffected - a test
   * that only cares about ordinary replies never has to know this
   * option exists. */
  scriptedToolCalls?: (request: ChatCompletionRequest) => ToolCallWire[] | undefined;
}

/** port 0 lets the OS assign a free port, avoiding a fixed-port clash
 * when tests and a dev server both start a stub. */
export function startStubLlmServer(port = 0, opts: StubLlmServerOptions = {}): StubLlmServerHandle {
  const server = Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }
      if (url.pathname === "/v1/models") {
        return Response.json({ data: [{ id: "stub-chat", object: "model" }] });
      }
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as ChatCompletionRequest | null;
        if (!body || !Array.isArray(body.messages)) {
          return Response.json({ error: "messages is required" }, { status: 400 });
        }
        const toolCalls = opts.scriptedToolCalls?.(body);
        if (toolCalls && toolCalls.length > 0) {
          if (body.stream) {
            return new Response(streamToolCallsCompletion(body, toolCalls), {
              headers: { "content-type": "text/event-stream" },
            });
          }
          return Response.json({
            id: `stub-${Date.now()}`,
            model: body.model || "stub-chat",
            choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: toolCalls }, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        }
        const scripted = opts.scriptedChatReply?.(body);
        const scriptedContent = scripted !== undefined ? (typeof scripted === "string" ? scripted : JSON.stringify(scripted)) : undefined;
        if (body.stream) {
          return new Response(streamChatCompletion(body, scriptedContent), {
            headers: { "content-type": "text/event-stream" },
          });
        }
        if (scriptedContent !== undefined) {
          return Response.json({
            id: `stub-${Date.now()}`,
            model: body.model || "stub-chat",
            choices: [{ index: 0, message: { role: "assistant", content: scriptedContent }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        }
        return Response.json(handleChatCompletion(body));
      }
      if (url.pathname === "/v1/embeddings" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as EmbeddingRequest | null;
        if (!body || (typeof body.input !== "string" && !Array.isArray(body.input))) {
          return Response.json({ error: "input is required" }, { status: 400 });
        }
        return Response.json(handleEmbeddings(body));
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}
