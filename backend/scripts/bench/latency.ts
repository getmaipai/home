// FAST-01 and FAST-02 (docs/BACKLOG.md, "Chat direction 2026-09-12"): the
// latency bench. Measures, against one running llama-server, what the
// household actually waits for: time to the first content delta, total
// reply time, and how much of each prompt the engine reused from its KV
// cache.
//
// Connects ONLY to MAIPAI_LLAMA_SERVER_URL (refuses to run without it),
// sets MAIPAI_DATA_DIR to a fresh temp directory before any repo import
// so no household database is ever opened, and sends only synthetic
// content (persona-roster names, invented facts). Never spawns anything.
//
// Two prompt layouts, both built by the REAL assembly functions in
// lib/turnEngine.ts (passed in as `builders`, so this file holds no copy
// of the prompt shape and cannot drift from production):
//   --layout=reordered       what production sends since FAST-02: the stable
//                            prefix, the history, then the volatile context
//                            as its own late system message, then the turn.
//   --layout=single-message  a stand-in for the pre-FAST-02 shape: the same
//                            stable prefix and context glued into ONE system
//                            message ahead of the history (buildSystemPrompt(),
//                            kept for the prompt-budget test). Not byte-for-
//                            byte the old prompt (that had the plugins list;
//                            FAST-01's table measured that one), but the same
//                            cache behaviour: anything after the context is
//                            re-prefilled when the context changes.
// Every turn's memory bullets carry the turn number, so no two turns ever
// send an identical prompt: llama-server keeps a server-side prompt cache
// of recent prompts (its default), and a bench that cycled a small set of
// bullets was silently measuring that cache restoring an earlier turn's
// whole prompt (a code review caught it, 2026-09-12). The household roster
// and profile paragraph come from a database this bench does not seed, so
// the context here is thinner than a real household's; the tables in
// docs/dev.md say so next to the numbers.
// Processed and cached token counts come from llama-server's own final
// stream chunk (`timings.prompt_n` and `timings.cache_n`, confirmed live on
// the pinned b10797 build, 2026-09-12), never inferred from a stable string.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";
import type { PersonRow } from "@/types";
import type { RecallMatch } from "@/lib/memory";
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

export type Layout = "single-message" | "reordered";

export type Msg = { role: "system" | "user" | "assistant"; content: string };

/** The two real assembly functions, typed from lib/turnEngine.ts itself so
 * a signature change there fails the typecheck here rather than the live
 * run. main() passes the real module; the tests pass a fake. */
export type PromptBuilders = Pick<typeof import("@/lib/turnEngine"), "buildSystemPrompt" | "buildPromptParts">;

// A ten-exchange synthetic history (~600 tokens), the same order of
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

export function syntheticActor(): PersonRow {
  const nowIso = "2026-09-12T12:00:00.000Z";
  return {
    id: "person-benchalfred",
    displayName: "alfred",
    nickname: null,
    birthdate: null,
    role: "adult",
    avatarSeed: "bench",
    source: "hub",
    localOnly: false,
    enabled: true,
    guestExpiresAt: null,
    memorializedAt: null,
    locale: "en-US",
    createdAt: nowIso,
    updatedAt: nowIso,
    hlc: "0:0:bench",
    deletedAt: null,
  } as PersonRow;
}

/** Three memory bullets per turn, each salted with the turn number so the
 * context differs on every turn the way a real household's does. */
export function syntheticMatches(turn: number): RecallMatch[] {
  return [0, 1, 2].map((k) => {
    const text = `${MEMORY_BULLETS[(turn + k) % MEMORY_BULLETS.length]!} (mentioned in chat ${turn + 1})`;
    return {
      record: {
        id: `mem-bench-${k}`,
        record_kind: "memory",
        text,
        category: "fact",
        tier: "durable",
        status: "active",
        scope: "household",
        person: null,
        source: "bench",
        importance: 0.5,
        pinned: false,
        sensitive: false,
        uses: 0,
        created_at: "2026-09-05T12:00:00.000Z",
        last_used_at: null,
        hlc: "0:0:bench",
      } as unknown as RecallMatch["record"],
      score: 0.8 - k * 0.1,
    };
  });
}

export function buildMessages(layout: Layout, builders: PromptBuilders, turn: number, userText: string): Msg[] {
  const actor = syntheticActor();
  const matches = syntheticMatches(turn);
  if (layout === "single-message") {
    return [{ role: "system", content: builders.buildSystemPrompt(actor, userText, matches) }, ...HISTORY, { role: "user", content: userText }];
  }
  const parts = builders.buildPromptParts(actor, userText, matches);
  return [{ role: "system", content: parts.stablePrefix }, ...HISTORY, { role: "system", content: parts.context }, { role: "user", content: userText }];
}

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

export async function runBench(url: string, layout: Layout, builders: PromptBuilders, log: (line: string) => void = () => {}, slot = 0): Promise<BenchSummary> {
  // Three uncounted warm-ups so turn 1 of the counted run is not also
  // paying for the very first load of the stable prefix.
  for (let w = 0; w < 3; w++) await streamOnce(url, buildMessages(layout, builders, 100 + w, "warm up"), { slot });
  const timings: TurnTiming[] = [];
  for (let i = 0; i < USER_MESSAGES.length; i++) {
    const t = await streamOnce(url, buildMessages(layout, builders, i, USER_MESSAGES[i]!), { slot });
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
  const layoutArg = process.argv.find((a) => a.startsWith("--layout="))?.slice("--layout=".length) ?? "reordered";
  if (layoutArg !== "single-message" && layoutArg !== "reordered") {
    console.error(`unknown --layout=${layoutArg} (single-message | reordered)`);
    process.exitCode = 1;
    return;
  }
  // Production chat pins id_slot 0 (lib/llm.ts), so a bench run against a
  // household's live engine and a real turn evict each other's cache.
  // Run against an idle engine, or pick another slot on a multi-slot one.
  const slot = Number(process.argv.find((a) => a.startsWith("--slot="))?.slice("--slot=".length) ?? 0);
  const engine = await import("@/lib/turnEngine");
  const { loadAllSkills } = await import("@/lib/skills");
  // Manifests and skills are read from disk once here and passed through,
  // the way prepareTurn() does, instead of on all 33 calls.
  const loaded = engine.loadAllManifests();
  const skills = loadAllSkills();
  const builders: PromptBuilders = {
    buildSystemPrompt: (actor, text, matches) => engine.buildSystemPrompt(actor, text, matches, loaded, undefined, skills),
    buildPromptParts: (actor, text, matches) => engine.buildPromptParts(actor, text, matches, loaded, undefined, skills),
  };
  console.log(`engine ${url}, layout ${layoutArg}, slot ${slot}, stable prefix ${engine.buildStablePrefix().length} chars, 3 warm-ups then ${USER_MESSAGES.length} turns`);
  const summary = await runBench(url, layoutArg, builders, (line) => console.log(line), slot);
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
