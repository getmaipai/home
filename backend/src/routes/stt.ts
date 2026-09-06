// STT routes (session-c-brain-and-voice.md step 5): push-to-talk's
// server half. Any signed-in person, no role gate - the same posture
// /api/llm/chat and /api/tts already take: transcribing your own voice
// isn't a privileged action.
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { requireAuth } from "@/middleware/auth";
import { SttSession, decodeWav } from "@/lib/sttSession";
import { transcribeUtterance, sttAssetsInstalled, sttAssetInstallStatus, sttRecognizerLoaded } from "@/lib/stt";
import type { SttStatusResponse, SttTranscribeResponse } from "@maipai/spec/voice/ts/sttTypes.js";
import type { AppEnv } from "@/types";

export const sttRoutes = new Hono<AppEnv>();

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
sttRoutes.post("/transcribe", requireAuth, async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  let decoded: { samples: Float32Array; sampleRate: number };
  try {
    decoded = decodeWav(bytes);
  } catch (err) {
    return c.json({ error: `not a supported WAV file: ${(err as Error).message}` }, 400);
  }
  try {
    const text = await transcribeUtterance(decoded.samples, decoded.sampleRate);
    return c.json({ text } satisfies SttTranscribeResponse);
  } catch (err) {
    return c.json({ error: `transcription unavailable: ${(err as Error).message}` }, 503);
  }
});

// Mounted under /api/voice (app.ts) alongside the wake-word status
// route this mirrors - GET /api/voice/stt/status, not GET /api/stt/status,
// so every "what voice capability is available" check lives under one
// path prefix.
export const sttStatusRoutes = new Hono<AppEnv>();
sttStatusRoutes.get("/stt/status", requireAuth, async (c) => {
  const { sileroInstalled, moonshineInstalled } = sttAssetInstallStatus();
  return c.json({
    installed: sttAssetsInstalled(),
    sileroInstalled,
    moonshineInstalled,
    recognizerLoaded: sttRecognizerLoaded(),
  } satisfies SttStatusResponse);
});
