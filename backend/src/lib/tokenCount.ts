// THIN-3B (rules 2 and 4): the one token counter. Every count Home uses to
// size a prompt comes from the chat engine's own template render and
// tokenizer, never a characters-per-token estimate: through the Stack's
// POST /v1/tokenize when chat runs on the Stack, or the engine's own
// /apply-template and /tokenize through the spec client when a test or a
// bench points Home at an engine directly. A count is taken on exactly the
// messages the engine will receive (credentials already redacted, guard
// notes already substituted by the caller), tools included when the turn
// offers them.
//
// Counts are cached by content (the same messages and tools always render
// to the same tokens on one model) and per engine identity, so a repeated
// count costs no call.
import { createHash } from "node:crypto";
import { isStackRoleEnabled, getStackClient } from "@/lib/stackEngine";
import { getChatClient } from "@/lib/llmSupervisor";
import { toToolDefinition, type LlmMessage, type ToolSpec } from "@/lib/llm";
import { formatEngineIdentity } from "@/lib/engineIdentity";

const COUNT_CACHE_MAX = 4000;
// A count sits on the turn's path before the model is asked, so it is
// bounded tightly (a review): a hung engine costs this much once, then the
// counter stops asking for COUNT_FAILURE_BACKOFF_MS and every caller takes
// its named minimum at once.
const COUNT_TIMEOUT_MS = 3_000;
const COUNT_FAILURE_BACKOFF_MS = 30_000;
const cache = new Map<string, number>();
// The engine that produced the cached counts. A count from a different
// model (a swap on the Stack) clears the cache, so a stale tokenizer never
// sizes a window (a review: the household setting can lag the Stack). The
// check runs on a miss; every turn's first window probe holds the newest
// exchange and so misses, which clears the cache before any later probe
// of that turn reads it.
let cachedIdentity: string | null = null;
let failedUntil = 0;

function cacheKey(messages: readonly LlmMessage[], tools: readonly ToolSpec[] | undefined): string {
  return createHash("sha256").update(JSON.stringify([messages, tools ?? null])).digest("hex");
}

function remember(key: string, count: number, identity: string): void {
  if (identity !== cachedIdentity) {
    cache.clear();
    cachedIdentity = identity;
  }
  if (cache.size >= COUNT_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, count);
}

function fail(reason: string): null {
  const now = Date.now();
  // One log line per back-off window, never one per turn.
  if (now >= failedUntil) console.warn(`[tokenCount] the chat engine could not count tokens (${reason}); the window falls back to its named minimum`);
  failedUntil = now + COUNT_FAILURE_BACKOFF_MS;
  return null;
}

/** The engine's own count of `messages` rendered with its chat template
 * (no generation prompt), the tools block included when `tools` is given.
 * Null when the engine cannot count (no route, offline, an error, a
 * timeout, or a recent failure): the caller falls back to its named
 * minimum, never to an estimate. */
export async function countTokens(messages: readonly LlmMessage[], opts: { tools?: readonly ToolSpec[]; signal?: AbortSignal } = {}): Promise<number | null> {
  if (messages.length === 0) return 0;
  const key = cacheKey(messages, opts.tools);
  const cached = cache.get(key);
  if (cached !== undefined) {
    // Refresh recency so a long conversation's live entries stay cached.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  if (Date.now() < failedUntil) return null;
  const tools = opts.tools && opts.tools.length > 0 ? opts.tools.map(toToolDefinition) : undefined;
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(COUNT_TIMEOUT_MS)]) : AbortSignal.timeout(COUNT_TIMEOUT_MS);
  try {
    let count: number;
    let identity: string;
    if (isStackRoleEnabled("chat")) {
      const reply = await getStackClient().tokenize({ model: "chat", messages: messages as unknown as Array<{ role: string }>, timeout_ms: COUNT_TIMEOUT_MS, ...(tools ? { tools } : {}) }, { signal });
      count = reply.data.count;
      identity = formatEngineIdentity(reply.identity);
    } else {
      const client = await getChatClient();
      count = await Promise.race([
        client.countTokens({ messages: messages as unknown as Array<Record<string, unknown>>, ...(tools ? { tools } : {}) }),
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("the count timed out")), { once: true })),
      ]);
      identity = "direct";
    }
    if (!Number.isInteger(count) || count < 0) return fail("an invalid count");
    remember(key, count, identity);
    return count;
  } catch (err) {
    if (opts.signal?.aborted) return null;
    return fail((err as Error).message);
  }
}

/** Test-only: forget every cached count. */
export function __clearTokenCountCacheForTests(): void {
  cache.clear();
  cachedIdentity = null;
  failedUntil = 0;
}
