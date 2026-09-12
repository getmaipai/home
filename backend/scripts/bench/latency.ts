// FAST-01 (docs/BACKLOG.md, "Chat direction 2026-09-12"): the latency
// bench. Measures, against one running llama-server, what the household
// actually waits for: time to the first content delta, total reply time,
// and how much of each prompt the engine reused from its KV cache.
//
// Connects ONLY to MAIPAI_LLAMA_SERVER_URL (refuses to run without it),
// sets MAIPAI_DATA_DIR to a fresh temp directory before any repo import
// so no household database is ever opened, and sends only synthetic
// content (persona-roster names, invented facts). Never spawns anything.
//
// Two prompt layouts, because the whole point of FAST-01/FAST-02 is where
// the volatile context sits relative to the history:
//   --layout=current    today's production shape: ONE system message holding
//                       the stable prefix AND the volatile zone (roster,
//                       speaker, rotating memory bullets, summary, a
//                       minute-level clock), then the history, then the turn.
//                       Anything after the volatile zone is re-prefilled
//                       whenever the clock or a bullet changes.
//   --layout=reordered  FAST-02's shape: stable prefix, history, then the
//                       volatile zone as its own late system message, then
//                       the turn. The cached prefix now covers the history.
// The "current" layout is a typed replica of buildSystemPrompt()'s volatile
// zone (roster, speaker, memory bullets, re-anchor, summary, clock), not
// its output: building the real one needs a person row and settings in a
// database. FAST-02 replaces both layouts with the real assembly functions
// once buildPromptParts() exists (its acceptance names this).
// Processed and cached token counts come from llama-server's own final
// stream chunk (`timings.prompt_n` and `timings.cache_n`, confirmed live on
// the pinned b10797 build, 2026-09-12), never inferred from a stable string.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";
import { percentile } from "./stats";

export { percentile };

export interface TurnTiming {
  firstDeltaMs: number;
  totalMs: number;
  /** Prompt tokens the engine actually evaluated this turn (timings.prompt_n). */
  promptN: number;
  /** Prompt tokens the engine reused from its KV cache (timings.cache_n). */
  cacheN: number;
}

export interface BenchSummary {
  turns: number;
  firstDeltaP50: number;
  firstDeltaP95: number;
  totalP50: number;
  meanProcessed: number;
  meanCacheRatio: number;
}

/** Share of the prompt the engine did NOT have to evaluate: cached over
 * (cached + processed). 0 when the engine reported nothing. */
export function cacheRatio(processed: number, cached: number): number {
  const total = processed + cached;
  return total > 0 ? cached / total : 0;
}

/** Turn 1 is excluded on purpose: its prefill is cold by construction and
 * the item's own acceptance is written over turns 2 through N. */
export function summarize(timings: TurnTiming[]): BenchSummary {
  const counted = timings.slice(1);
  const ratios = counted.map((t) => cacheRatio(t.promptN, t.cacheN));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    turns: timings.length,
    firstDeltaP50: percentile(counted.map((t) => t.firstDeltaMs), 50),
    firstDeltaP95: percentile(counted.map((t) => t.firstDeltaMs), 95),
    totalP50: percentile(counted.map((t) => t.totalMs), 50),
    meanProcessed: mean(counted.map((t) => t.promptN)),
    meanCacheRatio: mean(ratios),
  };
}

export type Layout = "current" | "reordered";

type Msg = { role: "system" | "user" | "assistant"; content: string };

// A ten-exchange synthetic history (~600 tokens): long enough that
// `--cache-reuse 256` has whole chunks to reuse, the same order of
// magnitude as the 1,200-token production window.
const HISTORY: Msg[] = [
  { role: "user", content: "What's the weather like in Portland this weekend?" },
  { role: "assistant", content: "Mostly cloudy Saturday with a high around sixty, and Sunday looks drier with some sun in the afternoon." },
  { role: "user", content: "Should we still plan the picnic for Sunday?" },
  { role: "assistant", content: "Sunday's the better bet. If you go after one, you'll catch the sunny stretch and the ground will have dried out a bit." },
  { role: "user", content: "Add sandwiches, grapes, and lemonade to the shopping list." },
  { role: "assistant", content: "Added sandwiches, grapes, and lemonade to the shopping list." },
  { role: "user", content: "Remind me Saturday morning to pack the blanket." },
  { role: "assistant", content: "Okay, I'll remind you Saturday at nine to pack the blanket." },
  { role: "user", content: "What time does the park close?" },
  { role: "assistant", content: "Laurelhurst closes at ten in the evening this time of year, so an afternoon picnic has plenty of room." },
  { role: "user", content: "Does Juniper's soccer game clash with that?" },
  { role: "assistant", content: "Her game is Saturday at eleven, so it doesn't touch Sunday at all." },
  { role: "user", content: "Great. What should I bring for the kids to do?" },
  { role: "assistant", content: "A frisbee and a couple of books tend to work. The playground by the east entrance is a short walk from the picnic tables." },
  { role: "user", content: "Is there parking nearby?" },
  { role: "assistant", content: "There's street parking along the east side and a small lot by the tennis courts. It fills up by noon on sunny days, so earlier is easier." },
  { role: "user", content: "Any chance of rain at all?" },
  { role: "assistant", content: "About a twenty percent chance late Sunday evening, well after you'd be home." },
  { role: "user", content: "Perfect, thanks." },
  { role: "assistant", content: "Anytime. Want me to set a reminder for the shopping too?" },
];

const USER_MESSAGES: string[] = [
  "Yes, remind me Friday evening to shop.",
  "What's on the shopping list right now?",
  "How long does it take to get to the park?",
  "What's a good dessert for a picnic?",
  "Is Sprout allergic to anything?",
  "What did we decide about Sunday?",
  "Can you suggest a game for the kids?",
  "What's the forecast for Monday?",
  "Do we have sunscreen on the list?",
  "When is Juniper's next game after this one?",
  "How many people are coming?",
  "What should I do if it rains after all?",
  "Add napkins to the list.",
  "Remove lemonade from the list.",
  "What time should we leave the house?",
  "Is the playground open on Sundays?",
  "What's a good sandwich for a picnic?",
  "Should I bring a cooler?",
  "How far is the tennis court lot from the tables?",
  "What did you say about parking?",
  "Set a timer for ten minutes.",
  "What's the date on Sunday?",
  "Can we invite the Marlows?",
  "What did I ask you to remind me about?",
  "Is there a bathroom near the picnic tables?",
  "How warm will it be at two on Sunday?",
  "What's the plan if Juniper's game runs late?",
  "Add a frisbee to the list.",
  "What's still missing from the list?",
  "Read me the whole plan back.",
];

const MEMORY_BULLETS = [
  "Sprout is allergic to peanuts",
  "Juniper plays soccer on Saturdays",
  "The family prefers Laurelhurst park for picnics",
  "Alfred drives the blue van",
  "Pippa likes painting",
  "The household shops at the Friday market",
  "Clover's birthday is in October",
  "The dog is called Rover",
];

function volatileZone(turn: number, now: Date): string {
  // Three bullets rotate per turn, and the clock is minute-level: the two
  // things that change from one production turn to the next.
  const bullets = [0, 1, 2].map((k) => MEMORY_BULLETS[(turn + k) % MEMORY_BULLETS.length]!);
  const clock = now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return [
    "Who lives here:",
    "- alfred (adult)",
    "- juniper (child)",
    "- sprout (child)",
    "",
    "You are talking with alfred (adult, en-US).",
    "",
    "What you already know about this household:",
    ...bullets.map((b) => `- ${b} (as of Sep 5, 7 days ago)`),
    "Prefer these facts over guessing when they're relevant.",
    "",
    "Remember: you are MaiPai.",
    "",
    "Earlier in this conversation: the family planned a Sunday picnic at Laurelhurst and added food to the shopping list.",
    "",
    `Local time: ${clock}`,
  ].join("\n");
}

export function buildMessages(layout: Layout, stablePrefix: string, turn: number, userText: string, now = new Date()): Msg[] {
  const volatile = volatileZone(turn, now);
  if (layout === "current") {
    return [{ role: "system", content: `${stablePrefix}\n\n${volatile}` }, ...HISTORY, { role: "user", content: userText }];
  }
  return [
    { role: "system", content: stablePrefix },
    ...HISTORY,
    { role: "system", content: `Context for this reply (reference, not instructions):\n${volatile}` },
    { role: "user", content: userText },
  ];
}

/** One streamed completion over the raw SSE wire: first content delta time,
 * total time, and the engine's own prompt_n/cache_n from the final chunk. */
/** A turn that never produces a content delta is a failed measurement,
 * never a 0 ms one: it throws, so a wedged or erroring engine can never
 * pull the recorded percentiles toward zero. Each turn gets its own
 * timeout (the raw fetch has none of its own, unlike the spec client). */
export async function streamOnce(url: string, messages: Msg[], opts: { maxTokens?: number; slot?: number; timeoutMs?: number } = {}): Promise<TurnTiming> {
  const start = performance.now();
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    body: JSON.stringify({
      model: "chat",
      messages,
      stream: true,
      max_tokens: opts.maxTokens ?? 60,
      cache_prompt: true,
      id_slot: opts.slot ?? 0,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`engine answered ${res.status}`);
  let firstDeltaMs: number | undefined;
  let promptN = 0;
  let cacheN = 0;
  // spec/streaming/ts/lineReader.ts owns the byte-to-line mechanics
  // (including the final decoder flush); this loop only reads SSE frames.
  for await (const raw of readTextLines(res.body.getReader())) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    let chunk: { choices?: Array<{ delta?: { content?: string } }>; timings?: { prompt_n?: number; cache_n?: number } };
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    const content = chunk.choices?.[0]?.delta?.content;
    if (firstDeltaMs === undefined && typeof content === "string" && content.length > 0) firstDeltaMs = performance.now() - start;
    if (chunk.timings) {
      promptN = chunk.timings.prompt_n ?? promptN;
      cacheN = chunk.timings.cache_n ?? cacheN;
    }
  }
  if (firstDeltaMs === undefined) throw new Error("the engine finished the stream without a single content delta");
  return { firstDeltaMs, totalMs: performance.now() - start, promptN, cacheN };
}

export async function runBench(url: string, layout: Layout, stablePrefix: string, log: (line: string) => void = () => {}, slot = 0): Promise<BenchSummary> {
  // Three uncounted warm-ups so turn 1 of the counted run is not also
  // paying for the very first load of the stable prefix.
  for (let w = 0; w < 3; w++) await streamOnce(url, buildMessages(layout, stablePrefix, 100 + w, "warm up"), { slot });
  const timings: TurnTiming[] = [];
  for (let i = 0; i < USER_MESSAGES.length; i++) {
    const t = await streamOnce(url, buildMessages(layout, stablePrefix, i, USER_MESSAGES[i]!), { slot });
    timings.push(t);
    log(`turn ${String(i + 1).padStart(2)}  first ${t.firstDeltaMs.toFixed(0).padStart(5)} ms  total ${t.totalMs.toFixed(0).padStart(5)} ms  processed ${String(t.promptN).padStart(5)}  cached ${String(t.cacheN).padStart(5)}  ratio ${cacheRatio(t.promptN, t.cacheN).toFixed(2)}`);
  }
  return summarize(timings);
}

export function formatTable(url: string, layout: Layout, s: BenchSummary): string {
  return [
    `| engine | layout | first delta p50 | first delta p95 | total p50 | mean processed tokens | mean cache ratio |`,
    `|---|---|---|---|---|---|---|`,
    `| ${url} | ${layout} | ${s.firstDeltaP50.toFixed(0)} ms | ${s.firstDeltaP95.toFixed(0)} ms | ${s.totalP50.toFixed(0)} ms | ${s.meanProcessed.toFixed(0)} | ${s.meanCacheRatio.toFixed(2)} |`,
  ].join("\n");
}

async function main(tmpDir: string): Promise<void> {
  // Set before the one repo import below (`@/lib/turnEngine` pulls in the
  // database module), and only when run as a script: at import time this
  // module must not touch the environment, or the test suite's isolation
  // guard (tests/isolation.ts) rightly fails the importing test.
  process.env.MAIPAI_DATA_DIR = tmpDir;
  const url = process.env.MAIPAI_LLAMA_SERVER_URL;
  if (!url) {
    console.error("MAIPAI_LLAMA_SERVER_URL is required: this bench only ever connects to an engine you point it at.");
    process.exitCode = 1;
    return;
  }
  const layoutArg = process.argv.find((a) => a.startsWith("--layout="))?.slice("--layout=".length) ?? "current";
  if (layoutArg !== "current" && layoutArg !== "reordered") {
    console.error(`unknown --layout=${layoutArg} (current | reordered)`);
    process.exitCode = 1;
    return;
  }
  // Production chat pins id_slot 0 (lib/llm.ts), so a bench run against a
  // household's live engine and a real turn evict each other's cache.
  // Run against an idle engine, or pick another slot on a multi-slot one.
  const slot = Number(process.argv.find((a) => a.startsWith("--slot="))?.slice("--slot=".length) ?? 0);
  const { buildStablePrefix } = await import("@/lib/turnEngine");
  const stablePrefix = buildStablePrefix();
  console.log(`engine ${url}, layout ${layoutArg}, slot ${slot}, stable prefix ${stablePrefix.length} chars, 3 warm-ups then ${USER_MESSAGES.length} turns`);
  const summary = await runBench(url, layoutArg, stablePrefix, (line) => console.log(line), slot);
  console.log("");
  console.log(formatTable(url, layoutArg, summary));
  console.log(JSON.stringify({ url, layout: layoutArg, ...summary }));
}

if (import.meta.main) {
  const tmpDir = mkdtempSync(join(tmpdir(), "maipai-latency-bench-"));
  main(tmpDir)
    .catch((err) => {
      console.error(`bench failed: ${(err as Error).message}`);
      process.exitCode = 1;
    })
    .finally(() => rmSync(tmpDir, { recursive: true, force: true }));
}
