// STREAM-NEXT-01 (home/docs/BACKLOG.md; home/docs/dev.md): the hold-
// protocol live bench the coordinator's own ruling named, run against
// the resident 8B (never spawned - a URL only, CHAT-22's own guard) and
// the household's own real, live SearXNG (never the fake one benches
// usually use - a forced-search turn's own tool latency is exactly what
// two of these bars measure, so a canned fixture would prove nothing).
// Every timestamp is taken at THIS SCRIPT, reading the real NDJSON
// stream `/api/turn/stream` sends (performance.now() per line) - never
// the server's own generation record, per the coordinator's own
// instruction.
//
// Bars (getmaipai-26's ruling):
//   1. A plain turn's first visible sentence arrives no later than the
//      old path's, interleaved (old, new, old, new, ...).
//   2. A forced-search turn's tool_call (the live "On it." status line -
//      STREAM-NEXT-01 (a) - the wire has never carried a structured
//      tool_call event on either path's own live stream) reaches the
//      client within 2.5s.
//   3. The first sentence after a forced search arrives within 4s of
//      the tool's own end. The wire carries no live tool_result event
//      either, so "the tool's own end" is estimated from the status
//      line's own arrival time plus a live, direct, independently-timed
//      call to the SAME real SearXNG this bench's own household setting
//      points the turn pipeline at - never the generation record.
//
// Real household IPs/hostnames are never committed (getmaipai/.github's
// own privacy rule): the SearXNG URL is read from an env var at
// runtime, never written into this file.
//
// A code review (before this bench's own numbers were trusted) caught a
// real confound: every rep reused the same signed-in person with no
// conversation_id reset, so resolveOrCreateConversation() kept reusing
// (and growing) the same open conversation across all ~18 requests in a
// run - a later rep's own prompt carries strictly more history than an
// earlier one, on top of whatever thermal/warm-cache effect a run's own
// numbers otherwise show. Fixed: every timed request sets `temporary:
// true` - conversationHistory.ts's own resolveOrCreateConversation()
// never reuses an existing conversation for one (createTemporaryConversation()
// runs unconditionally, no id given), so each rep gets a genuinely
// fresh, isolated context without a second household-setup call per
// rep (a first cut tried a fresh signed-in person instead and hit
// `/api/auth/setup`'s own one-time-only 409 on the second call).
//
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8788 \
//   MAIPAI_EMBED_URL=http://127.0.0.1:8794 \
//   MAIPAI_BENCH_SEARXNG_URL=<the household's own live SearXNG URL> \
//   MAIPAI_DATA_DIR=$(mktemp -d) \
//   bun run backend/scripts/bench/stream-next-01-live.ts
import "./setup";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";
import { TestClient } from "../../tests/client";
import { finishBench } from "./setup";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";

const REPS = 5;
// A world-knowledge-shaped question (even a casual one) can trip the
// interim rule's own forced search on the new path - proven live, the
// first attempt's own utterance did on every new-path rep. "hi" is the
// established, already-proven "plain turn, no tool" fixture this exact
// codebase's own tests already rely on (turnRouteU6a.test.ts et al.).
const PLAIN_TURN_TEXT = "hi";
const FORCED_SEARCH_TEXT = "who is the president of chile";

interface TimedEvent {
  atMs: number;
  event: Record<string, unknown>;
}

/** Reads a real streaming Response's own NDJSON body, timestamping each
 * line's arrival with performance.now() relative to `sendAtMs` (taken
 * immediately before the request was sent) - the client's own read of
 * the wire, never the server's internal timing. Uses the spec's own
 * readTextLines() (never a second, hand-rolled byte/line buffer -
 * a code review named the live 2026-09-04 incident this centralizes the
 * fix for: TextDecoder's own streaming mode can drop an incomplete
 * multi-byte UTF-8 sequence split across the last two chunks unless a
 * final, non-streaming flush runs at the end). A malformed line throws
 * a named error rather than crashing on a bare JSON.parse - a live
 * bench should report a bad rep, never die mid-run. */
async function readTimed(response: Response, sendAtMs: number): Promise<TimedEvent[]> {
  const events: TimedEvent[] = [];
  const reader = response.body!.getReader();
  for await (const line of readTextLines(reader)) {
    const atMs = performance.now() - sendAtMs;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`readTimed: malformed NDJSON line at ${atMs.toFixed(0)}ms: ${(err as Error).message} (line: ${line.slice(0, 200)})`);
    }
    events.push({ atMs, event });
  }
  return events;
}

/** `/api/auth/setup` is one-time (the household's own first owner
 * account, a real 409 on a second call - a first cut of this bench
 * tried a fresh person per rep and hit exactly that). One owner is
 * signed in once; every timed request instead sets `temporary: true`
 * (see its own header note below) for a genuinely fresh conversation
 * per rep, without a second household-setup call each time. */
async function signedInOwner(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Bench", secret: "correcthorse-battery-staple" });
  if (res.status !== 200 && res.status !== 201) throw new Error(`auth setup failed: ${res.status} ${await res.text()}`);
  return client;
}

/** setHouseholdSettingValue() can return {ok:false} (an unknown key, the
 * wrong scope, a failed validator) without throwing - a code review
 * caught this bench never checking, which would otherwise measure
 * against whatever the PREVIOUS setting value was while still printing
 * a confident pass/fail. */
function setSettingOrThrow(key: string, value: unknown): void {
  const result = setHouseholdSettingValue(key, value);
  if (!result.ok) throw new Error(`setHouseholdSettingValue(${key}) failed: ${JSON.stringify(result)}`);
}

function firstEventAt(events: TimedEvent[], match: (e: Record<string, unknown>) => boolean): number | null {
  const found = events.find((t) => match(t.event));
  return found ? found.atMs : null;
}

/** The textbook median: the average of the two middle values on an even
 * count, not just the upper one - a code review caught the first cut
 * taking `[Math.floor(n/2)]` alone, which silently skews high on an
 * even-length array (Bar 1's own per-path count can land on one
 * whenever a rep is excluded for calling a tool). */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 1 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A live, direct SearXNG round trip - the same query shape the forced-
 * search turn's own tool call makes, timed independently of the turn
 * pipeline entirely, since the wire carries no live tool_result event
 * to read "the tool's own end" from directly. Checked for a real result
 * (`res.ok`), not just timed blindly - a code review named the same
 * failure class this exact endpoint's own production error copy already
 * documents (packageHost.ts's searxngSearch(): "a URL that redirects to
 * a login page, or an instance with JSON output disabled, both look
 * like this" as a fast, misleadingly low latency). */
async function directSearxngLatencyMs(searxngUrl: string, query: string): Promise<number> {
  const start = performance.now();
  const res = await fetch(`${searxngUrl.replace(/\/$/, "")}/search?${new URLSearchParams({ q: query, format: "json" })}`);
  const elapsed = performance.now() - start;
  if (!res.ok) throw new Error(`directSearxngLatencyMs: SearXNG returned ${res.status} - the URL or its JSON output setting is likely misconfigured, the same failure class packageHost.ts's own searxngSearch() error copy names`);
  const body = await res.text();
  if (!body.trim().startsWith("{")) throw new Error("directSearxngLatencyMs: SearXNG's own response was not JSON (a login redirect or an HTML error page reads exactly this way) - check MAIPAI_BENCH_SEARXNG_URL");
  return elapsed;
}

if (import.meta.main) {
  await runMain();
}

async function runMain(): Promise<void> {
  const searxngUrl = process.env.MAIPAI_BENCH_SEARXNG_URL;
  if (!searxngUrl) {
    console.error("stream-next-01-live refused: MAIPAI_BENCH_SEARXNG_URL is not set; this bench measures a forced-search turn's real tool latency and never runs against a fake SearXNG.");
    process.exit(2);
  }

  console.log("\n## Run header\n");
  console.log(JSON.stringify({ date: new Date().toISOString(), chat: process.env.MAIPAI_LLAMA_SERVER_URL, embed: process.env.MAIPAI_EMBED_URL, reps: REPS }, null, 2));

  // One owner, signed in once - every timed request below sets
  // `temporary: true` instead for its own fresh, isolated conversation
  // (see this file's own header note).
  const client = await signedInOwner();
  setSettingOrThrow("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
  setSettingOrThrow("search.searxng_url", searxngUrl);

  let executed = 0;

  // Bar 1: a plain turn, interleaved old/new, each rep its own fresh conversation.
  console.log("\n## Bar 1: plain turn, first delta (old path vs new path, interleaved)\n");
  const plainResults: { path: "old" | "new"; firstDeltaMs: number | null }[] = [];
  for (let rep = 0; rep < REPS; rep++) {
    for (const path of ["old", "new"] as const) {
      setSettingOrThrow("turn.pipeline.next", path === "new");
      // A live "hi" turn resolves in well under a second - fast enough
      // to drain routes/turn.ts's own personWithinTurnBudget() (5
      // tokens, refilling at 0.5/s) before the natural pacing of a
      // slower turn would have. Reset before every request, the same
      // test-only reset the rest of this codebase's suite already uses
      // for the identical reason - a rate-limit 429 is not this bar's
      // own signal to measure.
      __resetRateLimiterForTests();
      const sendAtMs = performance.now();
      const res = await client.post("/api/turn/stream", { surface: "chat", text: PLAIN_TURN_TEXT, temporary: true });
      if (res.status !== 200) {
        console.error(`  rep ${rep} (${path}): request failed, status ${res.status}`);
        continue;
      }
      const events = await readTimed(res, sendAtMs);
      const firstDeltaMs = firstEventAt(events, (e) => e.type === "delta");
      const hadTool = events.some((t) => t.event.type === "status" && t.event.stage === "tool");
      executed++;
      console.log(`  rep ${rep} (${path}): first_delta_ms=${firstDeltaMs?.toFixed(0) ?? "n/a"}${hadTool ? " [WARNING: this rep called a tool, not a plain reply - excluded from the bar]" : ""}`);
      if (!hadTool) plainResults.push({ path, firstDeltaMs });
    }
  }
  const oldDeltas = plainResults.filter((r) => r.path === "old" && r.firstDeltaMs !== null).map((r) => r.firstDeltaMs!);
  const newDeltas = plainResults.filter((r) => r.path === "new" && r.firstDeltaMs !== null).map((r) => r.firstDeltaMs!);
  console.log(`\n  old path median first_delta_ms: ${median(oldDeltas)?.toFixed(0) ?? "n/a"} (n=${oldDeltas.length})`);
  console.log(`  new path median first_delta_ms: ${median(newDeltas)?.toFixed(0) ?? "n/a"} (n=${newDeltas.length})`);

  // Bar 2/3: a forced-search turn, new path only, against the real SearXNG.
  console.log("\n## Bar 2/3: forced-search turn (new path, live SearXNG)\n");
  setSettingOrThrow("turn.pipeline.next", true);
  const searchResults: { toolStatusMs: number | null; firstDeltaMs: number | null }[] = [];
  for (let rep = 0; rep < REPS; rep++) {
    __resetRateLimiterForTests();
    const sendAtMs = performance.now();
    const res = await client.post("/api/turn/stream", { surface: "chat", text: FORCED_SEARCH_TEXT, temporary: true });
    if (res.status !== 200) {
      console.error(`  rep ${rep}: request failed, status ${res.status}`);
      continue;
    }
    const events = await readTimed(res, sendAtMs);
    const toolStatusMs = firstEventAt(events, (e) => e.type === "status" && e.stage === "tool");
    const firstDeltaMs = firstEventAt(events, (e) => e.type === "delta");
    searchResults.push({ toolStatusMs, firstDeltaMs });
    executed++;
    console.log(`  rep ${rep}: tool_status_ms=${toolStatusMs?.toFixed(0) ?? "n/a"} first_delta_ms=${firstDeltaMs?.toFixed(0) ?? "n/a"}`);
  }

  const directLatencies: number[] = [];
  for (let i = 0; i < 3; i++) directLatencies.push(await directSearxngLatencyMs(searxngUrl, FORCED_SEARCH_TEXT));
  const searxngOwnLatencyMs = median(directLatencies)!;
  console.log(`\n  independent live SearXNG round trip (median of 3, same query): ${searxngOwnLatencyMs.toFixed(0)}ms`);

  const toolStatusMedian = median(searchResults.map((r) => r.toolStatusMs).filter((x): x is number => x !== null));
  const firstDeltaMedian = median(searchResults.map((r) => r.firstDeltaMs).filter((x): x is number => x !== null));
  console.log(`  median tool_call (status line) arrival: ${toolStatusMedian?.toFixed(0) ?? "n/a"}ms`);
  console.log(`  median first sentence (first delta) arrival: ${firstDeltaMedian?.toFixed(0) ?? "n/a"}ms`);
  if (toolStatusMedian !== null && firstDeltaMedian !== null) {
    const estimatedToolEndMs = toolStatusMedian + searxngOwnLatencyMs;
    const firstSentenceAfterToolEndMs = firstDeltaMedian - estimatedToolEndMs;
    console.log(`  estimated tool end (status + independent SearXNG latency): ${estimatedToolEndMs.toFixed(0)}ms`);
    console.log(`  estimated first sentence after tool's own end: ${firstSentenceAfterToolEndMs.toFixed(0)}ms`);
  }

  // VOICE-LIVE-02 re-measure: the row's own bar (first spoken word under
  // 3s) is a full voice-pipeline measurement (STT, the turn, TTS
  // synthesis, audio playback) this bench's own client has no audio
  // stack to reproduce - out of proportion for this hold. What
  // STREAM-NEXT-01 actually changed is the turn's own latency
  // component: `spoken: true` (RESP-01's flag, the same one a real
  // voice turn sets), first delta arrival timed the identical way as
  // Bar 1 - the earliest point a real TTS pipeline, wired to consume
  // the stream (the shipped contract: "reply.speech is spoken sentence
  // by sentence as it streams"), could begin synthesizing.
  console.log("\n## VOICE-LIVE-02 re-measure proxy: a spoken turn's own first delta (new path)\n");
  setSettingOrThrow("turn.pipeline.next", true);
  const spokenDeltas: number[] = [];
  for (let rep = 0; rep < 3; rep++) {
    __resetRateLimiterForTests();
    const sendAtMs = performance.now();
    const res = await client.post("/api/turn/stream", { surface: "chat", text: PLAIN_TURN_TEXT, spoken: true, temporary: true });
    if (res.status !== 200) {
      console.error(`  rep ${rep}: request failed, status ${res.status}`);
      continue;
    }
    const events = await readTimed(res, sendAtMs);
    const firstDeltaMs = firstEventAt(events, (e) => e.type === "delta");
    if (firstDeltaMs !== null) spokenDeltas.push(firstDeltaMs);
    executed++;
    console.log(`  rep ${rep}: first_delta_ms=${firstDeltaMs?.toFixed(0) ?? "n/a"}`);
  }
  console.log(`\n  median spoken-turn first_delta_ms: ${median(spokenDeltas)?.toFixed(0) ?? "n/a"} (n=${spokenDeltas.length})`);

  finishBench({ executed, engine: `MAIPAI_LLAMA_SERVER_URL=${process.env.MAIPAI_LLAMA_SERVER_URL} (chat)` });
}
