import { completeBackground, type LlmMessage } from "@/lib/llm";
import type { Completer } from "./core";

export function hubCompleter(): Completer {
  return (messages) => completeBackground(messages as LlmMessage[], { max_tokens: 1800, temperature: 0.2, thinking: false, dropReasoning: true });
}
