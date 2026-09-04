// Pocket TTS's real wire shapes (confirmed live against `pocket-tts serve`,
// 2026-09-04): see README.md for what's sent and what's deliberately not
// (voice selection/cloning).

export interface TtsHealthResponse {
  status: string;
}

export interface TtsSynthesizeRequest {
  text: string;
  /** Optional Pocket TTS built-in preset name (e.g. "alba") or a
   * http(s)/hf:// voice URL - see client.ts's synthesizeStream() for the
   * real endpoint's exact validation. Omitted entirely (not sent, not
   * `undefined` in the form body) uses Pocket TTS's own default voice. */
  voiceUrl?: string;
}

/** `POST /tts` returns the WAV bytes directly (content-type: audio/wav),
 * not a JSON envelope - there is no response type to parse, only the
 * request shape above. `body` is the raw, unbuffered response stream
 * (2026-09-04: real chunked playback, not "generate the whole reply then
 * play it" - see client.ts's synthesizeStream()). */
export interface TtsSynthesizeResult {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}
