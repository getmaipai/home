// ENGINE-CONTRACT-01 (docs/BACKLOG.md): the engine contract as a bench
// script. Sends raw OpenAI-shaped requests with fetch to
// ${MAIPAI_LLAMA_SERVER_URL}/v1/chat/completions (default
// http://127.0.0.1:8798, a side instance, never the hub's 8788) and
// judges the replies with pure functions that
// tests/engineContractJudges.test.ts drives with fixture objects. No
// engine is started by this script; the live run is a separate
// session's job.
//
// Usage: bun run scripts/bench/engine-contract.ts
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface JudgeResult {
  pass: boolean;
  reason: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function messageOf(reply: unknown): Record<string, unknown> | null {
  const root = asRecord(reply);
  const choices = Array.isArray(root?.choices) ? root.choices : null;
  return asRecord(choices?.[0]?.message);
}

export function judgeRequired(reply: unknown): JudgeResult {
  const message = messageOf(reply);
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : null;
  if (!calls || calls.length === 0) return { pass: false, reason: "no tool_calls in the reply" };
  for (const call of calls) {
    const fn = asRecord(call?.function);
    if (fn?.name === "websearch") {
      let expression: unknown;
      try {
        expression = (JSON.parse(fn.arguments as string) as Record<string, unknown>).expression;
      } catch {
        expression = undefined;
      }
      if (typeof expression === "string" && expression.length > 0) return { pass: true, reason: "websearch call with a non-empty expression" };
      return { pass: false, reason: "websearch call present but its arguments.expression is missing or empty" };
    }
  }
  return { pass: false, reason: "tool_calls present but none named websearch" };
}

export function judgeAutoNegative(reply: unknown): JudgeResult {
  const message = messageOf(reply);
  const calls = message?.tool_calls;
  const hasCalls = Array.isArray(calls) && calls.length > 0;
  const content = message?.content;
  if (hasCalls) return { pass: false, reason: "tool_calls present on an auto call that should call nothing" };
  if (typeof content !== "string" || content.length === 0) return { pass: false, reason: "no non-empty content in the reply" };
  return { pass: true, reason: "no tool_calls and non-empty content" };
}

export function judgeReasoningSeparated(reply: unknown): JudgeResult {
  const message = messageOf(reply);
  const reasoning = message?.reasoning_content;
  const content = message?.content;
  if (typeof reasoning !== "string" || reasoning.length === 0) return { pass: false, reason: "reasoning_content is missing or empty" };
  if (typeof content !== "string" || content.length === 0) return { pass: false, reason: "content is missing or empty" };
  if (content.includes("<think>")) return { pass: false, reason: "content contains <think>; reasoning is not separated" };
  return { pass: true, reason: "reasoning_content and content both present, no <think> in content" };
}

export function judgeTiming(reply: unknown): JudgeResult {
  const root = asRecord(reply);
  const timings = asRecord(root?.timings);
  const promptMs = timings?.prompt_ms;
  const predictedMs = timings?.predicted_ms;
  if (typeof promptMs === "number" && Number.isFinite(promptMs) && typeof predictedMs === "number" && Number.isFinite(predictedMs)) {
    return { pass: true, reason: "timings.prompt_ms and timings.predicted_ms are finite numbers" };
  }
  const usage = asRecord(root?.usage);
  const completionTokens = usage?.completion_tokens;
  if (typeof completionTokens === "number" && Number.isFinite(completionTokens)) {
    return { pass: true, reason: "usage.completion_tokens is a finite number (the timing floor)" };
  }
  return { pass: false, reason: "neither timings.prompt_ms/predicted_ms nor usage.completion_tokens is a finite number" };
}

export function judgeAbort(followupTtftMs: number, warmShortMedianMs: number): JudgeResult {
  if (followupTtftMs <= warmShortMedianMs + 200) return { pass: true, reason: `followup TTFT ${followupTtftMs} ms is within ${warmShortMedianMs + 200} ms of the warm-short median` };
  return { pass: false, reason: `followup TTFT ${followupTtftMs} ms exceeds the warm-short median (${warmShortMedianMs} ms) by more than 200 ms` };
}

export function cacheState(reply: unknown): { cached_tokens: number; prompt_tokens: number } {
  const root = asRecord(reply);
  const usage = asRecord(root?.usage);
  const details = asRecord(usage?.prompt_tokens_details);
  const cached = typeof details?.cached_tokens === "number" && Number.isFinite(details.cached_tokens) ? details.cached_tokens : 0;
  const prompt = typeof usage?.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0;
  return { cached_tokens: cached, prompt_tokens: prompt };
}

const TOOL_SPEC = {
  type: "function",
  function: {
    name: "websearch",
    description: "Search the web.",
    parameters: {
      type: "object",
      required: ["expression"],
      properties: {
        expression: { type: "string" },
        category: { type: "string", enum: ["images"] },
        read_page: { type: "boolean" },
      },
    },
  },
};

interface RepRecord {
  check: string;
  rep: number;
  pass: boolean;
  reason: string;
  cached_tokens: number;
  prompt_tokens: number;
}

async function sendCompletion(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`engine answered ${res.status} ${res.statusText}`);
  return (await res.json()) as unknown;
}

function median(values: number[]): number {
  if (values.length === 0) throw new Error("median of an empty array");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (upper === undefined) throw new Error("median: index out of range");
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

async function main(): Promise<void> {
  const url = process.env.MAIPAI_LLAMA_SERVER_URL ?? "http://127.0.0.1:8798";
  const reps = 5;
  const records: RepRecord[] = [];
  const rawReplies: Record<string, unknown[]> = {};
  const warmShortTtfts: number[] = [];

  const runCheck = async (
    check: string,
    judge: (reply: unknown) => JudgeResult,
    buildBody: () => Record<string, unknown>,
  ): Promise<void> => {
    for (let i = 1; i <= reps; i++) {
      const started = performance.now();
      try {
        const reply = await sendCompletion(url, buildBody());
        rawReplies[check] ??= [];
        rawReplies[check].push(reply);
        const result = judge(reply);
        const state = cacheState(reply);
        records.push({ check, rep: i, pass: result.pass, reason: result.reason, cached_tokens: state.cached_tokens, prompt_tokens: state.prompt_tokens });
        if (check === "auto-negative") warmShortTtfts.push(performance.now() - started);
      } catch (err) {
        records.push({ check, rep: i, pass: false, reason: err instanceof Error ? err.message : String(err), cached_tokens: 0, prompt_tokens: 0 });
      }
    }
  };

  const requiredBody = (cachePrompt: boolean): Record<string, unknown> => ({
    model: process.env.MAIPAI_CHAT_MODEL ?? "default",
    messages: [{ role: "user", content: "who is the president of chile" }],
    tools: [TOOL_SPEC],
    tool_choice: "required",
    cache_prompt: cachePrompt,
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 64,
    temperature: 0,
  });

  await runCheck("required (cache_prompt: false)", judgeRequired, () => requiredBody(false));
  await runCheck("required (cache_prompt: true)", judgeRequired, () => requiredBody(true));
  await runCheck("auto-negative", judgeAutoNegative, () => ({
    model: process.env.MAIPAI_CHAT_MODEL ?? "default",
    messages: [{ role: "user", content: "good morning" }],
    tools: [TOOL_SPEC],
    tool_choice: "auto",
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 64,
    temperature: 0,
  }));
  await runCheck("reasoning", judgeReasoningSeparated, () => ({
    model: process.env.MAIPAI_CHAT_MODEL ?? "default",
    messages: [{ role: "user", content: "what is 12 plus 30" }],
    chat_template_kwargs: { enable_thinking: true },
    max_tokens: 200,
    temperature: 0,
  }));

  const timingReps: RepRecord[] = [];
  for (const [check, replies] of Object.entries(rawReplies)) {
    for (let i = 0; i < replies.length; i++) {
      const result = judgeTiming(replies[i]);
      const state = cacheState(replies[i]);
      timingReps.push({ check: `timing (${check})`, rep: i + 1, pass: result.pass, reason: result.reason, cached_tokens: state.cached_tokens, prompt_tokens: state.prompt_tokens });
    }
  }
  records.push(...timingReps);

  let abortResult: JudgeResult;
  try {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 100);
    try {
      await sendCompletion(
        url,
        {
          model: process.env.MAIPAI_CHAT_MODEL ?? "default",
          messages: [{ role: "user", content: "write a long essay about the history of the world" }],
          max_tokens: 200,
          temperature: 0,
        },
        controller.signal,
      );
      // The engine answered before the 100ms timer fired - nothing was
      // actually aborted, so there is no cancellation to prove reached
      // the engine's slot.
      throw new Error("abort probe: the engine completed before the 100ms abort fired; nothing was cancelled");
    } catch (err) {
      // The expected outcome: sendCompletion's own fetch rejects with
      // an AbortError once the timer fires. That is proof the request
      // was cancelled client-side; it is not yet proof the engine's
      // own slot freed up, which is what the followup measurement
      // below checks. Any OTHER error (a real network failure, the
      // "nothing was cancelled" case just above) is not the abort
      // this check exists to prove, so it re-throws to the outer catch.
      const isAbort = err instanceof Error && (err.name === "AbortError" || /aborted|signal is aborted/i.test(err.message));
      if (!isAbort) throw err;
    } finally {
      clearTimeout(abortTimer);
    }
    // Same measurement shape as warmShortTtfts (a full round trip
    // through sendCompletion, not a streamed reader - these requests
    // never set `stream: true`, so a raw reader's first chunk on a
    // non-streaming JSON body is not a real first-token measurement),
    // so the 200ms comparison in judgeAbort is the same unit on both
    // sides.
    const started = performance.now();
    await sendCompletion(url, {
      model: process.env.MAIPAI_CHAT_MODEL ?? "default",
      messages: [{ role: "user", content: "good morning" }],
      max_tokens: 16,
      temperature: 0,
    });
    const followupTtftMs = performance.now() - started;
    const warmShortMedianMs = median(warmShortTtfts);
    abortResult = judgeAbort(followupTtftMs, warmShortMedianMs);
    records.push({ check: "abort", rep: 1, pass: abortResult.pass, reason: abortResult.reason, cached_tokens: 0, prompt_tokens: 0 });
  } catch (err) {
    records.push({ check: "abort", rep: 1, pass: false, reason: err instanceof Error ? err.message : String(err), cached_tokens: 0, prompt_tokens: 0 });
  }

  const byCheck = new Map<string, RepRecord[]>();
  for (const record of records) {
    byCheck.set(record.check, [...(byCheck.get(record.check) ?? []), record]);
  }
  console.log("| check | reps | pass | cached_tokens per rep | first failure reason |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const [check, group] of byCheck) {
    const passCount = group.filter((r) => r.pass).length;
    const cached = group.map((r) => r.cached_tokens).join(", ");
    const firstFailure = group.find((r) => !r.pass);
    console.log(`| ${check} | ${group.length} | ${passCount}/${group.length} | ${cached} | ${firstFailure ? firstFailure.reason : "none"} |`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join("data-scratch", "engine-contract");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${timestamp}.json`), JSON.stringify({ url: sanitizeEngineUrl(url), records, rawReplies }, null, 2));
  console.log(`\nbench finished: engine chat ${sanitizeEngineUrl(url)}; executed ${records.length} cases`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
