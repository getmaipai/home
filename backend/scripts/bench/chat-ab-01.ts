// CHAT-AB-01: the same model, three ways, to see which layer of the chat
// pipeline costs reply quality. Measurement only; nothing here tunes or
// fixes the pipeline, and no reply is machine-graded beyond a plain
// contains-the-expected-answer boolean (a person reads the replies).
//
//   A    bare: POST /v1/chat/completions on the engine, the conversation so
//        far plus the user message, no system prompt, no sampling fields,
//        max_tokens 1536, streaming.
//   A2   A plus CHAT_SAMPLING (imported from src/lib/llm.ts, not copied).
//   B    the real default turn path as an adult, written chat turn:
//        runConversation() from conversationRunner.ts (the construction path
//        every live bench uses) with real tools and
//        real search through a pass-through tee (see "the search tee").
//
//   C    (THIN-AB) the real default turn path as the child bench person, written
//        chat surface, streamed the way routes/turn.ts streams it
//        (runTurnNextStream + streamTurnEvents); TTFT is the first delta event.
//   S    (THIN-AB, THIN-4F) the spoken turn: the owner on the chat surface with
//        the client's spoken flag (the spoken register and the sentence-by-
//        sentence gate), streamed the same way. firstWord is the first answer
//        delta, measured from the moment the turn began; the 900 ms spoken
//        cue and the first status line are recorded beside it.
//
// Every arm talks to ONE engine: the MaiPai Stack's own chat role (the
// engine the Stack launches itself). The bench never starts an engine.
// Group of arms per invocation: --group adult (default: A, A2, B), child,
// spoken. Run:
//
//   MAIPAI_DATA_DIR=<empty dir under the OS temp root> \
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 \
//   MAIPAI_EMBED_URL=http://127.0.0.1:8770 \
//   MAIPAI_BENCH_REAL_SEARXNG_URL=<the real SearXNG> \
//   MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1 \
//   bun run scripts/bench/chat-ab-01.ts [--only id,id] [--runs N]
//
// `--render` rebuilds side-by-side.md from an existing results.json.
// Output (git-ignored): data-scratch/chat-ab/results.json (written after
// every run, so a killed run keeps what it measured) and side-by-side.md.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg, uptime } from "node:os";
import { join } from "node:path";
import dataset from "./datasets/chat-ab-01.json";
import { refuseIfGateRunning, refuseRealSearxngWithoutClearance, waitForHubQuiet } from "./liveHubQuiet";
import { startRecordingProxy, type RecordedRequest, type RecordingProxy } from "./recordingProxy";

const EMBED_OFF = process.env.MAIPAI_AB_EMBED === "off";
const STACK_CHAT_MODEL = "chat"; // the Stack answers by role name
const OUT_DIR = process.env.MAIPAI_AB_OUT ?? join(process.cwd(), "..", "data-scratch", "chat-ab");
const RESULTS = join(OUT_DIR, "results.json");
const SIDE_BY_SIDE = join(OUT_DIR, "side-by-side.md");
const SINGLE_RUNS = (() => {
  const at = process.argv.indexOf("--runs");
  return at < 0 ? 2 : Math.max(1, Number(process.argv[at + 1]));
})();
const SEARCH_FREE_ITEMS = new Set(["k1-heat-pump", "w1-story", "f4-recipe"]);
const ONLY = (() => {
  const at = process.argv.indexOf("--only");
  return at < 0 ? null : new Set((process.argv[at + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
})();
const GROUP = (() => {
  const at = process.argv.indexOf("--group");
  const g = at < 0 ? "adult" : (process.argv[at + 1] ?? "adult");
  if (!["adult", "child", "spoken"].includes(g)) throw new Error(`--group must be adult, child or spoken (got ${g})`);
  return g as "adult" | "child" | "spoken";
})();
// THIN-Q2 / BENCH-AB-02: --arms A2,AP,AT,APT,APM,B picks the adult arms (default
// A,A2,B) and runs them in BLOCKS (arm, then item, then run), so the engine
// slot's prompt cache is warm for repeats and every row carries the engine's
// own cached-token count (cold or warm is read from it, never assumed).
//   AP   A2 plus Home's persona and clock system lines (captured from a real B turn)
//   AT   A2 plus Home's tools block and tool_choice (captured from a real B turn)
//   APT  A2 plus both (the request body B sends, minus Home's own extras)
//   APM  APT with one short description per tool; parameter schemas are unchanged.
const ARMS = (() => {
  const at = process.argv.indexOf("--arms");
  if (at < 0) return null;
  const list = (process.argv[at + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!["A", "A2", "AP", "AT", "APT", "APM", "B"].includes(a)) throw new Error(`--arms: unknown arm ${a}`);
  return list as Arm[];
})();
const SEARCH_PACE_MS = 30_000;
const MAX_TOKENS = 1536;

type Arm = "A" | "A2" | "AP" | "AT" | "APT" | "APM" | "B" | "C" | "S";
type Category = "knowledge" | "reasoning" | "formatting" | "writing" | "world" | "multiturn";

interface SearchQuery {
  q: string;
  status: number;
  rows: number;
  engines: string[];
  unresponsive: string[];
  stoppedByBench: boolean;
}
interface RunRecord {
  arm: Arm;
  item: string;
  category: Category;
  rep: number;
  turn: number | null; // 1-based turn of a multi-turn script
  prompt: string;
  reply: string;
  words: number;
  ttftMs: number | null;
  totalMs: number | null;
  /** Prompt tokens the engine served from its cache (usage.prompt_tokens_details.cached_tokens or timings.cache_n); null when not reported. */
  cachedTokens?: number | null;
  /** Block mode only (BENCH-AB-02): "cold" when the engine served under half of the prompt from its cache, else "warm". */
  cache?: "cold" | "warm" | null;
  /** Host load and uptime sampled immediately before this generation. */
  hostLoad?: { one: number; five: number; fifteen: number; uptimeSeconds: number; loaded: boolean };
  /** Host load and uptime checked when this arm began. */
  armStart?: { one: number; five: number; fifteen: number; uptimeSeconds: number };
  promptTokens: number | null;
  completionTokens: number | null;
  finishReason: string | null;
  seed: string;
  correct: boolean | null; // reasoning items only
  factsRecalled: { id: string; recalled: boolean }[] | null; // multi-turn turns 8 and 9 only
  error: string | null;
  /** Streamed arms (C, S): the wire events the route would send. */
  stream?: { firstWordMs: number | null; spokenCueMs: number | null; firstStatusMs: number | null; searched: boolean; searchQueries: SearchQuery[]; engineRequests: { promptTokens: number | null; cachedTokens: number | null; tools: number; toolChoice: string | null }[] };
  // arm B only
  b?: {
    engineRequests: number;
    generations: number | null;
    searchFired: boolean;
    searchForced: boolean;
    searchQueries: SearchQuery[];
    source: string | null;
    pluginId: string | null;
    outcomes: string[];
    ttftNote: string;
  };
}

// ==== helpers ====

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Case-insensitive, not inside a longer word or number ("14:10" never satisfies "4:10"). */
function hasNeedle(reply: string, needle: string): boolean {
  return new RegExp(`(?<![\\w.:])${escapeRe(needle.trim())}(?!\\w)`, "i").test(reply);
}
const hasAnyOf = (reply: string, alternatives: string[]) => alternatives.some((n) => hasNeedle(reply, n));
const containsExpected = (reply: string, expectedAll: string[]) => expectedAll.every((group) => hasAnyOf(reply, group.split("|")));

function save(runs: RunRecord[], env: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(RESULTS, JSON.stringify({ environment: env, runs }, null, 2));
}

// ==== rendering (also `--render`) ====

function fmt(n: number | null): string {
  return n === null || Number.isNaN(n) ? "n/a" : String(Math.round(n));
}

function render(runs: RunRecord[], env: unknown): string {
  const lines: string[] = ["# CHAT-AB-01 side by side", "", "Replies are exactly as returned. Arms: A bare, A2 bare plus our sampling, B our pipeline.", "", "## Environment", "", "```json", JSON.stringify(env, null, 2), "```", ""];
  const itemIds = [...new Set(runs.map((r) => r.item))];
  for (const id of itemIds) {
    const forItem = runs.filter((r) => r.item === id);
    const sample = forItem[0]!;
    lines.push(`## ${id} (${sample.category})`, "");
    const turns = [...new Set(forItem.map((r) => r.turn))];
    for (const turn of turns) {
      // Multi-turn: the opening turn and the two recall turns in full here;
      // the filler turns are in results.json.
      if (turn !== null && ![1, 8, 9].includes(turn)) continue;
      const first = forItem.find((r) => r.turn === turn && r.rep === 1) ?? forItem.find((r) => r.turn === turn)!;
      lines.push(turn === null ? `**Prompt:** ${first.prompt}` : `**Turn ${turn} prompt:** ${first.prompt}`, "");
      for (const arm of ["A", "A2", "AP", "AT", "APT", "APM", "B", "C", "S"] as Arm[]) {
        const r = forItem.find((x) => x.arm === arm && x.turn === turn && x.rep === 1);
        if (!r) continue;
        const meta = `${r.words} words, TTFT ${fmt(r.ttftMs)} ms, total ${fmt(r.totalMs)} ms, finish ${r.finishReason ?? "n/a"}` + (r.correct !== null ? `, contains expected answer: ${r.correct}` : "") + (r.factsRecalled ? `, facts recalled: ${r.factsRecalled.filter((f) => f.recalled).length}/${r.factsRecalled.length}` : "") + (r.stream ? `, first word ${fmt(r.stream.firstWordMs)} ms, cue ${fmt(r.stream.spokenCueMs)} ms, searched ${r.stream.searched}` : "") + (r.b ? `, model calls ${r.b.engineRequests}, search fired ${r.b.searchFired}${r.b.searchForced ? " (forced)" : ""}` : "") + (r.error ? `, ERROR: ${r.error}` : "");
        lines.push(`### ${arm} (${meta})`, "", r.reply === "" ? "(empty reply)" : r.reply, "");
      }
    }
  }

  lines.push("## Summary by category and arm", "");
  lines.push("Medians over every run of the category (single-turn items: 2 runs each; multi-turn: all 9 turns of both scripts). Checkable-correct counts the reasoning items only. Multi-turn recall counts stated facts recalled at turns 8 and 9 (3 facts x 2 scripts = 6 per turn).", "");
  lines.push("| Category | Arm | Runs | Median words | Median TTFT ms | Median total ms | Checkable correct | Recall turn 8 | Recall turn 9 |", "|---|---|---:|---:|---:|---:|---|---|---|");
  for (const category of ["knowledge", "reasoning", "formatting", "writing", "world", "multiturn"] as Category[]) {
    for (const arm of ["A", "A2", "AP", "AT", "APT", "APM", "B", "C", "S"] as Arm[]) {
      const rs = runs.filter((r) => r.category === category && r.arm === arm);
      if (rs.length === 0) continue;
      const ok = rs.filter((r) => r.error === null);
      const checkable = rs.filter((r) => r.correct !== null);
      const recall = (turn: number) => {
        const t = rs.filter((r) => r.turn === turn && r.factsRecalled);
        return t.length ? `${t.reduce((n, r) => n + r.factsRecalled!.filter((f) => f.recalled).length, 0)}/${t.reduce((n, r) => n + r.factsRecalled!.length, 0)}` : "-";
      };
      lines.push(
        `| ${category} | ${arm} | ${rs.length} | ${fmt(median(ok.map((r) => r.words)))} | ${fmt(median(ok.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs]))))} | ${fmt(median(ok.flatMap((r) => (r.totalMs === null ? [] : [r.totalMs]))))} | ${checkable.length ? `${checkable.filter((r) => r.correct).length}/${checkable.length}` : "-"} | ${category === "multiturn" ? recall(8) : "-"} | ${category === "multiturn" ? recall(9) : "-"} |`,
      );
    }
  }
  const bad = runs.filter((r) => r.error !== null || r.reply.trim() === "");
  lines.push("", "## Errored or empty runs", "");
  lines.push(bad.length ? bad.map((r) => `- ${r.arm} ${r.item}${r.turn ? ` turn ${r.turn}` : ""} run ${r.rep}: ${r.error ?? "empty reply"}`).join("\n") : "None.");
  return lines.join("\n") + "\n";
}

if (process.argv.includes("--render")) {
  const saved = JSON.parse(readFileSync(RESULTS, "utf-8")) as { environment: unknown; runs: RunRecord[] };
  writeFileSync(SIDE_BY_SIDE, render(saved.runs, saved.environment));
  console.log(`wrote ${SIDE_BY_SIDE}`);
  process.exit(0);
}

// ==== live run ====

refuseIfGateRunning("chat-ab-01");
const chatUrl = process.env.MAIPAI_LLAMA_SERVER_URL;
if (!chatUrl) {
  console.error("chat-ab-01 refused: MAIPAI_LLAMA_SERVER_URL is not set; the bench connects only to an engine already running.");
  process.exit(2);
}
const realSearxng = process.env.MAIPAI_BENCH_REAL_SEARXNG_URL;
const selectedSearchFreeItems = GROUP === "adult" && ONLY !== null && ONLY.size > 0 && [...ONLY].every((id) => SEARCH_FREE_ITEMS.has(id));
if (!realSearxng && !selectedSearchFreeItems) {
  console.error("chat-ab-01 refused: MAIPAI_BENCH_REAL_SEARXNG_URL is not set (arm B uses the real SearXNG, cleared per run).");
  process.exit(2);
}
if (realSearxng) refuseRealSearxngWithoutClearance("chat-ab-01", realSearxng);

// Arms A and A2 talk to the engine directly; arm B reaches it through the
// recording proxy (so the requests of each turn can be read), which only
// forwards.
const directUrl = chatUrl.replace(/\/$/, "");
const embedUrl = (process.env.MAIPAI_EMBED_URL ?? "").replace(/\/$/, "");
if (!embedUrl) {
  console.error("chat-ab-01 refused: MAIPAI_EMBED_URL is not set.");
  process.exit(2);
}
const proxy = startRecordingProxy(chatUrl);

// ---- the Stack stand-in ----
// Home's chat and embedding calls now go to the MaiPai Stack's role routes
// (llm.ts: "Home chat always goes through the Stack when it is
// configured"), and role health is read from the Stack's /stack/v1/roles.
// The production Stack is the household's own and is off limits, so this
// is a thin stand-in on a loopback port: it answers healthz and roles and
// forwards /v1/chat/completions (through the recording proxy, to the one
// side llama-server) and /v1/embeddings (to the side embed engine)
// byte for byte. It adds no behaviour; the engine the pipeline talks to is
// the same llama-server the bare arms hit.
// The Stack has no /props; the engine build and model file come from the
// response headers of one tiny completion (x-maipai-engine, x-maipai-model).
const probe = await fetch(`${directUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: STACK_CHAT_MODEL, messages: [{ role: "user", content: "Say hi" }], max_tokens: 4, stream: false, chat_template_kwargs: { enable_thinking: false } }), signal: AbortSignal.timeout(240_000) });
if (!probe.ok) {
  console.error(`chat-ab-01 refused: the Stack's chat role answered ${probe.status}: ${(await probe.text()).slice(0, 300)}`);
  process.exit(2);
}
const engineHeaders = { "x-maipai-engine": probe.headers.get("x-maipai-engine") ?? "unknown", "x-maipai-model": probe.headers.get("x-maipai-model") ?? "unknown" };
await probe.text();
const roleRow = (id: string, wire: string) => ({ id, label: id, wire, residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null, state: { state: "ready", reason: null }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } });
// The persona/clock system lines and the tools block of a real B request,
// frozen by the first one that carries tools (arms AP, AT, APT replay them).
const captured: { system: { role: string; content: string }[]; tools: unknown[]; toolChoice: unknown } = { system: [], tools: [], toolChoice: undefined };
const stackStandIn = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/healthz") return Response.json({ ok: true, version: "chat-ab-01-stand-in", uptimeSeconds: 0 });
    if (req.method === "GET" && path === "/health") return Response.json({ status: "ok" });
    if (req.method === "GET" && path === "/stack/v1/roles") return Response.json({ roles: [roleRow("chat", "chat"), roleRow("judge", "chat"), roleRow("embed", "embeddings")] });
    // MAIPAI_AB_EMBED=off: answer an embedding request at once with the
    // refusal the Stack itself gives when it cannot load the embed role
    // (a 503), without waiting the Stack's 15 s memory wait. Used only when
    // the machine is under memory pressure; the environment block records it.
    if (req.method === "POST" && path === "/v1/embeddings" && EMBED_OFF) return Response.json({ error: "No engine is ready for role 'embed'.", role: "embed", state: "offline", offline_reason: "bench: embed treated as offline (MAIPAI_AB_EMBED=off)" }, { status: 503, headers: engineHeaders });
    if (req.method === "POST" && (path === "/v1/chat/completions" || path === "/v1/embeddings")) {
      const target = path === "/v1/chat/completions" ? proxy.url : embedUrl;
      const sentAt = performance.now();
      const bodyText = await req.text();
      if (path === "/v1/chat/completions" && captured.tools.length === 0) {
        try {
          const b = JSON.parse(bodyText) as { messages?: { role: string; content: string }[]; tools?: unknown[]; tool_choice?: unknown };
          if (b.tools && b.tools.length > 0) Object.assign(captured, { system: (b.messages ?? []).filter((m) => m.role === "system"), tools: b.tools, toolChoice: b.tool_choice });
        } catch {
          // not JSON: nothing to capture
        }
      }
      const upstream = await fetch(`${target.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyText, signal: req.signal });
      if (process.env.MAIPAI_AB_TRACE === "1") console.log(`[stand-in] ${path} headers after ${Math.round(performance.now() - sentAt)} ms, status ${upstream.status}`);
      return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", ...engineHeaders } });
    }
    return new Response("not found", { status: 404 });
  },
});
process.env.MAIPAI_LLAMA_SERVER_URL = stackStandIn.url.toString().replace(/\/$/, "");
process.env.MAIPAI_EMBED_URL = process.env.MAIPAI_LLAMA_SERVER_URL;

// ---- the search tee ----
// A pass-through in front of the real SearXNG: forwards every query
// unchanged, records the status, the rows, which engines answered and
// which were unresponsive, paces searched turns, and at the first
// rate-limit or block signal stops all searching (later queries get a 503,
// the shape of a down SearXNG) and records why.
const tee = {
  queries: [] as SearchQuery[],
  lastSearchAt: 0,
  stopped: false,
  stopReason: null as string | null,
};
const teeServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    if (tee.stopped) {
      tee.queries.push({ q, status: 503, rows: 0, engines: [], unresponsive: [], stoppedByBench: true });
      return new Response("search stopped by the bench", { status: 503 });
    }
    tee.lastSearchAt = Date.now();
    let upstream: Response;
    try {
      if (!realSearxng) throw new Error("search-free bench selection attempted a search");
      upstream = await fetch(new URL(url.pathname + url.search, realSearxng), { method: req.method, headers: { accept: req.headers.get("accept") ?? "application/json" } });
    } catch (err) {
      tee.queries.push({ q, status: 0, rows: 0, engines: [], unresponsive: [(err as Error).message], stoppedByBench: false });
      return new Response("upstream unreachable", { status: 502 });
    }
    const text = await upstream.text();
    tee.lastSearchAt = Date.now();
    let rows = 0;
    let engines: string[] = [];
    let unresponsive: string[] = [];
    try {
      const body = JSON.parse(text) as { results?: { engines?: string[] }[]; unresponsive_engines?: unknown[] };
      rows = body.results?.length ?? 0;
      engines = [...new Set((body.results ?? []).flatMap((r) => r.engines ?? []))];
      unresponsive = (body.unresponsive_engines ?? []).map((e) => (Array.isArray(e) ? e.join(": ") : String(e)));
    } catch {
      // not JSON: the status line below says what it was
    }
    const blocked = upstream.status === 429 || upstream.status === 403 || unresponsive.some((u) => /suspend|captcha|too many|rate.?limit|blocked|denied/i.test(u));
    tee.queries.push({ q, status: upstream.status, rows, engines, unresponsive, stoppedByBench: false });
    if (blocked) {
      tee.stopped = true;
      tee.stopReason = `status ${upstream.status}; unresponsive engines: ${unresponsive.join(" | ") || "none listed"}; query "${q}"`;
      console.error(`[chat-ab-01] SEARCH STOPPED: rate-limit or block signal (${tee.stopReason})`);
    }
    return new Response(text, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  },
});
const teeUrl = `http://127.0.0.1:${teeServer.port}`;

const setup = await import("./setup");
const { startBench, finishBench } = setup;
const runner = await import("./conversationRunner");
const { CHAT_SAMPLING } = await import("@/lib/llm");
const { setHouseholdSettingValue } = await import("@/lib/settings");

// ==== arms A and A2 ====

interface BareResult {
  reply: string;
  ttftMs: number | null;
  totalMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  finishReason: string | null;
  cachedTokens: number | null;
  error: string | null;
}

async function bareCompletion(messages: { role: string; content: string }[], sampling: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<BareResult> {
  const t0 = performance.now();
  let reply = "";
  let ttftMs: number | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let finishReason: string | null = null;
  let cachedTokens: number | null = null;
  try {
    const res = await fetch(`${directUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Thinking off is also the engine's launch default (--reasoning off);
      // sent per request too so the arm does not depend on that.
      body: JSON.stringify({ model: STACK_CHAT_MODEL, messages, max_tokens: MAX_TOKENS, stream: true, stream_options: { include_usage: true }, chat_template_kwargs: { enable_thinking: false }, ...sampling, ...extra }),
    });
    if (!res.ok || !res.body) return { reply, ttftMs, totalMs: performance.now() - t0, promptTokens, completionTokens, finishReason, cachedTokens, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }; timings?: { prompt_n?: number; predicted_n?: number; cache_n?: number } };
        const choice = chunk.choices?.[0];
        const piece = choice?.delta?.content;
        if (piece) {
          if (ttftMs === null && piece.trim()) ttftMs = performance.now() - t0;
          reply += piece;
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
          cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? cachedTokens;
        }
        if (chunk.timings) {
          promptTokens ??= (chunk.timings.prompt_n ?? 0) + (chunk.timings.cache_n ?? 0);
          completionTokens ??= chunk.timings.predicted_n ?? null;
          cachedTokens ??= chunk.timings.cache_n ?? null;
        }
      }
    }
    return { reply, ttftMs, totalMs: performance.now() - t0, promptTokens, completionTokens, finishReason, cachedTokens, error: null };
  } catch (err) {
    return { reply, ttftMs, totalMs: performance.now() - t0, promptTokens, completionTokens, finishReason, cachedTokens, error: (err as Error).message };
  }
}

// ==== arm B ====

const people = runner.createBenchPeople();
const log = runner.captureTurnLog();
const homeAssistant = runner.startFakeHomeAssistant();

// The recording proxy wrapped so each turn's requests survive the runner's
// per-turn reset(): snapshots[k] holds turn k-1's requests (snapshots[0] is
// empty); the last turn's are read from proxy.requests after the run.
function snapshottingProxy(base: RecordingProxy, snapshots: RecordedRequest[][]): RecordingProxy {
  return {
    ...base,
    reset: () => {
      snapshots.push(base.requests.map((r) => ({ ...r })));
      base.reset();
    },
  };
}

/** Drives one conversation (one or more turns) through the real turn path. */
async function runPipeline(id: string, prompts: string[]): Promise<{ turns: Omit<RunRecord, "arm" | "item" | "category" | "rep" | "turn" | "prompt" | "correct" | "factsRecalled" | "seed">[] }> {
  const snapshots: RecordedRequest[][] = [];
  const markers: number[] = [];
  const stamp = { waited: 0 };
  const run = await runner.runConversation(
    { id: `chat-ab-${id}`, category: "knowledge", note: "CHAT-AB-01 arm B", turns: prompts.map((say) => ({ say, expect: { guard: null, humanVerdict: true } })) },
    {
      people,
      proxy: snapshottingProxy(proxy, snapshots),
      log,
      drainJudge: async () => {},
      backdate: () => {},
      homeAssistant,
      beforeTurn: async () => {
        // A person's pace: at least 30 s between any two turns that searched.
        const since = Date.now() - tee.lastSearchAt;
        if (tee.lastSearchAt > 0 && since < SEARCH_PACE_MS) {
          stamp.waited += SEARCH_PACE_MS - since;
          await new Promise((r) => setTimeout(r, SEARCH_PACE_MS - since));
        }
        await waitForHubQuiet(undefined, (m) => console.log(m));
        markers.push(tee.queries.length);
      },
    },
  );
  markers.push(tee.queries.length);
  const perTurnRequests = [...snapshots.slice(1), proxy.requests.map((r) => ({ ...r }))];
  const turns = run.scores.map((score, i) => {
    const requests = perTurnRequests[i] ?? [];
    const queries = tee.queries.slice(markers[i] ?? 0, markers[i + 1] ?? tee.queries.length);
    const trace = score.observed.generationTrace ?? null;
    const completion = trace ? trace.reduce((n, g) => n + (g.predicted_n ?? 0), 0) : null;
    const promptSum = requests.reduce((n, r) => n + (r.promptTokens ?? 0), 0);
    const reply = score.observed.reply;
    const failed = /^\[error: /.test(reply);
    return {
      reply: failed ? "" : reply,
      words: failed ? 0 : words(reply),
      ttftMs: score.observed.firstDeltaMs,
      totalMs: score.observed.totalMs,
      promptTokens: requests.some((r) => r.promptTokens !== undefined) ? promptSum : null,
      completionTokens: completion,
      cachedTokens: requests[0]?.cachedTokens ?? null,
      // The pipeline does not record the engine's finish reason; not reconstructed.
      finishReason: null as string | null,
      error: failed ? reply : null,
      b: {
        engineRequests: requests.length,
        generations: trace ? trace.length : null,
        searchFired: queries.some((x) => x.q !== "") || requests.some((r) => r.toolChoice === "required") || (score.observed.outcomes ?? []).some((o) => /search/i.test(o.packageId)),
        searchForced: requests.some((r) => r.toolChoice === "required"),
        searchQueries: queries,
        source: score.observed.source,
        pluginId: score.observed.pluginId,
        outcomes: (score.observed.outcomes ?? []).map((o) => o.packageId),
        ttftNote: "first delta of the turn's first stored generation; on a searched turn that may be the tool-call generation, not the final text",
      },
    };
  });
  return { turns };
}

// ==== arms C and S: the route's own stream ====

/** Drives one turn the way routes/turn.ts does: runTurnNextStream, then
 * streamTurnEvents (the route's own event generator, 900 ms cue included).
 * The clock starts before the turn begins, so first word is what a person
 * waits from the moment they finish asking. */
async function streamTurn(actor: { id: string; role?: string }, surface: "chat" | "robot", text: string, spoken: boolean, dropReasoning: boolean): Promise<{ reply: string; error: string | null; firstWordMs: number | null; spokenCueMs: number | null; firstStatusMs: number | null; totalMs: number }> {
  const { createConversation } = await import("@/lib/conversationHistory");
  const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
  const { streamTurnEvents } = await import("@/routes/turn");
  const created = createConversation(actor as never, { surface });
  if (!created.ok) throw new Error(`createConversation: ${created.error}`);
  const t0 = performance.now();
  const at = () => performance.now() - t0;
  let reply = "";
  let firstWordMs: number | null = null;
  let spokenCueMs: number | null = null;
  let firstStatusMs: number | null = null;
  try {
    const result = await runTurnNextStream(actor as never, surface, text, { conversationId: created.value.id, spoken, thinking: dropReasoning ? false : undefined });
    if (!result.ok) return { reply: "", error: result.error, firstWordMs, spokenCueMs, firstStatusMs, totalMs: at() };
    if (result.kind === "immediate") {
      reply = result.value.reply.text;
      return { reply, error: null, firstWordMs: at(), spokenCueMs, firstStatusMs, totalMs: at() };
    }
    for await (const event of streamTurnEvents(result, actor.id, 900, undefined, dropReasoning)) {
      if (event.type === "delta") {
        reply += event.text;
        if (firstWordMs === null && event.text.trim()) firstWordMs = at();
      } else if (event.type === "spoken_cue") {
        spokenCueMs ??= at();
      } else if (event.type === "status") {
        firstStatusMs ??= at();
      } else if (event.type === "done") {
        if (reply.trim() === "") reply = event.value.reply.text; // a resolved or refused turn streams no deltas
        if (firstWordMs === null && reply.trim()) firstWordMs = at();
      } else if (event.type === "error") {
        return { reply, error: JSON.stringify(event).slice(0, 300), firstWordMs, spokenCueMs, firstStatusMs, totalMs: at() };
      }
    }
    return { reply, error: null, firstWordMs, spokenCueMs, firstStatusMs, totalMs: at() };
  } catch (err) {
    return { reply, error: (err as Error).message, firstWordMs, spokenCueMs, firstStatusMs, totalMs: at() };
  }
}

async function pacedBeforeSearchTurn(): Promise<void> {
  const since = Date.now() - tee.lastSearchAt;
  if (tee.lastSearchAt > 0 && since < SEARCH_PACE_MS) await new Promise((r) => setTimeout(r, SEARCH_PACE_MS - since));
  await waitForHubQuiet(undefined, (m) => console.log(m));
}

// ==== the run ====

async function environment(): Promise<Record<string, unknown>> {
  const roles = (await (await fetch(`${directUrl}/stack/v1/roles`)).json()) as { roles?: { id: string; model?: { id?: string; sizeBytes?: number; measuredContextLength?: number } | null }[] };
  const chatRole = roles.roles?.find((r) => r.id === "chat");
  const sh = (cmd: string) => {
    try {
      return execSync(cmd, { encoding: "utf-8" }).trim();
    } catch {
      return "n/a";
    }
  };
  return {
    date: new Date().toISOString(),
    group: GROUP,
    embedRole: EMBED_OFF ? "treated as offline by the stand-in (the Stack refused it for memory pressure: it waits 15 s, then answers 503)" : "forwarded to the Stack as is",
    engineBuild: engineHeaders["x-maipai-engine"],
    modelFile: engineHeaders["x-maipai-model"],
    stackChatRoleModel: chatRole?.model?.id ?? "n/a",
    contextSizeMeasuredByStack: chatRole?.model?.measuredContextLength ?? null,
    chatSamplingForA2: CHAT_SAMPLING,
    hardware: `${sh("sysctl -n machdep.cpu.brand_string")}, ${Math.round(Number(sh("sysctl -n hw.memsize")) / 1024 ** 3)} GB unified memory`,
    thinking: "off in all arms (arms A and A2 send enable_thinking=false; the pipeline sends thinking off)",
    arms: { A: `no system prompt, no sampling fields, max_tokens ${MAX_TOKENS}, stream`, A2: "A plus CHAT_SAMPLING", C: "the child bench person on the default turn path, chat surface, streamed", S: "the owner on the default turn path, chat surface with the spoken flag, streamed; first word is the first answer delta", B: "runConversation() through a loopback stand-in for the Stack that forwards to the same engine, adult owner, chat surface, memory judge off (no background engine), real SearXNG through a pass-through tee, Wikipedia fallback at its default (on)" },
    seeds: "none sent by any arm; the engine and the pipeline sample with their own random seeds, so the two runs of an item differ",
    searchTee: "all arm B searches paced at least 30 s apart; stops at the first rate-limit or block signal",
  };
}

async function main(): Promise<void> {
  await startBench();
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
  const set = setHouseholdSettingValue("search.searxng_url", teeUrl);
  if (!set.ok) throw new Error(`could not point search at the tee: ${set.error}`);

  const env = await environment();
  console.log(JSON.stringify(env, null, 2));
  const runs: RunRecord[] = [];
  const base = { seed: "engine-random" };

  const wanted = (id: string) => !ONLY || ONLY.has(id);

  // Single-turn items: item -> run -> arms, so drift hits the arms alike.
  if (GROUP === "child") {
    for (const id of dataset.child.items) {
      const item = dataset.items.find((i) => i.id === id);
      if (!item || !wanted(id)) continue;
      for (let rep = 1; rep <= SINGLE_RUNS; rep++) {
        console.log(`[chat-ab-01] ${id} run ${rep} arm C`);
        await pacedBeforeSearchTurn();
        const mark = tee.queries.length;
        proxy.reset();
        const r = await streamTurn(people.child, "chat", item.prompt, false, true);
        const queries = tee.queries.slice(mark);
        runs.push({ ...base, arm: "C", item: id, category: item.category as Category, rep, turn: null, prompt: item.prompt, reply: r.error ? "" : r.reply, words: r.error ? 0 : words(r.reply), ttftMs: r.firstWordMs, totalMs: r.totalMs, promptTokens: null, completionTokens: null, finishReason: null, correct: "expectedAll" in item && item.expectedAll ? containsExpected(r.reply, item.expectedAll as string[]) : null, factsRecalled: null, error: r.error, stream: { firstWordMs: r.firstWordMs, spokenCueMs: r.spokenCueMs, firstStatusMs: r.firstStatusMs, searched: queries.length > 0, searchQueries: queries, engineRequests: proxy.requests.map((q) => ({ promptTokens: q.promptTokens ?? null, cachedTokens: q.cachedTokens ?? null, tools: q.tools.length, toolChoice: q.toolChoice ?? null })) } });
        save(runs, env);
      }
    }
  }
  if (GROUP === "spoken") {
    const rows = [...dataset.spoken.general.map((id) => ({ id, searching: false })), ...dataset.spoken.searching.map((x) => ({ id: x.id, searching: true }))];
    for (const row of rows) {
      const found = dataset.items.find((i) => i.id === row.id) ?? dataset.spoken.searching.find((x) => x.id === row.id);
      if (!found || !wanted(row.id)) continue;
      const category = ("category" in found ? found.category : "world") as Category;
      for (let rep = 1; rep <= (row.searching ? 1 : SINGLE_RUNS); rep++) {
        console.log(`[chat-ab-01] ${row.id} run ${rep} arm S`);
        await pacedBeforeSearchTurn();
        const mark = tee.queries.length;
        proxy.reset();
        const r = await streamTurn(people.owner, "chat", found.prompt, true, true);
        const queries = tee.queries.slice(mark);
        runs.push({ ...base, arm: "S", item: row.id, category, rep, turn: null, prompt: found.prompt, reply: r.error ? "" : r.reply, words: r.error ? 0 : words(r.reply), ttftMs: r.firstWordMs, totalMs: r.totalMs, promptTokens: null, completionTokens: null, finishReason: null, correct: "expectedAll" in found && found.expectedAll ? containsExpected(r.reply, found.expectedAll as string[]) : null, factsRecalled: null, error: r.error, stream: { firstWordMs: r.firstWordMs, spokenCueMs: r.spokenCueMs, firstStatusMs: r.firstStatusMs, searched: queries.length > 0, searchQueries: queries, engineRequests: proxy.requests.map((q) => ({ promptTokens: q.promptTokens ?? null, cachedTokens: q.cachedTokens ?? null, tools: q.tools.length, toolChoice: q.toolChoice ?? null })) } });
        save(runs, env);
      }
    }
  }
  if (GROUP === "adult" && ARMS) {
    // Block mode (THIN-Q2, BENCH-AB-02): arm, then item, then run. A 503 for
    // memory is retried once after 60 s; a second one stops the run.
    const retry503 = async <T extends { error: string | null }>(go: () => Promise<T>): Promise<T> => {
      let r = await go();
      if (r.error && /503|memory budget|offline/i.test(r.error)) {
        console.log(`[chat-ab-01] 503, offline_reason verbatim: ${r.error}`);
        await new Promise((res) => setTimeout(res, 60_000));
        r = await go();
        if (r.error && /503|memory budget|offline/i.test(r.error)) {
          console.log(`[chat-ab-01] SECOND 503, stopping: ${r.error}`);
          save(runs, env);
          throw new Error(`second memory 503: ${r.error}`);
        }
      }
      return r;
    };
    if (ARMS.some((a) => ["AP", "AT", "APT", "APM"].includes(a)) && captured.tools.length === 0) {
      console.log("[chat-ab-01] capture turn (one real B request, to freeze Home's persona, clock and tools block)");
      await retry503(async () => {
        const out = await runPipeline("capture", ["Say hi"]);
        const t = out.turns[0];
        return { error: t ? t.error : "the pipeline returned no turn" };
      });
      if (captured.tools.length === 0) throw new Error("capture failed: no B request carried a tools block");
      console.log(`[chat-ab-01] captured ${captured.system.length} system messages (${captured.system.map((m) => m.content.length).join("+")} chars) and ${captured.tools.length} tools (${JSON.stringify(captured.tools).length} chars)`);
    }
    for (const arm of ARMS) {
      const armLoads = loadavg();
      const armStart = { one: armLoads[0]!, five: armLoads[1]!, fifteen: armLoads[2]!, uptimeSeconds: uptime() };
      console.log(`[chat-ab-01] starting arm ${arm}; uptime ${Math.round(armStart.uptimeSeconds)} s; load ${armStart.one.toFixed(2)} ${armStart.five.toFixed(2)} ${armStart.fifteen.toFixed(2)}`);
      for (const item of dataset.items.filter((i) => wanted(i.id))) {
        const category = item.category as Category;
        for (let rep = 1; rep <= SINGLE_RUNS; rep++) {
          console.log(`[chat-ab-01] block ${arm} ${item.id} run ${rep}`);
          await waitForHubQuiet(undefined, (m) => console.log(m));
          const loads = loadavg();
          const hostLoad = { one: loads[0]!, five: loads[1]!, fifteen: loads[2]!, uptimeSeconds: uptime(), loaded: loads[0]! > 8 };
          console.log(`[chat-ab-01] host load ${hostLoad.one.toFixed(2)} ${hostLoad.five.toFixed(2)} ${hostLoad.fifteen.toFixed(2)}; uptime ${Math.round(hostLoad.uptimeSeconds)} s${hostLoad.loaded ? "; LOADED" : ""}`);
          if (arm === "B") {
            const t = await retry503(async () => {
              const out = await runPipeline(`${item.id}-${rep}`, [item.prompt]);
              return out.turns[0] ?? { error: "the pipeline returned no turn" };
            });
            if (!("reply" in t)) {
              runs.push({ ...base, arm, item: item.id, category, rep, turn: null, prompt: item.prompt, reply: "", words: 0, ttftMs: null, totalMs: null, promptTokens: null, completionTokens: null, finishReason: null, correct: null, factsRecalled: null, error: t.error });
            } else {
              runs.push({ ...base, ...t, arm, item: item.id, category, rep, turn: null, prompt: item.prompt, correct: null, factsRecalled: null });
            }
          } else {
            const withP = arm === "AP" || arm === "APT" || arm === "APM";
            const withT = arm === "AT" || arm === "APT" || arm === "APM";
            const messages = [...(withP ? captured.system : []), { role: "user", content: item.prompt }];
            const tools = arm === "APM" ? captured.tools.map((tool) => {
              const copy = structuredClone(tool) as { function: { name: string; description: string; parameters: unknown } };
              const concise: Record<string, string> = {
                "almanac-date": "Get today's date and day of the week.",
                "almanac-time": "Get the current local time.",
                convert: "Convert a quantity between units.",
                math: "Calculate a mathematical expression.",
                remember: "Save a fact the person asks you to remember.",
                remind: "Create a reminder for the person.",
                start_project: "Start a project with the requested details.",
                timer: "Set or check a timer.",
                weather: "Get current weather or a forecast for a place.",
                websearch: "Search the web and read relevant pages; follow-up searches can refer to the previous subject.",
              };
              const description = concise[copy.function.name];
              if (!description) throw new Error(`APM has no concise description for ${copy.function.name}`);
              copy.function.description = description;
              return copy;
            }) : captured.tools;
            const extra = withT ? { tools, ...(captured.toolChoice !== undefined ? { tool_choice: captured.toolChoice } : {}) } : {};
            // A is the bare arm with no sampling fields; every other bare arm sends CHAT_SAMPLING, as B does.
            const r = await retry503(() => bareCompletion(messages, arm === "A" ? {} : { ...CHAT_SAMPLING }, extra));
            runs.push({ ...base, arm, item: item.id, category, rep, turn: null, prompt: item.prompt, reply: r.reply, words: words(r.reply), ttftMs: r.ttftMs, totalMs: r.totalMs, cachedTokens: r.cachedTokens, promptTokens: r.promptTokens, completionTokens: r.completionTokens, finishReason: r.finishReason, correct: null, factsRecalled: null, error: r.error });
          }
          const last = runs[runs.length - 1]!;
          last.hostLoad = hostLoad;
          last.armStart = armStart;
          last.cache = last.cachedTokens == null || last.promptTokens == null ? null : last.cachedTokens < last.promptTokens / 2 ? "cold" : "warm";
          save(runs, env);
        }
      }
    }
  }
  if (GROUP === "adult" && !ARMS) for (const item of dataset.items.filter((i) => wanted(i.id))) {
    const category = item.category as Category;
    for (let rep = 1; rep <= SINGLE_RUNS; rep++) {
      for (const arm of ["A", "A2", "B"] as Arm[]) {
        console.log(`[chat-ab-01] ${item.id} run ${rep} arm ${arm}`);
        await waitForHubQuiet(undefined, (m) => console.log(m));
        const correct = (reply: string) => ("expectedAll" in item && item.expectedAll ? containsExpected(reply, item.expectedAll as string[]) : null);
        if (arm === "B") {
          const out = await runPipeline(`${item.id}-${rep}`, [item.prompt]);
          const t = out.turns[0];
          if (!t) {
            runs.push({ ...base, arm, item: item.id, category, rep, turn: null, prompt: item.prompt, reply: "", words: 0, ttftMs: null, totalMs: null, promptTokens: null, completionTokens: null, finishReason: null, correct: null, factsRecalled: null, error: "the pipeline returned no turn" });
          } else {
            runs.push({ ...base, ...t, arm, item: item.id, category, rep, turn: null, prompt: item.prompt, correct: correct(t.reply), factsRecalled: null });
          }
        } else {
          const r = await bareCompletion([{ role: "user", content: item.prompt }], arm === "A2" ? { ...CHAT_SAMPLING } : {});
          runs.push({ ...base, arm, item: item.id, category, rep, turn: null, prompt: item.prompt, reply: r.reply, words: words(r.reply), ttftMs: r.ttftMs, totalMs: r.totalMs, promptTokens: r.promptTokens, completionTokens: r.completionTokens, finishReason: r.finishReason, correct: correct(r.reply), factsRecalled: null, error: r.error });
        }
        save(runs, env);
      }
    }
  }

  // Multi-turn scripts: once per arm. A and A2 carry the whole history
  // (their own earlier replies); B's pipeline carries it.
  const withScripts = GROUP === "adult" && process.argv.includes("--scripts");
  for (const script of withScripts ? dataset.scripts.filter((s) => wanted(s.id)) : []) {
    const recall = (reply: string) => script.facts.map((f) => ({ id: f.id, recalled: hasAnyOf(reply, f.needles) }));
    for (const arm of ["A", "A2", "B"] as Arm[]) {
      console.log(`[chat-ab-01] ${script.id} arm ${arm}`);
      if (arm === "B") {
        const out = await runPipeline(script.id, script.turns);
        script.turns.forEach((prompt, i) => {
          const t = out.turns[i];
          const turn = i + 1;
          if (!t) {
            runs.push({ ...base, arm, item: script.id, category: "multiturn", rep: 1, turn, prompt, reply: "", words: 0, ttftMs: null, totalMs: null, promptTokens: null, completionTokens: null, finishReason: null, correct: null, factsRecalled: null, error: "the pipeline returned no turn" });
            return;
          }
          runs.push({ ...base, ...t, arm, item: script.id, category: "multiturn", rep: 1, turn, prompt, correct: null, factsRecalled: turn >= 8 ? recall(t.reply) : null });
        });
        save(runs, env);
      } else {
        const history: { role: string; content: string }[] = [];
        for (let i = 0; i < script.turns.length; i++) {
          const prompt = script.turns[i]!;
          const turn = i + 1;
          await waitForHubQuiet(undefined, (m) => console.log(m));
          history.push({ role: "user", content: prompt });
          const r = await bareCompletion(history, arm === "A2" ? { ...CHAT_SAMPLING } : {});
          history.push({ role: "assistant", content: r.reply });
          runs.push({ ...base, arm, item: script.id, category: "multiturn", rep: 1, turn, prompt, reply: r.reply, words: words(r.reply), ttftMs: r.ttftMs, totalMs: r.totalMs, promptTokens: r.promptTokens, completionTokens: r.completionTokens, finishReason: r.finishReason, correct: null, factsRecalled: turn >= 8 ? recall(r.reply) : null, error: r.error });
          save(runs, env);
        }
      }
    }
  }

  const envWithSearch = { ...env, search: { stopped: tee.stopped, stopReason: tee.stopReason, queries: tee.queries.length, rowsPerQuery: tee.queries.map((q) => ({ q: q.q, status: q.status, rows: q.rows, engines: q.engines, unresponsive: q.unresponsive })) } };
  save(runs, envWithSearch);
  writeFileSync(SIDE_BY_SIDE, render(runs, envWithSearch));
  console.log(`wrote ${RESULTS} and ${SIDE_BY_SIDE}`);
  runner.cleanupBenchPeople(people);
  finishBench({ executed: runs.length, engine: `chat ${String((env as { engineBuild: unknown }).engineBuild)} ${String((env as { modelFile: unknown }).modelFile)}` });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  log.stop();
  homeAssistant.stop();
  teeServer.stop(true);
  stackStandIn.stop(true);
  proxy.stop();
  if (process.exitCode) process.exit(process.exitCode as number);
}
