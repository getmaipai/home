// STT routes (session-c-brain-and-voice.md step 5): push-to-talk's
// server half. Any signed-in person, no role gate - the same posture
// /api/llm/chat and /api/tts already take: transcribing your own voice
// isn't a privileged action.
import { createRoute, z } from "@hono/zod-openapi";
import { upgradeWebSocket } from "hono/bun";
import { requireAuth } from "@/middleware/auth";
import { SttSession, decodeWav } from "@/lib/sttSession";
import { transcribeUtterance } from "@/lib/stt";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { SttStatusResponse, SttTranscribeResponse } from "@maipai/spec/voice/ts/sttTypes.js";
import type { AppEnv } from "@/types";
import { apiRouter, errorResponses } from "@/lib/openapi";

export const sttRoutes = apiRouter();

const SESSION_CONFIG = { sampleRate: 16_000, silenceTimeoutS: 0.8, partialIntervalS: 1.5 };

// WS handshake itself has no cookie-friendly way to fail with a JSON
// body, so auth is checked as a real precondition (requireAuth's own
// middleware, same as every other route) - a rejected upgrade never
// reaches the socket lifecycle below at all.
sttRoutes.get(
  "/stream",
  requireAuth,
  upgradeWebSocket(() => {
    let session: SttSession | null = null;
    return {
      onOpen(_evt, ws) {
        session = new SttSession(SESSION_CONFIG, (msg) => ws.send(JSON.stringify(msg)));
        ws.send(JSON.stringify({ t: "ready" }));
      },
      onMessage(evt, ws) {
        if (!session) return;
        if (typeof evt.data === "string") {
          try {
            const parsed = JSON.parse(evt.data) as { t?: string };
            if (parsed.t === "end") session.end();
          } catch {
            ws.send(JSON.stringify({ t: "error", v: "malformed control message" }));
          }
          return;
        }
        // hono/bun's own adapter already unwraps Bun's raw Buffer message
        // to its underlying ArrayBuffer before this handler ever sees it
        // (websocket.js: `message.buffer`) - Blob (the other half of
        // WSMessageReceive's type) is a browser-client shape that never
        // occurs server-side under Bun.
        if (!(evt.data instanceof ArrayBuffer)) return;
        // A code review (2026-09-06) found this threw an uncaught
        // RangeError (verified live) for a frame whose byte length isn't
        // a multiple of 4 - a truncated or buggy-client frame silently
        // killed the whole stream (Bun's message handler doesn't recover
        // from a thrown error mid-callback), with no {t:"error"} ever
        // reaching the client, unlike the REST route's own decodeWav()
        // try/catch below.
        if (evt.data.byteLength % 4 !== 0) {
          ws.send(JSON.stringify({ t: "error", v: "malformed audio frame (not a multiple of 4 bytes)" }));
          return;
        }
        session.pushPcm(new Float32Array(evt.data));
      },
      onClose() {
        session?.close();
        session = null;
      },
    };
  }),
);

// A one-shot, non-streaming transcription of a complete WAV upload -
// push-to-talk's simpler fallback (record the whole press, upload once)
// and what the fixture-WAV acceptance test below exercises. Raw body,
// not multipart: the client already has the complete file in memory by
// the time it uploads (unlike voiceRoutes' /cloned, which is a browser
// form with a label field alongside the audio), so there's no second
// field to carry and a raw `audio/wav` body avoids a multipart parse
// for what is, on this route, just bytes in and JSON out.
const sttTranscribeRoute = createRoute({
  method: "post",
  path: "/transcribe",
  tags: ["Voice"],
  summary: "Transcribe a WAV file",
  description:
    "One-shot, non-streaming transcription of a complete WAV upload. " +
    "Takes a raw audio/wav body (not multipart) and returns the transcribed text.",
  middleware: [requireAuth] as const,
  request: {
    body: { content: { "audio/wav": { schema: z.string().openapi({ format: "binary" }) } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ text: z.string() }) } },
      description: "The transcribed text.",
    },
    ...errorResponses({ 400: "Not a supported WAV file", 401: "Not signed in", 503: "Transcription unavailable" }),
  },
});

sttRoutes.openapi(sttTranscribeRoute, async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  let decoded: { samples: Float32Array; sampleRate: number };
  try {
    decoded = decodeWav(bytes);
  } catch (err) {
    return c.json({ error: `not a supported WAV file: ${(err as Error).message}` }, 400);
  }
  try {
    const text = await transcribeUtterance(decoded.samples, decoded.sampleRate);
      return c.json({ text } satisfies SttTranscribeResponse, 200);
  } catch (err) {
    return c.json({ error: `transcription unavailable: ${(err as Error).message}` }, 503);
  }
});

// Mounted under /api/voice (app.ts) alongside the wake-word status
// route this mirrors - GET /api/voice/stt/status, not GET /api/stt/status,
// so every "what voice capability is available" check lives under one
// path prefix.
export const sttStatusRoutes = apiRouter();

const sttStatusRoute = createRoute({
  method: "get",
  path: "/stt/status",
  tags: ["Voice"],
  summary: "Stack speech to text status",
  description:
    "The configured Stack's speech to text role state. The legacy asset fields remain for response compatibility.",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            installed: z.boolean(),
            stackState: z.enum(["notInstalled", "installed", "loaded", "ready", "offline"]),
            sileroInstalled: z.boolean().describe("Deprecated Home VAD asset flag; always false."),
            moonshineInstalled: z.boolean().describe("Deprecated Home recognizer asset flag; always false."),
            recognizerLoaded: z.boolean().describe("Deprecated Home recognizer state; always false."),
          }),
        },
      },
      description: "Stack role state with legacy asset fields fixed to false.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

sttStatusRoutes.openapi(sttStatusRoute, async (c) => {
  let roleState: "notInstalled" | "installed" | "loaded" | "ready" | "offline" = "offline";
  if (isStackConfigured()) {
    try {
      const { roles } = await getStackClient().roles();
      const sttRole = roles.find((role) => role.id === "stt");
      roleState = sttRole?.state.state ?? "notInstalled";
    } catch {
      roleState = "offline";
    }
  }
  return c.json({
    installed: roleState === "ready" || roleState === "installed" || roleState === "loaded",
    stackState: roleState,
    sileroInstalled: false, // Home's retained VAD asset is not an STT engine install.
    moonshineInstalled: false, // Home no longer owns the transcription model.
    recognizerLoaded: false, // The recognizer runs in the Stack.
  } satisfies SttStatusResponse & { stackState: typeof roleState }, 200);
});
