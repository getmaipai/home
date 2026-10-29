// VOICE-PREWARM-01: a spoken turn's first word waits on the engine reading the system message and the tool
// block. Measured 2026-10-29: the first turn after a quiet spell took 2.1 to 3.3 s to first token, the next
// one with the same prefix cached 0.6 s. The last real prefix each person sent (system message and tools,
// byte for byte) is kept in memory; when a voice session opens, one request with that prefix and a one-token
// answer puts it back in the engine's prompt cache before the person speaks. Nothing is stored on disk, no
// text reaches anyone, and a person with no recorded prefix yet is left to the boot warm-up.
import { complete, type LlmMessage, type ToolSpec } from "@/lib/llm";

interface RecordedPrefix { system: LlmMessage; tools: ToolSpec[]; model?: string; at: number }
const MAX_PEOPLE = 64;
const MIN_GAP_MS = 20_000;
const recorded = new Map<string, RecordedPrefix>();
const lastWarm = new Map<string, number>();

const keyFor = (actorId: string, surfaceClass: string) => `${actorId}:${surfaceClass}`;

export function notePrefix(actorId: string, surfaceClass: string, messages: readonly LlmMessage[], tools: readonly ToolSpec[], model?: string, now = Date.now()): void {
  const system = messages[0];
  if (!system || system.role !== "system") return;
  const key = keyFor(actorId, surfaceClass);
  recorded.delete(key);
  recorded.set(key, { system, tools: [...tools], model, at: now });
  while (recorded.size > MAX_PEOPLE) recorded.delete(recorded.keys().next().value as string);
}

/** Primes the engine's prompt cache with this person's last prefix. Best effort, never throws. Returns whether a request was sent. */
export async function prewarmPrefix(actorId: string, surfaceClass: string, now = Date.now()): Promise<boolean> {
  const key = keyFor(actorId, surfaceClass);
  const prefix = recorded.get(key);
  if (!prefix) return false;
  if (now - (lastWarm.get(key) ?? 0) < MIN_GAP_MS) return false;
  lastWarm.set(key, now);
  try {
    const result = await complete("chat", [prefix.system, { role: "user", content: "hi" }], {
      model: prefix.model, tools: prefix.tools.length > 0 ? prefix.tools : undefined, max_tokens: 1, exactCeiling: true, thinking: false, dropReasoning: true,
    });
    return result.ok;
  } catch {
    return false;
  }
}

export function __resetPrefixPrewarmForTests(): void { recorded.clear(); lastWarm.clear(); }
