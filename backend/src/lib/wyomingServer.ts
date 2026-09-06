// The Wyoming satellite server (session-c-brain-and-voice.md step 8): a
// real TCP listener speaking the Wyoming protocol (lib/wyoming.ts's own
// framing) so a satellite (a Home Assistant Assist pipeline, a physical
// voice puck) can reach STT, TTS, and the turn engine without going
// through the HTTP API at all - the protocol Home Assistant's own voice
// stack expects natively.
//
// Authenticated, unlike the protocol's own base spec ("Wyoming has no
// authentication or encryption, by design... meant for a trusted
// network" - confirmed live against the reference docs before writing
// this) and unlike the legacy hub's own Wyoming socket, which the plan
// calls out by name as the wrong precedent ("the legacy Wyoming socket
// ran unauthenticated; not that"). This implementation requires a real
// `authenticate` message (a MaiPai-specific extension to the base
// protocol, since Wyoming itself defines none) as the FIRST message on
// every connection, checked against lib/apiToken.ts's own interim
// per-person token - the identical credential POST /v1/chat/completions
// already authenticates against, not a second auth system. Any other
// first message, a missing/invalid token, or a second connection
// re-authenticating with a different identity mid-stream (not supported,
// not needed) gets the connection closed outright, no data ever crosses
// into `describe`/`transcribe`/`synthesize`/`handle`.
import { readWavPcm, WyomingFramer, encodeWyomingMessage, type WyomingMessage } from "@/lib/wyoming";
import { resolveApiToken } from "@/lib/apiToken";
import { transcribeUtterance, sttAssetsInstalled } from "@/lib/stt";
import { synthesizeSpeech } from "@/lib/tts";
import { runTurn } from "@/lib/turnEngine";
import { personWithinTurnBudget } from "@/lib/llm";
import type { PersonRow } from "@/types";

const AUDIO_CHUNK_BYTES = 32_000; // ~1s of 16kHz mono 16-bit PCM per chunk - a real, bounded slice, not one giant frame

interface ConnectionState {
  actor: PersonRow | null;
  framer: WyomingFramer;
  /** Accumulated PCM bytes for an in-progress transcribe request
   * (audio-start...audio-chunk*...audio-stop). Wyoming's own audio-chunk
   * events carry `rate`/`width`/`channels` per chunk in principle; this
   * implementation takes the FIRST chunk's format as authoritative for
   * the whole utterance (a real, named simplification - a client that
   * changes format mid-utterance isn't something any real satellite
   * does, and isn't worth defending against here). */
  audioChunks: Uint8Array[];
  audioFormat: { rate: number; width: number; channels: number } | null;
  /** Chains every message this connection has been handed, so a slow
   * handler (synthesize, a turn-engine call) can never race a later
   * chunk's messages on the same socket - two independent `data` events
   * each spawning their own async run was a code-review finding on the
   * first version (out-of-order replies interleaved on the wire, and a
   * second audio-start able to reset `audioChunks`/`audioFormat` out from
   * under an in-flight audio-stop). Every `data` event appends onto this
   * instead of starting its own run. */
  chain: Promise<void>;
  /** Closes the connection if `authenticate` never arrives - an
   * unauthenticated socket held open forever was a code-review finding
   * (unbounded fd/connection growth from idle clients on the LAN).
   * Cleared once `state.actor` is set. */
  handshakeTimeout: ReturnType<typeof setTimeout>;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

function send(socket: { write: (data: Uint8Array) => void }, msg: WyomingMessage): void {
  socket.write(encodeWyomingMessage(msg));
}

// int16 PCM bytes -> Float32Array in [-1, 1], the shape lib/stt.ts's
// transcribe() wants (the same conversion sttSession.ts's own encodeWav()
// does in reverse).
function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

async function handleMessage(
  socket: { write: (data: Uint8Array) => void; end: () => void },
  state: ConnectionState,
  msg: WyomingMessage,
): Promise<void> {
  if (!state.actor) {
    if (msg.type !== "authenticate" || typeof msg.data?.token !== "string") {
      socket.end();
      return;
    }
    const person = resolveApiToken(msg.data.token);
    if (!person) {
      socket.end();
      return;
    }
    state.actor = person;
    clearTimeout(state.handshakeTimeout);
    return;
  }

  switch (msg.type) {
    case "describe":
      send(socket, {
        type: "info",
        data: {
          asr: sttAssetsInstalled() ? [{ name: "maipai", installed: true }] : [],
          tts: [{ name: "maipai", installed: true }],
          handle: [{ name: "maipai", installed: true }],
        },
      });
      return;

    case "audio-start":
      state.audioChunks = [];
      state.audioFormat = {
        rate: typeof msg.data?.rate === "number" ? msg.data.rate : 16000,
        width: typeof msg.data?.width === "number" ? msg.data.width : 2,
        channels: typeof msg.data?.channels === "number" ? msg.data.channels : 1,
      };
      return;

    case "audio-chunk":
      if (msg.payload) state.audioChunks.push(msg.payload);
      return;

    case "audio-stop": {
      const format = state.audioFormat;
      const chunks = state.audioChunks;
      state.audioChunks = [];
      state.audioFormat = null;
      // pcm16ToFloat32() below only knows how to decode 16-bit mono -
      // this server's own STT path (lib/stt.ts) doesn't accept anything
      // else either. A satellite is free to declare a different real
      // format on audio-start (per Wyoming's own event shape); silently
      // decoding those bytes as if they were 16-bit mono would produce
      // garbage transcripts rather than an honest failure, so this
      // rejects the utterance instead - a code-review finding on the
      // first version, which stored width/channels and never checked
      // them.
      if (format && (format.width !== 2 || format.channels !== 1)) {
        send(socket, { type: "error", data: { text: `unsupported audio format: ${format.width * 8}-bit, ${format.channels}ch (only 16-bit mono is supported)` } });
        return;
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const rate = format?.rate ?? 16000;
      const text = await transcribeUtterance(pcm16ToFloat32(merged), rate);
      send(socket, { type: "transcript", data: { text } });
      return;
    }

    // A client-sent "transcript" (as opposed to the one THIS server just
    // sent above) is a request to HANDLE that text - the plan's own
    // "intent/handle through the turn engine". Wyoming's reference
    // implementation documents "handled"/"not-handled" as the handle
    // service's own response events; no documented request event exists
    // separately from "transcript" itself (confirmed against the
    // reference protocol docs before writing this), so reusing it as
    // both "here's what I heard" (this server's own ASR output above)
    // and "please handle this" (a caller's request) is this
    // implementation's own best-effort reading of the real protocol,
    // not verified against a live Home Assistant Assist pipeline - see
    // docs/dev/session-c.md's step 8 entry for what's owed to Jesse.
    case "transcript": {
      const text = typeof msg.data?.text === "string" ? msg.data.text : "";
      if (!text) {
        send(socket, { type: "not-handled", data: { text: "no text to handle" } });
        return;
      }
      // Same per-person turn budget routes/turn.ts and routes/openai.ts
      // both gate on - an authenticated satellite is still one more
      // caller of the turn engine, not a way around its rate limit (a
      // code-review finding on the first version, which called runTurn()
      // here unchecked).
      if (!personWithinTurnBudget(state.actor.id)) {
        send(socket, { type: "not-handled", data: { text: "too many requests too quickly" } });
        return;
      }
      const result = await runTurn(state.actor, "chat", text);
      if (!result.ok) {
        send(socket, { type: "not-handled", data: { text: result.error } });
        return;
      }
      send(socket, { type: "handled", data: { text: result.value.reply.text } });
      return;
    }

    case "synthesize": {
      const text = typeof msg.data?.text === "string" ? msg.data.text : "";
      if (!text) {
        send(socket, { type: "error", data: { text: "text is required" } });
        return;
      }
      const result = await synthesizeSpeech(text);
      if (!result.ok) {
        send(socket, { type: "error", data: { text: result.error } });
        return;
      }
      const bytes = new Uint8Array(await new Response(result.value.stream).arrayBuffer());
      const wav = readWavPcm(bytes);
      send(socket, { type: "audio-start", data: { rate: wav.sampleRate, width: wav.bitsPerSample / 8, channels: wav.channels } });
      for (let offset = 0; offset < wav.pcm.length; offset += AUDIO_CHUNK_BYTES) {
        const slice = wav.pcm.subarray(offset, offset + AUDIO_CHUNK_BYTES);
        send(socket, { type: "audio-chunk", data: { rate: wav.sampleRate, width: wav.bitsPerSample / 8, channels: wav.channels }, payload: slice });
      }
      send(socket, { type: "audio-stop", data: {} });
      return;
    }

    default:
      // An unrecognized message type is not a protocol violation worth
      // closing the connection over (a real satellite may probe
      // capabilities this server doesn't implement, per `describe`'s own
      // honest `info` response above) - silently ignored, the same
      // "unknown fields/types are forward-compatible" posture most
      // wire protocols take.
      return;
  }
}

export interface WyomingServerHandle {
  stop: () => void;
  port: number;
}

/** Starts the real TCP listener. Exported (not auto-started) so
 * index.ts controls when it comes up, the same "boot wires it in, tests
 * start their own instance on an ephemeral port" shape every other real
 * service in this codebase already follows. `handshakeTimeoutMs` only
 * exists so a test can prove the timeout fires without a real 10-second
 * wait; index.ts never passes it. */
export function startWyomingServer(port = 0, opts: { handshakeTimeoutMs?: number } = {}): WyomingServerHandle {
  const handshakeTimeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const server = Bun.listen<ConnectionState>({
    hostname: "0.0.0.0",
    port,
    socket: {
      open(socket) {
        const handshakeTimeout = setTimeout(() => socket.end(), handshakeTimeoutMs);
        handshakeTimeout.unref?.();
        socket.data = {
          actor: null,
          framer: new WyomingFramer(),
          audioChunks: [],
          audioFormat: null,
          chain: Promise.resolve(),
          handshakeTimeout,
        };
      },
      data(socket, chunk) {
        socket.data.framer.push(chunk);
        // Appended onto the connection's own chain rather than spawned as
        // an independent run, so a slow handler from an earlier `data`
        // event can never still be in flight when a later one's messages
        // start processing (see ConnectionState.chain's own comment).
        socket.data.chain = socket.data.chain.then(async () => {
          try {
            let msg = socket.data.framer.next();
            while (msg) {
              await handleMessage(socket, socket.data, msg);
              msg = socket.data.framer.next();
            }
          } catch {
            // A malformed header (WyomingFramer's own thrown error) or a
            // failure inside a handler both end the connection rather
            // than leaving it in a state neither side can make sense of
            // - there's no reliable way to resynchronize on a byte
            // stream once a length-prefixed frame boundary is lost.
            socket.end();
          }
        });
      },
      close(socket) {
        clearTimeout(socket.data.handshakeTimeout);
      },
      error(socket) {
        clearTimeout(socket.data.handshakeTimeout);
      },
    },
  });
  return { stop: () => server.stop(true), port: server.port };
}
