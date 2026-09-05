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
import type { ChatCompletionRequest, ChatCompletionResponse, EmbeddingRequest, EmbeddingResponse } from "./types.js";

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
 * own chunk. */
function streamChatCompletion(request: ChatCompletionRequest): ReadableStream<Uint8Array> {
  const text = stubReplyText(request);
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

function stubEmbedding(text: string): number[] {
  let seed = hashString(text) || 1;
  const vector: number[] = [];
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    // mulberry32, a small deterministic PRNG - good enough for "stable,
    // distinct-per-input" without pulling in a real hashing/RNG library
    // for a canned test double.
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    vector.push((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
  }
  return vector;
}

function handleEmbeddings(request: EmbeddingRequest): EmbeddingResponse {
  const inputs = Array.isArray(request.input) ? request.input : [request.input];
  return {
    model: request.model || "stub-embed",
    data: inputs.map((text, index) => ({ index, embedding: stubEmbedding(text) })),
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/** port 0 lets the OS assign a free port, avoiding a fixed-port clash
 * when tests and a dev server both start a stub. */
export function startStubLlmServer(port = 0): StubLlmServerHandle {
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
        if (body.stream) {
          return new Response(streamChatCompletion(body), {
            headers: { "content-type": "text/event-stream" },
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
