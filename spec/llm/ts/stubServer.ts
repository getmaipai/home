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

function handleChatCompletion(request: ChatCompletionRequest): ChatCompletionResponse {
  const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
  const echoed = lastUser?.content ?? "(no user message)";
  return {
    id: `stub-${Date.now()}`,
    model: request.model || "stub-chat",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: `${STUB_PREFIX} ${echoed}` },
        finish_reason: "stop",
      },
    ],
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
