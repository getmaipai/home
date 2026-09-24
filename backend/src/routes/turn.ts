import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { randomBytes } from "node:crypto";
import { requireAuth } from "@/middleware/auth";
import { runTurn, runTurnStream, StreamSafetyRefusal, StreamUnavailable, type Surface, type TurnOpResult, type TurnStreamResult } from "@/lib/turnEngine";
import { runBareTurnStream, BareModeForbidden } from "@/lib/turnBareStream";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { isOwnerOrAdmin, canHaveTemporaryChat } from "@/lib/access";
import { pickThinkingCue } from "@/lib/replyVariation";
import { feedThinkSplit, flushThinkSplit, newThinkSplitState, type ThinkSpan } from "@/lib/wellFormed";
import { speakerAgeBand } from "@/lib/ageBand";
import { personWithinTurnBudget, personWithinEphemeralBudget } from "@/lib/llm";
import { isFixedHomeCardQuery } from "@/lib/homeCardQueries";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { TurnStreamEvent, TurnValue } from "@/wire";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import type { AppEnv } from "@/types";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { turnOwnerId } from "@/lib/conversationHistory";

// U6a (docs/plans/simple-turn-pipeline-2026-09-22.md; the coordinator's
// ruling, 2026-09-23): one boundary, no second one. This is the only
// place either route decides old path or new path - conversationRunner.ts's
// bench harness reads the identical setting the identical way, so a
// bench run and a real household turn are never on different paths for
// the same setting value. `runTurnNext`'s own opts surface is narrower
// than `runTurn`/`runTurnStream`'s (no thinking, supersedes,
// continuation, ephemeral or robot evidence yet - U2's own scope, not
// this item's to widen): those fields are silently unavailable on the
// new path until their own units land, exactly as `bare` mode stays on
// the frozen path regardless of the setting (a debug bypass, not a
// household turn).
function newPathOn(): boolean {
  return getHouseholdSettingValue("turn.pipeline.next") === true;
}

export const turnRoutes = apiRouter();
const RESUME_TTL_MS = 60_000;

interface StoredStreamEvent {
  event: TurnStreamEvent;
  sequence: number | null;
  afterSequence: number;
  terminal: boolean;
}

interface StreamSubscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  resumeFrom: number;
}

interface ResumeSession {
  token: string;
  ownerId: string;
  // REASONING-01: a minor's own turn (child or teen, ageBand.ts's shared
  // band) never emits a `reasoning` event (docs/dev.md's own
  // "REASONING-01" section) - computed once here from the real actor at
  // session-construction time, since streamTurnEvents() itself only ever
  // sees `ownerId`, a bare string.
  dropReasoning: boolean;
  conversationId: string;
  turnId: string;
  controller: AbortController;
  result: Extract<TurnStreamResult, { ok: true; kind: "stream" }>;
  events: StoredStreamEvent[];
  subscribers: Set<StreamSubscriber>;
  sequence: number;
  terminal: boolean;
  terminalDelivered: boolean;
  cancelled: boolean;
  expired: boolean;
  expiryTimer: ReturnType<typeof setTimeout>;
}

const resumeSessions = new Map<string, ResumeSession>();
const inFlightTurns = new Map<string, ResumeSession>();

const cancelTurnRoute = createRoute({
  method: "post", path: "/{turn_id}/cancel", tags: ["Turns"],
  summary: "Cancel an in-flight turn",
  description: "Aborts an in-flight completion for a turn owned by the caller.",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("turn_id") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ cancelled: z.boolean() }) } }, description: "Whether the turn was in flight and cancelled." },
    ...errorResponses({ 401: "Not signed in", 403: "The turn belongs to another person", 404: "Unknown turn" }),
  },
});

turnRoutes.openapi(cancelTurnRoute, (c) => {
  const flight = inFlightTurns.get(c.req.valid("param").turn_id);
  const owner = flight?.ownerId ?? turnOwnerId(c.req.valid("param").turn_id);
  if (owner === null) return c.json({ error: "Turn not found" }, 404);
  if (owner !== c.get("person").id) return c.json({ error: "Cannot cancel another person's turn" }, 403);
  const wasInFlight = Boolean(flight && !flight.cancelled && !flight.terminal);
  if (flight && !flight.cancelled && !flight.terminal) {
    flight.controller.abort();
    flight.cancelled = true;
  }
  return c.json({ cancelled: wasInFlight }, 200);
});

const RATE_LIMIT_RESPONSE = { error: "Too many requests too quickly.", code: "turn_rate_limited" } as const;

// Any signed-in person, no role gate: a household member's own
// conversation turn isn't a privileged action, the same posture
// /api/safety/check and /api/llm/chat already take. This is the real
// caller those two routes' comments named as "ahead of the turn engine";
// they stay useful in their own right (diagnostics, direct model/safety
// checks) now that this one exists.
// bodyLimit (SEC-5, 2026-09-06) rejects an oversized request as its bytes
// arrive, before JSON.parse or runTurn()'s own MAX_TURN_TEXT_LENGTH check
// ever run - a margin over that cap for the surrounding JSON and other
// fields, the same "reject at the edge, then validate the content"
// pairing lib/turnEngine.ts's own length check backs up.
const TURN_BODY_LIMIT = 64 * 1024;
const evidence = z.object({ person: z.string().regex(/^person-[a-z0-9]{6,}$/).nullable(), basis: z.enum(["signed_in", "voice", "face", "voice_and_face", "claimed", "unknown"]), level: z.enum(["confirmed", "tentative", "unknown"]) }).strict();
const present = z.array(evidence).nullable();

turnRoutes.post("/", requireAuth, bodyLimit({ maxSize: TURN_BODY_LIMIT }), async (c) => {
  const actor = c.get("person");
  if (!personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    surface?: string;
    text?: string;
    thinking?: boolean;
    conversation_id?: string;
    supersedes?: string;
    continuation_of?: string;
    continuation_text?: string;
    speaker_evidence?: unknown;
    present?: unknown;
    temporary?: boolean;
    spoken?: boolean;
  };
  const parsedEvidence = z.object({ speaker_evidence: evidence.optional(), present: present.optional() }).safeParse(body);
  if (!parsedEvidence.success) return c.json({ error: "Invalid turn evidence", code: "invalid_input" }, 400);
  const surface = (body.surface ?? "chat") as Surface;
  // TEMP-CHAT-01: the clean 403, checked here even though
  // resolveOrCreateConversation() (conversationHistory.ts) asserts the
  // identical thing again on its own construction path - the same
  // "route-level primary gate, structural backstop underneath"
  // ADMIN-COMPARE-01 (b) already established for bare mode.
  if (body.temporary === true && !canHaveTemporaryChat(actor)) {
    return c.json({ error: "temporary chat is not available for minors" }, 403);
  }
  // REASONING-03 (safety ruling, 2026-09-22): a minor's turn never even
  // asks the model to think, belt and braces alongside the composer's
  // own control being hidden for a minor (NextChatPage.tsx) - a client
  // can be edited, so `body.thinking` is never trusted for a minor
  // regardless of what it claims. Reasoning is a disclosure surface
  // built for typed chat's own Reasoning Element - never sent on a
  // surface that has no such affordance (voice/robot/tv/phone), adult
  // actor or not; a review caught the first draft only skipping the
  // MODEL for a minor and leaving a non-chat surface to spend the
  // tokens and latency on a think block this same gate discards below
  // anyway.
  const isMinor = speakerAgeBand(actor, new Date()) !== "adult";
  const dropReasoning = isMinor || surface !== "chat";
  const result: TurnOpResult = newPathOn()
    ? await (async () => {
        // runTurnNext() always resolves "immediate" (its own header note);
        // the explicit kind check is TypeScript's, not a real branch.
        const next = await runTurnNext(actor, surface, body.text ?? "", { conversationId: body.conversation_id, temporary: body.temporary, spoken: body.spoken === true, thinking: dropReasoning ? false : body.thinking });
        return next.ok && next.kind === "immediate" ? { ok: true, value: next.value } : next.ok ? { ok: false, status: 503, code: "unavailable", error: "the new path returned a stream result unexpectedly" } : next;
      })()
    : await runTurn(actor, surface, body.text ?? "", {
        thinking: dropReasoning ? false : body.thinking,
        conversationId: body.conversation_id,
        supersedes: body.supersedes,
        temporary: body.temporary,
        ...(surface === "robot" ? { speakerEvidence: parsedEvidence.data.speaker_evidence ?? null, present: parsedEvidence.data.present ?? null } : {}), // Evidence is only honored on the robot surface.
      });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  // REASONING-02: this blocking route serializes the whole TurnValue
  // (unlike /stream's own hand-built events), so a minor's reasoning
  // field is stripped here rather than at a shared boundary - the same
  // dropReasoning gate the streaming route's own version uses.
  return c.json(dropReasoning && result.value.reasoning !== undefined ? { ...result.value, reasoning: undefined } : result.value);
});

const encoder = new TextEncoder();
// TOOL-EVENTS-01(b): the spec's own tool_call/tool_result/tool_error
// shape is a deliberately separate NDJSON line shape from wire.ts's own
// TurnStreamEvent (keyed by `t`, not `type` - chatModelAdapter.ts's own
// header comment on the frontend side of this same split), never a
// member of that union - widened here rather than merged into it.
function ndjsonLine(event: TurnStreamEvent | ToolStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function newResumeToken(): string {
  return randomBytes(32).toString("base64url");
}

function isTerminalEvent(event: TurnStreamEvent): boolean {
  return event.type === "done" || event.type === "error";
}

function shouldDeliver(stored: StoredStreamEvent, resumeFrom: number | null): boolean {
  if (resumeFrom === null) return true;
  if (stored.terminal) return true;
  if (stored.sequence !== null) return stored.sequence > resumeFrom;
  return stored.afterSequence > resumeFrom;
}

function detachSubscriber(session: ResumeSession, subscriber: StreamSubscriber): void {
  session.subscribers.delete(subscriber);
}

function closeSubscriber(session: ResumeSession, subscriber: StreamSubscriber): void {
  detachSubscriber(session, subscriber);
  try {
    subscriber.controller.close();
  } catch {
    // A client can cancel between the last enqueue and close. The session
    // already has the terminal event buffered, so there is nothing else to
    // do for this subscriber.
  }
}

function appendSessionEvent(session: ResumeSession, event: TurnStreamEvent): void {
  if (session.terminal) return;
  const sequence = (event.type === "delta" || event.type === "reasoning") && event.sequence !== undefined ? event.sequence : null;
  const stored: StoredStreamEvent = { event, sequence, afterSequence: session.sequence, terminal: isTerminalEvent(event) };
  session.events.push(stored);
  if (stored.terminal) session.terminal = true;
  for (const subscriber of [...session.subscribers]) {
    if (!shouldDeliver(stored, subscriber.resumeFrom)) continue;
    try {
      subscriber.controller.enqueue(ndjsonLine(event));
      if (stored.terminal) {
        session.terminalDelivered = true;
        closeSubscriber(session, subscriber);
      }
    } catch {
      detachSubscriber(session, subscriber);
    }
  }
  if (session.terminal && session.expired) {
    resumeSessions.delete(session.token);
    inFlightTurns.delete(session.turnId);
  }
}

function streamResponse(session: ResumeSession, resumeFrom: number | null): Response {
  let subscriber: StreamSubscriber | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = { controller, resumeFrom: resumeFrom ?? -1 };
      session.subscribers.add(subscriber);
      try {
        controller.enqueue(ndjsonLine({ type: "turn_meta", conversation_id: session.conversationId, turn_id: session.turnId, resume_token: session.token }));
        for (const stored of session.events) {
          if (!shouldDeliver(stored, resumeFrom)) continue;
          controller.enqueue(ndjsonLine(stored.event));
          if (stored.terminal) session.terminalDelivered = true;
        }
        if (session.terminal) closeSubscriber(session, subscriber);
      } catch {
        detachSubscriber(session, subscriber);
      }
    },
    cancel() {
      if (subscriber) detachSubscriber(session, subscriber);
      // A dropped body is recoverable. Only the explicit cancel route aborts
      // the shared generation, so a reconnect can keep using this token.
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
}

function startResumeSession(session: ResumeSession): void {
  void (async () => {
    try {
      for await (const rawEvent of streamTurnEvents(session.result, session.ownerId, THINKING_CUE_DELAY_MS, session.controller.signal, session.dropReasoning)) {
        // One shared counter for `delta` and `reasoning` alike (REASONING-01):
        // a resuming client's own replay filter (shouldDeliver()) needs a
        // real per-event sequence for both, or a `reasoning` event sitting
        // between two `delta` sequence numbers would never be redelivered
        // on a resume exactly at that boundary.
        const event = rawEvent.type === "delta" || rawEvent.type === "reasoning" ? { ...rawEvent, sequence: ++session.sequence } : rawEvent;
        appendSessionEvent(session, event);
      }
    } catch (err) {
      // streamTurnEvents() maps generation failures to a terminal event. This
      // guard keeps the reconnect contract terminal even if a future change
      // makes an outer iterator failure escape that helper.
      console.error("[turn/stream] resume session failed:", err);
      if (!session.terminal) {
        try { session.result.finalize(""); } catch (finalizeErr) { console.error("[turn/stream] resume finalize failed:", finalizeErr); }
        appendSessionEvent(session, { type: "error", error: "The turn stream became unavailable.", code: "unavailable" });
      }
    }
  })();
}

// How long the `chat` model's own time to first token can run before
// silence starts reading as dead air rather than a fast answer arriving
// (home-legacy.git's own tuned TOOL_ACK_DELAY_MS, arXiv 2507.22352:
// fillers measurably help at multi-second waits and hurt at sub-second
// ones). A real, instant reply never crosses this and so never gets a
// cue - the same "answer when you know it, say 'let me check' only when
// checking actually takes a moment" logic, applied to the model's own
// generation latency instead of a tool call's.
export const THINKING_CUE_DELAY_MS = 900;

/** Returns the timer alongside the promise so the common case (the real
 * token wins the race) can cancel it - a code review (2026-09-05) found
 * the original version left the timeout running for the rest of its
 * `cueDelayMs` on every ordinary, fast reply, doing nothing but holding
 * its closure alive. */
function delay(ms: number): { promise: Promise<"timeout">; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<"timeout">((resolve) => {
    handle = setTimeout(() => resolve("timeout"), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/** The real event sequence for a "stream" kind TurnStreamResult: a
 * "spoken_cue" first IF the model's own first token is genuinely slow to
 * arrive (never more than once - only the very first token is raced, the
 * one real latency source in this codebase today), then every delta as
 * it arrives, then exactly one "done" or "error" terminal event.
 * Extracted from the route handler so a code review's "finalize() must
 * still run on the error path" fix can be proven directly, with a
 * hand-built failing `tokens` generator, instead of needing a genuinely
 * broken network connection - Bun.serve's own ReadableStream masks a
 * mid-stream server-side error as a clean close from the client's side,
 * so that real failure mode can't be reproduced end to end in a test at
 * all, only trusted to have the right code shape here. */
export async function* streamTurnEvents(
  result: Extract<TurnStreamResult, { ok: true; kind: "stream" }>,
  actorId: string,
  cueDelayMs = THINKING_CUE_DELAY_MS,
  signal?: AbortSignal,
  // REASONING-01: a minor's turn (child or teen) never emits a
  // `reasoning` event at all (the coordinator's own call, docs/dev.md's
  // "REASONING-01" section) - a minor sees the answer, not the model's
  // thinking. The safety/guard pass upstream (turnEngine.ts) is entirely
  // unaffected: this drops the already-classified reasoning span at the
  // OUTPUT boundary, after the combined text has gone through the
  // identical pass every turn gets.
  dropReasoning = false,
): AsyncGenerator<TurnStreamEvent, void, void> {
  let fullText = "";
  // REASONING-01: splits each chunk of the pipeline's own combined text
  // (a think block, if present, embedded per wellFormed.ts's own
  // contract) into `reasoning`/`delta` wire events - the one and only
  // place this split happens; `result.tokens` (turnEngine.ts's whole
  // pipeline) is never touched, and `fullText` keeps accumulating the
  // UNSPLIT original chunks, so `finalize()` and the stored row are
  // unaffected either way (docs/dev.md's own "smallest change" section).
  const thinkSplit = newThinkSplitState();
  // Sequence numbers are stamped by the caller (startResumeSession(), one
  // shared counter for `delta` and `reasoning` alike, so a resuming
  // client's replay filter works identically for both) - this function
  // never sets one itself, matching `delta`'s own existing contract.
  // Shared by the main loop and the end-of-stream flush below (a review
  // caught these two sites duplicating the identical span-to-event
  // mapping): each ThinkSpan[] this converts came from either
  // feedThinkSplit() (mid-stream) or flushThinkSplit() (once, at the
  // end) - the mapping itself doesn't care which.
  function* spanEvents(spans: readonly ThinkSpan[]): Generator<TurnStreamEvent, void, void> {
    for (const span of spans) {
      if (span.reasoning) {
        if (!dropReasoning) yield { type: "reasoning", text: span.text };
      } else {
        yield { type: "delta", text: span.text };
      }
    }
  }
  function* splitEvents(text: string): Generator<TurnStreamEvent, void, void> {
    yield* spanEvents(feedThinkSplit(thinkSplit, text));
  }
  try {
    const iterator = result.tokens[Symbol.asyncIterator]();
    // FAST-04: start the timer from startedAt (when prepareTurn() began),
    // not from when we enter this function, so the cue fires 900 ms after
    // the utterance arrived when nothing has streamed yet.
    const elapsedMs = Date.now() - result.startedAt;
    const remainingDelayMs = Math.max(0, cueDelayMs - elapsedMs);
    // Only one `.next()` call is ever made for the first step - racing a
    // timer against it means racing which one gets AWAITED first, never
    // calling `.next()` a second time (which would skip a real token).
    // The status channel wakes the race when a line is queued; the
    // lines themselves are drained synchronously, so a status emitted
    // before a delta (the `composing` line before the composition's
    // first token, K6) goes out ahead of it whatever the two promises'
    // settling order. A wake with nothing queued (the close) yields
    // nothing.
    // A closed channel never wakes the race again (its wait() would
    // resolve at once, forever); its last lines are drained below.
    const statusWake = () => (result.status.closed ? new Promise<never>(() => {}) : result.status.wait().then(() => "status" as const));
    let pendingStatus = statusWake();
    const firstStep = iterator.next();
    const timer = delay(remainingDelayMs);
    const race = await Promise.race([firstStep, pendingStatus, timer.promise]);
    timer.cancel();
    if (race === "status") { for (const status of result.status.drain()) yield status; pendingStatus = statusWake(); }
    if (race === "timeout" && !result.cueSuppressed) { const cue = pickThinkingCue(actorId, result.bannedPhrases); if (cue) yield { type: "spoken_cue", text: cue }; }
    let current = race === "timeout" || race === "status" ? await firstStep : race;

    while (!current.done) {
      for (const status of result.status.drain()) yield status;
      fullText += current.value;
      yield* splitEvents(current.value);
      const nextToken = iterator.next();
      let next = await Promise.race([nextToken, pendingStatus]);
      while (next === "status") {
        for (const status of result.status.drain()) yield status;
        pendingStatus = statusWake();
        next = await Promise.race([nextToken, pendingStatus]);
      }
      current = next;
    }
    // Whatever feedThinkSplit() was still holding back when the model's
    // own generation ended (a truncated open think block - the same
    // "generation cut off mid-reasoning" shape OPEN_THINK_RE already
    // treats as real and expected - or the last few characters of
    // visible text that were never actually the start of a tag).
    yield* spanEvents(flushThinkSplit(thinkSplit));
    while (true) {
      for (const status of result.status.drain()) yield status;
      if (result.status.closed) break;
      await result.status.wait();
    }
    // `current.value` here is the generator's own RETURN value (step 9),
    // not a yielded delta: a StreamOutcome (turnEngine.ts). Either the
    // most recently flagged, non-refuse SafetyResult gateOutputSafety()
    // saw (a self_harm mention in the model's own words, say; a review,
    // 2026-09-05, found this was previously discarded, so a flag that
    // never refuses never reached the logged turn or its
    // crisis_resources), or, FAST-04, `{ resolved }`: the model called a
    // tool, the package answered, and the stream yielded no deltas at
    // all. finalize() returns that TurnValue as-is, so this is still
    // exactly one "done" line either way, and the resolved case simply
    // has no "delta" lines before it.
    const value = result.finalize(fullText.trim(), (current as IteratorReturnResult<import("@/lib/turnEngine").StreamOutcome>).value);
    // REASONING-02: TurnValue.reasoning is dropped from the `done` event
    // for a minor's turn, the same gate `spanEvents()` already applies to
    // the live `reasoning` stream event above.
    yield { type: "done", value: dropReasoning && value.reasoning !== undefined ? { ...value, reasoning: undefined } : value };
  } catch (err) {
    // This catch had no server-side log at all (a live incident,
    // 2026-09-07: the real reason only ever left the process as
    // `event.error` on the wire, and the frontend collapses every
    // "error" event's code to the same generic banner regardless -
    // chatModelAdapter.ts always throws `code: "unavailable"` here, so
    // the actual message was undiagnosable without this). Kept as a
    // permanent log line, not a one-off: llm.ts's recoverFromDeadBackend()
    // now self-heals the one cause found so far (a dead backend process),
    // but this catch is the generic "something failed mid-turn" case and
    // will keep catching failures that fix doesn't cover.
    console.error("[turn/stream] failed mid-stream:", err);
    // Headers (and a 200 status) are already committed by the time
    // generation can fail here - an HTTP error status is no longer
    // possible, so the failure has to travel as its own event instead
    // (turnEngine.ts's "unavailable" code covers this same down-state
    // class for the non-streaming route; ChatPage.tsx maps this event to
    // the identical friendly message).
    //
    // A StreamSafetyRefusal (step 9) is a real, mapped failure: it gets
    // spec/errors/errors.json's own "safety_refused" code on the wire
    // (every other failure here has none - a genuine down-engine error,
    // not something the catalogue has a specific code for), and its own
    // SafetyResult is passed into finalize() so the logged/returned turn
    // reflects the real reason it was cut, not the input-side result
    // computed before generation ever started.
    //
    // A StreamUnavailable (FAST-04) is the engine-down case that used
    // to be an HTTP 503 with `code: "unavailable"` when runTurnStream()
    // still waited for the first token before returning; it now happens
    // after turn_meta is out, so it carries the same code on the error
    // event instead.
    if (signal?.aborted) {
      result.finalize(fullText.trim());
      yield { type: "error", error: "cancelled", code: "turn_cancelled" };
      return;
    }
    const safetyRefusal = err instanceof StreamSafetyRefusal ? err : undefined;
    // SAFETY-01 (#85): a streamed refusal's crisis resources reach the
    // client on the error event, the one terminal event this path
    // sends; finalize() below computes them, so it runs first for a
    // refusal (it never writes to the stream itself).
    let refused: TurnValue | undefined;
    if (safetyRefusal) {
      try {
        refused = result.finalize(fullText.trim(), safetyRefusal.safety);
      } catch (finalizeErr) {
        // The terminal event goes out whatever finalize did (a review).
        console.error("[turn/stream] finalize failed on a refusal:", finalizeErr);
      }
    }
    if (safetyRefusal) yield { type: "error", error: safetyRefusal.message, code: "safety_refused", ...(refused?.crisis_resources ? { crisis_resources: refused.crisis_resources } : {}) };
    else if (err instanceof StreamUnavailable) yield { type: "error", error: err.message, code: err.code };
    else yield { type: "error", error: (err as Error).message };
    // Still finalize (and so still log) whatever text actually streamed
    // before the failure: a code review (2026-09-04) found this skipped
    // on the error path, so a reply that had already streamed several
    // real sentences into the household's own thread - shown and spoken
    // before the engine crashed - was never written to conversation
    // history at all, as if the exchange had never happened. Fine to run
    // after yielding the error event: `finalize` only builds and logs a
    // TurnValue, it never writes to the response stream itself. A safety
    // refusal always finalizes even with an EMPTY fullText (the very
    // first sentence was itself the unsafe one) - step 9's own "log a
    // flagged turn" - unlike a generic mid-stream crash with nothing
    // real to log, an all-refused turn is exactly the case worth a
    // record of.
    // Trimmed at the edges (#99's review): a paragraph break beside a
    // sentence the guards skipped would otherwise open or close the
    // stored reply with a bare blank line the blocking path never has.
    if (fullText.trim() && !safetyRefusal) result.finalize(fullText.trim());
  }
}

// Real token-by-token streaming (2026-09-04): the prerequisite for
// speaking a reply sentence by sentence as it's generated, not after the
// whole thing finishes (spec/voice/README.md's "what Jesse actually meant
// by streamed"). Newline-delimited JSON, not SSE: one real HTTP response
// body, no `text/event-stream` framing to parse on the way back out for a
// wire shape this simple - see wire.ts's TurnStreamEvent for the three
// event kinds. Same auth posture as POST /api/turn above.
turnRoutes.post("/stream", requireAuth, bodyLimit({ maxSize: TURN_BODY_LIMIT }), async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as {
    surface?: string;
    text?: string;
    thinking?: boolean;
    conversation_id?: string;
    turn_id?: string;
    resume_token?: string;
    resume_from?: number;
    supersedes?: string;
    continuation_of?: string;
    continuation_text?: string;
    ephemeral?: boolean;
    speaker_evidence?: unknown;
    present?: unknown;
    bare?: boolean;
    temporary?: boolean;
    spoken?: boolean;
  };
  if (body.resume_token !== undefined) {
    const session = typeof body.resume_token === "string" ? resumeSessions.get(body.resume_token) : undefined;
    const resumeFrom = body.resume_from;
    if (!session || session.expired || (session.terminal && session.terminalDelivered) || session.ownerId !== actor.id || body.turn_id !== session.turnId || body.conversation_id !== session.conversationId || !Number.isInteger(resumeFrom) || resumeFrom! < 0 || resumeFrom! > session.sequence) {
      return c.json({ error: "The turn stream is no longer available.", code: "turn_resume_unavailable" }, 503);
    }
    return streamResponse(session, resumeFrom!);
  }
  const parsedEvidence = z.object({ speaker_evidence: evidence.optional(), present: present.optional() }).safeParse(body);
  if (!parsedEvidence.success) return c.json({ error: "Invalid turn evidence", code: "invalid_input" }, 400);
  const surface = (body.surface ?? "chat") as Surface;
  // getmaipai/home#91 (a code review of the original ephemeral fix,
  // 2026-09-13): honoring the flag for whatever text a caller sends
  // would let a household member skip their own chat-history/episode
  // write on ordinary content just by setting it, undercutting
  // conversationHistory.ts's own "a parent can see a request was made"
  // guarantee. `isFixedHomeCardQuery()` is the one place the actual
  // allowed question is declared, so a request claiming `ephemeral` is
  // only honored when the text matches it exactly; anything else is
  // logged normally, same as if the flag had never been sent, and
  // warned about here so a stray/misbehaving caller is visible.
  const requestedEphemeral = body.ephemeral === true;
  const ephemeral = requestedEphemeral && isFixedHomeCardQuery(body.text ?? "");
  if (requestedEphemeral && !ephemeral) {
    console.warn(`[turn/stream] ephemeral requested for a non-widget utterance from ${actor.id}; logging it normally`);
  }
  // getmaipai/home#102: the budget is read after the body, since the
  // card's own question (the validated flag, never the claimed one)
  // pays from its own bucket and everything else from the chat budget.
  if (ephemeral ? !personWithinEphemeralBudget(actor.id) : !personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
  // COR-7 (code review, 2026-09-06): the session controller's signal still
  // reaches all the way to the real fetch (lib/llm.ts's
  // startCompleteStream, spec/llm/ts/client.ts's chatCompleteStream),
  // but a dropped response body only detaches its subscriber. The explicit
  // cancel route fires this signal when the person really stops the turn.
  const abortController = new AbortController();
  // ADMIN-COMPARE-01 (b): a route-level branch, never a condition inside
  // runTurnStream()/turnEngine.ts itself - checked here (the normal,
  // clean-403 path) even though runBareTurnStream() asserts the
  // identical two things again on its own (the structural backstop, not
  // the primary gate).
  if (body.bare === true) {
    if (!isOwnerOrAdmin(actor)) return c.json({ error: "bare mode is owner/admin only" }, 403);
    if (speakerAgeBand(actor, new Date()) !== "adult") return c.json({ error: "bare mode is not available to a minor" }, 403);
  }
  // TEMP-CHAT-01: same shape as bare mode just above - the route-level
  // clean 403, checked again as a structural backstop inside
  // resolveOrCreateConversation() itself.
  if (body.temporary === true && !canHaveTemporaryChat(actor)) {
    return c.json({ error: "temporary chat is not available for minors" }, 403);
  }
  // REASONING-03 (safety ruling, 2026-09-22): same belt-and-braces as
  // the non-stream route above - a minor's turn never asks the model to
  // think, regardless of what `body.thinking` claims, and neither does
  // any turn on a surface with no Reasoning Element to disclose it in
  // (voice/robot/tv/phone) - a review caught the first draft only
  // skipping the model for a minor, leaving a non-chat surface to spend
  // the tokens and latency on a think block dropReasoning discards
  // below anyway.
  const isMinor = speakerAgeBand(actor, new Date()) !== "adult";
  const dropReasoning = isMinor || surface !== "chat";
  let result: TurnStreamResult;
  try {
    // A code review caught this: `bare` must be checked BEFORE
    // newPathOn(), not after - bare mode is a debug bypass of the whole
    // pipeline (ADMIN-COMPARE-01: the raw model, no persona, no
    // routing, no packages), and the header comment above already
    // promises it "stays on the frozen path regardless of the
    // setting"; checking newPathOn() first would silently route a
    // bare:true request through the full new-path pipeline instead,
    // defeating the comparison with no error at all.
    result = body.bare === true
      ? await runBareTurnStream(actor, body.text ?? "", body.conversation_id, abortController.signal)
      : newPathOn()
        // STREAM-NEXT-01: runTurnNextStream(), not runTurnNext() - this
        // route needs the "stream" kind TurnStreamResult (a live status/
        // tokens pair the machine hasn't finished yet), never the
        // "immediate" one the blocking POST / route above uses.
        ? await runTurnNextStream(actor, surface, body.text ?? "", { conversationId: body.conversation_id, temporary: body.temporary, spoken: body.spoken === true, thinking: dropReasoning ? false : body.thinking, signal: abortController.signal })
        : await runTurnStream(actor, surface, body.text ?? "", {
            thinking: dropReasoning ? false : body.thinking,
            conversationId: body.conversation_id,
            supersedes: body.supersedes,
            continuation: body.continuation_text === undefined ? undefined : { fromTurnId: body.continuation_of, assistantText: body.continuation_text },
            // A widget's own fixed-utterance query (Home's weather card), never a
            // household member's own words: skips logTurnSafely() only, so it
            // never lands in a person's real chat history or the episode store,
            // while still going through the exact same model/safety/reply path a
            // typed message does (getmaipai/home BACKLOG, found 2026-09-11).
            ephemeral,
            temporary: body.temporary,
            signal: abortController.signal,
            ...(surface === "robot" ? { speakerEvidence: parsedEvidence.data.speaker_evidence ?? null, present: parsedEvidence.data.present ?? null } : {}), // Evidence is only honored on the robot surface.
          });
  } catch (err) {
    if (err instanceof BareModeForbidden) return c.json({ error: err.message }, 403);
    throw err;
  }
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }

  // The contract's first line, either way (step 3): "turn_meta" before
  // anything else, so a client always knows which conversation and turn
  // this reply belongs to even if it never reads past the first line.
  const resumeToken = newResumeToken();
  const turnMeta: TurnStreamEvent =
    result.kind === "immediate"
      ? { type: "turn_meta", conversation_id: result.value.conversation_id, turn_id: result.value.turn_id, resume_token: resumeToken }
      : { type: "turn_meta", conversation_id: result.conversationId, turn_id: result.turnId, resume_token: resumeToken };

  if (result.kind === "immediate") {
    // A safety refusal or a plugin reply is already complete, deterministic
    // text - one "done" event, no artificial trickle for something with
    // nothing left to stream. Bare mode (runBareTurnStream) always lands
    // here; the old path (runTurnStream) does for its own deterministic
    // replies. STREAM-NEXT-01: the new path's own runTurnNextStream()
    // (this route) returns "stream" now, not "immediate" - its own
    // `reasoning.emit` gate still runs inside the machine (the state
    // record's "decided once, in context, before the model runs"), so
    // `result.value.reasoning` is already undefined for a minor by
    // construction; stripped here too anyway, the same belt-and-braces
    // every other reasoning site in this route already keeps.
    const value = dropReasoning && result.value.reasoning !== undefined ? { ...result.value, reasoning: undefined } : result.value;
    // TOOL-EVENTS-01(b): the new path's own tool_call/tool_result/
    // tool_error lines (chatModelAdapter.ts's toolTimelinePart, its
    // frontend consumer half, landed first) - present only when this
    // turn actually ran a tool (turnNext.ts omits an empty array),
    // always ahead of "done" so the tool timeline is already populated
    // by the time the reply itself arrives.
    const toolEventLines = (result.toolEvents ?? []).map((event) => ndjsonLine(event));
    const body = new Blob([ndjsonLine(turnMeta), ndjsonLine({ type: "signal", signal: result.signal }), ...toolEventLines, ndjsonLine({ type: "done", value })]);
    return new Response(body, {
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  const session: ResumeSession = {
    token: resumeToken,
    ownerId: actor.id,
    // The shared, birthdate-aware band (ageBand.ts's own header: role
    // alone is "an independent, less accurate signal") - a review
    // caught the first draft reading actor.role directly, which both
    // excluded teen and could disagree with every other minor-gated
    // decision on this same turn (host.ts's chat-models gate, turnEngine.ts's
    // withholdSensitive/mayDefer, composer.ts's child-only projection).
    dropReasoning,
    conversationId: result.conversationId,
    turnId: result.turnId,
    controller: abortController,
    result,
    events: [{ event: { type: "signal", signal: result.signal }, sequence: null, afterSequence: 0, terminal: false }],
    subscribers: new Set(),
    sequence: 0,
    terminal: false,
    terminalDelivered: false,
    cancelled: false,
    expired: false,
    expiryTimer: setTimeout(() => {
      if (session.terminal) {
        resumeSessions.delete(session.token);
        inFlightTurns.delete(session.turnId);
        return;
      }
      session.expired = true;
      session.controller.abort();
    }, RESUME_TTL_MS),
  };
  resumeSessions.set(session.token, session);
  inFlightTurns.set(session.turnId, session);
  startResumeSession(session);
  const response = streamResponse(session, null);
  // The initial response has a signal in its replay buffer, but its meta
  // event is deliberately sent first and the signal stays immediately next.
  return response;
});
