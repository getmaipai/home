// The hub as a brain for other clients (session-c-brain-and-voice.md
// step 8): an OpenAI-compatible `/v1/chat/completions` so any client that
// already speaks that wire contract (Home Assistant's own OpenAI
// Conversation integration, a scripted tool, a second MaiPai client not
// yet built) can reach the real turn engine without a MaiPai-specific
// API. Reuses spec/llm/ts/types.ts's own OpenAI types - the identical
// wire contract llmSupervisor.ts already speaks as a CLIENT to a real
// llama-server, now spoken as a SERVER instead. Deliberately a plain Hono
// router, not `apiRouter()`/`@hono/zod-openapi` like every other route
// file: this endpoint's shape is OpenAI's own contract, not ours to
// document in our OpenAPI schema - a client integrating against it reads
// OpenAI's docs, not /api/docs.
//
// Authenticated by lib/apiToken.ts's interim per-person API token
// (requireApiToken, middleware/auth.ts), never a cookie session - see
// that file's own header for why this is a real, if temporary,
// mechanism rather than a stub. `surface` (turnEngine.ts's Surface enum)
// comes from an `X-MaiPai-Surface` header per the plan's own "surface
// from a header" - deliberately NOT widening IMPLEMENTED_SURFACES to add
// a new value for "an external OpenAI client": an unsupported surface
// still fails exactly as honestly as it does for every other caller
// (turnEngine.ts's own "not implemented yet" error), which is the
// correct answer until a real surface for this actually exists.
//
// A full OpenAI multi-turn `messages` array does not map onto MaiPai's
// own server-side conversation history (turnEngine.ts already resolves
// or creates the real conversation and reads its own rolling window) -
// mapping the two would mean maintaining two parallel notions of
// "what's been said so far" that could drift. This route takes the LAST
// message with role "user" as the turn's text and lets the turn engine's
// own history do the rest; a real, named simplification, not silently
// dropped context (documented here and in docs/dev/session-c.md).
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireApiToken } from "@/middleware/auth";
import { StreamSafetyRefusal, type Surface } from "@/lib/turnEngine";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { personWithinTurnBudget } from "@/lib/llm";
import { visibleText } from "@/lib/wellFormed";
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk } from "@maipai/spec/llm/ts/types.js";
import type { AppEnv } from "@/types";

export const openaiRoutes = new Hono<AppEnv>();

const RATE_LIMIT_RESPONSE = { error: { message: "Too many requests too quickly.", code: "turn_rate_limited" } } as const;

function lastUserMessageText(messages: ChatMessage[] | undefined): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user" && typeof messages[i]?.content === "string") return messages[i]!.content;
  }
  return null;
}

function resolveSurface(c: { req: { header: (name: string) => string | undefined } }): Surface {
  const header = c.req.header("x-maipai-surface");
  const candidates: Surface[] = ["chat", "overlay", "pod", "robot", "tv", "phone"];
  return (candidates as string[]).includes(header ?? "") ? (header as Surface) : "chat";
}

let chunkCounter = 0;
function chunkId(): string {
  chunkCounter++;
  return `chatcmpl-${Date.now().toString(36)}${chunkCounter}`;
}

// bodyLimit (SEC-5, 2026-09-06): this route has the same unbounded-body
// exposure routes/turn.ts had - an external client's full messages
// history can be large, so this is more generous than turn.ts's own
// limit, but runTurn()/runTurnStream()'s MAX_TURN_TEXT_LENGTH still caps
// the extracted last-user-message text underneath this.
openaiRoutes.post("/v1/chat/completions", requireApiToken, bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const actor = c.get("person");
  if (!personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }

  const body = (await c.req.json().catch(() => ({}))) as { model?: string; messages?: ChatMessage[]; stream?: boolean };
  const text = lastUserMessageText(body.messages);
  if (!text) {
    return c.json({ error: { message: "messages must include at least one user message with string content", code: "invalid_input" } }, 400);
  }

  const surface = resolveSurface(c);
  const model = typeof body.model === "string" && body.model.length > 0 ? body.model : "maipai";

  // THIN-7B (rules 9 and 12): the one turn path, as a spoken turn. This
  // route is the hub as a voice brain for Home Assistant and scripted
  // clients, so the spoken register, the per-sentence gate for a child
  // and no reasoning apply, whatever the caller. A caller that needs a
  // long written reply uses the chat surface (docs/dev.md, THIN-7B).
  const turnOpts = { spoken: true, thinking: false } as const;

  if (body.stream) {
    // COR-7 (code review, 2026-09-06): an external client
    // disconnecting mid-reply must reach the real fetch, so the signal
    // is fired from the ReadableStream's own cancel() below.
    const abortController = new AbortController();
    const result = await runTurnNextStream(actor, surface, text, { ...turnOpts, signal: abortController.signal });
    if (!result.ok) {
      return c.json({ error: { message: result.error, code: result.code } }, result.status);
    }

    const encoder = new TextEncoder();
    const id = chunkId();
    function sseChunk(delta: ChatCompletionChunk["choices"][number]["delta"], finishReason: string | null): Uint8Array {
      const chunk: ChatCompletionChunk = { id, model, choices: [{ index: 0, delta, finish_reason: finishReason }] };
      return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let finishReason = "stop";
        try {
          controller.enqueue(sseChunk({ role: "assistant" }, null));
          if (result.kind === "immediate") {
            controller.enqueue(sseChunk({ content: visibleText(result.value.reply.text) }, null));
          } else {
            // The released sentences, already past the gate; the stored
            // reply is their concatenation (rule 9), so finalize() gets
            // exactly what went out. Reasoning travels on the status
            // channel, which this route never reads.
            let fullText = "";
            const iterator = result.tokens;
            // A turn that released nothing (a refusal on the first
            // sentence, a fixed-line reply) still tells the caller its
            // stored reply: the other wires carry it in the done event.
            const sendStoredIfSilent = (stored: string) => {
              if (!fullText.trim() && stored.trim()) controller.enqueue(sseChunk({ content: visibleText(stored) }, null));
            };
            try {
              let current = await iterator.next();
              while (!current.done) {
                fullText += current.value;
                controller.enqueue(sseChunk({ content: current.value }, null));
                current = await iterator.next();
              }
              sendStoredIfSilent(result.finalize(fullText.trim(), current.value).reply.text);
            } catch (err) {
              // A refused sentence ends the stream; what was released
              // is never retracted. Both outcomes log the turn.
              if (err instanceof StreamSafetyRefusal) {
                sendStoredIfSilent(result.finalize(fullText.trim(), err.safety).reply.text);
                finishReason = "content_filter";
              } else {
                if (fullText.trim()) result.finalize(fullText.trim());
                throw err;
              }
            }
          }
          controller.enqueue(sseChunk({}, finishReason));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  const next = await runTurnNext(actor, surface, text, turnOpts);
  if (!next.ok) {
    return c.json({ error: { message: next.error, code: next.code } }, next.status);
  }
  if (next.kind !== "immediate") {
    return c.json({ error: { message: "the turn returned a stream unexpectedly", code: "unavailable" } }, 503);
  }
  // No `reasoning_content`: a spoken turn drops reasoning at the engine
  // client, and `visibleText` strips a think block that slipped into
  // the text, so none reaches the caller either way.
  const response: ChatCompletionResponse = {
    id: chunkId(),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: visibleText(next.value.reply.text) }, finish_reason: "stop" }],
  };
  return c.json(response);
});
