// STYLE-BENCH-01 (docs/plans/style-bench-01-2026-09-29.md; the exact
// spec is docs/BACKLOG.md's own STYLE-BENCH-01 row, this file follows
// it, not the other way around): the fidelity gate for the four trained
// companion voice adapters (STYLE-TRAIN-01, 1e3ff6dd). Proves, per
// companion, whether the adapter carries the companion's voice without
// moving the substance, the cost, or tool calling - a companion that
// clears the bar ships; one that doesn't ships without an adapter and
// keeps today's behavior. Built on two existing benches, mirrored, not
// reinvented: steering-spike.ts's runner (the thirty spoken turns, one
// growing conversation, identity-only system prompt for the informational
// arms) and written-set.ts's rows (WRITTEN_QUESTIONS, imported directly,
// never re-typed).
//
// Five arms, per docs/dev.md's own design table ("Bench (STYLE-BENCH-01,
// the gate)"):
//   A, floor    - identity line only, no adapter (the bare reply floor)
//   B, shipped  - the REAL contextToMessages() composition (today's
//                 behavior), no adapter
//   C, adapter  - B's prompt byte-identical, `lora: [{id, scale: 1.0}]`
//   D, vector   - informational: a control vector trained on this
//                 companion's own `examples`, `--control-vector`, the
//                 spike's identity-only prompt
//   E, strength - informational: arm C's prompt, scale 0.5 and 1.5
//
// How "byte-identical" is actually achieved: arm B's prompt is never
// hand-approximated. Each spoken/written row runs ONCE through the real
// turn machine (runTurnNext(), the same function routes/turn.ts calls
// for a real household turn), through a small capture proxy this file
// owns (NOT recordingProxy.ts's RecordingProxy, which only keeps
// `systemText`, never the full wire body arm C needs to replay). That
// captured raw JSON body - the actual bytes contextToMessages() +
// chatRequestBody() produced - is what arms B(seeds 2-3)/C/E replay
// directly against the engine's /v1/chat/completions, adding only
// `lora` (and, for E, its scale). This is stronger than reconstructing
// the prompt a second time: a second call through the real turn machine
// risks a clock-line or cache-state difference chatRequestBody() itself
// wouldn't reintroduce identically. Arm B's own seed-1 run is the one
// real turn that ALSO advances the spoken class's real conversation
// window (so turn N's captured prompt genuinely reflects a real
// conversation up to turn N-1, replies from arm B's actual model, not a
// synthetic history) - arms A and D never see that window; they hold
// their own growing "identity-line-only" conversation instead, exactly
// steering-spike.ts's own original shape, per the row's own words ("the
// spike's identity-only prompt" for D, "identity line only" for A).
//
// Operator setup (mirrors steering-spike.ts's own header exactly - this
// script never spawns an engine itself, see that file's own comment on
// why): spawn the engine BY HAND on a spare port, point
// MAIPAI_LLAMA_SERVER_URL/MAIPAI_EMBED_URL at it, then run this script.
//
//   LLAMA=<engine dir>/llama-server
//   MODEL=<models dir>/qwen3-8b-instruct-q4-k-m.gguf
//   ADAPTERS=<dir with buddy/default/pal/tutor -qwen3-8b-instruct-q4-k-m.gguf>
//
//   # Arms A/B/C/E (all four companions' adapters loaded at once,
//   # scale 0 until a request's own `lora` field selects one - the
//   # production shape docs/dev.md's own "The concurrency resolution"
//   # describes):
//   $LLAMA -m $MODEL --port 8734 --reasoning off \
//     --lora "$ADAPTERS/buddy-qwen3-8b-instruct-q4-k-m.gguf,$ADAPTERS/default-qwen3-8b-instruct-q4-k-m.gguf,$ADAPTERS/pal-qwen3-8b-instruct-q4-k-m.gguf,$ADAPTERS/tutor-qwen3-8b-instruct-q4-k-m.gguf" \
//     --lora-init-without-apply &
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8734 MAIPAI_EMBED_URL=<embed url> \
//     bun run scripts/bench/style-adapter.ts --arms A,B,C,E
//
//   # Arm D, per companion (a fresh trained control vector each time -
//   # stop the engine above first, one model in memory at a time):
//   <engine dir>/llama-cvector-generator -m $MODEL \
//     --positive-file <this run's positive.txt> --negative-file <negative.txt> \
//     -o <company>.gguf
//   $LLAMA -m $MODEL --port 8734 --reasoning off --control-vector <company>.gguf &
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8734 MAIPAI_EMBED_URL=<embed url> \
//     bun run scripts/bench/style-adapter.ts --arms D --company <company>
//
//   # The companion-switch prefix re-evaluation (against the multi-
//   # adapter engine above):
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8734 MAIPAI_EMBED_URL=<embed url> \
//     bun run scripts/bench/style-adapter.ts --switch-cost
//
//   # scripts/bench/tool-calling.ts "with the adapter on" (unmodified -
//   # this file owns no change to that script): spawn a THIRD engine
//   # shape per companion, the adapter applied by DEFAULT (no
//   # --lora-init-without-apply, so every request carries it without
//   # needing a `lora` field at all):
//   $LLAMA -m $MODEL --port 8734 --reasoning off --lora "$ADAPTERS/<company>-qwen3-8b-instruct-q4-k-m.gguf" &
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8734 MAIPAI_EMBED_URL=<embed url> MAIPAI_BENCH_REPEATS=10 \
//     bun run scripts/bench/tool-calling.ts
//
// Env knobs (all optional, defaults match the row's own spec):
//   MAIPAI_STYLE_BENCH_COMPANIES  comma list, default "pal,tutor,buddy,default"
//   MAIPAI_STYLE_BENCH_ARMS       comma list from A,B,C,D,E, default "A,B,C"
//   MAIPAI_STYLE_BENCH_CLASSES    comma list from spoken,written, default "spoken,written"
//   MAIPAI_BENCH_REPEATS          seed count for the gating arms A/B/C, default 3
//     (reused verbatim from tool-calling.ts's own env var, same meaning:
//     "how many times to run each row" - not a second name for one idea)
//   MAIPAI_STYLE_BENCH_INFO_SEEDS seed count for informational arms D/E,
//     default 1 - wall-clock reduction disclosed here and in dev.md, never
//     a change to arm C's own pass bar, which stays at the row's 3.
//   MAIPAI_STYLE_BENCH_OUT        JSON results file (default a timestamped
//     path under data-scratch/voice/bench-results/, git-ignored)
import "./setup"; // CHAT-22: must come before anything that reaches "@/db" - but see below, MAIPAI_LLAMA_SERVER_URL is redirected to this file's own capture proxy BEFORE this import, so setup.ts's presence check (not a live health probe, that's startBench() below) sees the proxy's URL, not the operator's real engine.
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { finishBench, startBench, benchDataDir } from "./setup";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { setValue } from "@/lib/settings";
import { DEFAULT_PERSONA, resolvePersona, type Persona } from "@/lib/persona";
import { identityLine } from "@/lib/turnShared";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { createConversation } from "@/lib/conversationHistory";
import { deleteEpisodesForPerson } from "@/lib/episodes";
import { CHAT_SAMPLING, complete } from "@/lib/llm";
import { COMPOSE_FAILURE_LINE } from "@/lib/composer";
import { extractModelText } from "./recordingProxy";
import { replyShape, splitFrame } from "../voice/corpus";
import { WRITTEN_QUESTIONS } from "./written-set";
import { getEngineStatus, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import type { PersonRow } from "@/types";

// ==== CLI/env ====

function listArg(flag: string, envName: string, fallback: string[]): string[] {
  const i = process.argv.indexOf(flag);
  const raw = i >= 0 ? process.argv[i + 1] : process.env[envName];
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
}

const ALL_COMPANIES = ["pal", "tutor", "buddy", "default"] as const;
type CompanyId = (typeof ALL_COMPANIES)[number];
const COMPANIES = listArg("--company", "MAIPAI_STYLE_BENCH_COMPANIES", [...ALL_COMPANIES]) as CompanyId[];
const ARMS = listArg("--arms", "MAIPAI_STYLE_BENCH_ARMS", ["A", "B", "C"]);
const CLASSES = listArg("--classes", "MAIPAI_STYLE_BENCH_CLASSES", ["spoken", "written"]);
const SWITCH_COST = process.argv.includes("--switch-cost");

const requestedRepeats = Number(process.env.MAIPAI_BENCH_REPEATS ?? 3);
const SEEDS = Number.isFinite(requestedRepeats) && requestedRepeats > 0 ? Array.from({ length: requestedRepeats }, (_, i) => i + 1) : [1, 2, 3];
const requestedInfoSeeds = Number(process.env.MAIPAI_STYLE_BENCH_INFO_SEEDS ?? 1);
const INFO_SEEDS = SEEDS.slice(0, Number.isFinite(requestedInfoSeeds) && requestedInfoSeeds > 0 ? requestedInfoSeeds : 1);

// ==== The capture proxy (this file's own - see the header on why
// recordingProxy.ts's RecordingProxy isn't reused: it never keeps the
// full wire body, only systemText) ====

interface CapturedBody {
  body: Record<string, unknown> | null;
}

/** A pass-through Bun.serve() in front of the real engine, forwarding
 * every request untouched, that ALSO keeps the raw parsed JSON body of
 * the last real turn's completion request (recordingProxy.ts's own
 * `isTurn` heuristic: the last message is role "user", no "tool"
 * message anywhere in the request - never a background judge or a
 * forced tool-decision round). This file's own arm B capture is the
 * only caller; arms A/C/D/E never go through it (they call the real
 * engine directly - see postRaw() below). */
function startCaptureProxy(upstream: string): { url: string; captured: CapturedBody; stop: () => void } {
  const captured: CapturedBody = { body: null };
  const base = upstream.replace(/\/$/, "");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    // Bun.serve()'s own idle-connection timeout defaults far below what
    // a real generation needs (this proxy's incoming connection can go
    // quiet for several real seconds during prompt processing on a
    // production-sized prompt, well before the first streamed token) -
    // set to Bun's own allowed maximum so the SERVER side never closes
    // out from under a live generation the way the "stream ... broke"
    // failures (found live, 2026-09-29) looked like it might be doing.
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      const bodyText = req.method === "POST" ? await req.text() : undefined;
      if (bodyText && url.pathname.endsWith("/chat/completions")) {
        try {
          const parsed = JSON.parse(bodyText) as { messages?: { role: string }[] };
          const messages = parsed.messages ?? [];
          const isTurn = messages.length > 0 && messages[messages.length - 1]!.role === "user" && !messages.some((m) => m.role === "tool");
          if (isTurn) captured.body = parsed as Record<string, unknown>;
        } catch {
          // not JSON - forwarded untouched below, nothing to capture
        }
      }
      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("content-length");
      const res = await fetch(`${base}${url.pathname}${url.search}`, { method: req.method, headers, body: bodyText, signal: req.signal });
      // Never `return res` directly (a real bug found live, 2026-09-29:
      // every runTurnNext() call through this proxy failed mid-stream on
      // the client's own 120s idle timeout, spec/llm/ts/client.ts's own
      // chatCompleteStream() re-arming it on every line RECEIVED - Bun
      // returning a fetch() Response object as-is from a server handler
      // does not forward its streaming body chunk by chunk, so nothing
      // arrived until the whole generation finished, which regularly
      // took longer than the idle window). recordingProxy.ts's own
      // fetch()-passthrough never does this either - it always
      // reconstructs a fresh Response from `res.body`, which streams
      // correctly; mirrored here, minus its own transform (this proxy
      // never needs to read the response, only the request).
      return new Response(res.body, { status: res.status, headers: res.headers });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, captured, stop: () => server.stop(true) };
}

// setup.ts's own presence check (imported below) reads
// MAIPAI_LLAMA_SERVER_URL at import time; this file redirects it to its
// own capture proxy FIRST, so every call this process makes (including
// runTurnNext()'s, via llmSupervisor.ts's URL tier) transparently routes
// through the proxy while the real engine's own address is kept aside
// (UPSTREAM_CHAT_URL) for postRaw()'s direct calls, which never touch
// the proxy at all.
const UPSTREAM_CHAT_URL = process.env.MAIPAI_LLAMA_SERVER_URL;
if (!UPSTREAM_CHAT_URL) {
  console.error("MAIPAI_LLAMA_SERVER_URL must point at the hand-spawned engine (see this file's header for the exact commands).");
  process.exit(1);
}
const captureProxy = startCaptureProxy(UPSTREAM_CHAT_URL);
process.env.MAIPAI_LLAMA_SERVER_URL = captureProxy.url;

// ==== Metrics: markers, contractions, self-description, facts, shape ====

const CONTRACTIONS = ["can't", "won't", "don't", "it's", "you're", "i'm", "that's", "isn't", "didn't"];

/** No existing self-description detector anywhere in this codebase -
 * new for this item. The concrete failure mode this checks for was
 * observed live while validating the bench's own mechanics (2026-09-29,
 * an ad hoc completion against the pal adapter on an identity-only
 * prompt): the reply was a JSON object describing the assistant itself
 * (`{"name": "Pal", "type": "ai", "tags": [...], "description": "Pal is
 * the AI assistant..."}`)  instead of answering the question - a
 * document-shaped, self-referential collapse a small corpus's own
 * "who am I" style training rows can produce. Two independent signs:
 * the whole reply parses as a JSON object naming itself an assistant,
 * or a plain-text meta phrase describing the speaker as an AI/language
 * model rather than speaking as one. */
function looksSelfDescriptive(reply: string): boolean {
  const trimmed = reply.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const joined = JSON.stringify(parsed).toLowerCase();
      if (typeof parsed === "object" && parsed !== null && /"(name|type|tags|description)"/i.test(trimmed) && (joined.includes("assistant") || joined.includes('"ai"') || joined.includes("chatbot"))) return true;
    } catch {
      // not JSON - falls through to the plain-text check
    }
  }
  return /\b(i'?m an ai|i am an ai|as an ai(?:\b|,)|language model|ai assistant|virtual assistant|i'?m (?:just )?a (?:virtual|digital) assistant)\b/i.test(reply);
}

const HEADING_RE = /^#{1,6}\s/m;
const LIST_RE = /^\s*([-*]|\d+\.)\s/m;
function hasHeadingOrList(text: string): boolean {
  return HEADING_RE.test(text) || LIST_RE.test(text);
}

/** "tokens in `examples` absent from `default`'s" (the row's own words,
 * BACKLOG.md STYLE-BENCH-01): a plain set difference over lowercased
 * word tokens, no stopword list - the row doesn't ask for one, and a
 * companion's own filler words ("honestly", "I mean") are exactly the
 * short, common-looking tokens a stopword filter would wrongly drop. */
function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 1));
}
const DEFAULT_EXAMPLE_TOKENS = tokenize((DEFAULT_PERSONA.examples ?? []).join(" "));
function markersFor(persona: Persona): Set<string> {
  const own = tokenize((persona.examples ?? []).join(" "));
  return new Set([...own].filter((w) => !DEFAULT_EXAMPLE_TOKENS.has(w)));
}
function markerCount(reply: string, markers: Set<string>): number {
  const words = tokenize(reply);
  let n = 0;
  for (const m of markers) if (words.has(m)) n++;
  return n;
}
/** "no companion shows another companion's marker" (the row): counts
 * hits from every OTHER companion's own marker set, none of which this
 * companion's own examples contributed a token to (by markersFor()'s
 * own construction, a companion's marker set can still overlap another
 * companion's - two companions independently using "honestly" - so this
 * excludes this companion's own markers from the "other" pool first). */
function otherCompanionMarkerHits(reply: string, thisCompany: CompanyId, allMarkers: Map<CompanyId, Set<string>>): number {
  const mine = allMarkers.get(thisCompany)!;
  const words = tokenize(reply);
  let n = 0;
  for (const [id, markers] of allMarkers) {
    if (id === thisCompany) continue;
    for (const m of markers) {
      if (mine.has(m)) continue;
      if (words.has(m)) n++;
    }
  }
  return n;
}

/** The five written-fact rows, in WRITTEN_QUESTIONS's own order
 * (written-fact-1..5) - the row's own stated correct answers (BACKLOG.md
 * STYLE-BENCH-01: "212 F, 27 bones, Canberra, about 239,000 miles,
 * 1989"). A plain substring/regex check, deterministic like every other
 * pass-bar line here - written-set.ts's own humanVerdict is a different
 * kind of row (completeness, judged by a reader); this bench's own bar
 * asks whether the fact survived the adapter, which is a fact this
 * script can check itself. */
const FACT_CHECKS: Record<string, RegExp> = {
  "written-fact-1": /212\s*°?\s*f\b|212 degrees/i,
  "written-fact-2": /\b27\b/,
  "written-fact-3": /canberra/i,
  "written-fact-4": /239,?000|238,?900|384,?400\s*km/i,
  "written-fact-5": /1989/,
};

// ==== Response parsing: text + full telemetry (cached tokens, decode
// tok/s, predicted tokens) - recordingProxy.ts's own extractModelMeta()
// keeps cachedTokens/promptTokens/hasToolCalls but never `timings` or
// `completion_tokens`, both needed here; this is a small, self-contained
// twin rather than a second unrelated change to that file. ====

interface FullMeta {
  cachedTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  decodeTokensPerSecond?: number;
  promptMs?: number;
  promptTokensRaw?: number;
}

function extractFullMeta(raw: string): FullMeta {
  const trimmed = raw.trim();
  type Timings = { predicted_per_second?: number; prompt_ms?: number; prompt_n?: number };
  type Usage = { completion_tokens?: number; prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  let usage: Usage | undefined;
  let timings: Timings | undefined;
  const consider = (parsed: { usage?: Usage; timings?: Timings }) => {
    if (parsed.usage) usage = parsed.usage;
    if (parsed.timings) timings = parsed.timings;
  };
  if (trimmed.startsWith("{")) {
    try {
      consider(JSON.parse(trimmed));
    } catch {
      // not JSON
    }
  } else {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        consider(JSON.parse(payload));
      } catch {
        // a keepalive or a partial line
      }
    }
  }
  return {
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    decodeTokensPerSecond: timings?.predicted_per_second,
    promptMs: timings?.prompt_ms,
    promptTokensRaw: timings?.prompt_n,
  };
}

/** Every scored measurement (A, B's own seeds 2-3, C, D, E) goes through
 * this one function, direct against the real engine (UPSTREAM_CHAT_URL,
 * never the capture proxy) - the same reason A/D's sampling matches
 * production exactly (CHAT_SAMPLING, spread verbatim) rather than
 * llama-server's own bare defaults, which a live check against this
 * pinned build found genuinely pathological (near-empty completions) on
 * a plain, unsampled request. */
async function postRaw(body: Record<string, unknown>): Promise<{ text: string; meta: FullMeta }> {
  const res = await fetch(`${UPSTREAM_CHAT_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return { text: extractModelText(raw), meta: extractFullMeta(raw) };
}

/** A second, real runaway found live (2026-09-29, this time the engine
 * itself vanished mid-generation - no crash report, no OOM evidence,
 * just gone - after a captured production body's own generation passed
 * 900+ tokens with no stop on this same pal/identity-collapse pattern):
 * MAX_TOKENS_CAP below only ever bounded arm A/D's own hand-built
 * baseBody(). Every REPLAY of a captured production body (arm B's own
 * seeds 2-3, C, E) carries whatever `max_tokens` production itself sent
 * - `reply_ceiling_tokens` (modelCatalog.ts: 1536 for this model),
 * genuinely a "runaway backstop sized per model" per nodes/model.ts's
 * own comment, not a tight cap - real enough that a degenerate adapter
 * reply can still run long before hitting it. This clamps a REPLAYED
 * body's own `max_tokens` down to MAX_TOKENS_CAP too, never up (a body
 * whose own cap was already smaller keeps it), so a replay can never
 * ask the engine for more room than a hand-built arm A/D row already
 * gets. */
function cappedBody(body: Record<string, unknown>): Record<string, unknown> {
  const existing = typeof body.max_tokens === "number" ? body.max_tokens : Infinity;
  return { ...body, max_tokens: Math.min(existing, MAX_TOKENS_CAP) };
}

// A real runaway found live while validating this bench (2026-09-29): an
// identity-only completion against this run's own engine ran past 5,700
// tokens with no stop, task cancelled by hand rather than let it keep
// going - the production turn machine's own nodes/model.ts always sends
// its own age-clamped `max_tokens`, but arm A/D's own bare `baseBody()`
// (below) never did, so nothing here bounded a small model's own
// occasional non-stopping generation. A bound generous enough that no
// real written or spoken reply within this bench's own 0.85x-1.15x
// substance-parity band would ever hit it, but real enough to turn a
// multi-hour stall into a single capped, still-scoreable row.
const MAX_TOKENS_CAP = 600;

function baseBody(messages: { role: string; content: string }[], seed: number): Record<string, unknown> {
  return {
    model: "chat",
    messages,
    ...CHAT_SAMPLING,
    seed,
    max_tokens: MAX_TOKENS_CAP,
    chat_template_kwargs: { enable_thinking: false },
    cache_prompt: true,
    id_slot: 0,
    stream: false,
    stream_options: { include_usage: true },
  };
}

// ==== Adapter id discovery (GET /lora-adapters) ====

async function discoverLoraIds(): Promise<Map<CompanyId, number>> {
  const map = new Map<CompanyId, number>();
  try {
    const res = await fetch(`${UPSTREAM_CHAT_URL}/lora-adapters`);
    if (!res.ok) return map;
    const list = (await res.json()) as { id: number; path: string }[];
    for (const company of ALL_COMPANIES) {
      const match = list.find((a) => basename(a.path).startsWith(`${company}-qwen3-8b-instruct-q4-k-m`));
      if (match) map.set(company, match.id);
    }
  } catch {
    // no /lora-adapters (the stub, or an engine that hasn't loaded any) -
    // arm C/E fall back to lora id 0 with a console note, never a crash.
  }
  return map;
}

// ==== Rows: spoken (steering-spike.ts's own thirty, mirrored verbatim -
// that file exports nothing this bench could import) and written
// (written-set.ts's own WRITTEN_QUESTIONS, imported directly) ====

const SPOKEN_EXCHANGES: readonly string[] = [
  "hi there!",
  "what's the weather like today?",
  "can you help me with something?",
  "I'm not sure what to do about this",
  "thanks for the help",
  "what do you think about that?",
  "tell me something interesting",
  "I had a rough day today",
  "what's 2 plus 2?",
  "goodnight",
  "hey, you around?",
  "is it gonna rain later?",
  "can you give me a hand with this?",
  "I don't really know what to do here",
  "appreciate it",
  "what's your take on that?",
  "say something interesting",
  "today was kind of a rough one",
  "what's 5 plus 5?",
  "alright, goodnight",
  "yo",
  "how's the weather looking?",
  "could you help me out?",
  "still not sure what to do about it",
  "thanks a lot",
  "what do you make of that?",
  "got anything interesting to share?",
  "man, today was rough",
  "what's 10 plus 10?",
  "okay, night",
];

interface RowResult {
  rowId: string;
  turnIndex: number;
  shape: "document" | "conversational" | "spoken";
  arm: string;
  seed: number;
  scale?: number;
  reply: string;
  predictedTokens?: number;
  cachedTokens?: number;
  decodeTokensPerSecond?: number;
  hasHeadingOrList: boolean;
  lowercaseStart: boolean;
  selfDescriptive: boolean;
  hasContraction: boolean;
  markerCount: number;
  otherMarkerHits: number;
  factOk?: boolean;
}

function voiceCheckText(reply: string, shape: "document" | "conversational" | "spoken"): string {
  // VOICE-CLASS-01's shape-aware reading (docs/dev.md, already applied
  // by STYLE-CORPUS-02 to training): a document-shaped written reply's
  // voice checks read the frame (opener+closer) only, never the body the
  // adapter was trained to copy verbatim; a conversational or spoken
  // reply reads in full.
  if (shape !== "document") return reply;
  const { opener, closer } = splitFrame(reply);
  return `${opener}\n\n${closer}`;
}

// ==== Bench person + persona selection ====

const benchPersonId = newPersonId();
function createBenchPerson(): PersonRow {
  const nowIso = new Date().toISOString();
  sqlite
    .query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Marlow', 'owner', ?, 'bench', 0, ?, ?, ?)")
    .run(benchPersonId, randomSuffix(12), nowIso, nowIso, nextHlc());
  const row = db.select().from(people).where(eq(people.id, benchPersonId)).get();
  if (!row) throw new Error("failed to create the bench person row");
  return row as PersonRow;
}
function cleanupBenchPerson(): void {
  deleteEpisodesForPerson(benchPersonId);
  sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(benchPersonId);
  sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(benchPersonId);
  sqlite.query("DELETE FROM settings_values WHERE scope = ?").run(`person:${benchPersonId}`);
  sqlite.query("DELETE FROM people WHERE id = ?").run(benchPersonId);
}

// ==== The switch-cost measurement (a separate mode, --switch-cost) ====

async function measureSwitchCost(actor: PersonRow, loraIds: Map<CompanyId, number>): Promise<void> {
  const [a, b] = COMPANIES.filter((c) => loraIds.has(c));
  if (!a || !b) {
    console.log("switch-cost: fewer than two companies have a discoverable adapter id, skipping.");
    return;
  }
  const utterance = "hey, quick question";
  const msgFor = (id: CompanyId) => [{ role: "system", content: identityLine(resolvePersona(id)) }, { role: "user", content: utterance }];
  console.log(`\nswitch-cost: ${a} then ${a} again (no switch, baseline), then ${a} then ${b} (a real switch), one slot (id_slot 0)\n`);
  const run = async (company: CompanyId) => postRaw({ ...baseBody(msgFor(company), 1), lora: [{ id: loraIds.get(company)!, scale: 1.0 }] });
  await run(a); // warm the slot on `a`
  const noSwitch = await run(a);
  const switched = await run(b);
  console.log(`no-switch (${a} -> ${a}) prompt_ms=${noSwitch.meta.promptMs} prompt_n=${noSwitch.meta.promptTokensRaw} cached=${noSwitch.meta.cachedTokens}`);
  console.log(`switch    (${a} -> ${b}) prompt_ms=${switched.meta.promptMs} prompt_n=${switched.meta.promptTokensRaw} cached=${switched.meta.cachedTokens}`);
  const ratio = noSwitch.meta.promptMs && switched.meta.promptMs ? switched.meta.promptMs / noSwitch.meta.promptMs : undefined;
  console.log(`switch cost: ${ratio !== undefined ? `${ratio.toFixed(2)}x the no-switch prompt time` : "unmeasured (missing timings)"}`);
}

// ==== Main ====

async function runRowAllArms(
  actor: PersonRow,
  company: CompanyId,
  persona: Persona,
  markers: Map<CompanyId, Set<string>>,
  loraId: number | undefined,
  rowId: string,
  turnIndex: number,
  utterance: string,
  klass: "spoken" | "written",
  conversationId: string | undefined,
  ownHistory: { A: { role: string; content: string }[]; D: { role: string; content: string }[] },
  results: RowResult[],
): Promise<void> {
  // Arm B runs FIRST, always, when any of B/C/E is requested: besides
  // being the source of C/E's byte-identical body, its own reply is
  // what VOICE-CLASS-01's shape rule classifies a written row from
  // ("classified by arm B's own reply", docs/dev.md) - the shape has to
  // be known before ANY row's voice checks (A included) can read the
  // frame instead of the whole reply.
  let capturedBody: Record<string, unknown> | null = null;
  let bSeed1Reply = "";
  // Also captured when only D is requested (a real review finding): D's
  // own header-documented standalone invocation (`--arms D --company
  // <company>`) still needs a real arm-B reply to classify a written
  // row's shape from (VOICE-CLASS-01's own rule) - without this, D-only
  // runs always fell back to "conversational" and never read the frame
  // on a document-shaped reply.
  if (ARMS.includes("B") || ARMS.includes("C") || ARMS.includes("D") || ARMS.includes("E")) {
    // A real, intermittent infrastructure hiccup found live (2026-09-29):
    // the capture proxy occasionally breaks mid-stream (spec/llm/ts/
    // client.ts's own "stream from ... broke", a genuinely separate
    // network hop this proxy adds that plain production traffic doesn't
    // pay). Production's own nodes/model.ts already retries once inside
    // one turn for exactly this class of failure (its own
    // "model_retry_no_thinking" attempt) and falls back to the fixed
    // COMPOSE_FAILURE_LINE ("Sorry, I couldn't do that.") only when BOTH
    // attempts fail - reproduced live, about 1 in 5-10 turns through this
    // proxy needed the retry, and a smaller fraction still fell all the
    // way to the fixed line. That fixed line is an infrastructure
    // artifact, not a real reply from any arm, and scoring it as one
    // would corrupt the row (every voice/substance check would fail on
    // it for reasons that have nothing to do with the adapter). This
    // bench retries the WHOLE runTurnNext() call up to 3 times when the
    // reply is exactly that line, before accepting it as the row's real
    // answer - the same resilience production already has, applied one
    // level up, never silently kept as if it were a genuine reply.
    let result: Awaited<ReturnType<typeof runTurnNext>> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      captureProxy.captured.body = null;
      result = await runTurnNext(actor, "chat", utterance, { conversationId });
      const replyText = result.ok && result.kind === "immediate" ? result.value.reply.text : "";
      if (replyText !== COMPOSE_FAILURE_LINE) break;
      console.log(`  [${company}/${rowId}] arm B's real turn fell back to "${COMPOSE_FAILURE_LINE}" (attempt ${attempt + 1}/3) - retrying, this is an infrastructure artifact, never a real reply to score.`);
    }
    // runTurnNext() always returns kind "immediate" (STREAM-NEXT-01's own
    // "stream" kind belongs to runTurnNextStream() alone), but the two
    // share one TurnStreamResult union, so the kind check is still
    // needed for TS to narrow to the branch that actually has `.value`.
    bSeed1Reply = result!.ok && result!.kind === "immediate" ? result!.value.reply.text : "";
    // A real review finding: the loop above only breaks EARLY on a real
    // reply - it never separately checked whether all 3 attempts were
    // still the fixed fallback line, so a persistently failing turn fell
    // through and got scored as if `bSeed1Reply` were genuine, exactly
    // the outcome the retry exists to prevent. A second review pass
    // caught this first fix's own condition too narrow: checking only
    // `=== COMPOSE_FAILURE_LINE` misses the OTHER failure shape
    // (`!result.ok` or a non-"immediate" kind, which sets `bSeed1Reply`
    // to `""` on the line above, never equal to the fallback line) -
    // that case left `capturedBody` un-nulled, so arm C/E could still
    // score against a body captured from a turn that never produced a
    // genuine reply at all. `!bSeed1Reply` catches that empty-string
    // case too, alongside the fixed-line case, so ANY non-genuine
    // outcome after 3 attempts skips B/C/E entirely for this row - never
    // silently scored.
    if (!bSeed1Reply || bSeed1Reply === COMPOSE_FAILURE_LINE) {
      console.log(`  [${company}/${rowId}] arm B never produced a real reply after 3 attempts - skipping B/C/E scoring for this row rather than scoring an empty or fallback reply as if it were genuine.`);
      capturedBody = null;
      bSeed1Reply = "";
    }
    // TS's control-flow narrowing follows `captureProxy.captured.body =
    // null;` above straight through the `await` and treats the property
    // as still exactly `null` here, despite the capture proxy's own
    // fetch handler (a genuinely separate async callback TS has no
    // reason to model) writing a real object into it while the await was
    // in flight - a known narrowing gap for a mutable object property
    // read back after an unrelated await. The explicit assertion below
    // is the fix: it restates the field's own DECLARED type
    // (CapturedBody["body"]) rather than trust the incorrectly narrowed
    // one, so every downstream `if (capturedBody)` and `...capturedBody`
    // spread type-checks against `Record<string, unknown> | null` again.
    capturedBody = captureProxy.captured.body as Record<string, unknown> | null;
  }
  // A real review finding: when the guard above reset `bSeed1Reply` to
  // `""` (no real turn this row), `replyShape("")` silently resolves to
  // "conversational" with no visible sign of it - unlike B/C's own
  // explicit skip logs, arm D (scored below, and the only arm that can
  // still run when B/C/E were never requested at all) would read every
  // voice check against a possibly-wrong shape with nothing to flag it.
  const shapeIsDegraded = klass !== "spoken" && !bSeed1Reply;
  if (shapeIsDegraded) console.log(`  [${company}/${rowId}] shape classification degraded to "conversational": no real arm-B reply available this row to classify from (VOICE-CLASS-01's own rule needs one).`);
  const shape: "document" | "conversational" | "spoken" = klass === "spoken" ? "spoken" : replyShape(bSeed1Reply) === "document" ? "document" : "conversational";

  const score = (arm: string, seed: number, reply: string, meta: FullMeta, scale?: number) => {
    const voiceText = voiceCheckText(reply, shape);
    results.push({
      rowId,
      turnIndex,
      shape,
      arm,
      seed,
      scale,
      reply,
      predictedTokens: meta.completionTokens,
      cachedTokens: meta.cachedTokens,
      decodeTokensPerSecond: meta.decodeTokensPerSecond,
      hasHeadingOrList: hasHeadingOrList(reply),
      lowercaseStart: reply.length > 0 && reply[0] === reply[0]!.toLowerCase() && reply[0]! !== reply[0]!.toUpperCase(),
      selfDescriptive: looksSelfDescriptive(reply),
      hasContraction: CONTRACTIONS.some((c) => voiceText.toLowerCase().includes(c)),
      markerCount: markerCount(voiceText, markers.get(company)!),
      otherMarkerHits: otherCompanionMarkerHits(voiceText, company, markers),
      factOk: FACT_CHECKS[rowId] ? FACT_CHECKS[rowId]!.test(reply) : undefined,
    });
  };

  if (ARMS.includes("B") && bSeed1Reply) {
    // Seed-1's own real stats: re-measured via postRaw() against the
    // SAME captured body for a consistent telemetry path across every
    // arm (usage/timings, never the text - a real review finding: this
    // used to prefer the REPOST's own `text` over `bSeed1Reply`, but the
    // repost goes through cappedBody(), which can truncate a genuinely
    // long real reply at 600 tokens even though the actual production
    // reply (bSeed1Reply, uncapped, exactly what the household saw) was
    // longer and never truncated at all - scoring the truncated repost
    // would have graded arm B's own "shipped" baseline against a body
    // it never actually sent. `bSeed1Reply` is always the scored text
    // for B's own seed 1; `meta` (decode tok/s, cached tokens) still
    // comes from the repost, the only way to get clean, comparable
    // telemetry across every arm on the identical prompt).
    if (capturedBody) {
      const body = capturedBody; // a const alias: narrowing on the outer `let` doesn't survive the `score` closure's presence in scope
      const { meta } = await postRaw(cappedBody({ ...body, seed: SEEDS[0] }));
      score("B", SEEDS[0]!, bSeed1Reply, meta);
    } else {
      score("B", SEEDS[0]!, bSeed1Reply, {});
    }
    for (const seed of SEEDS.slice(1)) {
      if (!capturedBody) continue;
      const body = capturedBody;
      const { text, meta } = await postRaw(cappedBody({ ...body, seed }));
      score("B", seed, text, meta);
    }
  } else if (ARMS.includes("B")) {
    console.log(`  [${company}/${rowId}] arm B skipped entirely: no real reply this row (see the retry note above) - never scored as an empty or fallback row.`);
  }

  // Arm A: identity line only, its own growing history (spoken) or a
  // bare single turn (written), no adapter.
  if (ARMS.includes("A")) {
    const messages = [{ role: "system", content: identityLine(persona) }, ...ownHistory.A, { role: "user", content: utterance }];
    for (const seed of SEEDS) {
      const { text, meta } = await postRaw(baseBody(messages, seed));
      score("A", seed, text, meta);
      if (seed === SEEDS[0] && klass === "spoken") {
        ownHistory.A.push({ role: "user", content: utterance }, { role: "assistant", content: text });
      }
    }
  }

  // Arm C: B's captured body, byte-identical, `lora` added. `loraId`
  // undefined (GET /lora-adapters never listed this company - the
  // scripted/stub mode, or a real run against an engine that hasn't
  // loaded this companion's file) skips scoring outright rather than
  // silently falling back to id 0, which would select WHICHEVER
  // adapter happened to load first and misreport its effect as this
  // company's own.
  if (ARMS.includes("C") && capturedBody && loraId !== undefined) {
    const body = capturedBody;
    for (const seed of SEEDS) {
      const { text, meta } = await postRaw(cappedBody({ ...body, seed, lora: [{ id: loraId, scale: 1.0 }] }));
      score("C", seed, text, meta);
    }
  } else if (ARMS.includes("C") && !capturedBody) {
    console.log(`  [${company}/${rowId}] arm C skipped: no captured body from arm B this row (the real turn produced no scoreable completion request)`);
  } else if (ARMS.includes("C") && loraId === undefined) {
    console.log(`  [${company}/${rowId}] arm C skipped: no discoverable lora id for ${company} (GET /lora-adapters never listed it) - never falls back to id 0, which would score a different company's adapter.`);
  }

  // Arm D: informational, the spike's own identity-only prompt, its own
  // growing history, against whatever engine is live (a vector-loaded
  // one, per this file's own header) - no lora.
  if (ARMS.includes("D")) {
    const messages = [{ role: "system", content: identityLine(persona) }, ...ownHistory.D, { role: "user", content: utterance }];
    for (const seed of INFO_SEEDS) {
      const { text, meta } = await postRaw(baseBody(messages, seed));
      score("D", seed, text, meta);
      if (seed === INFO_SEEDS[0] && klass === "spoken") {
        ownHistory.D.push({ role: "user", content: utterance }, { role: "assistant", content: text });
      }
    }
  }

  // Arm E: informational, C's byte-identical body, scale 0.5 and 1.5.
  // Same "never fall back to id 0" rule as arm C above.
  if (ARMS.includes("E") && capturedBody && loraId !== undefined) {
    const body = capturedBody;
    for (const scale of [0.5, 1.5]) {
      for (const seed of INFO_SEEDS) {
        const { text, meta } = await postRaw(cappedBody({ ...body, seed, lora: [{ id: loraId, scale }] }));
        score("E", seed, text, meta, scale);
      }
    }
  }
}

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  // Warm the engine before reporting which one is active - the same
  // reason tool-calling.ts/memory-eval.ts/routing.ts do this first:
  // getEngineStatus() reads llmSupervisor.ts's own resolved backend
  // state, which stays "none" until getChatClient() has actually been
  // asked for one at least once.
  await complete("chat", [{ role: "user", content: "hello" }]);
  const status = getEngineStatus();
  console.log(`Chat engine (via capture proxy -> ${sanitizeEngineUrl(UPSTREAM_CHAT_URL)}): ${status.kind}, model ${status.modelId ?? "n/a"}`);
  console.log(`Companies: ${COMPANIES.join(", ")}  Arms: ${ARMS.join(", ")}  Classes: ${CLASSES.join(", ")}  Seeds: ${SEEDS.join(",")} (info arms: ${INFO_SEEDS.join(",")})`);

  const loraIds = await discoverLoraIds();
  if (loraIds.size === 0) console.log("note: GET /lora-adapters returned nothing usable (a stub engine, or none loaded) - arm C/E fall back to lora id 0.");
  else console.log(`Discovered lora ids: ${[...loraIds].map(([c, id]) => `${c}=${id}`).join(", ")}`);

  const markers = new Map<CompanyId, Set<string>>(ALL_COMPANIES.map((c) => [c, markersFor(resolvePersona(c))]));
  const actor = createBenchPerson();
  const results: RowResult[] = [];

  // Written incrementally (after every row, not just at the end) - a
  // real finding live (2026-09-29): this machine's own memory pressure
  // (confirmed independently, not a bug in this file) can kill the
  // hand-spawned engine mid-run with no warning, and a run that only
  // wrote its JSON at the very end lost an entire company's worth of
  // real, already-scored rows to exactly that twice. The file this
  // writes is always a valid, complete snapshot of every row scored so
  // far - never a partial JSON object - so a killed process still
  // leaves real, usable data behind.
  // A real review finding: defaulting this under the repo's own
  // data-scratch/ tree (via import.meta.dir) meant every scripted-mode
  // run of this entry point in benchSetup.test.ts - which never sets
  // MAIPAI_STYLE_BENCH_OUT - left an orphaned timestamped JSON file
  // behind that nothing ever cleans up, unlike every other entry point
  // in that same test. Defaulting under `benchDataDir` (setup.ts's own
  // export - the fresh, disposable MAIPAI_DATA_DIR this run already got,
  // deleted by CHAT-22's own contract like the rest of that directory)
  // fixes that for the common case; a real live run always sets
  // MAIPAI_STYLE_BENCH_OUT explicitly (this file's own header shows
  // every operator command doing so) to land the file somewhere
  // persistent instead.
  const outPath = process.env.MAIPAI_STYLE_BENCH_OUT ?? join(benchDataDir, `style-adapter-${Date.now()}.json`);
  const flush = (): void => {
    writeFileSync(outPath, JSON.stringify({ companies: COMPANIES, arms: ARMS, classes: CLASSES, seeds: SEEDS, infoSeeds: INFO_SEEDS, results }, null, 2));
  };

  if (SWITCH_COST) {
    await measureSwitchCost(actor, loraIds);
  } else {
    for (const company of COMPANIES) {
      const persona = resolvePersona(company);
      const setResult = setValue(actor, `person:${benchPersonId}`, "persona.active_id", company);
      if (!setResult.ok) throw new Error(`failed to set persona.active_id to ${company}: ${setResult.error}`);
      const loraId = loraIds.get(company);
      console.log(`\n=== ${company} (${persona.display_name}) - ${markers.get(company)!.size} own markers, lora id ${loraId ?? "unresolved"} ===`);

      if (CLASSES.includes("spoken")) {
        const conv = createConversation(actor, { surface: "chat" });
        if (!conv.ok) throw new Error(`failed to create the spoken conversation: ${conv.error}`);
        const ownHistory = { A: [] as { role: string; content: string }[], D: [] as { role: string; content: string }[] };
        for (let i = 0; i < SPOKEN_EXCHANGES.length; i++) {
          await runRowAllArms(actor, company, persona, markers, loraId, `spoken-${i}`, i, SPOKEN_EXCHANGES[i]!, "spoken", conv.value.id, ownHistory, results);
          flush();
        }
        // cleanupBenchPerson() below deletes every conversation row for
        // this bench person by person_id (persona-eval.ts's own
        // cleanup() pattern) - no per-conversation delete call exists in
        // conversationHistory.ts to call here instead.
      }

      if (CLASSES.includes("written")) {
        for (const row of WRITTEN_QUESTIONS) {
          // Written rows are independent single turns (written-set.ts's
          // own design), never a growing history; conversationId is
          // omitted so resolveOrCreateConversation() makes a fresh one
          // per row. Shape is classified inside runRowAllArms() from
          // arm B's own seed-1 reply (VOICE-CLASS-01's rule), never
          // passed in.
          const ownHistory = { A: [] as { role: string; content: string }[], D: [] as { role: string; content: string }[] };
          await runRowAllArms(actor, company, persona, markers, loraId, row.id, 0, row.say, "written", undefined, ownHistory, results);
          flush();
        }
      }
    }
  }

  cleanupBenchPerson();
  __resetLlmSupervisorForTests();

  if (results.length > 0) {
    console.log("\n## Per-row table (company/row/arm/seed -> tokens, cached, tok/s, heading/list, lowercase, self-desc, contraction, markers, other-markers, fact)\n");
    for (const r of results) {
      console.log(
        `${r.rowId.padEnd(20)} ${r.arm.padEnd(2)}${r.scale ? `(${r.scale})` : "   "} seed=${r.seed}  tok=${r.predictedTokens ?? "?"}  cached=${r.cachedTokens ?? "?"}  tok/s=${r.decodeTokensPerSecond?.toFixed(1) ?? "?"}  hl=${r.hasHeadingOrList ? 1 : 0}  lower=${r.lowercaseStart ? 1 : 0}  selfdesc=${r.selfDescriptive ? 1 : 0}  contr=${r.hasContraction ? 1 : 0}  markers=${r.markerCount}  other=${r.otherMarkerHits}${r.factOk !== undefined ? `  fact=${r.factOk ? 1 : 0}` : ""}`,
      );
    }

    flush(); // the loop above already kept this current; one last write for the SWITCH_COST-less path's own final state
    console.log(`\nRaw results written to ${outPath}`);
  }

  return { executed: results.length + (SWITCH_COST ? 1 : 0), engine: `chat ${status.kind} at ${sanitizeEngineUrl(UPSTREAM_CHAT_URL)}` };
}

let summary = { executed: 0, engine: "not run" };
try {
  summary = await main();
} finally {
  captureProxy.stop();
}
finishBench(summary);
