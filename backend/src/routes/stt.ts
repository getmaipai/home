// STT routes (session-c-brain-and-voice.md step 5): push-to-talk's
// server half. Any signed-in person, no role gate - the same posture
// /api/llm/chat and /api/tts already take: transcribing your own voice
// isn't a privileged action.
import { createRoute, z } from "@hono/zod-openapi";
import { upgradeWebSocket } from "hono/bun";
import { requireAuth } from "@/middleware/auth";
import { SttSession, decodeWav, getEndpointer } from "@/lib/sttSession";
import { transcribeUtterance } from "@/lib/stt";
import { voiceFailureLine } from "@/lib/failureCopy";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { SttStatusResponse, SttTranscribeResponse } from "@maipai/spec/voice/ts/sttTypes.js";
import type { AppEnv } from "@/types";
import { robotsEnabled } from "@/lib/robots";
import { getDeviceById } from "@/lib/devices";
import { getCookie } from "hono/cookie";
import { resolveSessionDeviceId } from "@/middleware/auth";
import { apiRouter, errorResponses } from "@/lib/openapi";

export const sttRoutes = apiRouter();

const SESSION_CONFIG = { sampleRate: 16_000, silenceTimeoutS: 0.6, partialIntervalS: 1.5 };
const robotSttSockets = new Set<{ close(code: number, reason: string): void }>();

export function closeRobotSttSockets(): void {
  for (const socket of robotSttSockets) socket.close(4403, "robots_off");
  robotSttSockets.clear();
}

// WS handshake itself has no cookie-friendly way to fail with a JSON
// body, so auth is checked as a real precondition (requireAuth's own
// middleware, same as every other route) - a rejected upgrade never
// reaches the socket lifecycle below at all.
sttRoutes.get(
  "/stream",
  requireAuth,
  upgradeWebSocket((c) => {
    let session: SttSession | null = null;
    let ended = false;
    const pendingPcm: Float32Array[] = [];
    let trackedRobotSocket: { close(code: number, reason: string): void } | undefined;
    const sessionToken = getCookie(c, "session");
    const deviceId = sessionToken ? resolveSessionDeviceId(sessionToken) : null;
    const isRobot = !!deviceId && getDeviceById(deviceId)?.kind === "robot";
    return {
      onOpen(_evt, ws) {
        if (isRobot) {
          trackedRobotSocket = { close: (code, reason) => ws.close(code, reason) };
          robotSttSockets.add(trackedRobotSocket);
          if (!robotsEnabled()) trackedRobotSocket.close(4403, "robots_off");
        }
        void getEndpointer().then((endpointer) => {
          if (ended) return;
          const config = endpointer
            ? { ...SESSION_CONFIG, silenceTimeoutS: 0.4, endpointing: { endpointer, holdS: 0.8 } }
            : SESSION_CONFIG;
          session = new SttSession(config, (msg) => ws.send(JSON.stringify(msg)));
          for (const frame of pendingPcm) session.pushPcm(frame);
          pendingPcm.length = 0;
          ws.send(JSON.stringify({ t: "ready" }));
        });
      },
      onMessage(evt, ws) {
        if (!session && (typeof evt.data === "string" || evt.data instanceof ArrayBuffer)) {
          // Hold messages that arrive before the optional lookup settles.
          if (evt.data instanceof ArrayBuffer && evt.data.byteLength % 4 === 0) {
            pendingPcm.push(new Float32Array(evt.data));
          }
          return;
        }
        if (!session) return;
        if (typeof evt.data === "string") {
          try {
            const parsed = JSON.parse(evt.data) as { t?: string; reply_id?: unknown; ms?: unknown };
            if (parsed.t === "end") session.end();
            else if (parsed.t === "played_ms" && typeof parsed.reply_id === "string" && parsed.reply_id.trim().length > 0 && typeof parsed.ms === "number" && Number.isFinite(parsed.ms) && parsed.ms >= 0 && Object.keys(parsed).length === 3) {
              session.notePlayback(parsed.reply_id, parsed.ms, Date.now());
            }
          } catch {
            ws.send(JSON.stringify({ t: "error", v: voiceFailureLine("listening_engine", { minor: false, canOpenRepairs: true }) }));
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
          ws.send(JSON.stringify({ t: "error", v: voiceFailureLine("listening_engine", { minor: false, canOpenRepairs: true }) }));
          return;
        }
        session.pushPcm(new Float32Array(evt.data));
      },
      onClose() {
        if (trackedRobotSocket) robotSttSockets.delete(trackedRobotSocket);
        ended = true;
        pendingPcm.length = 0;
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
