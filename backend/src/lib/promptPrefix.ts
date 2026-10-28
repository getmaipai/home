import type { LlmMessage, ToolSpec } from "@/lib/llm";

/** What one model request shares with the one before it in the same conversation: sizes and a part label, never text. */
export interface PromptPrefix {
  request_chars: number;
  /** Leading characters identical to the previous request: the most the engine's prompt cache could reuse. */
  shared_chars: number;
  /** Where the request first differs ("tools", "message 3 (system)"); null when the previous request is a prefix of this one. */
  first_diff: string | null;
  /** False for the first request seen for this conversation since the hub started. */
  had_previous: boolean;
}

const MAX_CONVERSATIONS = 50;
const previous = new Map<string, string[]>();

/** The parts in the order the engine's chat template lays them out: tools first, then each message. */
function partsOf(messages: readonly LlmMessage[], tools: readonly ToolSpec[]): string[] {
  return [JSON.stringify(tools), ...messages.map((m) => JSON.stringify(m))];
}

function labelOf(index: number, messages: readonly LlmMessage[]): string {
  return index === 0 ? "tools" : `message ${index - 1} (${String(messages[index - 1]?.role ?? "unknown")})`;
}

/** Compares this request with the last one for the conversation, then remembers it. Held in memory only. */
export function comparePrompt(conversationId: string, messages: readonly LlmMessage[], tools: readonly ToolSpec[]): PromptPrefix {
  const parts = partsOf(messages, tools);
  const before = previous.get(conversationId);
  previous.delete(conversationId);
  previous.set(conversationId, parts);
  while (previous.size > MAX_CONVERSATIONS) previous.delete(previous.keys().next().value as string);
  const request_chars = parts.reduce((n, p) => n + p.length, 0);
  if (!before) return { request_chars, shared_chars: 0, first_diff: null, had_previous: false };
  let shared = 0;
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i]!;
    const b = before[i];
    if (b === undefined) return { request_chars, shared_chars: shared, first_diff: null, had_previous: true };
    if (a === b) { shared += a.length; continue; }
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    return { request_chars, shared_chars: shared + k, first_diff: labelOf(i, messages), had_previous: true };
  }
  return { request_chars, shared_chars: shared, first_diff: null, had_previous: true };
}
