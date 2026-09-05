import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { runTurn, runTurnStream, type Surface, type TurnStreamResult } from "@/lib/turnEngine";
import { pickThinkingCue } from "@/lib/replyVariation";
import type { TurnStreamEvent } from "@/wire";
import type { AppEnv } from "@/types";

export const turnRoutes = new Hono<AppEnv>();

// Any signed-in person, no role gate: a household member's own
// conversation turn isn't a privileged action, the same posture
// /api/safety/check and /api/llm/chat already take. This is the real
// caller those two routes' comments named as "ahead of the turn engine";
// they stay useful in their own right (diagnostics, direct model/safety
// checks) now that this one exists.
turnRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { surface?: string; text?: string; thinking?: boolean };
  const surface = (body.surface ?? "chat") as Surface;
  const result = await runTurn(actor, surface, body.text ?? "", { thinking: body.thinking });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  return c.json(result.value);
});

const encoder = new TextEncoder();
function ndjsonLine(event: TurnStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
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
): AsyncGenerator<TurnStreamEvent, void, void> {
  let fullText = "";
  try {
    const iterator = result.tokens[Symbol.asyncIterator]();
    // Only one `.next()` call is ever made for the first step - racing a
    // timer against it means racing which one gets AWAITED first, never
    // calling `.next()` a second time (which would skip a real token).
    const firstStep = iterator.next();
    const timer = delay(cueDelayMs);
    const race = await Promise.race([firstStep, timer.promise]);
    timer.cancel();
    if (race === "timeout") yield { type: "spoken_cue", text: pickThinkingCue(actorId) };
    let current = race === "timeout" ? await firstStep : race;

    while (!current.done) {
      fullText += current.value;
      yield { type: "delta", text: current.value };
      current = await iterator.next();
    }
    const value = result.finalize(fullText);
    yield { type: "done", value };
  } catch (err) {
    // Headers (and a 200 status) are already committed by the time
    // generation can fail here - an HTTP error status is no longer
    // possible, so the failure has to travel as its own event instead
    // (turnEngine.ts's "unavailable" code covers this same down-state
    // class for the non-streaming route; ChatPage.tsx maps this event to
    // the identical friendly message).
    yield { type: "error", error: (err as Error).message };
    // Still finalize (and so still log) whatever text actually streamed
    // before the failure: a code review (2026-09-04) found this skipped
    // on the error path, so a reply that had already streamed several
    // real sentences into the household's own thread - shown and spoken
    // before the engine crashed - was never written to conversation
    // history at all, as if the exchange had never happened. Fine to run
    // after yielding the error event: `finalize` only builds and logs a
    // TurnValue, it never writes to the response stream itself.
    if (fullText) result.finalize(fullText);
  }
}

// Real token-by-token streaming (2026-09-04): the prerequisite for
// speaking a reply sentence by sentence as it's generated, not after the
// whole thing finishes (spec/voice/README.md's "what Jesse actually meant
// by streamed"). Newline-delimited JSON, not SSE: one real HTTP response
// body, no `text/event-stream` framing to parse on the way back out for a
// wire shape this simple - see wire.ts's TurnStreamEvent for the three
// event kinds. Same auth posture as POST /api/turn above.
turnRoutes.post("/stream", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { surface?: string; text?: string; thinking?: boolean };
  const surface = (body.surface ?? "chat") as Surface;
  const result = await runTurnStream(actor, surface, body.text ?? "", { thinking: body.thinking });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }

  if (result.kind === "immediate") {
    // A safety refusal or a skill reply is already complete, deterministic
    // text - one "done" event, no artificial trickle for something with
    // nothing left to stream.
    return new Response(ndjsonLine({ type: "done", value: result.value }), {
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamTurnEvents(result, actor.id)) {
          controller.enqueue(ndjsonLine(event));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
});
