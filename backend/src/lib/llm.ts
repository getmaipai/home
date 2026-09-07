// The model role port (platform plan 4.11): "Roles, not model names, in
// code." Only `chat` is implemented this pass; every other role is a
// real, named gap, not a silently missing one. See spec/llm/README.md for
// the full scope. `host.llm.complete` in packageHost.ts calls this file's
// own complete() directly (session-d-packages-and-store.md step 7, the
// translate package's own recipe) - the Host RPC boundary went async the
// same day fetch/home.call_service did, and llm.complete followed once a
// recipe step actually called it.
//
// `embed` (2026-09-04) is now real too, but through its own dedicated
// embed() function below, not complete()/IMPLEMENTED_ROLES: a chat
// completion's request shape (a messages array) and an embedding
// request's shape (a batch of plain strings) have nothing in common, so
// forcing embed through validate()'s chat-shaped checks would be the
// wrong kind of code reuse, not real sharing.
import { getChatClient, reportChatBackendUnreachable } from "@/lib/llmSupervisor";
import { getEmbedClient } from "@/lib/embedSupervisor";
import { tryConsume } from "@/lib/rateLimiter";
import { LlmClientError } from "@maipai/spec/llm/ts/client.js";
import type { ChatRole, ChatCompletionRequest, ToolDefinition, ToolCallWire } from "@maipai/spec/llm/ts/types.js";

// Session C step 0 (wave-2.md): a person every couple of seconds, burst
// of a few - Session A's own per-person limit (its step 11) hadn't
// landed on main when this session started. Lives here, the one module
// both routes/turn.ts (via lib/turnEngine.ts) and routes/llm.ts already
// sit above, rather than in either route file: a turn's own reply
// generation goes through this identical model call, so a route-to-route
// import (one HTTP handler reaching into another's module) would be the
// wrong shape for what is really a shared policy on this port.
export const PERSON_TURN_BUDGET = { capacity: 5, refillPerSecond: 0.5 };

/** True (and consumes a token) if `personId` is still within budget;
 * false if the caller should get back spec/errors/errors.json's
 * "turn_rate_limited" instead. */
export function personWithinTurnBudget(personId: string): boolean {
  return tryConsume(`turn:${personId}`, PERSON_TURN_BUDGET);
}

export type LlmRole =
  | "chat"
  | "router"
  | "embed"
  | "vision"
  | "image"
  | "video"
  | "coding"
  | "tts"
  | "stt"
  | "wakeword";

const IMPLEMENTED_ROLES: ReadonlySet<LlmRole> = new Set(["chat"]);

export interface LlmMessage {
  role: ChatRole;
  content: string;
}

export interface LlmCompleteOptions {
  temperature?: number;
  max_tokens?: number;
  /** Off by default (Jesse, 2026-09-04: "thinking mode off by default
   * with the ability to enable in chats when needed"): a household
   * member turns it on per message, not a standing mode, since the
   * catalog's one chat model (Qwen3 8B) answers noticeably slower with it
   * on and most turns don't need it. No auto-detect heuristic here on
   * purpose - guessing "does this question need reasoning" is a real,
   * unbuilt research problem (a router role, 4.11's other deferred role),
   * not something to improvise as a side effect of this slice. */
  thinking?: boolean;
  /** Grammar-constrained structured output (step 6, session-a-
   * intelligence.md): passed straight through to client.chatComplete()
   * (already spreads its whole request object, so no other change is
   * needed here or in client.ts itself). The memory judge
   * (lib/memoryJudge.ts) is the first real caller. Never combined with
   * `tools` below by any real caller today (native tool calling has no
   * use for a `response_format` grammar), so no precedence rule between
   * them is needed. */
  response_format?: ChatCompletionRequest["response_format"];
  /** Fix E (docs/dev.md's "Chat reliability" - native tool calling, one
   * round trip): offering `tools` lets llama-server's own function-
   * calling support decide and call, replacing the deleted grammar-
   * forced JSON-array mechanism (`toolCallSchema()`/`parseToolCalls()`,
   * a real, measured problem of their own - see this fix's docs/dev.md
   * writeup for why). Capped at two calls per turn (turnEngine.ts's own
   * pre-filter picks which candidates to offer at all) - two independent
   * calls, never a chained pipeline. */
  tools?: ToolSpec[];
  /** "required" disallows the model declining (used only by
   * enginePostLoadCheck.ts's own capability probe); "auto" (the
   * default) lets it answer normally instead when nothing offered fits. */
  tool_choice?: "auto" | "required";
}

/** One package (or, once D's `exposes.queries` lands, one typed query on
 * a package) offered as a Tier 2 candidate. `args` is that candidate's
 * own JSON Schema (manifest.args unchanged - the exact shape
 * `runPlugin()` already validates against, reused here, not
 * reinvented; mapped to `ToolDefinition.function.parameters` verbatim by
 * toToolDefinition() below, no reshaping). */
export interface ToolSpec {
  id: string;
  description: string;
  args: unknown;
}

export interface ToolCall {
  tool: string;
  args: unknown;
}

function toToolDefinition(spec: ToolSpec): ToolDefinition {
  return { type: "function", function: { name: spec.id, description: spec.description, parameters: spec.args } };
}

/** The model's own JSON-encoded `arguments` string, parsed once here so
 * every caller works with the same `unknown` shape `runPlugin()`'s real
 * ajv-compiled schema already validates for real - a parse failure (the
 * model emitted something that isn't valid JSON, rare but real for a
 * small model) becomes `args: undefined`, which `runPlugin()`'s own
 * `validateArgs()` then rejects the normal way (a required-property
 * miss), not a second, different error path for the identical class of
 * problem. */
function toolCallFromWire(wire: ToolCallWire): ToolCall {
  let args: unknown;
  try {
    args = JSON.parse(wire.function.arguments);
  } catch {
    args = undefined;
  }
  return { tool: wire.function.name, args };
}

export interface LlmCompleteValue {
  text: string;
  model: string;
  /** Only set (even to `[]`) when `tools` was offered for this call.
   * `undefined` means tools weren't offered at all; `[]` is the model's
   * own real decision that nothing offered fit - both `complete()` and
   * `startCompleteStream()` preserve this distinction explicitly (see
   * each one's own `offering` check) rather than letting an absent
   * field and an empty array read as the same thing. */
  tool_calls?: ToolCall[];
}

export type LlmOpResult =
  | { ok: true; value: LlmCompleteValue }
  | { ok: false; status: 400 | 503; code: "unsupported_role" | "invalid_input" | "unavailable"; error: string };

const VALID_MESSAGE_ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant"]);

type LlmValidationError = Extract<LlmOpResult, { ok: false }>;

/** Shared by complete() and startCompleteStream(): role/messages
 * validation is identical either way, and doing it up front (before
 * either function ever touches the client) means an invalid request
 * fails the same way regardless of which path answers it. */
function validate(role: LlmRole, messages: LlmMessage[]): LlmValidationError | null {
  if (!IMPLEMENTED_ROLES.has(role)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_role",
      error: `the ${role} model role is not implemented on this host build yet (4.11)`,
    };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "messages must be a non-empty array" };
  }
  for (const message of messages) {
    if (!message || typeof message.content !== "string" || !VALID_MESSAGE_ROLES.has(message.role)) {
      return {
        ok: false,
        status: 400,
        code: "invalid_input",
        error: "every message needs role in system|user|assistant and a string content",
      };
    }
  }
  return null;
}

// A live incident (2026-09-07): Fix A keeps a spawned chat backend's
// client cached on `globalThis` across a hot reload (llmSupervisor.ts),
// but nothing ever re-validates that its underlying process is still
// alive. That process can die out from under it - observed twice in one
// night, no crash report, no resource-governor trip, chat's own port
// simply stopped answering - and without this, every subsequent turn
// repeats the identical "could not reach" failure forever: only an
// explicit stop/restart action ever clears `state.chatBackend`, and
// nothing was calling one. `LlamaServerClient`'s own `timeoutError()`
// (spec/llm/ts/client.ts) gives the unreachable case this exact message
// prefix, distinct from a timeout (a slow/wedged process that may still
// be alive, and shouldn't be killed out from under a request that might
// still complete). This turn still fails - by the time a stream failure
// reaches here, headers may already be committed - but clearing the
// stale reference means the household's NEXT message spawns a fresh
// backend instead of repeating the same dead one.
// Since the auto-heal (docs/dev.md, "What was actually killing the chat
// engine"), this hands the failure to llmSupervisor.ts's own watch rather
// than calling restartChatBackend() directly: a code review (2026-09-07)
// found the direct restart read as a DELIBERATE stop to the exit watcher,
// so an engine dying mid-request was dropped with no log line and no
// Repairs issue - the exact case this exists for.
function recoverFromDeadBackend(err: unknown): void {
  if (err instanceof LlmClientError && err.message.startsWith("could not reach ")) {
    reportChatBackendUnreachable(err.message);
  }
}

export async function complete(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
): Promise<LlmOpResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;

  let client;
  try {
    client = await getChatClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${(err as Error).message}` };
  }

  try {
    const { thinking, tools, tool_choice, ...rest } = opts;
    const offering = !!tools && tools.length > 0;
    const response = await client.chatComplete({
      model: "chat",
      messages,
      ...rest,
      // A code review (2026-09-07) found `...rest` above still carries a
      // caller-supplied `response_format` through with nothing stopping
      // it from being sent alongside `tools` in the same request - no
      // real caller does both today, but nothing enforced that. Explicit
      // now, matching this option's own doc comment: offering tools
      // always wins.
      response_format: offering ? undefined : rest.response_format,
      tools: offering ? tools!.map(toToolDefinition) : undefined,
      tool_choice: offering ? (tool_choice ?? "auto") : undefined,
      chat_template_kwargs: { enable_thinking: !!thinking },
    });
    const choice = response.choices[0];
    if (!choice) {
      return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    }
    // `[]` (the model looked and genuinely found nothing worth calling)
    // and a real, non-empty array are both real decisions the caller
    // (turnEngine.ts) branches on; only `undefined` means "tools weren't
    // offered on this call at all," never conflated with "offered, and
    // declined."
    const tool_calls = offering ? (choice.message.tool_calls ?? []).map(toolCallFromWire) : undefined;
    return { ok: true, value: { text: choice.message.content, model: response.model, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
  } catch (err) {
    recoverFromDeadBackend(err);
    const message = err instanceof LlmClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${message}` };
  }
}

export type LlmStreamStartResult =
  | { ok: true; tokens: AsyncGenerator<string, ToolCall[] | undefined, void> }
  | { ok: false; status: 400 | 503; code: "unsupported_role" | "invalid_input" | "unavailable"; error: string };

/** Real token-by-token streaming (2026-09-04): validates and resolves a
 * backend synchronously, exactly like complete(), so a bad request or a
 * down engine still gets a proper HTTP status before any byte streams -
 * only the actual generation (the `tokens` generator) is where a failure
 * can no longer change the response status, since by then the caller
 * (turnEngine.ts's runTurnStream) has already committed to a streaming
 * response. A mid-stream failure surfaces there as a thrown error from
 * the generator, not a return value. */
/** `signal` (COR-7, code review, 2026-09-06) lets a caller abort
 * generation from outside - turnEngine.ts's runTurnStream() threads
 * through the AbortController routes/turn.ts's ReadableStream.cancel()
 * fires when an HTTP client disconnects mid-stream, so that stops
 * occupying the shared chat engine slot instead of running to
 * completion for nobody. A separate parameter, not folded into
 * LlmCompleteOptions: that type's fields all end up spread straight into
 * the request body sent to llama-server (`...rest` below), and a signal
 * has no business there. */
export async function startCompleteStream(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
  signal?: AbortSignal,
): Promise<LlmStreamStartResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;

  let client;
  try {
    client = await getChatClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${(err as Error).message}` };
  }

  const { thinking, tools, tool_choice, ...rest } = opts;
  const offering = !!tools && tools.length > 0;
  // Fix E: `yield*` delegation both forwards every text delta the inner
  // generator yields AND evaluates to its own return value once it ends
  // (spec/llm/ts/client.ts's own chatCompleteStream(), assembled from
  // `delta.tool_calls` fragments) - the same pattern turnEngine.ts's
  // gateGuards()/gateOutputSafety() already use for propagating a
  // return value through a wrapping generator, just via `yield*` instead
  // of a manual per-item loop, since nothing here needs to inspect or
  // transform an individual delta the way those two do.
  async function* tokens(): AsyncGenerator<string, ToolCall[] | undefined, void> {
    try {
      const wireToolCalls = yield* client!.chatCompleteStream(
        {
          model: "chat",
          messages,
          ...rest,
          // Same explicit precedence as complete()'s own fix: offering
          // tools always wins over a caller-supplied response_format.
          response_format: offering ? undefined : rest.response_format,
          tools: offering ? tools!.map(toToolDefinition) : undefined,
          tool_choice: offering ? (tool_choice ?? "auto") : undefined,
          chat_template_kwargs: { enable_thinking: !!thinking },
        },
        signal,
      );
      return offering && wireToolCalls && wireToolCalls.length > 0 ? wireToolCalls.map(toolCallFromWire) : undefined;
    } catch (err) {
      // A request the caller itself cancelled (the person closed the tab
      // before the first byte) surfaces as the same "could not reach"
      // as a dead engine (spec/llm/ts/client.ts wraps every pre-header
      // rejection that way) - a code review (2026-09-07) caught that
      // reporting it would kill a healthy engine for everyone else.
      if (!signal?.aborted) recoverFromDeadBackend(err);
      const message = err instanceof LlmClientError ? err.message : (err as Error).message;
      throw new Error(`chat model unavailable: ${message}`);
    }
  }
  return { ok: true, tokens: tokens() };
}

export interface EmbedValue {
  /** One vector per input text, in the SAME order as the request - never
   * trusts llama-server's own response order, which the OpenAI-compatible
   * embeddings shape doesn't actually guarantee (each item carries its
   * own `index`; this sorts by it before returning). */
  vectors: number[][];
  model: string;
}

export type EmbedOpResult =
  | { ok: true; value: EmbedValue }
  | { ok: false; status: 400 | 503; code: "invalid_input" | "unavailable"; error: string };

/** 4.11's `embed` role: text in, one real vector per input out. No
 * `role` parameter (unlike complete()) - there is exactly one embedding
 * model, embedAssets.ts's pinned nomic-embed-text-v1.5, with no
 * catalog/selection to route between yet. */
export async function embed(texts: string[]): Promise<EmbedOpResult> {
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => typeof t !== "string" || t.length === 0)) {
    return { ok: false, status: 400, code: "invalid_input", error: "texts must be a non-empty array of non-empty strings" };
  }

  let client;
  try {
    client = await getEmbedClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `embed model unavailable: ${(err as Error).message}` };
  }

  try {
    const response = await client.embed({ model: "embed", input: texts });
    const vectors = [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { ok: true, value: { vectors, model: response.model } };
  } catch (err) {
    const message = err instanceof LlmClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `embed model unavailable: ${message}` };
  }
}
