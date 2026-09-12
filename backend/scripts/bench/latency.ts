#!/usr/bin/env bun
// Latency benchmark for the chat model (FAST-01, 2026-09-12): measures
// first-token latency and cache reuse with the stable prefix, history,
// and volatile context.
//
// Requires MAIPAI_LLAMA_SERVER_URL to connect to a running engine.
// Never reads a household database; sets MAIPAI_DATA_DIR to a fresh temp
// directory before any import so no real data is touched.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const tmpDir = mkdtempSync(join(tmpdir(), "maipai-bench-"));
process.env.MAIPAI_DATA_DIR = tmpDir;

import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { buildStablePrefix } from "@/lib/turnEngine.js";

export function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function cacheRatio(processedTokens: number, totalPromptTokens: number): number {
  return totalPromptTokens > 0 ? 1 - processedTokens / totalPromptTokens : 0;
}

const url = process.env.MAIPAI_LLAMA_SERVER_URL;
if (!url) {
  console.error("MAIPAI_LLAMA_SERVER_URL is required");
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

const client = new LlamaServerClient(url);
const stablePrefix = buildStablePrefix();

const history: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "What's the weather like?" },
  { role: "assistant", content: "I can check the weather for you. What location would you like to know about?" },
  { role: "user", content: "London" },
  { role: "assistant", content: "The weather in London today is partly cloudy with a high of 15°C and a low of 10°C." },
  { role: "user", content: "What about tomorrow?" },
  { role: "assistant", content: "Tomorrow in London, it will be mostly cloudy with a chance of light rain. High of 13°C, low of 9°C." },
];

const userMessages: string[] = [
  "Tell me about the history of London.",
  "What are some popular tourist attractions?",
  "What's the best time to visit?",
  "How long should I stay?",
  "What about food and restaurants?",
  "Can you recommend a hotel?",
  "What's the public transport like?",
  "Is it safe to visit?",
  "What currency do they use?",
  "What language is spoken there?",
  "What's the cost of accommodation?",
  "Are there any museums worth visiting?",
  "What about shopping?",
  "Tell me about the nightlife.",
  "What cultural events are there?",
  "How's the weather in summer?",
  "What about winter?",
  "Are there any nearby day trips?",
  "What are the visa requirements?",
  "What's the time zone?",
  "What are some local dishes?",
  "How much should I budget per day?",
  "What about getting around the city?",
  "Are there any beaches nearby?",
  "What sports can I do there?",
  "What's the healthcare system like?",
  "Any safety tips?",
  "What about traditional crafts?",
  "Tell me about local festivals.",
  "What's the best neighborhood to stay in?",
];

async function runBenchmark(): Promise<void> {
  const timings: Array<{ firstDeltaMs: number; totalMs: number; promptTokens: number }> = [];

  console.log("\nRunning latency benchmark (30 turns)...\n");
  for (let i = 0; i < userMessages.length; i++) {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system" as const, content: stablePrefix },
      ...(history as Array<{ role: "user" | "assistant"; content: string }>),
      { role: "user" as const, content: userMessages[i]! },
    ];

    let firstDeltaMs = 0;
    let totalMs = 0;
    let promptTokens = 0;
    const startTime = performance.now();

    try {
      const response = await client.chatCompleteStream(
        {
          model: "chat",
          messages,
          max_tokens: 100,
          cache_prompt: true,
          id_slot: 0,
          chat_template_kwargs: { enable_thinking: false },
        },
        undefined,
      );

      let firstToken = true;
      for await (const delta of response) {
        if (firstToken && delta && typeof delta === "string" && delta.length > 0) {
          firstDeltaMs = performance.now() - startTime;
          firstToken = false;
        }
      }
      totalMs = performance.now() - startTime;

      try {
        const metricsResponse = await fetch(`${url}/metrics`);
        const metricsText = await metricsResponse.text();
        const match = metricsText.match(/llamacpp:prompt_tokens_total\s+(\d+)/);
        if (match && match[1]) {
          promptTokens = parseInt(match[1], 10);
        }
      } catch {
        promptTokens = 0;
      }
    } catch (err) {
      console.error(`Error during turn: ${(err as Error).message}`);
      throw err;
    }

    timings.push({ firstDeltaMs, totalMs, promptTokens });
    console.log(
      `Turn ${i + 1}: first-token=${firstDeltaMs}ms, total=${totalMs}ms, prompt_tokens=${promptTokens}`,
    );
  }

  const sortedFirstDelta = timings.map((t) => t.firstDeltaMs).sort((a, b) => a - b);
  const sortedTotal = timings.map((t) => t.totalMs).sort((a, b) => a - b);
  const meanPromptTokens = timings.reduce((sum, t) => sum + t.promptTokens, 0) / timings.length;
  const totalPromptTokens = stablePrefix.length / 4 + history.length * 50 + userMessages[0]!.length / 4;

  const cachedRatio = cacheRatio(meanPromptTokens, totalPromptTokens);

  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));
  console.log(`First-token latency p50: ${percentile(sortedFirstDelta, 50)}ms`);
  console.log(`First-token latency p95: ${percentile(sortedFirstDelta, 95)}ms`);
  console.log(`Total latency p50:       ${percentile(sortedTotal, 50)}ms`);
  console.log(`Mean processed tokens:   ${Math.round(meanPromptTokens)}`);
  console.log(`Cache ratio:             ${(cachedRatio * 100).toFixed(1)}%`);
  console.log("=".repeat(70));

  rmSync(tmpDir, { recursive: true, force: true });
}

if (import.meta.main) {
  runBenchmark().catch((err) => {
    console.error(err);
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  });
}
