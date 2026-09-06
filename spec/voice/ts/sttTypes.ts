// The `stt` role's wire contract (session-c-brain-and-voice.md step 5).
// Same precedent as types.ts's own TTS shapes: plain types, no TS-only
// tricks, language-portable in spirit even though only a TypeScript
// implementation exists so far. backend/src/routes/stt.ts is the real
// consumer of both shapes below.

/** `WS /api/stt/stream`: the client sends binary frames, each one a
 * little-endian Float32Array of 16kHz mono PCM samples (no envelope -
 * every binary frame IS a chunk of audio, since anything else would cost
 * a JSON parse per ~10ms of audio on the hot path). The client may also
 * send one JSON text frame, `{"t":"end"}`, to flush whatever utterance
 * is in progress (e.g. push-to-talk's button-up) without waiting for
 * silence to time out. The server never sends binary frames back - only
 * these JSON events, one object per text frame. */
export type SttWireEvent =
  | { t: "ready" }
  | { t: "vad"; speaking: boolean; rms: number }
  | { t: "partial"; v: string }
  | { t: "final"; v: string }
  | { t: "no_speech" }
  | { t: "error"; v: string };

/** `POST /api/stt/transcribe`: a one-shot, non-streaming transcription
 * of a complete WAV file (multipart form field `file`) - push-to-talk's
 * simpler fallback path (record the whole press, upload once) and the
 * one this repo's own fixture-WAV tests exercise. 16-bit mono PCM WAV
 * only (see backend/src/lib/sttSession.ts's decodeWav() for why). */
export interface SttTranscribeResponse {
  text: string;
}

/** `GET /api/voice/stt/status`: mirrors the wake-word status route's own
 * shape (routes/voice.ts's `GET /wakewords`) - what's installed, what's
 * actually loaded in this process right now. `installed` is true only
 * once BOTH the Silero VAD model and the full Moonshine archive are on
 * disk; `sileroInstalled`/`moonshineInstalled` break that down
 * separately, since `ensureSttAssets()` downloads Silero first, then
 * Moonshine - "silero present, Moonshine still downloading" is a real,
 * reachable partial-install state, not a hypothetical one.
 * `recognizerLoaded` is true only after the first real transcription has
 * actually constructed the in-process recognizer (lazy, per lib/stt.ts),
 * distinguishing "ready to serve" from "will download and load on first
 * use." */
export interface SttStatusResponse {
  installed: boolean;
  sileroInstalled: boolean;
  moonshineInstalled: boolean;
  recognizerLoaded: boolean;
}
