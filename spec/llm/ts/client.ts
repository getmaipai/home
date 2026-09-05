// A client for llama-server's OpenAI-compatible HTTP surface (4.11),
// against a base URL that may point at a real llama-server process or
// the stub in stubServer.ts: both speak the same subset (health,
// /v1/models, /v1/chat/completions), so the client can't tell them apart
// and doesn't need to.
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  EmbeddingRequest,
  EmbeddingResponse,
} from "./types.js";
import { readTextLines } from "../../streaming/ts/lineReader.js";

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

  /** 4.11's `embed` role (2026-09-04): a real llama-server started with
   * `--embedding` answers this same OpenAI-compatible path. Works
   * unmodified against stubServer.ts's canned embeddings too. */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch (err) {
      throw new LlmClientError(`could not reach ${this.baseUrl}`, err);
    }
    if (!res.ok) {
      throw new LlmClientError(`POST /v1/embeddings returned ${res.status}`);
    }
    return (await res.json()) as EmbeddingResponse;
  }

  /** Real token-by-token streaming (2026-09-04): yields each chunk's text
   * delta as it arrives over the connection, `stream: true` always sent
   * regardless of what the request asked for. Confirmed live against a
   * real llama-server: SSE `data: {...}` lines, a final `data: [DONE]`
   * with no JSON to parse. Works unmodified against stubServer.ts's
   * canned streaming reply too - both speak the identical line shape. */
  async *chatCompleteStream(request: ChatCompletionRequest): AsyncGenerator<string, void, void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: true }),
      });
    } catch (err) {
      throw new LlmClientError(`could not reach ${this.baseUrl}`, err);
    }
    if (!res.ok) {
      throw new LlmClientError(`POST /v1/chat/completions returned ${res.status}`);
    }
    if (!res.body) {
      throw new LlmClientError(`POST /v1/chat/completions returned no response body`);
    }

    // readTextLines (spec/streaming/ts/lineReader.ts) owns the
    // buffer/decode/final-flush mechanics shared with the hub frontend's
    // own ndjson reader (api.ts) - a real bug (a missing TextDecoder
    // final flush) had to be fixed once per copy before this was
    // centralized, a code review (2026-09-04) flagged as the direct
    // cause. This method only owns what's specific to SSE: the `data:`
    // framing and the `[DONE]` sentinel.
    const reader = res.body.getReader();
    try {
      for await (const line of readTextLines(reader)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice("data:".length).trim();
        if (data === "[DONE]") {
          // A code review (2026-09-04) found this early-exit path never
          // released the reader lock: if llama-server keeps the TCP
          // connection open briefly after emitting [DONE] instead of
          // closing it immediately, the lock would only be freed by GC
          // eventually rather than promptly - a real connection-pool
          // leak under sustained chat traffic. Best-effort: cancelling
          // an already-finished/already-closing stream can itself
          // reject, never worth surfacing over the real generation this
          // call already succeeded at.
          reader.cancel().catch(() => {});
          return;
        }
        if (!data) continue;
        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue; // a malformed line is skipped, not fatal - the rest of the stream may still be good
        }
        // A code review (2026-09-04) found this guarded against an empty
        // `choices` array but not a chunk that omits the field entirely
        // (a valid-JSON, non-standard SSE frame - e.g. an inline
        // error/usage frame some backends emit): `chunk.choices[0]` threw
        // before the `?.` ever applied, killing the whole generation
        // instead of skipping the one frame, unlike the malformed-JSON
        // case two lines up, which already degrades gracefully.
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    } catch (err) {
      throw new LlmClientError(`stream from ${this.baseUrl} broke`, err);
    }
  }
}
