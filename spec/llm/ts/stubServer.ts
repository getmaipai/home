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
import type { ChatCompletionRequest, ChatCompletionResponse } from "./types.js";

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
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}
