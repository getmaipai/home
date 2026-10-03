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
import { tryConsume } from "@/lib/rateLimiter";
import { LlmClientError, type ChatCompletionStreamStats } from "@maipai/spec/llm/ts/client.js";
import type { ChatRole, ChatCompletionRequest, ChatCompletionChunk, ToolDefinition, ToolCallWire } from "@maipai/spec/llm/ts/types.js";
import { validateToolMessages } from "@maipai/spec/llm/ts/types.js";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";
import { seedFields } from "@/lib/benchSampling";
import { feedThinkSplit, flushThinkSplit, newThinkSplitState, type ThinkSpan } from "@/lib/wellFormed";
import { isStackRoleEnabled, getStackClient, recordStackChatIdentity, stackFailureResult, resolveStackOffline, type StackFailureResult } from "@/lib/stackEngine";
import { identityFromHeaders } from "@/lib/stack/client";
import type { RoleRequest } from "@/lib/stack/types";

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
  /** An installed model id validated from the Stack's chat role. Omitted
   * keeps the existing role-based selection. */
  model?: string;
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
  /** THIN-5A (docs/design/RULES.md rule 2): a minor's request, a spoken
   * turn or any surface with nowhere to show reasoning. Sets thinking
   * off on the request and drops any reasoning the engine returns
   * anyway, here at the engine client, so it never reaches a caller to
   * be stored. Never sent to the engine. */
  dropReasoning?: boolean;
  /** THIN-5A: complete() hands back the engine's reasoning only to a
   * caller that asks for it (the old path's re-wrap seam). Every other
   * caller (routes/llm.ts, the judges, the package host) gets `text`
   * alone, so a response body can never carry reasoning that was not
   * safety-checked with the text. Never sent to the engine. */
  returnReasoning?: boolean;
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
   * default) lets it answer normally instead when nothing offered fits.
   * "none" (PHRASE-01, dev.md "The written prompt on tier 1, decided"'s
   * own follow-up): the tools block still renders (offering stays true,
   * so the prompt's own prefix - and its cache hit - stays the forced
   * round's own), but the engine is told never to call one this round -
   * the phrasing round's own shape, which never asks the model to
   * decide again. `chatRequestBody`'s own pass-through (`tool_choice ??
   * "auto"`) already forwards any explicit value verbatim; only this
   * type needed widening. */
  tool_choice?: "auto" | "required" | "none";
  /** STYLE-BENCH-01/STYLE-ADAPTER-01 (docs/dev.md "The engine facts,
   * verified in the pinned build (b10797)"): llama-server's own
   * per-request LoRA selection (`--lora`/`--lora-scaled` load adapters
   * at launch, `--lora-init-without-apply` at scale 0; this field
   * selects and scales them for one completion, an unlisted adapter
   * defaulting to 0). `chatRequestBody` already spreads every other
   * option straight into the request body (`...rest`), so this reaches
   * both the local client and the Stack-routed twin with no second code
   * path needed - `body`'s own inferred type (built from `rest`, not a
   * literal) carries `lora` through to `client.chatComplete({ model,
   * ...body })` without tripping TypeScript's excess-property check on
   * `ChatCompletionRequest` (which has no `lora` field of its own: a
   * spread of an already-typed variable isn't literal-checked the way a
   * hand-written property would be), and the field still reaches the
   * wire either way, since `JSON.stringify` serializes whatever the
   * object actually holds at runtime. Omitted (never `[]`) by every
   * caller that isn't testing or selecting an adapter, so an ordinary
   * completion's request shape - and its prompt-cache hit - is
   * unaffected by this option ever existing. */
  lora?: { id: number; scale: number }[];
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

// ENGINE-CONTRACT-03 (dev.md "U6 rerun ruling" (a)): a reply whose
// WHOLE visible text is one tool-call envelope - the model writing the
// wire's own {name, arguments} shape as prose instead of using the
// engine's real tool-call field, in whatever tag wraps it (or none).
// Found live: Qwen3's chat template wraps a call in <function_call>,
// which llama-server's own parser does not recognize, so it arrives as
// ordinary content and nothing anywhere used to notice. Prose anywhere
// around the envelope - a lead-in sentence, a trailing aside - means
// this is a reply that happens to mention a call, not a bare one; only
// the ENTIRE trimmed text, once at most one wrapping tag is stripped,
// parsing as exactly one object with a `name` and an `arguments` field
// counts. Reuses toolCallFromWire()'s own args-parsing so a hand-typed
// envelope call is normalized identically to a real wire one.
const ENVELOPE_TAG_RE = /^<([a-zA-Z_][\w-]*)>([\s\S]*)<\/\1>$/;

export function envelopeToolCall(text: string): ToolCall | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const tagged = trimmed.match(ENVELOPE_TAG_RE);
  const candidate = tagged ? tagged[2]!.trim() : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim().length === 0) return undefined;
  if (!("arguments" in obj)) return undefined;
  const args = obj.arguments;
  const rawArgs = typeof args === "string" ? args : JSON.stringify(args);
  // No real wire id for a call the model wrote as prose instead of
  // through the wire's own tool-call field; toolCallFromWire() only
  // keeps a truthy one, so "" comes through as ToolCall.id: undefined,
  // same as any other synthetic call (builderFallbackOutput's own).
  return toolCallFromWire({ id: "", type: "function", function: { name: obj.name, arguments: rawArgs } });
}

export interface LlmCompleteValue {
  /** The engine's `content` only. Reasoning is never folded into it. */
  text: string;
  /** THIN-5A: the engine's own `reasoning_content`, as its own field
   * (llama.cpp's `--reasoning-format`). Absent when the engine returned
   * none, or when the request set `dropReasoning`. */
  reasoning?: string;
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
  const { thinking, dropReasoning, returnReasoning: _returnReasoning, tools, tool_choice, ...rest } = opts;
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
      chat_template_kwargs: { enable_thinking: !!thinking && !dropReasoning },
      // ENGINE-CONTRACT-01 (dev.md 2026-09-23): GROUND-01's own live
      // rerun may need one pass with the prompt cache off, to read the
      // grounding bar on the forced rows without llama-server b10797's
      // own cache-hit defect (tool_choice: "required" going advisory on
      // a warm KV cache) in the way - never set as a standing default,
      // the operator sets it per invocation for exactly that rerun. The
      // product fix is ENGINE-CONTRACT-02, never this flag.
      cache_prompt: process.env.MAIPAI_BENCH_CACHE_PROMPT_FALSE === "1" ? false : true,
      id_slot: 0,
      // USAGE-01 (dev.md "U6 rerun ruling," 2026-09-23): without this,
      // a streamed completion never carries a final usage chunk at
      // all, so cached_tokens stayed blank on every streamed row even
      // though ChatCompletionUsage already had the field to carry it.
      // Harmless on the non-streaming call sites too (stream_options
      // only applies alongside stream: true; spec-v0.1.26).
      stream_options: { include_usage: true },
    },
  };
}

// THIN-5A (docs/design/RULES.md rule 2): reasoning travels as its own
// field (LlmCompleteValue.reasoning, LlmStreamPiece) from the engine
// client to the gate. The default turn path never wraps it into `<think>`
// tags and never splits it out again. The two helpers below exist only
// for the OLD path (turnEngine.ts, turnBareStream.ts, the OpenAI-style
// callers), whose pipeline still carries a think block inside its text;
// they are deleted with that path (rule 12).

// REASONING-01 (a review's own named failure mode): a literal
// `<think>`/`</think>` substring INSIDE reasoning_content would create a
// spurious boundary once the old path re-parses the wrapped text. Breaks
// the tag SHAPE before reasoning is wrapped; never applied to `content`,
// where an engine that never separates reasoning legitimately leaks real
// `<think>` markup.
const THINK_TAG_RE = /<\/?think>/gi;
export function neutralizeThinkTags(text: string): string {
  return text.replace(THINK_TAG_RE, (tag) => tag.replace(/[<>]/g, ""));
}

/** OLD PATH ONLY (retires with turnEngine.ts's pipeline): the shape that
 * path's text contract expects, `<think>reasoning</think>content`. */
export function legacyThinkTagged(content: string, reasoning?: string | null): string {
  return reasoning ? `<think>${neutralizeThinkTags(reasoning)}</think>${content}` : content;
}

/** THIN-5A: the one place a blocking completion's `reasoning_content`
 * becomes `LlmCompleteValue.reasoning`; dropped here for a minor. */
function reasoningField(reasoning: string | null | undefined, opts: LlmCompleteOptions): { reasoning?: string } {
  return reasoning && opts.returnReasoning === true && !opts.dropReasoning ? { reasoning } : {};
}

/** HOME-STACK-02b: role="chat" for every real caller today (turnEngine.ts's
 * own turns and personaJudge.ts/memoryJudge.ts's judge calls all pass
 * "chat" - there is no separate judge role on the wire, only a different
 * prompt), sent to the Stack as its own `model` per the role wire so a
 * differently-sized model can answer it there. */
export type StackChatResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; failure: StackFailureResult };

/** Shared non-streaming Stack chat call for ordinary chat and the
 * background worker's judge request. Keeps identity and Repairs handling
 * in the same path for every caller. */
export async function completeViaStackRequest(role: string, request: RoleRequest): Promise<StackChatResult> {
  try {
    const client = getStackClient();
    const result = await client.chat(request);
    if ("stream" in result) {
      // complete() never asks for stream: true; a Stack that streamed
      // anyway is a contract break worth a loud, distinct failure rather
      // than silently reading `undefined` fields below.
      return { ok: false, failure: { ok: false, status: 503, code: "unavailable", error: "chat model unavailable: the Stack streamed a non-streaming request" } };
    }
    recordStackChatIdentity(result.identity);
    resolveStackOffline(role);
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, failure: stackFailureResult(err, role) };
  }
}

async function completeViaStack(role: LlmRole, messages: LlmMessage[], opts: LlmCompleteOptions): Promise<LlmOpResult> {
  const { offering, body } = chatRequestBody(messages, opts);
  const result = await completeViaStackRequest(role, { ...body, model: opts.model ?? role });
  if (!result.ok) return result.failure;
  const data = result.data as { choices?: Array<{ message: { content: string; reasoning_content?: string | null; tool_calls?: ToolCallWire[] } }>; model?: string };
    const choice = data.choices?.[0];
    if (!choice) return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    const tool_calls = offering ? (choice.message.tool_calls ?? []).map(toolCallFromWire) : undefined;
    return { ok: true, value: { text: choice.message.content, ...reasoningField(choice.message.reasoning_content, opts), model: data.model ?? role, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
}

export async function complete(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
): Promise<LlmOpResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;

  // Home chat always goes through the MaiPai Stack when it is configured.
  // MAIPAI_LLAMA_SERVER_URL no longer selects a Home-owned chat backend.
  if (isStackRoleEnabled("chat")) return completeViaStack(role, messages, opts);

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
    const response = await client.chatComplete({ ...body, model: opts.model ?? "chat" });
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
    return { ok: true, value: { text: choice.message.content, ...reasoningField(choice.message.reasoning_content, opts), model: response.model, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
  } catch (err) {
    recoverFromDeadBackend(err);
    const message = err instanceof LlmClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${message}` };
  }
}

export type LlmStreamStartResult =
  | { ok: true; tokens: AsyncGenerator<string, ToolCall[] | undefined, void>; stats: ChatCompletionStreamStats }
  | { ok: false; status: 400 | 503; code: "unsupported_role" | "invalid_input" | "unavailable"; error: string };

/** THIN-5A: one piece of a streamed completion, on the channel the
 * engine itself put it on: `reasoning` is `delta.reasoning_content`,
 * `text` is `delta.content`. */
export interface LlmStreamPiece {
  channel: "reasoning" | "text";
  text: string;
}

export type LlmPiecesStartResult =
  | { ok: true; pieces: AsyncGenerator<LlmStreamPiece, ToolCall[] | undefined, void>; stats: ChatCompletionStreamStats }
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
async function* stackChatPieces(
  stream: ReadableStream<Uint8Array>,
  stats: ChatCompletionStreamStats,
  dropReasoning: boolean,
): AsyncGenerator<LlmStreamPiece, ToolCallWire[] | undefined, void> {
  const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>();
  const assembleToolCalls = (): ToolCallWire[] | undefined =>
    toolCallsByIndex.size === 0
      ? undefined
      : [...toolCallsByIndex.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.args } }));
  // THIN-5A: `delta.reasoning_content` (llama-server's own split, typed
  // at @maipai/spec llm/ts/types.ts:233-241, ChatCompletionChunkDelta) is
  // yielded as a reasoning piece and `delta.content` as a text piece. No
  // tag is synthesized; a minor's request drops reasoning here, so it
  // never reaches a caller to be stored.
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
    if (reasoning && !dropReasoning) yield { channel: "reasoning", text: reasoning };
    const content = delta?.content;
    if (content) yield { channel: "text", text: content };
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

async function openStackPieces(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions,
  signal?: AbortSignal,
): Promise<LlmPiecesStartResult> {
  const { offering, body } = chatRequestBody(messages, opts);
  const stats: ChatCompletionStreamStats = { usage: null, timings: null, stopReason: null };
  let stream: ReadableStream<Uint8Array>;
  let headers: Headers;
  try {
    const client = getStackClient();
    const result = await client.chat({ ...body, model: opts.model ?? role, stream: true }, { signal });
    if (!("stream" in result)) {
      return { ok: false, status: 503, code: "unavailable", error: "chat model unavailable: the Stack answered a streaming request without a stream" };
    }
    ({ stream, headers } = result);
  } catch (err) {
    return stackFailureResult(err, role);
  }
  recordStackChatIdentity(identityFromHeaders(headers));
  resolveStackOffline(role);
  async function* pieces(): AsyncGenerator<LlmStreamPiece, ToolCall[] | undefined, void> {
    try {
      const wireToolCalls = yield* stackChatPieces(stream, stats, opts.dropReasoning === true);
      return offering && wireToolCalls && wireToolCalls.length > 0 ? wireToolCalls.map(toolCallFromWire) : undefined;
    } catch (err) {
      throw new Error(`chat model unavailable: ${(err as Error).message}`);
    }
  }
  return { ok: true, pieces: pieces(), stats };
}

/** OLD PATH ONLY (retires with turnEngine.ts's pipeline, rule 12): folds
 * the native pieces back into the single think-tagged text stream that
 * pipeline's contract still expects. */
async function* thinkTaggedTokens(
  pieces: AsyncGenerator<LlmStreamPiece, ToolCall[] | undefined, void>,
): AsyncGenerator<string, ToolCall[] | undefined, void> {
  let reasoningOpen = false;
  try {
    for (;;) {
      const step = await pieces.next();
      if (step.done) return step.value;
      if (step.value.channel === "reasoning") {
        if (!reasoningOpen) {
          yield "<think>";
          reasoningOpen = true;
        }
        yield neutralizeThinkTags(step.value.text);
      } else {
        if (reasoningOpen) {
          yield "</think>";
          reasoningOpen = false;
        }
        yield step.value.text;
      }
    }
  } finally {
    await pieces.return(undefined);
  }
}

/** The direct-engine seam (MAIPAI_LLAMA_SERVER_URL, benches and tests
 * only; Home never spawns an engine) goes through spec's client, which
 * still yields one think-tagged string stream. This is the only place
 * that stream is split back into pieces, and it retires with the seam. */
async function* piecesFromTagged(
  tokens: AsyncGenerator<string, ToolCall[] | undefined, void>,
  dropReasoning: boolean,
): AsyncGenerator<LlmStreamPiece, ToolCall[] | undefined, void> {
  const split = newThinkSplitState();
  const toPieces = (spans: ThinkSpan[]): LlmStreamPiece[] =>
    spans.filter((span) => !(span.reasoning && dropReasoning)).map((span) => ({ channel: span.reasoning ? "reasoning" : "text", text: span.text }));
  try {
    for (;;) {
      const step = await tokens.next();
      if (step.done) {
        yield* toPieces(flushThinkSplit(split));
        return step.value;
      }
      yield* toPieces(feedThinkSplit(split, step.value));
    }
  } finally {
    await tokens.return(undefined);
  }
}

type LlmTokensStartResult = Extract<LlmStreamStartResult, { ok: true }> | Extract<LlmStreamStartResult, { ok: false }>;

/** The direct-engine seam's token stream (see piecesFromTagged()). */
async function startDirectTokens(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions,
  signal?: AbortSignal,
): Promise<LlmTokensStartResult> {
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
  // `delta.tool_calls` fragments).
  async function* tokens(): AsyncGenerator<string, ToolCall[] | undefined, void> {
    try {
      const wireToolCalls = yield* client!.chatCompleteStream({ ...body, model: opts.model ?? "chat" }, signal, stats);
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

/** THIN-5A: the default turn path's streaming call. Reasoning and text
 * arrive as separate pieces; `dropReasoning` (a minor, a spoken turn)
 * sets thinking off and discards any reasoning the engine sends anyway. */
export async function startCompleteStreamPieces(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
  signal?: AbortSignal,
): Promise<LlmPiecesStartResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;
  if (isStackRoleEnabled("chat")) return openStackPieces(role, messages, opts, signal);
  const direct = await startDirectTokens(role, messages, opts, signal);
  if (!direct.ok) return direct;
  return { ok: true, pieces: piecesFromTagged(direct.tokens, opts.dropReasoning === true), stats: direct.stats };
}

/** OLD PATH ONLY (retires with turnEngine.ts's pipeline, rule 12): the
 * think-tagged string stream that pipeline still consumes. The default
 * turn path calls startCompleteStreamPieces() instead. */
export async function startCompleteStream(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
  signal?: AbortSignal,
): Promise<LlmStreamStartResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;

  // Streaming follows the same Stack-only routing as complete() above.
  if (isStackRoleEnabled("chat")) {
    const opened = await openStackPieces(role, messages, opts, signal);
    return opened.ok ? { ok: true, tokens: thinkTaggedTokens(opened.pieces), stats: opened.stats } : opened;
  }
  return startDirectTokens(role, messages, opts, signal);
}

export type BackgroundResult = { ok: true; text: string } | { ok: false; unavailable: true };

/** Runs memory extraction and summaries through the configured Stack judge. */
export async function completeBackground(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<BackgroundResult> {
  const { body } = chatRequestBody(messages, options);
  const result = await completeViaStackRequest("background", { ...body, model: options.model ?? "judge" });
  if (!result.ok) return { ok: false, unavailable: true };
  const data = result.data as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? { ok: true, text: content } : { ok: false, unavailable: true };
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
 * model, the Stack's pinned embedding model, selected by role. */
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

  return embedViaStack(texts);
}
