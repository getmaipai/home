#!/usr/bin/env bun
// Latency benchmark for the chat model (FAST-01, 2026-09-12): measures
// first-token latency and cache reuse with the stable prefix, history,
// and volatile context.
//
// Requires MAIPAI_LLAMA_SERVER_URL to connect to a running engine.
// Never reads a household database; sets MAIPAI_DATA_DIR to a fresh temp
// directory before any import so no real data is touched.

import { mkdtemp, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

// Set up temp data dir before any imports
const tmpDir = mkdtemp(join(tmpdir(), "maipai-bench-"));
process.env.MAIPAI_DATA_DIR = tmpDir;

import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { buildStablePrefix } from "@/lib/persona";

const serverUrl = process.env.MAIPAI_LLAMA_SERVER_URL;
if (!serverUrl) {
  console.error("MAIPAI_LLAMA_SERVER_URL is required");
  process.exit(1);
}

const client = new LlamaServerClient(serverUrl);

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

interface Timings {
  firstDeltaMs: number;
  totalMs: number;
  promptTokens: number;
}

async function measureTurn(systemPrompt: string, history: Array<{ role: string; content: string }>, userMessage: string): Promise<Timings> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: userMessage },
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
    for await (const chunk of response) {
      if (firstToken && chunk.choices[0]?.delta?.content) {
        firstDeltaMs = performance.now() - startTime;
        firstToken = false;
      }
      // Consume the stream to get timings
    }
    totalMs = performance.now() - startTime;

    // Try to get processed tokens from the response timings if available
    // (llama.cpp includes this in the final chunk)
    if (response.timings?.prompt_n) {
      promptTokens = response.timings.prompt_n;
    } else {
      // Fallback: query /metrics endpoint
      try {
        const metricsResponse = await fetch(`${serverUrl}/metrics`);
        const metricsText = await metricsResponse.text();
        const match = metricsText.match(/llamacpp:prompt_tokens_total\s+(\d+)/);
        if (match) {
          promptTokens = parseInt(match[1], 10);
        }
      } catch {
        promptTokens = 0;
      }
    }
  } catch (err) {
    console.error(`Error during turn: ${(err as Error).message}`);
    throw err;
  }

  return { firstDeltaMs, totalMs, promptTokens };
}

async function main() {
  console.log("Building stable prefix...");
  const stablePrefix = buildStablePrefix({
    household: { name: "example" },
    speaker: { id: "speaker-1", name: "Alfred", role: "owner" },
    companion: null,
    now: new Date(),
    locale: "en-US",
    timezone: "UTC",
  });

  console.log("Preparing fixed history...");
  const history = [
    { role: "user" as const, content: "What's the weather like?" },
    { role: "assistant" as const, content: "I can check the weather for you. What location would you like to know about?" },
    { role: "user" as const, content: "London" },
    { role: "assistant" as const, content: "The weather in London today is partly cloudy with a high of 15°C and a low of 10°C." },
    { role: "user" as const, content: "What about tomorrow?" },
    { role: "assistant" as const, content: "Tomorrow in London, it will be mostly cloudy with a chance of light rain. High of 13°C, low of 9°C." },
  ];

  const userMessages = [
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

  const timings: Timings[] = [];

  console.log("\nRunning latency benchmark (30 turns)...\n");
  for (let i = 0; i < userMessages.length; i++) {
    const turn = await measureTurn(stablePrefix, history, userMessages[i]);
    timings.push(turn);
    console.log(
      `Turn ${i + 1}: first-token=${turn.firstDeltaMs}ms, total=${turn.totalMs}ms, prompt_tokens=${turn.promptTokens}`,
    );
  }

  // Calculate statistics
  const sortedFirstDelta = timings.map((t) => t.firstDeltaMs).sort((a, b) => a - b);
  const sortedTotal = timings.map((t) => t.totalMs).sort((a, b) => a - b);
  const meanPromptTokens = timings.reduce((sum, t) => sum + t.promptTokens, 0) / timings.length;

  // Calculate cache ratio (1 - processed / total)
  // Total prompt tokens should be relatively stable (prefix + history + current message)
  const totalPromptSize = 1000; // Estimated from typical prefix + history
  const cacheRatio = 1 - meanPromptTokens / totalPromptSize;

  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));
  console.log(`First-token latency p50: ${percentile(sortedFirstDelta, 50)}ms`);
  console.log(`First-token latency p95: ${percentile(sortedFirstDelta, 95)}ms`);
  console.log(`Total latency p50:       ${percentile(sortedTotal, 50)}ms`);
  console.log(`Mean processed tokens:   ${Math.round(meanPromptTokens)}`);
  console.log(`Cache ratio:             ${(cacheRatio * 100).toFixed(1)}%`);
  console.log("=".repeat(70));

  // Clean up temp dir
  rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
});
