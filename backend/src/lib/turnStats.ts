import type { ChatCompletionStreamStats } from "@maipai/spec/llm/ts/client.js";
import type { EngineIdentity } from "@/lib/engineIdentity";
import { formatEngineIdentity } from "@/lib/engineIdentity";
import type { TurnTimings } from "@/lib/turnContext";
import type { TurnStats, TurnGeneration } from "@/wire";

export type { TurnStats } from "@/wire";

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

// LAT-00: the shape buildTurnStats() actually needs from a generation -
// deliberately structural (not turnEngine.ts's own GenerationRecord
// import) so this file never imports from turnEngine.ts, which already
// imports this one.
export interface GenerationInput {
  reason: string;
  thinking: boolean;
  maxTokens: number | null;
  requestSentMs: number;
  firstDeltaMs: number | null;
  stats: ChatCompletionStreamStats | null | undefined;
}

function projectGeneration(gen: GenerationInput): TurnGeneration {
  // Code review: the same usage-then-timings fallback the turn-level
  // summary below already uses for these two fields - an engine response
  // that carries `usage` but not `timings` (real for a non-streaming or
  // differently-configured backend) would otherwise show null here while
  // the summary for the identical call reports real numbers.
  return {
    reason: gen.reason,
    thinking: gen.thinking,
    max_tokens: gen.maxTokens,
    prompt_n: finite(gen.stats?.usage?.prompt_tokens) ?? finite(gen.stats?.timings?.prompt_n),
    cache_n: finite(gen.stats?.timings?.cache_n),
    prompt_ms: finite(gen.stats?.timings?.prompt_ms),
    predicted_n: finite(gen.stats?.usage?.completion_tokens) ?? finite(gen.stats?.timings?.predicted_n),
    predicted_ms: finite(gen.stats?.timings?.predicted_ms),
    request_sent_ms: gen.requestSentMs,
    first_delta_ms: gen.firstDeltaMs,
  };
}

export function buildTurnStats(
  generations: readonly GenerationInput[],
  timings: TurnTimings,
  startedAt: number,
  finishedAt: number,
  identity: EngineIdentity | null | undefined,
  thinking: boolean | undefined,
): TurnStats {
  // The summary fields below have always meant "the generation that
  // actually produced what the household heard" - the LAST one a turn
  // made, same as the single `stream` this function used to take before
  // LAT-00 gave every generation its own record. Unchanged meaning, now
  // read from the end of the list instead of a value a caller
  // overwrote on every new generation.
  const stream = generations[generations.length - 1]?.stats;
  const promptTokens = finite(stream?.usage?.prompt_tokens) ?? finite(stream?.timings?.prompt_n);
  const predictedTokens = finite(stream?.usage?.completion_tokens) ?? finite(stream?.timings?.predicted_n);
  const predictedMs = finite(stream?.timings?.predicted_ms);
  const reportedSpeed = finite(stream?.timings?.predicted_per_second);
  const tokensPerSecond = reportedSpeed ?? (predictedTokens !== null && predictedMs !== null && predictedTokens > 0 && predictedMs > 0 ? predictedTokens / predictedMs * 1000 : null);
  const cacheTokens = finite(stream?.timings?.cache_n);
  const cacheDenominator = cacheTokens !== null && promptTokens !== null ? cacheTokens + promptTokens : 0;
  const firstToken = finite(timings.first_token_ms);
  const totalTime = finite(finishedAt - startedAt);
  return {
    prompt_tokens: promptTokens,
    predicted_tokens: predictedTokens,
    tokens_per_second: tokensPerSecond,
    time_to_first_token_ms: firstToken,
    total_time_ms: totalTime !== null && totalTime >= 0 ? totalTime : null,
    context_tokens: promptTokens,
    context_used_percent: null,
    cache_reuse_tokens: cacheTokens,
    cache_reuse_percent: cacheDenominator > 0 ? cacheTokens! / cacheDenominator * 100 : null,
    engine: identity ? formatEngineIdentity(identity) : null,
    stop_reason: stream?.stopReason ?? null,
    thinking: thinking === true,
    generations: generations.map(projectGeneration),
  };
}
