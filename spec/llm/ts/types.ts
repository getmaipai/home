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
