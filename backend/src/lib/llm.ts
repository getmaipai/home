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
import { ChatTemplateTokenFilter, stripChatTemplateTokens } from "@/lib/chatTemplateTokens";
import { foldLateSystemMessages } from "@/lib/systemFold";
import { getChatClient, reportChatBackendUnreachable } from "@/lib/llmSupervisor";
import { tryConsume } from "@/lib/rateLimiter";
import { isStackRestart, waitForStackBack } from "@/lib/stackRestart";
import { StackError } from "@/lib/stack/errors";
import { LlmClientError, type ChatCompletionStreamStats } from "@maipai/spec/llm/ts/client.js";
import type { ChatRole, ChatCompletionRequest, ChatCompletionChunk, ToolDefinition, ToolCallWire } from "@maipai/spec/llm/ts/types.js";
import { validateToolMessages } from "@maipai/spec/llm/ts/types.js";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";
import { seedFields } from "@/lib/benchSampling";
import { feedThinkSplit, flushThinkSplit, newThinkSplitState, visibleText, type ThinkSpan } from "@/lib/wellFormed";
import { isStackRoleEnabled, isStackConfigured, getStackClient, recordStackChatIdentity, stackFailureResult, stackFailureFacts, resolveStackOffline, type StackFailureResult, type StackFailureFacts } from "@/lib/stackEngine";
import { identityFromHeaders } from "@/lib/stack/client";
import type { RoleRequest } from "@/lib/stack/types";

import { cachedRoleHealth } from "@/lib/roleHealth";
import { getActiveChatEngineIdentity } from "@/lib/stackEngine";
import { chatCatalogEntry } from "@/lib/modelCatalog";
import { chatSamplingOf } from "@/lib/llmSampling";
import { availableAnswerTokens, ContextTooLargeError, setCeilingEngineIdentity, reasoningReserveFor, rememberCeilingSpentInvisibly, EmptyLengthError, logEmptyLengthRetry, type ReasoningContext } from "@/lib/reasoningReserve";

// Session C step 0 (wave-2.md): a person every couple of seconds, burst
// of a few - Session A's own per-person limit (its step 11) hadn't
// landed on main when this session started. Lives here, the one module
// both routes/turn.ts (via the retired turn engine) and routes/llm.ts already
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

/** VISION-02c: one stored picture sent to a chat model that reads
 * pictures, as the OpenAI-style data URL the local engine takes. Never
 * sent to anything but the local chat engine (PRIVACY.md). */
export interface LlmImagePart {
  /** The stored picture's attachment id (never sent to the engine). */
  id: string;
  /** The file name, cleaned for a prompt; sent as a text part before the picture. */
  name: string;
  /** `data:<media type>;base64,...` of the stored, re-encoded picture. */
  url: string;
  /** The most tokens the engine lets this picture take (the chat role's
   * declared --image-max-tokens): what a window count holds for it, since
   * the engine's token count route counts a picture as a marker only. */
  reservedTokens: number;
}

export interface LlmMessage {
  role: ChatRole;
  content: string;
  /** VISION-02c: pictures that go with this (user) message. The wire
   * renders them as content parts; every other reader keeps `content`. */
  images?: LlmImagePart[];
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
  /** Non-streaming answer budget; streaming callers own their total ceiling. */
  max_tokens?: number;
  signal?: AbortSignal;
  /** Hard engine ceiling, only for a documented smoke check. */
  exactCeiling?: boolean;
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
   * caller that asks for it. Every other
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
   * writeup for why). Capped at two calls per turn (the retired turn engine's own
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
  /** FORM-CHAT-HUB-01, Home-only: set by turnNext.ts for a form-resume or form-confirm run; toolCallFromWire never sets them. */
  formResume?: boolean;
  redactArgs?: boolean;
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
  // FORM-CHAT-HUB-01: a wire id in Home's reserved resume namespace is dropped, so a model or engine can never present one.
  const id = wire.id && !wire.id.startsWith("resumed-ask:") && !wire.id.startsWith("resumed:") ? wire.id : undefined;
  return { tool: wire.function.name, args, ...(id ? { id } : {}), rawArgs: wire.function.arguments };
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

// CF-SEARCH-01 (live, 2026-10-17, Muse Glimmer on oMLX): in about one search turn in five the engine's
// own tool parser took the call's opening tags and left the rest as plain content, so the person saw
// `<ns:parameter name="expression">cloudflare down</ns:parameter> ... </ns:invoke>` as the reply and no
// search ran. The text is a call and nothing else: parameter blocks, optionally inside an `invoke`
// (which names the tool), then closing tags and stray punctuation. The opener is gone in the live
// shape, so a call carrying `expression` is the search call (the one tool with that field).
const MARKUP_PARAM_RE = /<([a-zA-Z_][\w-]*):parameter\s+name="([\w-]+)"\s*>([\s\S]*?)<\/\1:parameter>/g;
const MARKUP_INVOKE_RE = /<([a-zA-Z_][\w-]*):invoke\s+name="([\w-]+)"\s*>/;
function markupToolCall(trimmed: string): ToolCall | undefined {
  if (!trimmed.startsWith("<") || !trimmed.includes(":parameter")) return undefined;
  const args: Record<string, string> = {};
  let rest = trimmed;
  for (const m of trimmed.matchAll(MARKUP_PARAM_RE)) {
    args[m[2]!] = m[3]!.trim();
    rest = rest.replace(m[0], "");
  }
  const invoke = rest.match(MARKUP_INVOKE_RE);
  if (invoke) rest = rest.replace(invoke[0], "");
  // Anything left must be closing tags and punctuation; prose beside the markup is an ordinary answer.
  if (rest.replace(/<\/?[a-zA-Z_][\w-]*(?::[\w-]+)?[^>]*>/g, "").replace(/[\s.,;]/g, "").length > 0) return undefined;
  const name = invoke?.[2] ?? ("expression" in args ? "websearch" : undefined);
  if (!name || Object.keys(args).length === 0) return undefined;
  return toolCallFromWire({ id: "", type: "function", function: { name, arguments: JSON.stringify(args) } });
}

// RECENCY-02: Qwen's own XML call, `<tool_call><function=name><parameter=key>value</parameter></function></tool_call>`, as the
// whole reply. Prose beside it is never a call (toolMarkup.ts cuts that text off instead).
const QWEN_XML_FUNCTION_RE = /^(?:<tool_call>\s*)?<function=([\w.-]+)>([\s\S]*?)<\/function>\s*(?:<\/tool_call>)?$/i;
const QWEN_XML_PARAM_RE = /<parameter=([\w.-]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;
function qwenXmlToolCall(trimmed: string): ToolCall | undefined {
  if (!trimmed.startsWith("<")) return undefined;
  const whole = trimmed.match(QWEN_XML_FUNCTION_RE);
  if (!whole) return undefined;
  const args: Record<string, string> = {};
  let leftover = whole[2]!;
  for (const m of whole[2]!.matchAll(QWEN_XML_PARAM_RE)) {
    args[m[1]!] = m[2]!;
    leftover = leftover.replace(m[0], "");
  }
  if (leftover.trim().length > 0) return undefined;
  return toolCallFromWire({ id: "", type: "function", function: { name: whole[1]!, arguments: JSON.stringify(args) } });
}

export function envelopeToolCall(text: string): ToolCall | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const qwenXml = qwenXmlToolCall(trimmed);
  if (qwenXml) return qwenXml;
  const markup = markupToolCall(trimmed);
  if (markup) return markup;
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
  /** Engine stop reason, including a ceiling reached before visible text. */
  finish_reason?: string | null;
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
  | { ok: false; status: 400 | 503; code: "unsupported_role" | "invalid_input" | "unavailable"; error: string; reason?: "empty_length" | "context_too_large" };

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
 * come from the answering model's own record (MODEL-ADD-01 S3), never a
 * global: shipped records carry the former global set unchanged (see
 * FORMER_GLOBAL_SAMPLING in modelCatalog.ts for where those numbers came
 * from), and a model with no record or no values sends none and keeps
 * the engine's defaults. A tools-offered completion (the ordinary chat
 * turn, since websearch is always offered) gets the set too. */
function chatSamplingFor(opts: { temperature?: number; response_format?: unknown; model?: string }): Record<string, number> {
  if (opts.response_format !== undefined || opts.temperature !== undefined) return {};
  const model = opts.model && !["chat", "judge"].includes(opts.model) ? opts.model : getActiveChatEngineIdentity()?.model ?? undefined;
  return chatSamplingOf(chatCatalogEntry(model));
}

/** The request body shared by complete() and its Stack-routed twin below
 * - factored out so the two call sites (a local LlamaServerClient, the
 * Stack's own /v1/chat/completions) can never drift on what a completion
 * actually asks for. */
/** VISION-02c: a message's pictures as OpenAI-style content parts, one
 * text part naming each file ahead of its image_url part, then the
 * message's own text. A message without pictures is sent unchanged. */
export function toWireMessage(message: LlmMessage): Omit<LlmMessage, "images" | "content"> & { content: LlmMessage["content"] | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> } {
  const { images, ...rest } = message;
  if (!images || images.length === 0) return rest;
  const parts = images.flatMap((image) => [{ type: "text" as const, text: `Picture: ${image.name}` }, { type: "image_url" as const, image_url: { url: image.url } }]);
  return { ...rest, content: [...parts, { type: "text" as const, text: message.content }] };
}

function chatRequestBody(messages: LlmMessage[], opts: LlmCompleteOptions) {
  const { thinking, dropReasoning, returnReasoning: _returnReasoning, exactCeiling: _exactCeiling, signal: _signal, tools, tool_choice, ...rest } = opts;
  const offering = !!tools && tools.length > 0;
  return {
    offering,
    body: {
      // CHAT-LATE-SYSTEM-01: at most one system message, first.
      messages: foldLateSystemMessages(messages).map(toWireMessage),
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
// tags and never splits it out again. The think-tag helpers below serve
// only startCompleteStream(), the string-stream facade the benches and
// tests still read.

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

/** THIN-5A: the one place a blocking completion's `reasoning_content`
 * becomes `LlmCompleteValue.reasoning`; dropped here for a minor. */
function reasoningField(reasoning: string | null | undefined, opts: LlmCompleteOptions): { reasoning?: string } {
  return reasoning && opts.returnReasoning === true && !opts.dropReasoning ? { reasoning: stripChatTemplateTokens(reasoning) } : {};
}

/** HOME-STACK-02b: role="chat" for every real caller today (the retired turn engine's
 * own turns and personaJudge.ts/memoryJudge.ts's judge calls all pass
 * "chat" - there is no separate judge role on the wire, only a different
 * prompt), sent to the Stack as its own `model` per the role wire so a
 * differently-sized model can answer it there. */
export type StackChatResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; failure: StackFailureResult & { reason?: "empty_length" | "context_too_large" } };

/** Shared non-streaming Stack chat call for ordinary chat and the
 * background worker's judge request. Keeps identity and Repairs handling
 * in the same path for every caller. */
async function stackRequestOnce(role: string, request: RoleRequest, signal?: AbortSignal): Promise<StackChatResult> {
  try {
    const client = getStackClient();
    const result = await client.chat(request, { signal });
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

interface CeilingPlan { model?: string; answer?: number; context: ReasoningContext; ceiling?: number; failure?: boolean }
function ceilingPlan(role: string, messages: LlmMessage[], opts: LlmCompleteOptions): CeilingPlan {
  const health = cachedRoleHealth(role === "background" || role === "judge" ? "background" : "chat");
  setCeilingEngineIdentity(getActiveChatEngineIdentity());
  const model = opts.model && !["chat", "judge"].includes(opts.model) ? opts.model : health?.modelId ?? (role === "chat" ? getActiveChatEngineIdentity()?.model ?? undefined : undefined);
  // Estimate only prompt material, never the encoded picture bytes. Picture
  // token reservations come from the role's measured image limit.
  const promptTokens = messages.reduce((total, message) => {
    const { images, ...text } = message;
    const chars = JSON.stringify(text, (key, value) => key === "url" ? "[picture]" : value).length;
    const pictures = (images ?? []).reduce((n, image) => n + image.reservedTokens, 0) + (Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url").length * (health?.pictureTokensMax ?? health?.contextPerSlot ?? 4096) : 0);
    return total + Math.ceil(chars / 2) + 16 + pictures;
  }, 32) + Math.ceil(JSON.stringify(opts.tools ?? []).length / 2);
  const context = { contextTokens: (!opts.model || ["chat", "judge"].includes(opts.model) || opts.model === health?.modelId) ? health?.contextPerSlot : undefined, promptTokens: promptTokens + Math.ceil(JSON.stringify(opts.response_format ?? {}).length / 2) };
  const answer = opts.max_tokens;
  const ceiling = answer === undefined || answer <= 0 || opts.exactCeiling ? answer : answer + reasoningReserveFor(model, answer, context);
  if (answer && reasoningReserveFor(model, answer) > 0 && availableAnswerTokens(context) < answer) return { model, answer, context, ceiling, failure: true };
  return { model, answer, context, ceiling };
}
function retryCeiling(role: string, plan: CeilingPlan): number {
  setCeilingEngineIdentity(getActiveChatEngineIdentity());
  rememberCeilingSpentInvisibly(plan.model);
  const answer = plan.answer && plan.answer > 0 ? plan.answer : 1024;
  const reserve = reasoningReserveFor(plan.model ?? { thinking_mode: "always" }, answer, plan.context, 2);
  const ceiling = answer + reserve;
  if (ceiling > (plan.ceiling ?? answer)) logEmptyLengthRetry(role, plan.model, answer, plan.ceiling ?? answer, ceiling);
  return ceiling;
}
export async function complete(role: LlmRole, messages: LlmMessage[], opts: LlmCompleteOptions = {}): Promise<LlmOpResult> {
  const invalid = validate(role, messages);
  if (invalid) return invalid;
  const plan = ceilingPlan(role, messages, opts);
  if (plan.failure) return { ok: false, status: 400, code: "invalid_input", reason: "context_too_large", error: new ContextTooLargeError().message };
  let result = await completeOnce(role, messages, { ...opts, max_tokens: plan.ceiling });
  const empty = (r: LlmOpResult) => r.ok && r.value.finish_reason === "length" && !visibleText(r.value.text).trim() && !r.value.tool_calls?.length;
  if (!empty(result)) return result;
  if (result.ok && !plan.model) plan.model = result.value.model;
  const next = opts.exactCeiling || opts.signal?.aborted ? (plan.ceiling ?? 0) : retryCeiling(role, plan);
  if (!opts.exactCeiling && !opts.signal?.aborted && next > (plan.ceiling ?? 0)) result = await completeOnce(role, messages, { ...opts, max_tokens: next });
  return empty(result) ? { ok: false, status: 503, code: "unavailable", reason: "empty_length", error: new EmptyLengthError().message } : result;
}

/** Raw Stack consumers use the same answer-budget and retry boundary. */
export async function completeViaStackRequest(role: string, request: RoleRequest, signal?: AbortSignal, options: Pick<LlmCompleteOptions, "exactCeiling"> = {}): Promise<StackChatResult> {
  const messages = request.messages as LlmMessage[];
  const plan = ceilingPlan(role, messages, { ...request, ...options } as LlmCompleteOptions);
  const wire = { ...request, messages: messages.map(toWireMessage) };
  if (plan.failure) return { ok: false, failure: { ok: false, status: 503, code: "unavailable", reason: "context_too_large", error: new ContextTooLargeError().message } };
  let result = await stackRequestOnce(role, { ...wire, max_tokens: plan.ceiling }, signal);
  const empty = (r: StackChatResult) => {
    if (!r.ok) return false;
    const choice = (r.data as { choices?: Array<{ finish_reason?: string; message?: { content?: string; tool_calls?: unknown[] } }> }).choices?.[0];
    return choice?.finish_reason === "length" && !visibleText(stripChatTemplateTokens(choice.message?.content ?? "")).trim() && !choice.message?.tool_calls?.length;
  };
  if (!empty(result)) return result;
  if (result.ok && !plan.model && typeof result.data.model === "string") plan.model = result.data.model;
  const next = options.exactCeiling || signal?.aborted ? (plan.ceiling ?? 0) : retryCeiling(role, plan);
  if (!options.exactCeiling && !signal?.aborted && next > (plan.ceiling ?? 0)) result = await stackRequestOnce(role, { ...wire, max_tokens: next }, signal);
  return empty(result) ? { ok: false, failure: { ok: false, status: 503, code: "unavailable", reason: "empty_length", error: new EmptyLengthError().message } } : result;
}

async function completeViaStack(role: LlmRole, messages: LlmMessage[], opts: LlmCompleteOptions): Promise<LlmOpResult> {
  const { offering, body } = chatRequestBody(messages, opts);
  const result = await stackRequestOnce(role, { ...body, model: opts.model ?? role }, opts.signal);
  if (!result.ok) return result.failure;
  const data = result.data as { choices?: Array<{ finish_reason?: string | null; message: { content: string; reasoning_content?: string | null; tool_calls?: ToolCallWire[] } }>; model?: string };
    const choice = data.choices?.[0];
    if (!choice) return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    const tool_calls = offering ? (choice.message.tool_calls ?? []).map(toolCallFromWire) : undefined;
    return { ok: true, value: { text: stripChatTemplateTokens(choice.message.content ?? ""), finish_reason: choice.finish_reason, ...reasoningField(choice.message.reasoning_content, opts), model: data.model ?? role, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
}

async function completeOnce(
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
    // The spec client types `content` as text; a picture part (VISION-02c)
    // is the same OpenAI shape llama-server takes, passed through as is.
    const response = await client.chatComplete({ ...body, model: opts.model ?? "chat" } as ChatCompletionRequest);
    const choice = response.choices[0];
    if (!choice) {
      return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    }
    // `[]` (the model looked and genuinely found nothing worth calling)
    // and a real, non-empty array are both real decisions the caller
    // (the retired turn engine) branches on; only `undefined` means "tools weren't
    // offered on this call at all," never conflated with "offered, and
    // declined."
    const tool_calls = offering ? (choice.message.tool_calls ?? []).map(toolCallFromWire) : undefined;
    return { ok: true, value: { text: stripChatTemplateTokens(choice.message.content ?? ""), finish_reason: choice.finish_reason, ...reasoningField(choice.message.reasoning_content, opts), model: response.model, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
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
  | { ok: false; status: 400 | 503; code: "unsupported_role" | "invalid_input" | "unavailable"; error: string; facts?: StackFailureFacts };

/** CHAT-CALM-ERRORS-01b: a Stack chat stream that broke after it opened
 * (the engine died mid-reply). The message keeps the shape every caller
 * already reads ("chat model unavailable: ..."); `facts` carries the raw
 * cause and the engine and model that were answering, for an admin. */
export class StackStreamError extends Error {
  constructor(message: string, readonly facts: StackFailureFacts) {
    super(message);
    this.name = "StackStreamError";
  }
}

/** Real token-by-token streaming (2026-09-04): validates and resolves a
 * backend synchronously, exactly like complete(), so a bad request or a
 * down engine still gets a proper HTTP status before any byte streams -
 * only the actual generation (the `tokens` generator) is where a failure
 * can no longer change the response status, since by then the caller
 * (the retired turn engine's runTurnStream) has already committed to a streaming
 * response. A mid-stream failure surfaces there as a thrown error from
 * the generator, not a return value. */
/** `signal` (COR-7, code review, 2026-09-06) lets a caller abort
 * generation from outside - the retired turn engine's runTurnStream() threads
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
  // Chat-template control tokens (`<|message|>`) are removed here, once, for text and reasoning alike.
  const textFilter = new ChatTemplateTokenFilter();
  const reasoningFilter = new ChatTemplateTokenFilter();
  const flushed = (): LlmStreamPiece[] => {
    const out: LlmStreamPiece[] = [];
    const reasoningRest = reasoningFilter.flush();
    if (reasoningRest && !dropReasoning) out.push({ channel: "reasoning", text: reasoningRest });
    const textRest = textFilter.flush();
    if (textRest) out.push({ channel: "text", text: textRest });
    return out;
  };
  for await (const line of readTextLines(reader)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (data === "[DONE]") {
      reader.cancel().catch(() => {});
      for (const piece of flushed()) yield piece;
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
      const clean = reasoningFilter.push(reasoning);
      if (clean && !dropReasoning) yield { channel: "reasoning", text: clean };
    }
    const content = delta?.content;
    if (content) {
      const clean = textFilter.push(content);
      if (clean) yield { channel: "text", text: clean };
    }
    for (const fragment of delta?.tool_calls ?? []) {
      const existing = toolCallsByIndex.get(fragment.index) ?? { id: "", name: "", args: "" };
      if (fragment.id) existing.id = fragment.id;
      if (fragment.function?.name) existing.name = fragment.function.name;
      if (fragment.function?.arguments) existing.args += fragment.function.arguments;
      toolCallsByIndex.set(fragment.index, existing);
    }
  }
  // CHAT-CALM-ERRORS-01b: a stream that closes with neither `[DONE]` nor a
  // finish reason was cut off (an engine that died mid-reply closes its
  // socket, and the reader sees a plain end), never a finished reply.
  if (!stats.stopReason) throw new Error("the chat stream ended before the engine finished the reply");
  for (const piece of flushed()) yield piece;
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
  const openStream = async () => {
    const result = await getStackClient().chat({ ...body, model: opts.model ?? role, stream: true }, { signal });
    if (!("stream" in result)) throw new StackError("unexpected", "chat model unavailable: the Stack answered a streaming request without a stream");
    return result;
  };
  try {
    let result;
    try {
      result = await openStream();
    } catch (err) {
      // The Stack is restarting: wait for it and ask once more, so a message sent during an update still gets its answer.
      if (!isStackRestart(err) || signal?.aborted || !(await waitForStackBack(signal))) throw err;
      result = await openStream();
    }
    ({ stream, headers } = result);
  } catch (err) {
    return stackFailureResult(err, role);
  }
  recordStackChatIdentity(identityFromHeaders(headers));
  const answering = (name: string) => {
    const value = headers.get(name);
    return value && value !== "none" ? value : undefined;
  };
  const engineId = answering("x-maipai-engine");
  const modelId = answering("x-maipai-model");
  resolveStackOffline(role);
  async function* pieces(): AsyncGenerator<LlmStreamPiece, ToolCall[] | undefined, void> {
    try {
      // A stream that breaks before the first word because the Stack went down is opened once more after it is back; after a word was
      // shown it is not (the person would read the start twice).
      let yielded = false;
      let retried = false;
      let wireToolCalls: ToolCallWire[] | undefined;
      for (;;) {
        try {
          const source = stackChatPieces(stream, stats, opts.dropReasoning === true);
          for (;;) {
            const step = await source.next();
            if (step.done) { wireToolCalls = step.value; break; }
            yielded = true;
            yield step.value;
          }
          break;
        } catch (inner) {
          if (yielded || retried || signal?.aborted || !isStackRestart(inner)) throw inner;
          retried = true;
          if (!(await waitForStackBack(signal))) throw inner;
          stream = (await openStream()).stream;
        }
      }
      return offering && wireToolCalls && wireToolCalls.length > 0 ? wireToolCalls.map(toolCallFromWire) : undefined;
    } catch (err) {
      const facts = stackFailureFacts(err);
      throw new StackStreamError(`chat model unavailable: ${(err as Error).message}`, {
        ...facts,
        ...(!facts.engine_id && engineId ? { engine_id: engineId } : {}),
        ...(!facts.model_id && modelId ? { model_id: modelId } : {}),
      });
    }
  }
  return { ok: true, pieces: pieces(), stats };
}

/** Folds the native pieces back into the single think-tagged text stream
 * startCompleteStream() yields. */
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

/** The think-tagged string stream, for the benches and tests that read one
 * string. The turn path calls startCompleteStreamPieces() instead. */
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

/** `failureKind` is the Stack client's error kind or the ceiling plan's reason
 * (`unreachable`, `offline`, `timeout`, `unknown`, `context_too_large`,
 * `empty_length`, `no_content`); `httpStatus` is the Stack's own HTTP status
 * when one answered, and `error` the Stack's message (never the prompt). A
 * caller that gives up on a job logs these three so the failure class is
 * readable from the log (MEM-AUDIT-02's judge fix: three silent attempts). */
export type BackgroundResult = { ok: true; text: string } | { ok: false; unavailable: true; failureKind?: string; httpStatus?: number; error?: string };

/** Runs memory extraction and summaries through the configured Stack judge. */
export async function completeBackground(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<BackgroundResult> {
  const { body } = chatRequestBody(messages, options);
  const result = await completeViaStackRequest("background", { ...body, model: options.model ?? "judge" }, options.signal, { exactCeiling: options.exactCeiling });
  if (!result.ok) {
    // A Home-side refusal (no Stack configured) has no Stack error kind of
    // its own; named here so a background job can tell it from bad output.
    const failureKind = result.failure.reason ?? result.failure.failureKind ?? (isStackConfigured() ? "unknown" : "not_configured");
    return { ok: false, unavailable: true, failureKind, httpStatus: result.failure.facts?.http_status, error: result.failure.error };
  }
  const data = result.data as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? { ok: true, text: content } : { ok: false, unavailable: true, failureKind: "no_content", error: "the judge answered without a message" };
}

export interface ProbeReading { prompt_n: number | null; cache_n: number | null; prompt_ms: number | null }
/** DIAG-KEY-01: one chat-engine request built by the same body builder chat uses (cache_prompt on, tools rendered), read back as the
 * three numbers that show whether the engine reused its prompt. Reads only counts from the reply, never its text. */
export async function probeChatEngine(messages: LlmMessage[], tools: ToolSpec[]): Promise<{ ok: true; reading: ProbeReading } | { ok: false; error: string }> {
  const { body } = chatRequestBody(messages, { tools, max_tokens: 8, dropReasoning: true });
  const result = await completeViaStackRequest("chat", { ...body, model: "chat" }, undefined, { exactCeiling: true });
  if (!result.ok) return { ok: false, error: result.failure.error };
  const data = result.data as { usage?: { prompt_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } }; timings?: { prompt_n?: unknown; cache_n?: unknown; prompt_ms?: unknown } };
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  return { ok: true, reading: {
    prompt_n: num(data.usage?.prompt_tokens) ?? num(data.timings?.prompt_n),
    cache_n: num(data.usage?.prompt_tokens_details?.cached_tokens) ?? num(data.timings?.cache_n),
    prompt_ms: num(data.timings?.prompt_ms) } };
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
  | { ok: false; status: 400 | 503; code: "invalid_input" | "unavailable"; error: string; failureKind?: string };

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
