// A client for llama-server's OpenAI-compatible HTTP surface (4.11),
// against a base URL that may point at a real llama-server process or
// the stub in stubServer.ts: both speak the same subset (health,
// /v1/models, /v1/chat/completions), so the client can't tell them apart
// and doesn't need to.
import type { ChatCompletionRequest, ChatCompletionResponse, ModelInfo } from "./types.js";

export class LlmClientError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmClientError";
  }
}

export class LlamaServerClient {
  constructor(private readonly baseUrl: string) {}

  /** True only on a reachable server reporting ready ("ok"); loading,
   * unreachable, and any non-200 all fold to false, since a caller only
   * ever needs "can I send a completion request right now." */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (!res.ok) return false;
      const body = (await res.json()) as { status?: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`);
    if (!res.ok) {
      throw new LlmClientError(`GET /v1/models returned ${res.status}`);
    }
    const body = (await res.json()) as { data?: ModelInfo[] };
    return body.data ?? [];
  }

  /** Non-streaming only this pass (see spec/llm/README.md): stream:true
   * is never sent, and a response carrying it would need SSE handling
   * this client doesn't have yet. */
  async chatComplete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: false }),
      });
    } catch (err) {
      throw new LlmClientError(`could not reach ${this.baseUrl}`, err);
    }
    if (!res.ok) {
      throw new LlmClientError(`POST /v1/chat/completions returned ${res.status}`);
    }
    return (await res.json()) as ChatCompletionResponse;
  }
}
