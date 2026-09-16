import type { ChatCompletionStreamStats } from "@maipai/spec/llm/ts/client.js";
import type { EngineIdentity } from "@/lib/engineIdentity";
import { formatEngineIdentity } from "@/lib/engineIdentity";
import type { TurnTimings } from "@/lib/turnContext";
import type { TurnStats } from "@/wire";

export type { TurnStats } from "@/wire";

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export function buildTurnStats(
  stream: ChatCompletionStreamStats | null | undefined,
  timings: TurnTimings,
  startedAt: number,
  finishedAt: number,
  identity: EngineIdentity | null | undefined,
): TurnStats {
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
  };
}
