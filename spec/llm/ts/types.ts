// The wire contract for the `chat` model role (platform plan 4.11):
// "OpenAI-compatible HTTP for text and embeddings... chat completions
// with streaming, tools, JSON schema, grammar, chat_template_kwargs."
// This file has the non-streaming chat-completions subset only (see
// spec/llm/README.md for what's deferred and why).
//
// Deliberately NOT a spec/schemas/*.schema.json record with generated
// Zod/Pydantic bindings, unlike Person/MemoryRecord/SafetyResult: this
// isn't a MaiPai-defined record type we store or sync, it's a mirror of
// llama-server's own OpenAI-compatible HTTP surface, an external wire
// contract. Hand-written types are the same choice spec/safety/ts and
// spec/interpreters/ts made for logic that isn't a stored shape.

export type ChatRole = "system" | "user" | "assistant";

// Fix E (docs/dev.md's "Chat reliability" - native tool calling, one
// round trip): llama-server's own OpenAI-compatible tool-calling shape,
// confirmed live against the real pinned engine (b10797) and Qwen3 8B
// Instruct, 2026-09-07 - both non-streaming (`message.tool_calls`) and
// streaming (`delta.tool_calls`, argument fragments concatenated per
// index) round-tripped exactly as documented here, no `--jinja` flag
// even required (this build already defaults it on; engineAutotune.ts
// still passes it explicitly per E2, for a future build where it isn't).
export interface ToolFunctionDef {
  name: string;
  description: string;
  /** A JSON Schema for this tool's own call arguments - the manifest's
   * `args` field, unchanged (turnEngine.ts maps ToolSpec.args here
   * directly, no reshaping). */
  parameters: unknown;
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunctionDef;
}

export interface ToolCallFunction {
  name: string;
  /** A JSON-encoded string, exactly as the model emits it - never
   * pre-parsed here (this is a wire mirror, not a validated record): the
   * caller (llm.ts) parses it, the same "don't trust the model's own
   * JSON blindly" posture the deleted grammar-based parseToolCalls() had
   * for its own array-of-calls shape. */
  arguments: string;
}

export interface ToolCallWire {
  id: string;
  type: "function";
  function: ToolCallFunction;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Only ever present on an ASSISTANT message this client itself just
   * received (a tool-calling reply) - never sent as part of a request's
   * own `messages` array this pass (spec/llm/README.md's own "deferred"
   * scope): a tool result answers the turn directly (turnEngine.ts's
   * resolveToolCalls()), it's never fed back to the model for a second
   * completion in the same turn, so there's no `role: "tool"` message
   * shape to round-trip yet either. */
  tool_calls?: ToolCallWire[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Forwarded verbatim into the model's Jinja chat template. This
   * pass's one real use (llm.ts's `thinking` option): Qwen3's template
   * reads `enable_thinking` to switch its hybrid thinking/non-thinking
   * mode per request, overriding llmSupervisor.ts's spawn-time
   * `--chat-template-kwargs` default. */
  chat_template_kwargs?: Record<string, unknown>;
  /** Always set explicitly by client.ts (`false` for chatComplete(),
   * `true` for chatCompleteStream()), never left to llama-server's own
   * default - the two methods read completely different response shapes
   * (one JSON body vs. SSE lines), so which one a caller gets can never
   * be ambiguous. */
  stream?: boolean;
  /** OpenAI's structured-output param (session-a-intelligence.md step 6:
   * "Add response_format/json_schema support... if it is not there -
   * llama-server supports it"): `json_schema` grammar-constrains every
   * token llama-server samples to a valid instance of the given schema,
   * the mechanism the memory judge (lib/memoryJudge.ts) depends on for a
   * small model to reliably return parseable, correctly-shaped JSON.
   * `json_object` is the looser "valid JSON, any shape" variant, kept
   * for completeness though nothing in this codebase uses it yet. Client
   * passthrough only (client.ts already spreads the whole request) - no
   * client code changes needed to add this. */
  response_format?: { type: "json_object" } | JsonSchemaResponseFormat;
  /** Fix E: native tool calling. Offering `tools` lets the model answer
   * with `tool_calls` instead of (never alongside - confirmed live) plain
   * content; omitted entirely (never sent as `[]`) when a turn has
   * nothing worth offering, so an ordinary chat request's own prompt-cache
   * hit rate is unaffected by tool-calling ever existing. */
  tools?: ToolDefinition[];
  /** "auto" (the default) lets the model decline and answer normally;
   * "required" disallows that; "none" is never used from this codebase
   * today (mirrored from the wire contract for completeness) - deferred
   * omitted, not sent, whenever `tools` itself is omitted. */
  tool_choice?: "none" | "auto" | "required";
}

export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

export interface ModelInfo {
  id: string;
}

// The streaming half of the chat-completions subset (2026-09-04): real
// token-by-token generation, needed so a reply can start being spoken
// (and shown) before the model finishes writing it - see
// spec/voice/README.md's "what Jesse actually meant by streamed." Confirmed
// live against a real llama-server (`stream: true`, SSE `data: {...}`
// lines terminated by `data: [DONE]`): each chunk's `delta.content` is the
// next slice of text, empty/absent on the first chunk (role-only) and the
// last (finish_reason only).
// Fix E: one fragment of one proposed call, keyed by `index` (multiple
// simultaneous calls stream interleaved, one index each - confirmed live
// against the real engine, 2026-09-07). `id`/`function.name` arrive once,
// on that call's own first fragment; every fragment after that (for the
// same index) carries only the next slice of `function.arguments` to
// concatenate - never a complete, independently-parseable JSON string on
// its own until the stream ends.
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface ChatCompletionChunkDelta {
  role?: ChatRole;
  content?: string | null;
  tool_calls?: ToolCallDelta[];
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

// The embeddings half of "OpenAI-compatible HTTP for text and
// embeddings" this file's own header names (4.11's `embed` role,
// 2026-09-04). `input` matches OpenAI's own `/v1/embeddings` shape (a
// single string or a batch); llama-server's real implementation accepts
// both when started with `--embedding`.
export interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

export interface EmbeddingData {
  index: number;
  embedding: number[];
}

export interface EmbeddingResponse {
  model: string;
  data: EmbeddingData[];
  usage?: ChatCompletionUsage;
}
