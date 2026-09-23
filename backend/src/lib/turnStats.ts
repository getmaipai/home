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
  /** ENGINE-CONTRACT-02 ("U6: the flip verdict" regression A): the
   * engine's own raw `arguments` string for the call this generation's
   * own verification looked at (a websearch call, forced or offered),
   * kept beside the parsed args so a parse failure and a literal `{}`
   * are told apart on the record - `null` when no such call was made
   * this generation. */
  toolCallRawArgs?: string | null;
  /** ENGINE-CONTRACT-03 (dev.md "U6 rerun ruling" (a)): true when this
   * generation's own tool call came from the model writing the wire's
   * {name, arguments} shape as plain text (llm.ts's envelopeToolCall())
   * rather than through the engine's real tool-call field - a wire
   * normalization the trace counts, not a language rule. */
  envelopeParsed?: boolean;
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
    // ENGINE-CONTRACT-01/02: llama-server's own OpenAI-shaped
    // usage.prompt_tokens_details.cached_tokens is the field the live
    // diagnosis's own bench read (data-scratch/omlx-vs-llama/results.md)
    // - preferred here the same "usage then timings" way prompt_n and
    // predicted_n already fall back, so a required-miss can be read by
    // cache state straight off the stored generation record.
    cache_n: finite(gen.stats?.usage?.prompt_tokens_details?.cached_tokens) ?? finite(gen.stats?.timings?.cache_n),
    prompt_ms: finite(gen.stats?.timings?.prompt_ms),
    predicted_n: finite(gen.stats?.usage?.completion_tokens) ?? finite(gen.stats?.timings?.predicted_n),
    predicted_ms: finite(gen.stats?.timings?.predicted_ms),
    request_sent_ms: gen.requestSentMs,
    first_delta_ms: gen.firstDeltaMs,
    tool_call_raw_args: gen.toolCallRawArgs ?? null,
    envelope_parsed: gen.envelopeParsed ?? false,
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
  // ENGINE-CONTRACT-01/02: the same usage-then-timings preference
  // projectGeneration() already uses - a review caught this summary
  // still reading only timings.cache_n, so an engine response that
  // reports usage.prompt_tokens_details.cached_tokens but omits or
  // zeroes timings.cache_n (the exact gap the fallback exists for)
  // would show a real cache hit on the last generation's own record
  // while this turn-level summary (rendered in the chat UI's own
  // "Cache reused"/"Cache reuse %") stayed at zero, contradicting it.
  const cacheTokens = finite(stream?.usage?.prompt_tokens_details?.cached_tokens) ?? finite(stream?.timings?.cache_n);
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
