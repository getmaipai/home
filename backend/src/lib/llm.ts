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
import { LlmClientError, type ChatCompletionStreamStats } from "@maipai/spec/llm/ts/client.js";
import type { ChatRole, ChatCompletionRequest, ChatCompletionChunk, ToolDefinition, ToolCallWire } from "@maipai/spec/llm/ts/types.js";
import { validateToolMessages } from "@maipai/spec/llm/ts/types.js";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";
import { seedFields } from "@/lib/benchSampling";
import { getStackUrl, getStackClient, recordStackChatIdentity, stackFailureResult, resolveStackOffline } from "@/lib/stackEngine";
import { identityFromHeaders } from "@/lib/stack/client";

// Session C step 0 (wave-2.md): a person every couple of seconds, burst
// of a few - Session A's own per-person limit (its step 11) hadn't
// landed on main when this session started. Lives here, the one module
// both routes/turn.ts (via lib/turnEngine.ts) and routes/llm.ts already
// sit above, rather than in either route file: a turn's own reply
// generation goes through this identical model call, so a route-to-route
// import (one HTTP handler reaching into another's module) would be the
// wrong shape for what is really a shared policy on this port.
export const PERSON_TURN_BUDGET = { capacity: 5, refillPerSecond: 0.5 };
// getmaipai/home#102: a Home card's ephemeral fixed question (routes/
// turn.ts, gated to the allowlist by #91) used to draw from the chat
// budget above, so several tabs loading Home at once 429'd the card and
// a person's own chat and the Home page paid from one bucket. An
// ephemeral turn draws from its own small bucket per person, same
// refill, so neither can starve the other.
export const EPHEMERAL_TURN_BUDGET = { capacity: 2, refillPerSecond: PERSON_TURN_BUDGET.refillPerSecond };

/** True (and consumes a token) if `personId` is still within budget;
 * false if the caller should get back spec/errors/errors.json's
 * "turn_rate_limited" instead. */
export function personWithinTurnBudget(personId: string): boolean {
  return tryConsume(`turn:${personId}`, PERSON_TURN_BUDGET);
}

/** The same, for a Home card's own ephemeral turn (#102): its own
 * bucket, never the chat budget's. */
export function personWithinEphemeralBudget(personId: string): boolean {
  return tryConsume(`ephemeral:${personId}`, EPHEMERAL_TURN_BUDGET);
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
  /** CHAT-16 (K1's wire): a `tool` message names the assistant tool
   * call it answers; the composer sends one per retained outcome. */
  tool_call_id?: string;
  /** The tool calls an assistant message made, retained so the tool
   * messages after it can answer them by id. */
  tool_calls?: ToolCallWire[];
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
  /** The model's own call id from the wire (CHAT-01: kept so a
   * ToolExecutionOutcome can name the call it answers); absent for a
   * call built by a test or a stub without one. */
  id?: string;
  /** ENGINE-CONTRACT-02 (home/docs/dev.md 2026-09-23, "U6: the flip
   * verdict", regression A): the model's own JSON-encoded `arguments`
   * string, kept alongside the parsed `args` so a parse failure and a
   * literal `{}` can be told apart on the stored generation record -
   * `args` alone collapses both to the identical `undefined`/`{}`
   * shape. Absent for a call built by a test or by code, never from
   * the wire (a synthetic builder call has no "raw" string to keep). */
  rawArgs?: string;
}

export function toToolDefinition(spec: ToolSpec): ToolDefinition {
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
  return { tool: wire.function.name, args, ...(wire.id ? { id: wire.id } : {}), rawArgs: wire.function.arguments };
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

const VALID_MESSAGE_ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool"]);

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
        error: "every message needs role in system|user|assistant|tool and a string content",
      };
    }
  }
  // CHAT-16: a tool message answers a preceding assistant tool call by
  // id (the spec client's own rule, checked here so the failure is a 400
  // and not a thrown client error).
  const toolSequence = validateToolMessages(messages);
  if (toolSequence) return { ok: false, status: 400, code: "invalid_input", error: toolSequence };
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

/** FAST-06 (docs/dev.md, the 2026-09-12 review's decision 6): variety
 * in phrasing comes from the sampler, not from a prompt sentence. Sent
 * on every plain `chat` completion (complete() and startCompleteStream())
 * when the caller passed neither a `response_format` (a JSON-schema
 * answer must be the single most likely one) nor its own `temperature`
 * (a caller that chose one is choosing its own sampling). The values
 * are llama.cpp's own documented defaults for the three samplers; the
 * temperature is the item's 0.7, which is a change: plain chat used
 * to run at llama-server's own default of 0.8, since nothing passed
 * `--temp` or a request temperature. A tools-offered completion (the
 * ordinary chat turn, since websearch is always offered) gets the set
 * too, measured rather than assumed: the tool-calling bench at 10
 * repeats holds every positive and every negative with it on. */
export const CHAT_SAMPLING = {
  temperature: 0.7,
  min_p: 0.05,
  xtc_probability: 0.5,
  xtc_threshold: 0.1,
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2,
} as const;

function chatSamplingFor(opts: { temperature?: number; response_format?: unknown }): Partial<typeof CHAT_SAMPLING> {
  if (opts.response_format !== undefined || opts.temperature !== undefined) return {};
  return CHAT_SAMPLING;
}

/** The request body shared by complete() and its Stack-routed twin below
 * - factored out so the two call sites (a local LlamaServerClient, the
 * Stack's own /v1/chat/completions) can never drift on what a completion
 * actually asks for. */
function chatRequestBody(messages: LlmMessage[], opts: LlmCompleteOptions) {
  const { thinking, tools, tool_choice, ...rest } = opts;
  const offering = !!tools && tools.length > 0;
  return {
    offering,
    body: {
      messages,
      ...rest,
      ...chatSamplingFor(rest),
      ...seedFields(),
      response_format: offering ? undefined : rest.response_format,
      tools: offering ? tools!.map(toToolDefinition) : undefined,
      tool_choice: offering ? (tool_choice ?? "auto") : undefined,
      chat_template_kwargs: { enable_thinking: !!thinking },
      // ENGINE-CONTRACT-01 (dev.md 2026-09-23): GROUND-01's own live
      // rerun may need one pass with the prompt cache off, to read the
      // grounding bar on the forced rows without llama-server b10797's
      // own cache-hit defect (tool_choice: "required" going advisory on
      // a warm KV cache) in the way - never set as a standing default,
      // the operator sets it per invocation for exactly that rerun. The
      // product fix is ENGINE-CONTRACT-02, never this flag.
      cache_prompt: process.env.MAIPAI_BENCH_CACHE_PROMPT_FALSE === "1" ? false : true,
      id_slot: 0,
    },
  };
}

// REASONING-01 (a review's own named failure mode): a literal
// `<think>`/`</think>` substring INSIDE reasoning_content itself (the
// model reasoning about markup, or an adversarial completion) would
// otherwise create a spurious boundary once feedThinkSplit() re-parses
// the synthesized text downstream, misclassifying the remainder as
// ordinary `delta` - never gated by a minor's own dropReasoning check,
// which only ever filters spans already tagged `reasoning`. Breaks the
// tag SHAPE (never alters meaning-bearing text otherwise) before
// reasoning_content ever reaches the synthesized wrapper; the engine's
// own already-separated reasoning has no legitimate reason to carry
// this exact markup, so this is always safe. Never applied to `content`:
// an engine/template that never separates reasoning legitimately leaks
// real `<think>` markup INTO content (the fallback shape this file still
// supports unchanged), and neutralizing content unconditionally would
// break that case. Exported so stackChatDeltas()'s own per-delta twin
// case applies the identical neutralization.
const THINK_TAG_RE = /<\/?think>/gi;
export function neutralizeThinkTags(text: string): string {
  return text.replace(THINK_TAG_RE, (tag) => tag.replace(/[<>]/g, ""));
}

/** REASONING-01: the non-streaming twin of stackChatDeltas()'s/
 * chatCompleteStream()'s own per-chunk synthesis - a single blocking
 * completion's `message.reasoning_content` (llama.cpp's own
 * `--reasoning-format deepseek`/`auto` split, confirmed live against
 * the pinned b10797 build) wrapped into the identical
 * `<think>...</think>` shape wellFormed.ts's whole downstream contract
 * already expects around it. `undefined`/empty reasoning_content
 * (an engine/template that never separates it, tags already embedded
 * in `content` instead, or reasoning off) returns `content` unchanged. */
function withSynthesizedThink(content: string, reasoningContent?: string | null): string {
  return reasoningContent ? `<think>${neutralizeThinkTags(reasoningContent)}</think>${content}` : content;
}

/** HOME-STACK-02b: role="chat" for every real caller today (turnEngine.ts's
 * own turns and personaJudge.ts/memoryJudge.ts's judge calls all pass
 * "chat" - there is no separate judge role on the wire, only a different
 * prompt), sent to the Stack as its own `model` per the role wire so a
 * differently-sized model can answer it there. */
async function completeViaStack(role: LlmRole, messages: LlmMessage[], opts: LlmCompleteOptions): Promise<LlmOpResult> {
  const { offering, body } = chatRequestBody(messages, opts);
  try {
    const client = getStackClient();
    const result = await client.chat({ model: role, ...body });
    if ("stream" in result) {
      // complete() never asks for stream: true; a Stack that streamed
      // anyway is a contract break worth a loud, distinct failure rather
      // than silently reading `undefined` fields below.
      return { ok: false, status: 503, code: "unavailable", error: "chat model unavailable: the Stack streamed a non-streaming request" };
    }
    recordStackChatIdentity(result.identity);
    resolveStackOffline(role);
    const data = result.data as { choices?: Array<{ message: { content: string; reasoning_content?: string | null; tool_calls?: ToolCallWire[] } }>; model?: string };
    const choice = data.choices?.[0];
    if (!choice) return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    const tool_calls = offering ? (choice.message.tool_calls ?? []).map(toolCallFromWire) : undefined;
    return { ok: true, value: { text: withSynthesizedThink(choice.message.content, choice.message.reasoning_content), model: data.model ?? role, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
  } catch (err) {
    return stackFailureResult(err, role);
  }
}

export async function complete(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
): Promise<LlmOpResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;

  if (getStackUrl()) return completeViaStack(role, messages, opts);

  let client;
  try {
    client = await getChatClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${(err as Error).message}` };
  }

  try {
    // `rest` first, then the sampling: a caller that passed
    // `temperature: undefined` (routes/llm.ts forwards the body's field
    // as-is) must not end up with the samplers on and no temperature (a
    // code review caught the other order doing that). A code review
    // (2026-09-07) also found an earlier cut still carrying a
    // caller-supplied `response_format` through alongside `tools` with
    // nothing stopping it - chatRequestBody() makes offering tools
    // always win, explicitly. Both fixes live in that one shared
    // builder now, not duplicated between this call and the Stack's.
    const { offering, body } = chatRequestBody(messages, opts);
    const response = await client.chatComplete({ model: "chat", ...body });
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
    return { ok: true, value: { text: withSynthesizedThink(choice.message.content, choice.message.reasoning_content), model: response.model, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
  } catch (err) {
    recoverFromDeadBackend(err);
    const message = err instanceof LlmClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${message}` };
  }
}

export type LlmStreamStartResult =
  | { ok: true; tokens: AsyncGenerator<string, ToolCall[] | undefined, void>; stats: ChatCompletionStreamStats }
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
/** HOME-STACK-02b's streaming twin of completeViaStack(): the Stack's
 * `/v1/chat/completions` is the same OpenAI-compatible SSE wire
 * `@maipai/spec/llm/ts/client.ts`'s own chatCompleteStream() already
 * parses against a direct llama-server - that method owns its own fetch
 * internally, so it cannot be pointed at a stream this file already has
 * in hand, but its chunk-interpretation logic (the `data:`/`[DONE]`
 * framing, per-index tool-call assembly, stats) is ported here verbatim
 * against `stack/client.ts`'s own `{ stream, headers }` reply instead -
 * that shape is what gives this path what the direct client's method
 * cannot: the identity headers, readable the moment the connection
 * opens, before a single token arrives. Simplified relative to the
 * original: no idle-timeout re-arming per chunk (the caller's own
 * `signal` still aborts on a client disconnect); a genuinely wedged
 * Stack stream is a gap to close in a follow-up, not silently patched
 * over here with an untested port of that machinery too. */
async function* stackChatDeltas(
  stream: ReadableStream<Uint8Array>,
  stats: ChatCompletionStreamStats,
): AsyncGenerator<string, ToolCallWire[] | undefined, void> {
  const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>();
  const assembleToolCalls = (): ToolCallWire[] | undefined =>
    toolCallsByIndex.size === 0
      ? undefined
      : [...toolCallsByIndex.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.args } }));
  // REASONING-01: the identical `reasoning_content` -> synthesized
  // `<think>...</think>` port as chatCompleteStream()'s own twin case -
  // this function's own header comment already promises "ported here
  // verbatim," so this stays in sync with that copy rather than drifting.
  let reasoningOpen = false;
  const reader = stream.getReader();
  for await (const line of readTextLines(reader)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (data === "[DONE]") {
      reader.cancel().catch(() => {});
      return assembleToolCalls();
    }
    if (!data) continue;
    let chunk: ChatCompletionChunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk.usage) stats.usage = chunk.usage;
    if (chunk.timings) stats.timings = chunk.timings;
    const finishReason = chunk.choices?.[0]?.finish_reason;
    if (finishReason) stats.stopReason = finishReason;
    const delta = chunk.choices?.[0]?.delta;
    const reasoning = delta?.reasoning_content;
    if (reasoning) {
      if (!reasoningOpen) {
        yield "<think>";
        reasoningOpen = true;
      }
      // Never `content` here: an engine/template that never separates
      // reasoning legitimately leaks real `<think>` markup INTO content
      // (the fallback shape this whole file still supports unchanged) -
      // neutralizing content unconditionally would break that case.
      // reasoning_content, by contrast, is only ever populated by the
      // engine's own already-separated reasoning; it has no legitimate
      // reason to carry literal tag markup, so it's always safe (and
      // necessary, for the dropReasoning gate) to neutralize.
      yield neutralizeThinkTags(reasoning);
    }
    const content = delta?.content;
    if (content) {
      if (reasoningOpen) {
        yield "</think>";
        reasoningOpen = false;
      }
      yield content;
    }
    for (const fragment of delta?.tool_calls ?? []) {
      const existing = toolCallsByIndex.get(fragment.index) ?? { id: "", name: "", args: "" };
      if (fragment.id) existing.id = fragment.id;
      if (fragment.function?.name) existing.name = fragment.function.name;
      if (fragment.function?.arguments) existing.args += fragment.function.arguments;
      toolCallsByIndex.set(fragment.index, existing);
    }
  }
  return assembleToolCalls();
}

async function startCompleteStreamViaStack(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions,
  signal?: AbortSignal,
): Promise<LlmStreamStartResult> {
  const { offering, body } = chatRequestBody(messages, opts);
  const stats: ChatCompletionStreamStats = { usage: null, timings: null, stopReason: null };
  let stream: ReadableStream<Uint8Array>;
  let headers: Headers;
  try {
    const client = getStackClient();
    const result = await client.chat({ model: role, ...body, stream: true }, { signal });
    if (!("stream" in result)) {
      return { ok: false, status: 503, code: "unavailable", error: "chat model unavailable: the Stack answered a streaming request without a stream" };
    }
    ({ stream, headers } = result);
  } catch (err) {
    return stackFailureResult(err, role);
  }
  recordStackChatIdentity(identityFromHeaders(headers));
  resolveStackOffline(role);
  async function* tokens(): AsyncGenerator<string, ToolCall[] | undefined, void> {
    try {
      const wireToolCalls = yield* stackChatDeltas(stream, stats);
      return offering && wireToolCalls && wireToolCalls.length > 0 ? wireToolCalls.map(toolCallFromWire) : undefined;
    } catch (err) {
      throw new Error(`chat model unavailable: ${(err as Error).message}`);
    }
  }
  return { ok: true, tokens: tokens(), stats };
}

export async function startCompleteStream(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
  signal?: AbortSignal,
): Promise<LlmStreamStartResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;

  if (getStackUrl()) return startCompleteStreamViaStack(role, messages, opts, signal);

  let client;
  try {
    client = await getChatClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${(err as Error).message}` };
  }

  // Same shared builder complete() uses (see its own comment) - a review
  // caught an earlier cut of this file leaving this method's own copy of
  // the request unswapped, exactly the drift chatRequestBody() exists to
  // prevent.
  const { offering, body } = chatRequestBody(messages, opts);
  const stats: ChatCompletionStreamStats = { usage: null, timings: null, stopReason: null };
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
      const wireToolCalls = yield* client!.chatCompleteStream({ model: "chat", ...body }, signal, stats);
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
  return { ok: true, tokens: tokens(), stats };
}

export interface EmbedValue {
  /** One vector per input text, in the SAME order as the request - never
   * trusts llama-server's own response order, which the OpenAI-compatible
   * embeddings shape doesn't actually guarantee (each item carries its
   * own `index`; this sorts by it before returning). */
  vectors: number[][];
  model: string;
  /** The preprocessing scheme version these vectors were produced under
   * (CHAT-09's embedding identity, alongside the model: a vector's
   * identity is model + dims + preprocess). Always `EMBED_PREPROCESS`
   * for live embeds; re-embed jobs stamp it the same way. */
  preprocess: string;
}

export type EmbedOpResult =
  | { ok: true; value: EmbedValue }
  | { ok: false; status: 400 | 503; code: "invalid_input" | "unavailable"; error: string };

// CHAT-09: the preprocessing scheme version stamped into every stored
// embedding row and carried on every query vector. Today there is exactly
// one ("v1" = the current raw / document-prefix scheme); a future change
// to the scheme bumps this and re-embeds rather than silently mixing
// incompatible rows in the cosine comparison.
export const EMBED_PREPROCESS = "v1";

/** 4.11's `embed` role: text in, one real vector per input out. No
 * `role` parameter (unlike complete()) - there is exactly one embedding
 * model, embedAssets.ts's pinned nomic-embed-text-v1.5, with no
 * catalog/selection to route between yet. */
async function embedViaStack(texts: string[]): Promise<EmbedOpResult> {
  try {
    const client = getStackClient();
    const result = await client.embeddings({ model: "embed", input: texts });
    resolveStackOffline("embed");
    const data = result.data as { data: Array<{ index: number; embedding: number[] }>; model: string };
    const vectors = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { ok: true, value: { vectors, model: data.model, preprocess: EMBED_PREPROCESS } };
  } catch (err) {
    return stackFailureResult(err, "embed");
  }
}

export async function embed(texts: string[]): Promise<EmbedOpResult> {
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => typeof t !== "string" || t.length === 0)) {
    return { ok: false, status: 400, code: "invalid_input", error: "texts must be a non-empty array of non-empty strings" };
  }

  if (getStackUrl()) return embedViaStack(texts);

  let client;
  try {
    client = await getEmbedClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `embed model unavailable: ${(err as Error).message}` };
  }

  try {
    const response = await client.embed({ model: "embed", input: texts });
    const vectors = [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { ok: true, value: { vectors, model: response.model, preprocess: EMBED_PREPROCESS } };
  } catch (err) {
    const message = err instanceof LlmClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `embed model unavailable: ${message}` };
  }
}
