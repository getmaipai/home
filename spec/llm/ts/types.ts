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

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
export interface ChatCompletionChunkDelta {
  role?: ChatRole;
  content?: string | null;
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
