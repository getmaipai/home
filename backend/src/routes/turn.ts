import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { runTurn, runTurnStream, type Surface, type TurnStreamResult } from "@/lib/turnEngine";
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

/** The real event sequence for a "stream" kind TurnStreamResult: every
 * delta as it arrives, then exactly one "done" or "error" terminal event.
 * Extracted from the route handler so a code review's "finalize() must
 * still run on the error path" fix can be proven directly, with a
 * hand-built failing `tokens` generator, instead of needing a genuinely
 * broken network connection - Bun.serve's own ReadableStream masks a
 * mid-stream server-side error as a clean close from the client's side,
 * so that real failure mode can't be reproduced end to end in a test at
 * all, only trusted to have the right code shape here. */
export async function* streamTurnEvents(
  result: Extract<TurnStreamResult, { ok: true; kind: "stream" }>,
): AsyncGenerator<TurnStreamEvent, void, void> {
  let fullText = "";
  try {
    for await (const delta of result.tokens) {
      fullText += delta;
      yield { type: "delta", text: delta };
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
        for await (const event of streamTurnEvents(result)) {
          controller.enqueue(ndjsonLine(event));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
});
