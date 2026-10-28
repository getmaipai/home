// DIAG-KEY-01 (docs/dev/diagnose-api.md): what an assistant holding a `diagnose` key may read. Timings, counts and component state only
// (design rule 6a): no message text, no people, no turn ids or clock times, no free text from a log. Every function here is read-only
// except the cache probe, which sends fixed synthetic text.
import { median, recentTurnStats } from "@/lib/performance";
import { probeChatEngine, type LlmMessage, type ProbeReading, type ToolSpec } from "@/lib/llm";
import { getStackClient } from "@/lib/stackEngine";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import { activeTurnCount, acquireTurnLease } from "@/lib/turnActivity";
import { tryConsume } from "@/lib/rateLimiter";
import { NEWS_COUNTER_NAMES, newsCounters } from "@/lib/news/newsCounters";
import { newsImagesOn, newsPictureCount } from "@/lib/news/pictures";

/** Why News cards show a stand-in: every closed News counter since the hub started (zero when never bumped), whether pictures are on
 * and how many pictures the cache holds. Fixed names and numbers only, never an item, address or host (RULES 6a). */
export function newsView() {
  const counts = newsCounters();
  return {
    pictures_on: newsImagesOn(),
    pictures_cached: newsPictureCount(),
    counters: Object.fromEntries(NEWS_COUNTER_NAMES.map((name) => [name, counts[`news.${name}`] ?? 0])),
  };
}

export const MAX_TURNS = 50;
export const DEFAULT_TURNS = 10;
/** A cached prompt this large and missed is the slow case the summary counts. */
export const BIG_PROMPT_TOKENS = 2000;

/** Newest turns, generation numbers only. A turn row also holds message text; recentTurnStats never selects it. */
export function turnsView(limit: number) {
  // No turn id, no clock time and no node names per turn: those would tie an activity to a record (rule 6a). Newest first.
  return recentTurnStats(limit).map(({ stats }) => ({
    time_to_first_token_ms: stats.time_to_first_token_ms ?? null,
    total_time_ms: stats.total_time_ms ?? null,
    tokens_per_second: stats.tokens_per_second ?? null,
    generations: (stats.generations ?? []).map((g) => ({
      reason: g.reason, prompt_n: g.prompt_n, cache_n: g.cache_n, prompt_ms: g.prompt_ms, predicted_n: g.predicted_n,
      request_sent_ms: g.request_sent_ms, first_delta_ms: g.first_delta_ms, ...(g.prefix ? { prefix: g.prefix } : {}) })),
  }));
}

/** Time per pipeline node summed over the window: a total, never per turn. */
function nodeTotals(all: ReadonlyArray<{ nodes?: Array<{ node: string; startMs: number; endMs: number }> }>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const stats of all) for (const n of stats.nodes ?? []) totals[n.node] = (totals[n.node] ?? 0) + Math.max(0, n.endMs - n.startMs);
  return totals;
}

export function summaryView(limit: number) {
  const rows = recentTurnStats(limit);
  const sorted = (values: Array<number | null | undefined>) => values.filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
  // `generations` is oldest first, so index 0 is the first model call of the turn.
  const firsts = rows.map((r) => r.stats.generations?.[0]).filter((g): g is NonNullable<typeof g> => !!g);
  const big = firsts.filter((g) => typeof g.prompt_n === "number" && g.prompt_n > BIG_PROMPT_TOKENS);
  const missed = big.filter((g) => g.cache_n === 0);
  return {
    turns_examined: rows.length,
    median_first_token_ms: median(sorted(rows.map((r) => r.stats.time_to_first_token_ms))),
    median_total_ms: median(sorted(rows.map((r) => r.stats.total_time_ms))),
    first_call_big_prompt_turns: big.length,
    first_call_cache_miss_share: big.length === 0 ? null : missed.length / big.length,
    median_first_call_prompt_n: median(sorted(firsts.map((g) => g.prompt_n))),
    median_first_call_cache_n: median(sorted(firsts.map((g) => g.cache_n))),
    median_first_call_prompt_ms: median(sorted(firsts.map((g) => g.prompt_ms))),
    big_prompt_threshold_tokens: BIG_PROMPT_TOKENS,
    node_total_ms: nodeTotals(rows.map((r) => r.stats)),
  };
}
// ---- engines (the Stack's own typed state) -----------------------------------------------------------------------------------------------

/** Role and engine state as the Stack reports it, cut to named fields: no directories, no reason or health text, no model file paths. */
export async function engineState() {
  const stack = getStackClient();
  const [roles, engines, health] = await Promise.all([stack.roles(), stack.engines(), stack.health()]);
  return {
    roles: roles.roles.map((r) => ({
      id: r.id, wire: r.wire, residency: r.residency, state: r.state.state, model: r.model?.id ?? null,
      measured_context_length: r.model?.measuredContextLength ?? null, identity_ok: r.identity?.ok ?? null,
      coding_engine: r.coding?.engine ?? null, slots: r.coding?.slots ?? null,
    })),
    engines: engines.engines.map((e) => ({
      name: e.name, installed: e.installed, running_tag: e.running, current_tag: e.currentTag, newest_tag: e.newestTag, needs_restart: e.needsRestart, state: e.state,
    })),
    health: health.health.map((h) => ({ code: h.code, severity: h.severity })),
  };
}

// ---- cache probe ------------------------------------------------------------------------------------------------------------------------

const PROBE_TOOLS: ToolSpec[] = [
  { id: "probe_lookup", description: "Look up a word in a fixed list.", args: { type: "object", properties: { word: { type: "string" } }, required: ["word"] } },
  { id: "probe_count", description: "Count the items in a fixed list.", args: { type: "object", properties: { list: { type: "string" } }, required: ["list"] } },
  { id: "probe_pick", description: "Pick one entry from a fixed list.", args: { type: "object", properties: { index: { type: "integer" } }, required: ["index"] } },
];
const WORDS = ["amber", "birch", "cedar", "dune", "ember", "fern", "grove", "harbor", "iris", "juniper", "kelp", "lantern", "meadow", "nectar", "orchard", "pebble", "quartz", "ridge", "sorrel", "thistle", "umber", "valley", "willow", "yarrow", "zephyr"];
/** About 4.5k tokens of fixed, varied filler: the same text every call, so the second request is an exact repeat of the first. */
export function probeFiller(): string {
  const sentences: string[] = [];
  for (let i = 0; sentences.length < 450; i++) sentences.push(`Note ${i + 1}: the ${WORDS[i % 25]} path bends past the ${WORDS[(i * 7 + 3) % 25]} gate near stone ${(i * 13) % 97}.`);
  return sentences.join(" ");
}
function probeMessages(extended: boolean): LlmMessage[] {
  return [
    { role: "system", content: "You are a quiet test assistant. Reply with one short word." },
    { role: "user", content: `${probeFiller()}${extended ? " Addendum: the last gate is red." : ""} Reply with the word ok.` },
  ];
}

const PROBE_BUCKET = { capacity: 1, refillPerSecond: 1 / 60 };
let probeRunning = false;
export type ProbeOutcome =
  | { ok: true; calls: Array<{ call: "first" | "repeat" | "extended" } & ProbeReading> }
  | { ok: false; status: 409 | 429 | 503; error: string };

/** Three requests through the chat engine path: a fixed prompt, the same prompt again, then that prompt with a few words added. */
export async function runCacheProbe(): Promise<ProbeOutcome> {
  if (activeTurnCount() > 0) return { ok: false, status: 409, error: "A chat turn is running now. Wait for it to finish and run the probe again." };
  if (probeRunning) return { ok: false, status: 409, error: "A probe is already running. Wait for it to finish and read its result." };
  if (!tryConsume("diagnose:cache-probe", PROBE_BUCKET)) return { ok: false, status: 429, error: "The cache probe runs once a minute. Wait a minute and try again." };
  probeRunning = true;
  // Held like a household turn, so background work waits and a second probe sees it.
  const lease = acquireTurnLease();
  try {
    const calls: Array<{ call: "first" | "repeat" | "extended" } & ProbeReading> = [];
    for (const [call, extended] of [["first", false], ["repeat", false], ["extended", true]] as const) {
      const result = await probeChatEngine(probeMessages(extended), PROBE_TOOLS);
      if (!result.ok) return { ok: false, status: 503, error: `The chat engine did not answer the probe (${redactCredentials(result.error)}). Check that the engine is running on the status page and try again in a minute.` };
      calls.push({ call, ...result.reading });
    }
    return { ok: true, calls };
  } finally { lease.release(); probeRunning = false; }
}
export function __resetProbeForTests(): void { probeRunning = false; }
