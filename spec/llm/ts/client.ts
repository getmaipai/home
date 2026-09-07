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
  ToolCallWire,
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

// COR-2 (code review, 2026-09-06): neither chatComplete() nor embed() had
// any timeout - a wedged llama-server (the post-load memory drift this
// codebase already measures can produce exactly that under a too-large
// context override) meant these calls waited forever. The scheduler's
// own runDueJobsUnguarded() awaits both directly (memory.judge,
// memory.consolidate); with no timeout here, one wedged model tick could
// never time out on its own, silently wedging the scheduler's per-tick
// in-flight guard right along with it, so this fix belongs at the same
// altitude as the SSRF/permission checks: the shared client every real
// caller goes through, not something each caller re-adds for itself.
// Generous defaults, not tuned to a measured worst case (chat replies
// can legitimately run tens of seconds on a slow model; embedding is
// small and fast, so it gets a tighter budget) - overridable per client
// instance for a test that needs to prove the timeout actually fires
// without waiting out the real default.
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;
const DEFAULT_EMBED_TIMEOUT_MS = 30_000;

export interface LlamaServerClientOptions {
  chatTimeoutMs?: number;
  embedTimeoutMs?: number;
}

function timeoutError(baseUrl: string, path: string, timeoutMs: number, err: unknown): LlmClientError {
  if (err instanceof Error && err.name === "TimeoutError") {
    return new LlmClientError(`${path} on ${baseUrl} timed out after ${timeoutMs}ms`, err);
  }
  return new LlmClientError(`could not reach ${baseUrl}`, err);
}

export class LlamaServerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly opts: LlamaServerClientOptions = {},
  ) {}

  /** True only on a reachable server reporting ready ("ok"); loading,
   * unreachable, and any non-200 all fold to false, since a caller only
   * ever needs "can I send a completion request right now." */
  async health(): Promise<boolean> {
    try {
      // Bounded (2026-09-07): a live-but-hung server must read as
      // unhealthy, not hold every caller's poll open forever - the hub's
      // engine auto-heal (home's sidecars.ts) counts misses to decide a
      // process is wedged, and an unbounded fetch never misses.
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
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
    const timeoutMs = this.opts.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw timeoutError(this.baseUrl, "POST /v1/chat/completions", timeoutMs, err);
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
    const timeoutMs = this.opts.embedTimeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw timeoutError(this.baseUrl, "POST /v1/embeddings", timeoutMs, err);
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
  /** `externalSignal` (COR-7, code review, 2026-09-06): lets a caller
   * cancel generation from OUTSIDE this generator's own control flow - a
   * disconnected HTTP client's ReadableStream.cancel(), say. Calling
   * `.return()` on a suspended async generator alone doesn't abort a
   * pending network read (it only takes effect once that read settles on
   * its own), so a caller that actually wants the underlying connection
   * torn down needs a real signal reaching this fetch, not just "stop
   * iterating." Composed with the internal idle-timeout controller
   * below, not replacing it - either one firing ends the stream. */
  /** Fix E's own return value (docs/dev.md, "native tool calling, one
   * round trip"): `undefined` for an ordinary reply (every text delta
   * already yielded is the whole answer); a non-empty array when the
   * model proposed a tool call instead - confirmed live, 2026-09-07,
   * that a tool-calling reply's `content` stays empty/null throughout
   * (no interleaved prose), so a caller never has to guess which shape
   * it's getting until the stream itself ends. Assembled from
   * `delta.tool_calls` fragments accumulated per `index` as they arrive,
   * the identical concatenation this method already does for plain text
   * content, just keyed by call instead of by nothing. */
  async *chatCompleteStream(request: ChatCompletionRequest, externalSignal?: AbortSignal): AsyncGenerator<string, ToolCallWire[] | undefined, void> {
    // A review, 2026-09-06, found this was the one method on this client
    // still missing a timeout after chatComplete()/embed() got theirs -
    // the exact "wedged llama-server" failure mode is just as reachable
    // through a live, streamed chat turn as through a background job. A
    // SECOND review pass then caught that a flat AbortSignal.timeout()
    // (chatComplete()/embed()'s own shape, a fixed deadline from request
    // start) is the wrong model here: verified empirically that it
    // aborts an in-progress body read too, not just the connect/headers
    // phase, so a real reply whose tokens keep arriving past the
    // deadline - not stalled, just long - would be killed identically to
    // a genuinely wedged server. This is an IDLE timeout instead (the
    // same shape lib/modelDownload.ts's own per-chunk stall detector
    // uses, applied here via a real AbortController rather than a bare
    // promise race, so an idle-out actually cancels the underlying
    // connection instead of merely abandoning it): armed before the
    // request even starts (bounds time-to-first-byte too) and re-armed
    // on every line actually received, so only a stream that goes
    // genuinely silent for `timeoutMs` ever fires it.
    const timeoutMs = this.opts.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
    const controller = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimer = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), timeoutMs);
    };
    armIdleTimer();

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(idleTimer);
      throw timeoutError(this.baseUrl, "POST /v1/chat/completions (stream)", timeoutMs, err);
    }
    if (!res.ok) {
      clearTimeout(idleTimer);
      throw new LlmClientError(`POST /v1/chat/completions returned ${res.status}`);
    }
    if (!res.body) {
      clearTimeout(idleTimer);
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
    // Fix E: accumulated across every chunk, keyed by the wire's own
    // `index` - built up here the same way `content` is concatenated by
    // the CALLER (this method just yields each piece), but tool_calls
    // has no caller-visible per-fragment shape worth yielding (a partial
    // JSON-argument string fragment means nothing on its own), so the
    // assembly happens inside this method instead, surfaced once, whole,
    // as the generator's own return value.
    const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>();
    const assembleToolCalls = (): ToolCallWire[] | undefined =>
      toolCallsByIndex.size === 0
        ? undefined
        : [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, call]) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.args } }));
    try {
      for await (const line of readTextLines(reader)) {
        armIdleTimer(); // real activity - push the deadline back out
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
          return assembleToolCalls();
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
        const delta = chunk.choices?.[0]?.delta;
        const content = delta?.content;
        if (content) yield content;
        for (const fragment of delta?.tool_calls ?? []) {
          const existing = toolCallsByIndex.get(fragment.index) ?? { id: "", name: "", args: "" };
          if (fragment.id) existing.id = fragment.id;
          if (fragment.function?.name) existing.name = fragment.function.name;
          if (fragment.function?.arguments) existing.args += fragment.function.arguments;
          toolCallsByIndex.set(fragment.index, existing);
        }
      }
    } catch (err) {
      throw new LlmClientError(`stream from ${this.baseUrl} broke`, err);
    } finally {
      clearTimeout(idleTimer);
    }
    return assembleToolCalls(); // the stream ended without a [DONE] line (a clean close is still possible without it)
  }
}
