// The baseline conversation bench's runner: drives one fixture
// conversation through the real `runTurnStream()` and reads every
// outcome from the system's own state afterwards (the turn row, the
// memory rows written with the turn as source, the `[turn]` and
// `[route]` log lines, the context message the model saw through the
// recording proxy, the lease registry). No engine setup here: the live
// entry point (conversationLive.ts) imports setup.ts first and passes
// the judge and the backdating in; tests/conversationBench.test.ts
// drives the same functions against the stub, so the control flow
// (abort, confirmation, credential, cross-person, scoring) is proven
// offline before a live run.
import { eq, and, or, ne, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { conversationTurns, memoryRecords, people, lists, entities, relationships, episodes as episodesTable } from "@/db/schema";
import { runTurnStream, loadAllManifests, commandOpeners, judgeStatusAtInsert, notePendingLookup, type TurnStreamResult, lookupQueryFor } from "@/lib/turnEngine";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { getHouseholdSettingValue } from "@/lib/settings";
import { pickThinkingCue } from "@/lib/replyVariation";
import { THINKING_CUE_DELAY_MS } from "@/routes/turn";
import { resolveNames } from "@/lib/unknownNames";
import { lookupShapeOf } from "@/lib/guards";
import { createConversation, getPendingAsk, turnSignalOf, turnPlanOf, logTurn, outcomesForConversation, listOpenQuestions, queueOpenQuestion, resolveOpenQuestionsAbout } from "@/lib/conversationHistory";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { speakerAgeBand } from "@/lib/ageBand";
import { evaluateSafety } from "@/lib/safety";
import { newConversationTurnId } from "@/lib/id";
import { activeTurnCount } from "@/lib/turnActivity";
import { remember, PROFILE_SOURCE } from "@/lib/memory";
import { deleteEpisodesForPerson } from "@/lib/episodes";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { createEntity, updateEntity } from "@/lib/entities";
import { findEntityByName } from "@/lib/subjects";
import { createRelationship, updateRelationship } from "@/lib/relationships";
import { listJobs, runDueJobs } from "@/lib/scheduler";
import { runPlugin, registerAllPackageNotificationTypes } from "@/lib/plugins";
import { __setPageReaderForTests, type PageReadResult } from "@/lib/packageHost";
import { listPending } from "@/lib/notifications";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import type { BenchConversation, Speaker } from "./conversationFixture";
import { scoreTurn, type TurnObserved, type TurnScore } from "./conversationScore";
import { __setPromptClockForBench } from "@/lib/benchSampling";
import type { TurnTimings } from "@/lib/turnContext";
import { complete } from "@/lib/llm";
import { visibleText } from "@/lib/wellFormed";

// ==== The [turn] / [route] log capture ====

interface TurnLine {
  turn_id: string;
  guard?: string[];
  plugin_id?: string;
  source?: string;
  safety_action?: string;
  /** ASK-01: the turn's subjects by type and name, and the first as
   * `subject` (CHAT-13's stack grows from it). */
  subject?: string;
  subjects?: { type: "household" | "world" | "unresolved"; name: string }[];
  /** LOOKUP-02: the shape the draft confessed. */
  lookup_shape?: string;
  composed?: string;
  ungrounded?: string;
  /** ACT-01: the frozen signal's headline and the per-stage timings. */
  signal?: { act: string; secondary: string[]; emotion: string; intensity: string; target: string; repair: string; source: string };
  timings?: TurnTimings;
}
interface RouteLine {
  turn_id: string;
  offered?: string[];
  winner?: string | null;
  tier?: string;
}

export interface LogCapture {
  turns: Map<string, TurnLine>;
  routes: Map<string, RouteLine>;
  stop(): void;
}

/** Wraps console.log for the run: the engine's own `[turn]` and
 * `[route]` lines are parsed by turn id and still printed. */
export function captureTurnLog(): LogCapture {
  const turns = new Map<string, TurnLine>();
  const routes = new Map<string, RouteLine>();
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string") {
      try {
        if (first.startsWith("[turn] {")) {
          const line = JSON.parse(first.slice(7)) as TurnLine;
          turns.set(line.turn_id, line);
        } else if (first.startsWith("[route] {")) {
          const line = JSON.parse(first.slice(8)) as RouteLine;
          routes.set(line.turn_id, line);
        }
      } catch {
        // not one of ours
      }
    }
    original(...args);
  };
  return { turns, routes, stop: () => void (console.log = original) };
}

// The recording proxy lives in recordingProxy.ts (no database import,
// so conversationLive.ts can start it before setup.ts runs).
import { type RecordingProxy } from "./recordingProxy";
export { startRecordingProxy, type RecordingProxy, type RecordedRequest } from "./recordingProxy";

// ==== People and conversations ====

export interface BenchPeople {
  owner: PersonRow;
  child: PersonRow;
}

/** The bench's own two people, inserted the way the memory bench does. */
export function createBenchPeople(): BenchPeople {
  const nowIso = new Date().toISOString();
  const insert = (displayName: string, role: string): PersonRow => {
    const id = newPersonId();
    sqlite
      .query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)")
      .run(id, displayName, role, randomSuffix(12), nowIso, nowIso, nextHlc());
    const row = db.select().from(people).where(eq(people.id, id)).get();
    if (!row) throw new Error(`failed to create the bench person ${displayName}`);
    return row;
  };
  return { owner: insert("Sage", "owner"), child: insert("Bramble", "child") };
}

// ==== The fake Home Assistant (E2, A4) ====

export interface FakeHomeAssistant {
  url: string;
  /** Calls received, by "domain.service". */
  calls: Record<string, number>;
  stop(): void;
}

/** A Bun.serve() on port 0 that answers Home Assistant's service-call
 * endpoint and counts each call: the package's own effect, counted
 * where it lands, never inferred from turn rows. Points the household's
 * `home.base_url` and `home.access_token` at itself (the bench's
 * disposable database). */
/** LOOKUP-01: a fake SearXNG (`/search?q=...&format=json`) answering
 * every query with two canned results built from the query's own words,
 * so a forced or accepted lookup has a source to cite without the
 * network; `queries` records what the hub searched for. The design's
 * "lookups answered from recorded fixtures". Sets `search.searxng_url`
 * on the bench's own household. */
export interface FakeSearxng {
  url: string;
  queries: string[];
  stop(): void;
}
export function startFakeSearxng(): FakeSearxng {
  const queries: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/search") return new Response("not found", { status: 404 });
      const q = url.searchParams.get("q") ?? "";
      queries.push(q);
      const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "query";
      // The fixture's own world subject gets real canned facts; every
      // other query gets a result that says nothing, so the rows that
      // check a real fact fail as they did with no search at all.
      // ASK-02: the film's cast row names Serena Vale (the hub-named
      // subject), and a query about her answers with her own facts.
      const results = /no results fixture/i.test(q)
        ? []
        : /serena vale/i.test(q) && /photo|picture|image/i.test(q)
        ? [
            { title: "Serena Vale portrait", url: `https://example.com/${slug}/portrait`, content: "A portrait of Serena Vale.", img_src: "https://images.example.com/serena-vale-portrait.jpg", thumbnail_src: "https://images.example.com/thumbs/serena-vale-portrait.jpg" },
            { title: "Serena Vale on stage", url: `https://example.com/${slug}/stage`, content: "A stage photo of Serena Vale.", img_src: "https://images.example.com/serena-vale-stage.jpg", thumbnail_src: "https://images.example.com/thumbs/serena-vale-stage.jpg" },
            { title: "Serena Vale at the premiere", url: `https://example.com/${slug}/premiere`, content: "A premiere photo of Serena Vale.", img_src: "https://images.example.com/serena-vale-premiere.jpg", thumbnail_src: "https://images.example.com/thumbs/serena-vale-premiere.jpg" },
            { title: "Serena Vale archive", url: `https://example.com/${slug}/archive`, content: "An archive photo of Serena Vale.", img_src: "https://images.example.com/serena-vale-archive.jpg", thumbnail_src: "https://images.example.com/thumbs/serena-vale-archive.jpg" },
          ]
        : /marsh lantern/i.test(q) && /poster|cover|artwork/i.test(q)
          ? [
              { title: "Marsh Lantern movie poster", url: `https://example.com/${slug}`, content: "The official Marsh Lantern movie poster.", img_src: "https://images.example.com/marsh-lantern-poster.jpg", thumbnail_src: "https://images.example.com/thumbs/marsh-lantern-poster.jpg" },
              { title: "Marsh Lantern alternate poster", url: `https://example.com/${slug}/alternate`, content: "An alternate Marsh Lantern poster.", img_src: "https://images.example.com/marsh-lantern-poster-alt.jpg", thumbnail_src: "https://images.example.com/thumbs/marsh-lantern-poster-alt.jpg" },
              { title: "Marsh Lantern festival poster", url: `https://example.com/${slug}/festival`, content: "A festival poster for Marsh Lantern.", img_src: "https://images.example.com/marsh-lantern-poster-festival.jpg", thumbnail_src: "https://images.example.com/thumbs/marsh-lantern-poster-festival.jpg" },
              { title: "Marsh Lantern archive poster", url: `https://example.com/${slug}/archive`, content: "An archive poster for Marsh Lantern.", img_src: "https://images.example.com/marsh-lantern-poster-archive.jpg", thumbnail_src: "https://images.example.com/thumbs/marsh-lantern-poster-archive.jpg" },
            ]
        : /serena vale/i.test(q) && /song|music|hit/i.test(q)
        ? [
            { title: "Sunday Bay - Serena Vale", url: `https://example.com/${slug}`, content: "Sunday Bay is one of Serena Vale's songs; her other hits include Lantern Bay and Northern Light." },
            { title: "Serena Vale songs", url: `https://example.com/${slug}/songs`, content: "Serena Vale's music includes Sunday Bay, Lantern Bay, and Northern Light." },
          ]
        : /serena vale/i.test(q)
          ? [
            { title: "Serena Vale (actress)", url: `https://example.com/${slug}`, content: "Serena Vale is an actress; she plays the lighthouse keeper in the new Marsh Lantern film and won a stage award last year." },
            // The public-figure row's raising turn asks what happened to her
            // (the set's read: the recipe's summary said the results did not
            // say, rightly, until the fixture carried it).
            { title: "Serena Vale found safe after a week missing", url: `https://example.com/${slug}/news`, content: "What happened to Serena Vale: the actress was found safe after a week missing; she had been filming in secret on a closed shoot for the Marsh Lantern film." },
          ]
          : /marsh lantern/i.test(q) && /film|movie|cast|stars?|about|who/i.test(q)
          ? [
              { title: "Marsh Lantern (film): cast and plot", url: `https://example.com/${slug}`, content: "The new Marsh Lantern film follows a lighthouse keeper on a rock through one winter; it stars Serena Vale as the keeper and Vincent Marlow as her brother, and it is out in October." },
              { title: "Marsh Lantern film reviews", url: `https://example.com/${slug}/reviews`, content: "Reviews call it slow and beautiful; Serena Vale's performance carries it." },
            ]
          : /marsh lantern/i.test(q)
            ? [
                { title: "Marsh Lantern: the new album (release details)", url: `https://example.com/${slug}`, content: "The new Marsh Lantern album is out on September 22 with 12 tracks; the first single is already out and a spring tour is announced." },
                { title: "Marsh Lantern album reviews", url: `https://example.com/${slug}/reviews`, content: "Reviews call it their strongest record in years; the drumming on the second track stands out." },
              ]
            : /cosmo 7/i.test(q) && /pin|power|connector/i.test(q)
              ? [
                  { title: "Cosmo 7 card: specifications", url: `https://example.com/${slug}`, content: "The Cosmo 7 card takes one 8-pin power connector (8 pins) and draws 220 watts." },
                ]
              : /cosmo 7/i.test(q) && /open.?box|price|going for|used/i.test(q)
                ? [
                    { title: "Open-box Cosmo 7 listings", url: `https://example.com/${slug}`, content: "Open-box Cosmo 7 cards are listed between 340 and 380 dollars this week." },
                  ]
                : /lantern bay/i.test(q)
                  ? [
                      { title: "Lantern Bay (cartoon)", url: `https://example.com/${slug}`, content: "The old Lantern Bay cartoon's horse is called Copper; the show ran for six seasons." },
                    ]
                  : // TRUEUP-01 (docs/plans/chat-trueup-2026-09-23.md, the
                    // coordinator's own ruling): "mariners" fell into the
                    // generic catch-all below, a placeholder with no real
                    // content - a fixture gap named directly (fix the
                    // fixture, not the code), since search-mariners-game's
                    // own row needs real content to answer a forced-search
                    // turn from.
                    /mariners/i.test(q)
                    ? [{ title: "Mariners win 6-3", url: `https://example.com/${slug}`, content: "The Seattle Mariners won last night's game 6-3, extending their winning streak to four games." }]
                    : // WRITTEN-PARITY-01's own `written-fresh-president-france`
                      // row: a name no model's own training data could
                      // already know, so a reply carrying it can only have
                      // come from these results, never a lucky guess -
                      // real world figures never appear here on purpose.
                      /pr[ée]sident.*franc|franc.*pr[ée]sident/i.test(q)
                      ? [{ title: "President of France: officeholder", url: `https://example.com/${slug}`, content: "Élodie Vasseur is the current President of France, sworn in after the last presidential election." }]
                      : [{ title: `Search results for ${q}`, url: `https://example.com/${slug}`, content: `No further details were found for ${q}.` }];
      return Response.json({ query: q, results });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const page: PageReadResult = {
    type: "document",
    attachment_id: "att-page-fake001",
    url: "https://example.com/page",
    title: "Vendor support page",
    text: "The latest driver fix is in the download section. The current price is 349 dollars.",
    chunks: [{ attachment_id: "att-page-fake001", page: 1, text: "The latest driver fix is in the download section. The current price is 349 dollars." }],
    links: [
      { title: "Download latest game driver", href: "https://example.com/downloads/latest-driver", rel: "nofollow", surrounding_text: "Download latest game driver" },
      { title: "Support and fixes", href: "https://example.com/support/fixes", rel: null, surrounding_text: "Support and fixes" },
      { title: "Pricing", href: "https://example.com/price", rel: null, surrounding_text: "Current price: 349 dollars" },
    ],
    sections: [
      { heading: "Download", text: "The latest driver fix is in the download section." },
      { heading: "Support", text: "Support and fixes are listed here." },
      { heading: "Pricing", text: "The current price is 349 dollars." },
    ],
  };
  __setPageReaderForTests(async (pageUrl) => ({ ...page, url: pageUrl }));
  const set = setHouseholdSettingValue("search.searxng_url", url);
  if (!set.ok) throw new Error(`the fake SearXNG could not set search.searxng_url: ${set.error}`);
  return { url, queries, stop: () => { __setPageReaderForTests(null); server.stop(true); } };
}

export function startFakeHomeAssistant(): FakeHomeAssistant {
  const calls: Record<string, number> = {};
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const m = /^\/api\/services\/([^/]+)\/([^/]+)$/.exec(new URL(req.url).pathname);
      if (req.method === "POST" && m) {
        const key = `${decodeURIComponent(m[1]!)}.${decodeURIComponent(m[2]!)}`;
        calls[key] = (calls[key] ?? 0) + 1;
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  for (const [key, value] of [
    ["home.base_url", url],
    ["home.access_token", "bench-token"],
  ] as const) {
    const set = setHouseholdSettingValue(key, value);
    if (!set.ok) throw new Error(`the fake Home Assistant could not set ${key}: ${set.error}`);
  }
  return { url, calls, stop: () => server.stop(true) };
}

// ==== WRITTEN-PARITY-01: the reply floor ====

/** The bare model's own answer to a question - no system message, no
 * tools, thinking off, the engine's own default length - the floor
 * written-set.ts measures the path's reply against (the state record's
 * "the reply floor": personality, register and guards may change tone,
 * never substance, structure or usefulness). Returns "" on a failed
 * completion rather than throwing, the same degrade posture
 * judgePersonaConsistency's own caller already assumes for one bad
 * call. */
export async function bareReply(question: string): Promise<string> {
  const result = await complete("chat", [{ role: "user", content: question }], { thinking: false });
  return result.ok ? visibleText(result.value.text) : "";
}

export interface RunDeps {
  people: BenchPeople;
  /** The recording proxy, when the run has one (the live run does; the
   * stub tests capture the context another way and pass null). */
  proxy: RecordingProxy | null;
  log: LogCapture;
  /** Run the memory judge until the queue is empty. */
  drainJudge: () => Promise<void>;
  /** Backdate everything the bench wrote for these people, and the
   * memory rows written from these turns, by N days. */
  backdate: (days: number, turnIds: readonly string[]) => void;
  /** The fake Home Assistant counting the lock package's own calls. */
  homeAssistant: FakeHomeAssistant | null;
  /** Fire the due scheduled jobs, as the hub's own minute tick does;
   * the default runs the real scheduler with the real package runner. */
  tickScheduler?: (now: Date) => Promise<void>;
  /** U2d's own live-hub protocol (replay.ts's --hub-live,
   * liveHubQuiet.ts): called once before each turn's own driveTurn(),
   * so a run against the household's real 127.0.0.1:8788 waits for
   * real household activity to go quiet first. undefined for every
   * other run (the stub tests, a side-instance --live run) - those
   * never touch the shared engine this exists to protect. */
  beforeTurn?: () => Promise<void>;
}

// The hub registers every package's notification types at boot
// (index.ts); the bench runs turns in process and a fired timer's
// `timer.done` is declared by the timer package, so the same
// registration runs once here before the first tick (idempotent).
let notificationTypesRegistered = false;
const defaultTick = async (now: Date) => {
  if (!notificationTypesRegistered) {
    registerAllPackageNotificationTypes();
    notificationTypesRegistered = true;
  }
  await runDueJobs(runPlugin, now);
};

const SENTENCE_END = /[.!?]["')\]]?(\s|$)/;

interface Timings {
  firstDeltaMs: number | null;
  firstSentenceMs: number | null;
  totalMs: number;
}

/** Drives one turn: starts the stream, reads it (aborting after the
 * first delta for an interruption), finalizes, and returns the value
 * with the timings the bench measures itself. */
async function driveTurn(
  actor: PersonRow,
  say: string,
  opts: { conversationId: string; supersedes?: string; interrupt?: boolean; surface?: "chat" | "robot" },
): Promise<{ value: TurnValue | null; text: string; timings: Timings; error: string | null; interrupted: boolean; spokenCue: string | null }> {
  const t0 = performance.now();
  const controller = new AbortController();
  const elapsed = () => performance.now() - t0;
  let result: TurnStreamResult;
  try {
    // U2d's own acceptance ("the replay set on the new path with the
    // flag on"): reads the real household setting, never a bench-only
    // flag, so a replay run exercises exactly what a household turn
    // would - turnNext.ts's own TurnStreamResult is always "immediate"
    // (its own header note), which this function already handles below.
    result = getHouseholdSettingValue("turn.pipeline.next") === true
      ? await runTurnNext(actor, opts.surface ?? "chat", say, { conversationId: opts.conversationId, signal: controller.signal })
      : await runTurnStream(actor, opts.surface ?? "chat", say, { conversationId: opts.conversationId, supersedes: opts.supersedes, signal: controller.signal });
  } catch (err) {
    return { value: null, text: "", timings: { firstDeltaMs: null, firstSentenceMs: null, totalMs: elapsed() }, error: (err as Error).message, interrupted: false, spokenCue: null };
  }
  if (!result.ok) return { value: null, text: "", timings: { firstDeltaMs: null, firstSentenceMs: null, totalMs: elapsed() }, error: result.error, interrupted: false, spokenCue: null };
  if (result.kind === "immediate") {
    const total = elapsed();
    // RERUN-PROTOCOL-01 (dev.md "U6 rerun ruling" (c) 3, "both paths on
    // the same runner shape"): an immediate result (runTurnNext's own
    // header note - it always resolves this way) still made real,
    // internally-streamed engine calls (model.ts's startCompleteStream);
    // this just never surfaced that stream to the caller. The turn's
    // own stored generation record already has the real first-token
    // time (request_sent_ms, turn-relative, plus that request's own
    // first_delta_ms) - reading it back gives an honest firstDeltaMs
    // instead of collapsing it to the whole call's total, the one gap
    // that made every new-path row's own "first delta" identical to
    // its total regardless of how fast the model actually answered.
    // firstSentenceMs has no equivalent: nothing in this path detects a
    // sentence boundary mid-generation, so it stays total - an honest
    // limit, not a guess.
    let firstDeltaMs = total;
    const firstGen = db.select({ stats: conversationTurns.stats }).from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    if (firstGen?.stats) {
      try {
        const parsed = JSON.parse(firstGen.stats) as { generations?: { request_sent_ms: number; first_delta_ms: number | null }[] };
        const gen = parsed.generations?.[0];
        if (gen && gen.first_delta_ms !== null) firstDeltaMs = gen.request_sent_ms + gen.first_delta_ms;
      } catch {
        // Malformed stats JSON (should not happen - buildTurnStats()
        // always writes valid JSON) falls back to total rather than
        // throwing mid-bench over a diagnostic-only field.
      }
    }
    return { value: result.value, text: result.value.reply.text, timings: { firstDeltaMs, firstSentenceMs: total, totalMs: total }, error: null, interrupted: false, spokenCue: null };
  }
  // The route (src/routes/turn.ts, streamTurnEvents) plays the spoken cue
  // when the model's first token is slow to arrive (a race against a
  // 900 ms delay from startedAt) and the cue is not suppressed. The
  // runner drains the tokens directly and never sees the cue, so it
  // recomputes the same decision here, from the stream result's own
  // `startedAt`, `cueSuppressed` and `bannedPhrases`, and records it so a
  // row can check it.
  let spokenCue: string | null = null;
  if (!result.cueSuppressed) {
    const elapsedAtStream = performance.now() - (result.startedAt ?? t0);
    if (elapsedAtStream >= THINKING_CUE_DELAY_MS) spokenCue = pickThinkingCue(actor.id, result.bannedPhrases);
  }
  let text = "";
  let firstDeltaMs: number | null = null;
  let firstSentenceMs: number | null = null;
  let outcome: unknown;
  let interrupted = false;
  try {
    const iterator = result.tokens[Symbol.asyncIterator]();
    let step = await iterator.next();
    while (!step.done) {
      text += step.value;
      if (firstDeltaMs === null && step.value.trim()) firstDeltaMs = elapsed();
      if (firstSentenceMs === null && SENTENCE_END.test(text)) firstSentenceMs = elapsed();
      if (opts.interrupt && firstDeltaMs !== null) {
        // The route's disconnect: the abort fires while the next read
        // is pending (the consumer is always waiting on the next token),
        // so the throw passes holdLease()'s finally and releases.
        interrupted = true;
        const pending = iterator.next();
        controller.abort();
        await pending;
        await iterator.return?.(undefined as never);
        break;
      }
      step = await iterator.next();
    }
    if (step.done) outcome = step.value;
  } catch (err) {
    if (!interrupted) return { value: null, text, timings: { firstDeltaMs, firstSentenceMs, totalMs: elapsed() }, error: (err as Error).message, interrupted, spokenCue };
  }
  if (interrupted) {
    // The route's disconnect path: nothing is finalized for a reply
    // nobody read; the lease releases through holdLease()'s finally.
    return { value: null, text, timings: { firstDeltaMs, firstSentenceMs, totalMs: elapsed() }, error: null, interrupted, spokenCue };
  }
  const resolved = outcome && typeof outcome === "object" && "resolved" in outcome ? (outcome as { resolved: TurnValue }).resolved : null;
  const value = result.finalize(text, outcome as Parameters<typeof result.finalize>[1]);
  const finalValue = resolved ?? value;
  return { value: finalValue, text: finalValue.reply.text, timings: { firstDeltaMs: firstDeltaMs ?? elapsed(), firstSentenceMs: firstSentenceMs ?? elapsed(), totalMs: elapsed() }, error: null, interrupted, spokenCue };
}

/** The coherence review's question 5 (row 4): the runner scripts the
 * hub's own reply for this turn instead of calling the model, so a row
 * can test the acceptance half of an offer before the engine offers
 * unprompted. The turn is logged through logTurn() with the frozen
 * signal prepareTurn() would compute, and the engine's own offer scan
 * (notePendingLookup) binds the offer, one definition. */
function seedTurn(actor: PersonRow, say: string, reply: string, conversationId: string): { value: TurnValue; text: string; timings: Timings; error: string | null; interrupted: boolean; spokenCue: string | null } {
  const turnId = newConversationTurnId();
  const signal = classifyTurnSignal({ text: say, commandOpeners: commandOpeners(loadAllManifests()), ageBand: speakerAgeBand(actor, new Date()) });
  const safety = evaluateSafety(say, speakerAgeBand(actor, new Date()));
  const value: TurnValue = { reply: { text: reply }, source: "model", safety, conversation_id: conversationId, turn_id: turnId };
  logTurn(actor, "chat", say, value, { signal, judgeStatus: judgeStatusAtInsert(value, signal) });
  // LOOKUP-02: the bound question is the engine's, built from the
  // turn's subjects and the offer, as on the live path.
  const subjects = resolveNames(say, signal, { names: [], resolveEntity: () => null }, turnId).subjects;
  const offered = reply.split(/(?<=[.!?])\s+/).find((sentence) => lookupShapeOf(sentence) !== null);
  const expression = offered ? lookupQueryFor({ subjects, sentence: offered, utterance: say, history: [], roster: [], shape: lookupShapeOf(offered) ?? undefined }) : null;
  notePendingLookup(conversationId, reply, say, [], undefined, expression);
  return { value, text: reply, timings: { firstDeltaMs: 0, firstSentenceMs: 0, totalMs: 0 }, error: null, interrupted: false, spokenCue: null };
}

function memoryRowsFor(turnId: string | null): string[] {
  if (!turnId) return [];
  return db
    .select({ text: memoryRecords.text })
    .from(memoryRecords)
    .where(eq(memoryRecords.source, turnId))
    .all()
    .map((r) => r.text);
}

/** Package runs in the conversation so far: a turn row whose package
 * answered or failed while running; a confirmation ask (source
 * "confirm") parked the call and is not a run. */
function attemptsIn(conversationId: string): Record<string, number> {
  const rows = db.select({ pluginId: conversationTurns.pluginId, source: conversationTurns.source }).from(conversationTurns).where(eq(conversationTurns.conversationId, conversationId)).all();
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.pluginId || (r.source !== "plugin" && r.source !== "plugin_error")) continue;
    for (const id of r.pluginId.split("+")) counts[id] = (counts[id] ?? 0) + 1; // a two-call turn stores "a+b"
  }
  return counts;
}

/** The person's and the household's memory records with their status
 * (A3: a correction retires the old record and activates the new one). */
function memoryRowDetailsFor(actor: PersonRow): TurnObserved["memoryRowDetails"] {
  const subjectNames = new Map(db.select({ id: entities.id, name: entities.name }).from(entities).all().map((e) => [e.id, e.name]));
  return db
    .select({ text: memoryRecords.text, category: memoryRecords.category, subjectId: memoryRecords.subjectId, status: memoryRecords.status, importance: memoryRecords.importance, validTo: memoryRecords.validTo, expiredAt: memoryRecords.expiredAt })
    .from(memoryRecords)
    .where(or(eq(memoryRecords.person, actor.id), eq(memoryRecords.scope, "household")))
    .all()
    .filter((r) => r.text.length > 0)
    // `disclosure` is AGE-01's column (spec'd by SPEC-01, not stored
    // yet): null until the table carries it.
    .map((r) => ({ text: r.text, category: r.category, subject: r.subjectId ? (subjectNames.get(r.subjectId) ?? null) : null, status: r.status, importance: r.importance, validTo: r.validTo, disclosure: null, expiredAt: r.expiredAt }));
}

function recordsFor(actor: PersonRow): { text: string; status: string }[] {
  return db
    .select({ text: memoryRecords.text, status: memoryRecords.status })
    .from(memoryRecords)
    .where(or(eq(memoryRecords.person, actor.id), eq(memoryRecords.scope, "household")))
    .all()
    .filter((r) => r.text.length > 0);
}

/** Every open item on the household's lists by id (A5, the list-add
 * effect; a checked-off item counts as gone, so G3's "take it off"
 * passes whether the path removes or completes the item). */
function listItemsNow(): Map<string, string> {
  return new Map(
    db
      .select({ items: lists.items })
      .from(lists)
      .where(isNull(lists.deletedAt))
      .all()
      .flatMap((r) => (JSON.parse(r.items) as { id: string; text: string; done?: boolean }[]).filter((i) => !i.done).map((i) => [i.id, i.text] as const)),
  );
}

/** What a map gained since an earlier reading: a row reads only the
 * effects since its own start, never an earlier conversation's (a
 * review: the second lock conversation read the first one's call, and
 * a ten-minute timer from one conversation would satisfy the next). */
function since<T>(before: ReadonlyMap<string, T>, now: ReadonlyMap<string, T>): T[] {
  return [...now.entries()].filter(([id]) => !before.has(id)).map(([, v]) => v);
}

/** Seeds a conversation's entities in the household registry (B4),
 * with a relationship from the owner's own entity when asked; the
 * owner's entity is created once per run. */
const seededEntityIds = new Set<string>();
function seedEntities(conv: BenchConversation, owner: PersonRow): void {
  if (!conv.seedEntities?.length) return;
  for (const e of conv.seedEntities) {
    // ASK-01: a candidate is the judge's own shape (inferred, the
    // owner's scope, unconfirmed), with its question queued.
    // The bench household is one across every row: a registered seed
    // whose name an earlier row's judge already put in the registry as a
    // candidate (act-register-requests' Rover in a full run) confirms
    // that row instead of standing a second entity beside it, and its
    // open question is answered.
    // The seed's own description and aliases go on that row (the
    // household-subject rows' facts live in the registry, never in the
    // transcript), and its relationship below; a hit of another kind is
    // a premise clash the run reports rather than a twin it makes.
    const existing = e.source === "inferred" ? null : findEntityByName(owner, e.name);
    let entityId: string;
    if (existing) {
      if (existing.kind !== e.kind) throw new Error(`seeding entity ${e.name} for ${conv.id}: the registry already has ${e.name} as a ${existing.kind}, the row wants a ${e.kind}`);
      const candidate = existing.source === "inferred" && !existing.confirmed_by_person_id;
      const merged = updateEntity(owner, existing.id, { ...(candidate ? { confirm: true } : {}), description: e.description, aliases: Array.from(new Set([...existing.aliases, ...(e.aliases ?? [])])) });
      if (!merged.ok) throw new Error(`merging the seeded entity ${e.name} for ${conv.id}: ${merged.error}`);
      if (candidate) resolveOpenQuestionsAbout(owner.id, existing.id, "answered");
      entityId = existing.id;
    } else {
      const created = e.source === "inferred"
        ? createEntity(owner, { kind: e.kind, name: e.name, aliases: [...(e.aliases ?? [])], description: e.description || null, scope: "person", person: owner.id, source: "inferred" })
        : createEntity(owner, { kind: e.kind, name: e.name, aliases: [...(e.aliases ?? [])], description: e.description, scope: "household" });
      if (!created.ok || !created.value) throw new Error(`seeding entity ${e.name} for ${conv.id}: ${created.ok ? "no value" : created.error}`);
      seededEntityIds.add(created.value.id);
      entityId = created.value.id;
      if (e.openQuestion) queueOpenQuestion({ person: owner.id, kind: "who", text: e.openQuestion, subjectId: created.value.id, source: `bench:${conv.id}` });
    }
    if (e.relationshipFromOwner) {
      let self = db.select({ id: entities.id }).from(entities).where(and(eq(entities.accountPersonId, owner.id), isNull(entities.deletedAt))).get();
      if (!self) {
        const made = createEntity(owner, { kind: "person", name: owner.displayName, account_person_id: owner.id, scope: "household" });
        if (!made.ok || !made.value) throw new Error(`seeding the owner's entity for ${conv.id}: ${made.ok ? "no value" : made.error}`);
        self = { id: made.value.id };
        seededEntityIds.add(self.id);
      }
      const rel = createRelationship(owner, { type: e.relationshipFromOwner, from_id: self.id, to_id: entityId, scope: "household" });
      if (!rel.ok) throw new Error(`seeding the relationship ${e.relationshipFromOwner} for ${conv.id}: ${rel.error}`);
    }
  }
}

function seedRecords(conv: BenchConversation, owner: PersonRow): void {
  for (const record of conv.seedRecords ?? []) {
    const subject = record.subject ? findEntityByName(owner, record.subject)?.id : undefined;
    const seeded = remember(owner, {
      text: record.text,
      category: record.category,
      tier: "durable",
      scope: record.scope,
      person: record.scope === "person" ? owner.id : undefined,
      subject_id: subject,
      source: record.asProfile ? PROFILE_SOURCE : `bench:${conv.id}`,
      importance: 0.9,
      pinned: record.asProfile ?? false,
      child_disclosure: record.disclosure ?? undefined,
      sensitive: record.sensitive ?? false,
    });
    if (!seeded.ok) throw new Error(`seeding ${conv.id}: ${seeded.error}`);
  }
}

/** The live relationships touching the person's own entity, the other
 * end named, for the relationship rows (step 3a). */
function relationshipsOf(actor: PersonRow): { type: string; name: string; source: string; confirmed: boolean }[] {
  const self = db.select({ id: entities.id }).from(entities).where(and(eq(entities.accountPersonId, actor.id), isNull(entities.deletedAt))).get();
  if (!self) return [];
  const names = new Map(db.select({ id: entities.id, name: entities.name }).from(entities).where(isNull(entities.deletedAt)).all().map((e) => [e.id, e.name]));
  return db
    .select()
    .from(relationships)
    .where(and(isNull(relationships.deletedAt), or(eq(relationships.fromId, self.id), eq(relationships.toId, self.id))))
    .all()
    .filter((r) => r.validTo === null)
    .map((r) => ({ type: r.type, name: names.get(r.fromId === self.id ? r.toId : r.fromId) ?? "?", source: r.source, confirmed: r.confirmedByPersonId !== null }));
}

/** The Confirm control, driven from the bench: every unconfirmed
 * inferred relationship of the person's, confirmed by them (the bench's
 * owner is an adult). */
function confirmInferredRelationships(actor: PersonRow): void {
  const rows = db
    .select({ id: relationships.id })
    .from(relationships)
    .where(and(isNull(relationships.deletedAt), eq(relationships.person, actor.id), eq(relationships.source, "inferred"), isNull(relationships.confirmedByPersonId)))
    .all();
  for (const row of rows) {
    // A directed pair is confirmed together with its first edge, so the
    // second is already confirmed by the time its turn comes: not an
    // error.
    const result = updateRelationship(actor, row.id, { confirm: true });
    if (!result.ok && result.status !== 409) throw new Error(`confirming ${row.id}: ${result.error}`);
  }
}

/** Waits for the due time, ticks the scheduler the way the hub does
 * every minute, and returns the notification types delivered to the
 * person since the turn started (F2: the scheduler's own later
 * delivery, observed; an earlier conversation's timer firing in the
 * same tick does not count). Polls every half second up to
 * `withinMs`, so a job due in five seconds is seen in about five. */
async function observeDelivery(actor: PersonRow, notification: string, withinMs: number, tick: (now: Date) => Promise<void>, before: ReadonlySet<string>): Promise<string[]> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    await tick(new Date());
    const delivered = listPending(actor)
      .filter((n) => !before.has(n.id))
      .map((n) => n.typeId);
    if (delivered.includes(notification) || Date.now() >= deadline) return delivered;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const jobsNow = (actor: PersonRow) => new Map(listJobs(actor).map((j) => [j.id, { job: j.job, status: j.status }] as const));

export interface ConversationRun {
  scores: TurnScore[];
  /** The turn ids in order, for the caller's own cleanup or backdating. */
  turnIds: string[];
}

/** Runs one fixture conversation end to end and scores every turn. */
export async function runConversation(conv: BenchConversation, deps: RunDeps): Promise<ConversationRun> {
  const scores: TurnScore[] = [];
  const turnIds: string[] = [];
  const conversationIds: Partial<Record<Speaker, string>> = {};
  if (conv.seedPrivateForChild) {
    const seeded = remember(deps.people.child, { text: conv.seedPrivateForChild, category: "fact", tier: "durable", scope: "person", person: deps.people.child.id, source: `bench:${conv.id}`, importance: 0.8 });
    if (!seeded.ok) throw new Error(`seeding ${conv.id}: ${seeded.error}`);
  }
  seedEntities(conv, deps.people.owner);
  seedRecords(conv, deps.people.owner);
  // Every conversation starts with empty lists: the household's one
  // shopping list is shared, and the live run found "the second one"
  // pointing at an item a conversation twenty rows earlier had added.
  // The household's lists and the bench people's own, never another
  // person's (the bench's database is disposable, setup.ts refuses any
  // other, and this keeps that promise inside the function too).
  sqlite.query("DELETE FROM lists WHERE scope = 'household' OR person IN (?, ?)").run(deps.people.owner.id, deps.people.child.id);
  const tick = deps.tickScheduler ?? defaultTick;
  // The fake Home Assistant counts for the whole run; a row reads the
  // calls this conversation made (the live run found the second lock
  // conversation reading the first one's call).
  const homeCallsAtStart = { ...(deps.homeAssistant?.calls ?? {}) };
  const listItemsAtStart = listItemsNow();
  const homeCallsSince = (): Record<string, number> => {
    const now = deps.homeAssistant?.calls ?? {};
    const delta: Record<string, number> = {};
    for (const [service, count] of Object.entries(now)) delta[service] = count - (homeCallsAtStart[service] ?? 0);
    return delta;
  };
  // A row may pin the engine's prompt clock (dev.md section 16 part 6):
  // the clock is local, so promptNow() returns the row's local date-time
  // for every turn of this conversation and is unpinned afterwards.
  if (conv.clock) __setPromptClockForBench(() => new Date(conv.clock!));
  try {
  // REP-01: the hub's last delivered reply per conversation, for the
  // "not the same reply again" read.
  const previousReplies: Record<string, string> = {};
  const previousMediaUrls: Record<string, string[]> = {};
  for (let i = 0; i < conv.turns.length; i++) {
    const turn = conv.turns[i]!;
    const speaker: Speaker = turn.as ?? "owner";
    const actor = deps.people[speaker];
    // The judge first, so the rows it writes are the ones backdated.
    if (turn.drainJudge) await deps.drainJudge();
    if (turn.confirmInferred) confirmInferredRelationships(actor);
    if (turn.daysLater) deps.backdate(turn.daysLater, turnIds.filter(Boolean));
    if (i === 0 || turn.newConversation || !conversationIds[speaker]) {
      const created = createConversation(actor, { surface: "chat" });
      if (!created.ok) throw new Error(`createConversation: ${created.error}`);
      conversationIds[speaker] = created.value.id;
    }
    const conversationId = conversationIds[speaker]!;
    const supersedes = turn.supersedesTurn !== undefined ? turnIds[turn.supersedesTurn] : undefined;
    deps.proxy?.reset();
    const before = new Set(deps.log.turns.keys());
    const beforeRoutes = new Set(deps.log.routes.keys());
    const jobsBefore = jobsNow(actor);
    const deliveriesBefore = new Set(listPending(actor).map((n) => n.id));
    // LOOKUP-02: with the recording proxy in front of the engine, a
    // seeded reply is the model's next draft and goes through the reply
    // boundary (the read, the forced lookup, the guards); without one
    // (the stub tests) it is pasted as before.
    if (turn.seedReply !== undefined && deps.proxy) deps.proxy.scriptNextReply(turn.seedReply);
    if (deps.beforeTurn) await deps.beforeTurn();
    const driven = turn.seedReply !== undefined && !deps.proxy ? seedTurn(actor, turn.say, turn.seedReply, conversationId) : await driveTurn(actor, turn.say, { conversationId, supersedes, interrupt: turn.interrupt, surface: conv.surface });
    await deps.proxy?.settled(); // the teed reply text lands a tick after the client's read
    // An interrupted turn logs no [turn] line today (nothing is
    // finalized for a reply nobody read); its id is on the [route] line.
    const turnId = driven.value?.turn_id ?? [...deps.log.turns.keys()].find((id) => !before.has(id)) ?? [...deps.log.routes.keys()].find((id) => !beforeRoutes.has(id)) ?? null;
    if (turnId) turnIds[i] = turnId;
    const line = turnId ? deps.log.turns.get(turnId) : undefined;
    const route = turnId ? deps.log.routes.get(turnId) : undefined;
    const row = turnId ? db.select().from(conversationTurns).where(and(eq(conversationTurns.id, turnId), eq(conversationTurns.personId, actor.id))).get() : undefined;
    const requests = deps.proxy?.requests ?? [];
    // A row that reads memory (written, or nothing written) is read
    // after the judge has had its turn, so the judge's own rows count.
    if (turn.expect.memoryWritten || turn.expect.storesNothing || turn.expect.recordActive || turn.expect.recordRetired || turn.expect.entityExists || turn.expect.entityAbsent || turn.expect.relationshipExists || turn.expect.memoryRows || turn.expect.askedAbout || turn.expect.openQuestion || turn.expect.openQuestionStatus) await deps.drainJudge();
    // The jobs this turn scheduled, read before the delivery wait: a
    // promise row sees its own job pending, then the scheduler's own
    // delivery of it.
    const jobs = since(jobsBefore, jobsNow(actor));
    const deliveryExpectation = turn.expect.delivered ?? (turn.expect.notificationExists ? { notification: turn.expect.notificationExists, withinMs: 12_000 } : undefined);
    const deliveries = deliveryExpectation ? await observeDelivery(actor, deliveryExpectation.notification, deliveryExpectation.withinMs, tick, deliveriesBefore) : [];
    // The turn's own completions: the interrupted one is the first
    // (a summary refresh may follow it on the same proxy).
    const own = requests[0];
    const requiredCall = requests.find((r) => r.toolChoice === "required");
    // RERUN-PROTOCOL-01: the turn row's own stored stats.nodes[]/
    // generations[], read once here rather than a second time in
    // replay.ts - one definition of "how a turn's stats JSON gets
    // parsed," the same row `row?.source`/`row?.pluginId` above already
    // read from. A review caught the first cut here with no try/catch,
    // unlike the sibling parse in driveTurn() above - a malformed
    // `stats` value would throw mid-loop and abort the whole
    // conversation run over a diagnostic-only field.
    let parsedStats: { nodes?: TurnObserved["nodeTrace"]; generations?: TurnObserved["generationTrace"] } | null = null;
    if (row?.stats) {
      try {
        parsedStats = JSON.parse(row.stats as unknown as string) as { nodes?: TurnObserved["nodeTrace"]; generations?: TurnObserved["generationTrace"] };
      } catch {
        // Falls back to null rather than throwing mid-bench.
      }
    }
    const currentMediaUrls = (driven.value?.media_items ?? (driven.value?.media ? [driven.value.media] : [])).map((item) => item.url);
    const previousUrls = previousMediaUrls[conversationId] ?? [];
    const mediaDisjointFromPrevious = previousUrls.length > 0 && currentMediaUrls.length > 0 && currentMediaUrls.every((url) => !previousUrls.includes(url));
    const observed: TurnObserved = {
      reply: driven.value?.reply.text ?? driven.text,
      source: driven.value?.source ?? row?.source ?? null,
      pluginId: driven.value?.plugin_id ?? row?.pluginId ?? null,
      guardHits: line?.guard ?? [],
      guardReplaced: row?.guardReason ?? null,
      safetyAction: driven.value?.safety.action ?? row?.safetyAction ?? null,
      crisisResources: Boolean(driven.value?.crisis_resources),
      memoryRows: memoryRowsFor(turnId),
      storedUserText: row?.userText ?? null,
      contextMessage: requests.length ? requests.map((r) => r.systemText).join("\n") : null,
      offeredTools: requests[0]?.tools ?? route?.offered ?? [],
      attempts: attemptsIn(conversationId),
      answered: driven.value !== null && driven.error === null,
      leaseCount: activeTurnCount(),
      firstDeltaMs: driven.timings.firstDeltaMs,
      firstSentenceMs: driven.timings.firstSentenceMs,
      totalMs: driven.timings.totalMs,
      interrupted: driven.interrupted,
      spokenCue: driven.spokenCue,
      rawModelText: requests.length ? (requests[requests.length - 1]?.responseText ?? null) : null,
      records: recordsFor(actor),
      // ACT-01: the frozen signal off the turn row (never the log line),
      // and the memory rows in the detail MEM-06's memoryRows expectation
      // reads (category, subject, importance, the valid_to window).
      signal: row ? turnSignalOf(row) : null,
      plan: row ? turnPlanOf(row) : null,
      memoryRowDetails: memoryRowDetailsFor(actor),
      pendingAsk: getPendingAsk(conversationId)?.kind ?? null,
      pendingAskName: getPendingAsk(conversationId)?.name ?? null,
      lookupShape: line?.lookup_shape ?? null,
      composed: line?.composed ?? null,
      ungrounded: line?.ungrounded ?? null,
      // REP-01: the turn's extra generations (the retry), and the reply
      // this conversation delivered before it.
      retries: line?.timings?.retries ?? null,
      previousReply: previousReplies[conversationId] ?? null,
      // ASK-01: the person's own open questions, read after the judge
      // drained (a candidate's question is the judge's).
      openQuestions: listOpenQuestions(actor.id).map((q) => ({ kind: q.kind, status: q.status, text: q.text })),
      listItems: since(listItemsAtStart, listItemsNow()),
      jobs,
      homeCalls: homeCallsSince(),
      sourceUrls: [...new Set([
        ...(driven.value?.sources ?? []).map((source) => source.url),
        ...requests.flatMap((r) => r.sourceUrls),
      ])],
      mediaPresent: Boolean(driven.value?.media_items?.length ?? driven.value?.media),
      mediaItems: driven.value?.media_items?.length ?? (driven.value?.media ? 1 : 0),
      mediaDisjointFromPrevious,
      inferenceStopped: own ? own.aborted && !own.completed : null,
      reconciledRow: row !== undefined && row.replyText.trim().length > 0,
      deliveries,
      subject: line?.subject ?? null,
      subjects: line?.subjects?.map((s) => ({ ...s, rejected: false })),
      entities: db
        .select({ kind: entities.kind, name: entities.name, source: entities.source, pronouns: entities.pronouns, description: entities.description })
        .from(entities)
        .where(isNull(entities.deletedAt))
        .all(),
      relationships: relationshipsOf(actor),
      // LOOKUP-01 (the coherence review's outcomeArgs): the turn row's
      // own retained outcomes, package id, arguments and the path.
      // `rejected` is CHAT-13's slot (a correction's rejected value on
      // the outcome), unread until the correction path retains it.
      outcomes: turnId ? (outcomesForConversation(conversationId).find((o) => o.turnId === turnId)?.outcomes ?? []).map((o) => ({ packageId: o.packageId, args: o.args ?? {}, via: o.via ?? null, rejected: null, source: o.source ?? null })) : [],
      assistantEpisodes: db
        .select({ text: episodesTable.text })
        .from(episodesTable)
        .where(and(eq(episodesTable.personId, actor.id), eq(episodesTable.speaker, "assistant"), ne(episodesTable.conversationId, conversationId)))
        .all()
        .map((r) => r.text),
      // ENGINE-CONTRACT-01 (dev.md 2026-09-23): the first completion
      // this turn actually forced, read straight off the recording
      // proxy - null when none was.
      requiredHonored: requiredCall?.hasToolCalls ?? null,
      requiredCachedTokens: requiredCall?.cachedTokens ?? null,
      requiredPromptTokens: requiredCall?.promptTokens ?? null,
      nodeTrace: parsedStats?.nodes ?? null,
      generationTrace: parsedStats?.generations ?? null,
    };
    previousReplies[conversationId] = observed.reply;
    previousMediaUrls[conversationId] = currentMediaUrls;
    if (driven.error) observed.reply = `[error: ${driven.error}]`;
    scores.push(scoreTurn(conv, i, turn, observed));
  }
  } finally {
    if (conv.clock) __setPromptClockForBench(null);
  }
  return { scores, turnIds };
}

/** Deletes everything the bench wrote for its two people, inside its
 * own disposable database. Best effort: a row the bench did not expect
 * (a package's own table, the way list-add's lists row was on the first
 * live run) is reported, never allowed to lose the run's table, which
 * the caller prints before this runs. */
export function cleanupBenchPeople(peopleRows: BenchPeople): void {
  try {
    cleanupBenchPeopleStrict(peopleRows);
  } catch (err) {
    console.error(`[bench] cleanup left rows behind in the disposable database: ${(err as Error).message}`);
  }
}

function cleanupBenchPeopleStrict(peopleRows: BenchPeople): void {
  // The registry rows the household-subject conversations seeded (B4),
  // before the people they reference.
  for (const id of seededEntityIds) {
    sqlite.query("DELETE FROM relationships WHERE from_id = ? OR to_id = ?").run(id, id);
    sqlite.query("DELETE FROM entities WHERE id = ?").run(id);
  }
  seededEntityIds.clear();
  for (const person of [peopleRows.owner, peopleRows.child]) {
    // The judge's own registry rows (step 3a): the person's entities,
    // their own person entity, and every edge touching either.
    sqlite.query("DELETE FROM relationships WHERE person = ? OR from_id IN (SELECT id FROM entities WHERE person = ? OR account_person_id = ?) OR to_id IN (SELECT id FROM entities WHERE person = ? OR account_person_id = ?)").run(person.id, person.id, person.id, person.id, person.id);
    sqlite.query("DELETE FROM entities WHERE person = ? OR account_person_id = ?").run(person.id, person.id);
    sqlite.query("DELETE FROM lists WHERE person = ?").run(person.id); // list-add's own rows
    sqlite.query("DELETE FROM open_questions WHERE person = ?").run(person.id); // ASK-01
    sqlite.query("DELETE FROM notification_deliveries WHERE recipient_id = ?").run(person.id);
    sqlite.query("DELETE FROM scheduled_jobs WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM memory_records WHERE person = ?").run(person.id);
    deleteEpisodesForPerson(person.id); // the episode store's own FK-ordered delete
    sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM people WHERE id = ?").run(person.id);
  }
}

/** Backdates the rows the bench wrote for its people by N days: the
 * turn rows, the conversations, the memory records (the person's, and
 * the household-scope ones written from the bench's own turns) and the
 * episodes, computed in JS so the ISO format of created_at is
 * preserved. */
export function backdateBenchRows(peopleRows: BenchPeople, days: number, turnIds: readonly string[] = []): void {
  const shift = days * 86_400_000;
  const back = (iso: string) => new Date(new Date(iso).getTime() - shift).toISOString();
  for (const turnId of turnIds) {
    for (const column of ["created_at", "valid_from"] as const) {
      const rows = sqlite.query(`SELECT id, ${column} AS v FROM memory_records WHERE source = ? AND ${column} IS NOT NULL`).all(turnId) as { id: string; v: string }[];
      const update = sqlite.query(`UPDATE memory_records SET ${column} = ? WHERE id = ?`);
      for (const r of rows) update.run(back(r.v), r.id);
    }
  }
  for (const person of [peopleRows.owner, peopleRows.child]) {
    for (const [table, owner, column] of [
      ["conversation_turns", "person_id", "created_at"],
      ["conversations", "person_id", "created_at"],
      ["conversations", "person_id", "updated_at"],
      ["memory_records", "person", "created_at"],
      ["memory_records", "person", "valid_from"],
      // ACT-01: a bounded state's window moves with the clock too, so a
      // backdated record that was a day from expiring is expired now.
      ["memory_records", "person", "valid_to"],
      ["episodes", "person_id", "created_at"],
    ] as const) {
      const rows = sqlite.query(`SELECT id, ${column} AS v FROM ${table} WHERE ${owner} = ? AND ${column} IS NOT NULL`).all(person.id) as { id: string; v: string }[];
      const update = sqlite.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
      for (const r of rows) update.run(back(r.v), r.id);
    }
  }
}
