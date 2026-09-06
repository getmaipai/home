// The model role port (platform plan 4.11): "Roles, not model names, in
// code." Only `chat` is implemented this pass; every other role is a
// real, named gap, not a silently missing one. See spec/llm/README.md for
// the full scope and why `host.llm.complete` in packageHost.ts still
// isn't wired to this (a real, separate architectural gap: the Host RPC
// boundary is synchronous, this port is inherently async).
//
// `embed` (2026-09-04) is now real too, but through its own dedicated
// embed() function below, not complete()/IMPLEMENTED_ROLES: a chat
// completion's request shape (a messages array) and an embedding
// request's shape (a batch of plain strings) have nothing in common, so
// forcing embed through validate()'s chat-shaped checks would be the
// wrong kind of code reuse, not real sharing.
import { getChatClient } from "@/lib/llmSupervisor";
import { getEmbedClient } from "@/lib/embedSupervisor";
import { tryConsume } from "@/lib/rateLimiter";
import { LlmClientError } from "@maipai/spec/llm/ts/client.js";
import type { ChatRole, ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

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
   * (lib/memoryJudge.ts) is the first real caller. Ignored (overridden)
   * when `tools` is also set below - offering tools always wins. */
  response_format?: ChatCompletionRequest["response_format"];
  /** Tier 2 native tool calling (step 2, session-c-brain-and-voice.md).
   * Offering `tools` builds its OWN `response_format` grammar (a JSON
   * array of `{tool, args}`, `args` shaped by the tool's own schema) -
   * llama-server compiles any JSON Schema to GBNF, so the model's own
   * tool-calling ability matters less than the grammar making its call
   * valid by construction (docs/dev.md's own words on this). Capped at
   * two calls per turn (turnEngine.ts's own pre-filter picks which
   * candidates to offer at all) - two independent calls, never a
   * chained pipeline. */
  tools?: ToolSpec[];
  /** "required" disallows an empty array (the model MUST propose
   * something from `tools`); "auto" (the default) allows one, meaning
   * "none of these fit, answer normally instead." */
  tool_choice?: "auto" | "required";
}

/** One package (or, once D's `exposes.queries` lands, one typed query on
 * a package) offered as a Tier 2 candidate. `args` is that candidate's
 * own JSON Schema (manifest.args unchanged - the exact shape
 * `runPlugin()` already validates against, reused here, not
 * reinvented). */
export interface ToolSpec {
  id: string;
  description: string;
  args: unknown;
}

export interface ToolCall {
  tool: string;
  args: unknown;
}

/** A JSON array, one entry per proposed call, `args` constrained by
 * WHICHEVER tool's schema `tool` names (a discriminated `oneOf`, not a
 * single flat shape - each candidate's own `args` schema can differ
 * completely, and llama-server's grammar compiler handles `oneOf` fine).
 * `minItems: 0` under "auto" is what actually lets the model decline: an
 * empty array is a valid, complete reply under this grammar, not an
 * error. */
function toolCallSchema(tools: readonly ToolSpec[], toolChoice: "auto" | "required"): Record<string, unknown> {
  return {
    type: "array",
    minItems: toolChoice === "required" ? 1 : 0,
    maxItems: 2,
    items: {
      oneOf: tools.map((t) => ({
        type: "object",
        additionalProperties: false,
        required: ["tool", "args"],
        properties: { tool: { const: t.id }, args: t.args },
      })),
    },
  };
}

/** Never trusts the grammar blindly (llama.cpp's lazy grammars still let
 * a malformed call through on recent Qwen builds, upstream issue 24807 -
 * this step's own text names it): `undefined` means the reply didn't
 * parse as SOME array of `{tool, args}` objects naming one of the
 * offered ids at all - a caller treats that as "ask again," never as an
 * empty (= "no tool needed") decision, and never runs anything from it.
 * A tool's OWN `args` shape is deliberately NOT re-validated here -
 * `runPlugin()` already does that with the real ajv-compiled schema
 * (the exact mechanism `deterministicArgs()` can't reuse, and the one
 * "verify every call... before acting" is really asking for); catching
 * the same class of error twice, differently, would be the second,
 * worse copy of that check, not real defense in depth. */
function parseToolCalls(raw: string, tools: readonly ToolSpec[], toolChoice: "auto" | "required"): ToolCall[] | undefined {
  const knownIds = new Set(tools.map((t) => t.id));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length > 2) return undefined;
  // A code review (2026-09-06) found this didn't re-check `required`'s
  // own minItems:1 - the exact "don't trust the grammar blindly" gap
  // this function's own header warns about, just for the other bound
  // instead of the array-length ceiling: an empty array under
  // `tool_choice: "required"` would have been accepted as a real "no
  // tool needed" decision, which "required" specifically forbids.
  if (parsed.length === 0 && toolChoice === "required") return undefined;
  const calls: ToolCall[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || typeof (entry as { tool?: unknown }).tool !== "string") return undefined;
    const tool = (entry as { tool: string }).tool;
    if (!knownIds.has(tool)) return undefined;
    calls.push({ tool, args: (entry as { args?: unknown }).args });
  }
  return calls;
}

export interface LlmCompleteValue {
  text: string;
  model: string;
  /** Only set (even to `[]`) when `tools` was offered for this call -
   * see parseToolCalls()'s own comment for what `undefined` vs `[]`
   * means. */
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
    const response_format =
      tools && tools.length > 0
        ? { type: "json_schema" as const, json_schema: { name: "tool_calls", schema: toolCallSchema(tools, tool_choice ?? "auto") } }
        : rest.response_format;
    const response = await client.chatComplete({
      model: "chat",
      messages,
      ...rest,
      response_format,
      chat_template_kwargs: { enable_thinking: !!thinking },
    });
    const choice = response.choices[0];
    if (!choice) {
      return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    }
    const tool_calls = tools && tools.length > 0 ? parseToolCalls(choice.message.content, tools, tool_choice ?? "auto") : undefined;
    return { ok: true, value: { text: choice.message.content, model: response.model, ...(tool_calls !== undefined ? { tool_calls } : {}) } };
  } catch (err) {
    const message = err instanceof LlmClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${message}` };
  }
}

export type LlmStreamStartResult =
  | { ok: true; tokens: AsyncGenerator<string, void, void> }
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

  const { thinking, ...rest } = opts;
  async function* tokens(): AsyncGenerator<string, void, void> {
    try {
      for await (const delta of client!.chatCompleteStream(
        {
          model: "chat",
          messages,
          ...rest,
          chat_template_kwargs: { enable_thinking: !!thinking },
        },
        signal,
      )) {
        yield delta;
      }
    } catch (err) {
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
