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
import { attachSpeechTiming, findVoiceTiming, setCuePlaybackTiming, setVoiceOutcome, setVoiceTiming, VoiceTimingMessageSchema } from "@/lib/voiceTiming";
import { scoreEdgePartial, talkOverDecision } from "@/lib/talkOver";
import { noteListeningActivity } from "@/lib/turnActivity";
import { computeVoiceVerdict } from "@/lib/voiceMatch";
import { setVoiceMatchVerdict } from "@/lib/voiceMatchVerdict";

export const sttRoutes = apiRouter();

const SESSION_CONFIG = { sampleRate: 16_000, silenceTimeoutS: 0.75, partialIntervalS: 1.5 };
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
        // TALK-OVER-01: the grant is decided once per session from the signed-in person (an adult, not a robot device, the settings on);
        // a session with no grant gets no `talk_over` field and its edge partials carry no score, so an older or ungranted client has
        // nothing to act on.
        const decision = talkOverDecision({ actor: c.get("person"), isRobot });
        const grant = decision.grant;
        void getEndpointer().then((endpointer) => {
          if (ended) return;
          // Every session's edge partial carries the end-of-turn score (the client starts no held run on an unfinished fragment); the
          // acknowledgement clip itself needs the grant.
          const base = { ...SESSION_CONFIG, turnEnd: scoreEdgePartial };
          const config = endpointer
            ? { ...base, silenceTimeoutS: 0.4, endpointing: { endpointer, holdS: 0.8 } }
            : base;
          const person = c.get("person");
          const onSpeechClip = person.role !== "child" && person.role !== "guest" ? (clip: Float32Array, sampleRate: number) => {
            // This is intentionally fire-and-forget: STT and the person-facing turn never fail on matching.
            const pending = computeVoiceVerdict({ person, clip, sampleRate });
            setVoiceMatchVerdict(person.id, pending);
          } : undefined;
          session = new SttSession({ ...config, ...(onSpeechClip ? { onSpeechClip } : {}) }, (msg) => {
            // LISTEN-GATE-01: the person is talking in an open call, so background model work (the memory judge) waits.
            if ((msg.t === "vad" && msg.speaking) || msg.t === "final") noteListeningActivity();
            ws.send(JSON.stringify(msg));
          });
          for (const frame of pendingPcm) session.pushPcm(frame);
          pendingPcm.length = 0;
          ws.send(JSON.stringify(grant ? { t: "ready", talk_over: grant } : { t: "ready", talk_over_reason: decision.reason }));
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
            const parsed = JSON.parse(evt.data) as { t?: string; reply_id?: unknown; ms?: unknown; stt_ms?: unknown; first_playback_ms?: unknown; first_sentence_ms?: unknown; cue_playback_ms?: unknown; head_ms?: unknown; offer_ms?: unknown; emit_ms?: unknown; ctx_enqueue?: unknown; ctx_emit?: unknown; turn_id?: unknown };
            if (parsed.t === "end") session.end();
            else if (parsed.t === "played_ms" && typeof parsed.reply_id === "string" && parsed.reply_id.trim().length > 0 && typeof parsed.ms === "number" && Number.isFinite(parsed.ms) && parsed.ms >= 0 && Object.keys(parsed).length === 3) {
              session.notePlayback(parsed.reply_id, parsed.ms, Date.now());
            }
            else {
              const timing = VoiceTimingMessageSchema.safeParse(parsed);
              if (timing.success) {
                const value = timing.data;
                const record = findVoiceTiming(value.turn_id);
                if (value.first_sentence_ms !== undefined) setVoiceTiming(record, "first_sentence_ms", value.first_sentence_ms);
                if (value.first_playback_ms !== undefined) setVoiceTiming(record, "first_playback_ms", value.first_playback_ms);
                if (value.cue_playback_ms !== undefined) setCuePlaybackTiming(record, value.cue_playback_ms);
                attachSpeechTiming(value.turn_id, { head_ms: value.head_ms, offer_ms: value.offer_ms, emit_ms: value.emit_ms, ctx_enqueue: value.ctx_enqueue, ctx_emit: value.ctx_emit });
                // STT-SMARTTURN-01 and TALK-OVER-01: the client's labels and counts for the speculative start and the acknowledgement clip.
                setVoiceOutcome(record, { speculative: value.speculative, talk_over_level: value.talk_over_level, early_release_ms: value.early_release_ms, overlap_ms: value.overlap_ms, decision: value.decision, yield_ms: value.yield_ms, edge_partials: value.edge_partials, clip_started_ms: value.clip_started_ms, clip_ended_ms: value.clip_ended_ms, clip_completed: value.clip_completed, echo_drops: value.echo_drops, talk_over_reason: value.talk_over_reason, pool_size: value.pool_size, filler_group: value.filler_group, filler_source: value.filler_source, filler_choose_ms: value.filler_choose_ms, filler_pool_ready: value.filler_pool_ready });
              }
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
