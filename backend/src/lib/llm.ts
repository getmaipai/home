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
   * (lib/memoryJudge.ts) is the first real caller. */
  response_format?: ChatCompletionRequest["response_format"];
}

export interface LlmCompleteValue {
  text: string;
  model: string;
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
    const { thinking, ...rest } = opts;
    const response = await client.chatComplete({
      model: "chat",
      messages,
      ...rest,
      chat_template_kwargs: { enable_thinking: !!thinking },
    });
    const choice = response.choices[0];
    if (!choice) {
      return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    }
    return { ok: true, value: { text: choice.message.content, model: response.model } };
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
export async function startCompleteStream(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
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
      for await (const delta of client!.chatCompleteStream({
        model: "chat",
        messages,
        ...rest,
        chat_template_kwargs: { enable_thinking: !!thinking },
      })) {
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
