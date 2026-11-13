// VOICE-PREWARM-01: a spoken turn's first word waits on the engine reading the system message and the tool
// block. Measured 2026-10-29: the first turn after a quiet spell took 2.1 to 3.3 s to first token, the next
// one with the same prefix cached 0.6 s. The last real prefix each person sent (system message and tools,
// byte for byte) is kept in memory; when a voice session opens, one request with that prefix and a one-token
// answer puts it back in the engine's prompt cache before the person speaks. Nothing is stored on disk, no
// text reaches anyone, and a person with no recorded prefix yet is left to the boot warm-up.
import { complete, StackStreamError, type LlmMessage, type ToolSpec } from "@/lib/llm";
import { recordPrewarmTiming } from "@/lib/voiceTiming";
import { StackError } from "@/lib/stack/errors";
import { activeTurnCount } from "@/lib/turnActivity";

interface RecordedPrefix { system: LlmMessage; tools: ToolSpec[]; model?: string; at: number }
const MAX_PEOPLE = 64;
const MIN_GAP_MS = 20_000;
const recorded = new Map<string, RecordedPrefix>();
const lastWarm = new Map<string, number>();
const conversationWarms = new Map<string, AbortController>();

const keyFor = (actorId: string, surfaceClass: string) => `${actorId}:${surfaceClass}`;
export function prewarmFailureReason(error?: unknown): "engine_busy" | "engine_error" | "timeout" | "other" {
  const detail = error instanceof Error ? error.message.toLowerCase() : "";
  if (error instanceof StackError && error.kind === "timeout" || detail.includes("timeout") || detail.includes("timed out")) return "timeout";
  if (error instanceof StackError && error.status === 429 || error instanceof StackStreamError && error.facts.http_status === 429 || detail.includes("busy") || detail.includes("locked") || detail.includes("in use")) return "engine_busy";
  if (error instanceof StackStreamError || detail.includes("engine") || detail.includes("stack")) return "engine_error";
  return "other";
}

export function notePrefix(actorId: string, surfaceClass: string, messages: readonly LlmMessage[], tools: readonly ToolSpec[], model?: string, now = Date.now()): void {
  const system = messages[0];
  if (!system || system.role !== "system") return;
  const key = keyFor(actorId, surfaceClass);
  recorded.delete(key);
  recorded.set(key, { system, tools: [...tools], model, at: now });
  while (recorded.size > MAX_PEOPLE) recorded.delete(recorded.keys().next().value as string);
}

/** Primes the engine's prompt cache with this person's last prefix. Best effort, never throws. Returns whether a request was sent. */
export async function prewarmPrefix(actorId: string, surfaceClass: string, now = Date.now(), force = false): Promise<boolean> {
  const key = keyFor(actorId, surfaceClass);
  const prefix = recorded.get(key);
  if (!prefix) return false;
  if (!force && now - (lastWarm.get(key) ?? 0) < MIN_GAP_MS) return false;
  lastWarm.set(key, now);
  try {
    const result = await complete("chat", [prefix.system, { role: "user", content: "hi" }], {
      model: prefix.model, tools: prefix.tools.length > 0 ? prefix.tools : undefined, max_tokens: 1, exactCeiling: true, thinking: false, dropReasoning: true,
    });
    if (!result.ok) recordPrewarmTiming(actorId, "failed", Date.now() - now, undefined, undefined, prewarmFailureReason(new Error(result.reason ?? "engine error")));
    return result.ok;
  } catch (error) {
    recordPrewarmTiming(actorId, "failed", Date.now() - now, undefined, undefined, prewarmFailureReason(error));
    return false;
  }
}

// CONVO-PREWARM-03 (measured 2026-11-12 against Splash 1.6.1, backend/scripts/bench/engine-resume-probe.ts): the chat engine
// resumes a request only from the END of an earlier request (its prompt rounded down to a 32-token block, or a 4096-token
// checkpoint), never from a shared prefix that ends earlier. So a warm helps the next turn only when the warm's whole prompt is a
// byte-for-byte prefix of that turn's prompt. The idle fold (summaryRefresh.ts, 20 s after the turn) rewrites the summary line
// and moves the window anchor AFTER the post-turn warm ran, which made every live turn of a long conversation fall back to the
// session-open warm (cache_n stuck at 2,048 while the window read cold). The warm now keeps its builder, runs again when the
// conversation folds, and the turn reports whether its prompt extended the last warm (`prewarm` on the generation record).
interface ConversationWarm { actorId: string; surfaceClass: string; build: () => Promise<readonly LlmMessage[]>; parts: string[]; at: number }
// CONVO-PREWARM-04 (2026-11-12): every warm leaves one more kept state in the engine (about a third of a gigabyte per 2,600-token
// prompt on Splash 1.6.1, never evicted by time), and the fold warm ran again for every conversation warmed since the hub
// started. So the household keeps at most MAX_WARMS conversations warm (the oldest dropped when a newer one is warmed), and a
// conversation is warmed again after a fold only within WARM_TTL_MS of its last warm; an older one is dropped and left to its next
// turn. The engine's own budget (Stack SPLASH-MEM-01) bounds what Home cannot see.
const MAX_WARMS = 8;
const WARM_TTL_MS = 30 * 60_000;
const conversationWarmed = new Map<string, ConversationWarm>();

/** The request's parts in the order the engine lays them out: the tools block, then each message (one JSON string each). No text leaves this process. */
function promptParts(messages: readonly LlmMessage[], tools: readonly ToolSpec[]): string[] {
  return [JSON.stringify(tools), ...messages.map((m) => JSON.stringify(m))];
}

/** Warms the persisted conversation prefix after its final spoken audio was handed off. `window` is the replay the next turn
 * sends after the system message, or a builder of it (kept, so a fold can warm the conversation again); `conversationId` keys
 * the warm for the fold and for the next turn's hit check. */
export async function prewarmConversation(actorId: string, surfaceClass: string, window: readonly LlmMessage[] | (() => Promise<readonly LlmMessage[]>), conversationId?: string): Promise<boolean> {
  if (surfaceClass !== "spoken") return false;
  const key = keyFor(actorId, surfaceClass);
  const prefix = recorded.get(key);
  if (!prefix || conversationWarms.has(actorId)) return false;
  const build = typeof window === "function" ? window : async () => window;
  const controller = new AbortController();
  conversationWarms.set(actorId, controller);
  const started = Date.now();
  try {
    const replay = await build();
    if (replay.length === 0 || controller.signal.aborted) return false;
    const messages = [prefix.system, ...replay];
    const tools = prefix.tools.length > 0 ? prefix.tools : [];
    if (conversationId) {
      conversationWarmed.delete(conversationId);
      conversationWarmed.set(conversationId, { actorId, surfaceClass, build, parts: promptParts(messages, tools), at: started });
      while (conversationWarmed.size > MAX_WARMS) conversationWarmed.delete(conversationWarmed.keys().next().value as string);
    }
    const result = await complete("chat", messages, {
      model: prefix.model, tools: tools.length > 0 ? tools : undefined,
      max_tokens: 1, exactCeiling: true, thinking: false, dropReasoning: true, signal: controller.signal,
    });
    recordPrewarmTiming(actorId, controller.signal.aborted ? "aborted" : result.ok ? "done" : "failed", Date.now() - started, result.ok ? result.value.prompt_n : undefined, result.ok ? result.value.cache_n : undefined, result.ok || controller.signal.aborted ? undefined : prewarmFailureReason(new Error(result.reason ?? "engine error")));
    return result.ok;
  } catch (error) { recordPrewarmTiming(actorId, controller.signal.aborted ? "aborted" : "failed", Date.now() - started, undefined, undefined, controller.signal.aborted ? undefined : prewarmFailureReason(error)); return false; }
  finally { if (conversationWarms.get(actorId) === controller) conversationWarms.delete(actorId); }
}

/** The conversation's window changed after its warm (a fold stored a new summary and moved the anchor): warm it again from the
 * kept builder, so the next turn still extends a whole earlier request. Skipped while a turn runs (the turn aborts warms anyway)
 * and when the window did not change. Best effort, never throws. */
export async function rewarmConversation(conversationId: string, turnActive: () => boolean = () => activeTurnCount() > 0, now = Date.now()): Promise<boolean> {
  const warm = conversationWarmed.get(conversationId);
  if (!warm || turnActive()) return false;
  if (now - warm.at > WARM_TTL_MS) { conversationWarmed.delete(conversationId); return false; }
  const prefix = recorded.get(keyFor(warm.actorId, warm.surfaceClass));
  if (!prefix) return false;
  try {
    const replay = await warm.build();
    if (turnActive()) return false;
    const parts = promptParts([prefix.system, ...replay], prefix.tools);
    if (parts.length === warm.parts.length && parts.every((part, i) => part === warm.parts[i])) return false;
  } catch { return false; }
  return prewarmConversation(warm.actorId, warm.surfaceClass, warm.build, conversationId);
}

export interface PrewarmHit {
  /** False when no conversation warm was sent for this conversation since the hub started. */
  warmed: boolean;
  /** True when the whole warmed request is a prefix of this one: the engine can resume at the warm's end. */
  hit: boolean;
  /** Where this request first differs from the warm ("tools", "message 3 (system)"); null on a hit or with no warm. */
  first_diff: string | null;
}

/** Whether this turn's first request extends the conversation's last warm. Sizes and a part label only, never text. */
export function prewarmPrefixHit(conversationId: string, messages: readonly LlmMessage[], tools: readonly ToolSpec[]): PrewarmHit {
  const warm = conversationWarmed.get(conversationId);
  if (!warm) return { warmed: false, hit: false, first_diff: null };
  const parts = promptParts(messages, tools);
  for (let i = 0; i < warm.parts.length; i++) {
    if (parts[i] === warm.parts[i]) continue;
    return { warmed: true, hit: false, first_diff: i === 0 ? "tools" : `message ${i - 1} (${String(messages[i - 1]?.role ?? "missing")})` };
  }
  return { warmed: true, hit: true, first_diff: null };
}

/** A new utterance or real turn supersedes any quiet-period cache warm. */
export function abortConversationPrewarm(actorId: string): void {
  conversationWarms.get(actorId)?.abort();
}

/** A hub that just started has recorded nothing, so the first spoken turn after every restart read the whole prompt cold (3 s to the first word,
 * measured 2026-10-29). Warm the shared start of the spoken prompt (tools block and persona text) with the default prompt, retrying while the Stack loads. */
const BOOT_WARM_TRIES = 6;
const BOOT_WARM_GAP_MS = 20_000;
export function warmSpokenPrefixAtBoot(build: () => Promise<{ system: string; tools?: ToolSpec[] }>, tries = BOOT_WARM_TRIES, gapMs = BOOT_WARM_GAP_MS, firstDelayMs = 5_000): void {
  const attempt = async (left: number): Promise<void> => {
    try {
      const { system, tools } = await build();
      notePrefix("boot", "spoken", [{ role: "system", content: system }], tools ?? []);
      if (await prewarmPrefix("boot", "spoken", Date.now(), true)) return;
    } catch { /* retry below */ }
    if (left > 1) { const timer = setTimeout(() => { void attempt(left - 1); }, gapMs); (timer as { unref?: () => void }).unref?.(); }
  };
  const first = setTimeout(() => { void attempt(tries); }, firstDelayMs);
  (first as { unref?: () => void }).unref?.();
}

export function __resetPrefixPrewarmForTests(): void { recorded.clear(); lastWarm.clear(); for (const c of conversationWarms.values()) c.abort(); conversationWarms.clear(); conversationWarmed.clear(); }
