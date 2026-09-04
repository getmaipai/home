// A client for Pocket TTS's real HTTP surface (`pocket-tts serve`), against
// a base URL that may point at a real process or stubServer.ts's stand-in:
// both speak the same two endpoints (/health, /tts), so the client can't
// tell them apart and doesn't need to.
import type { TtsHealthResponse, TtsSynthesizeResult } from "./types.js";

export class TtsClientError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TtsClientError";
  }
}

export class PocketTtsClient {
  constructor(private readonly baseUrl: string) {}

  /** True only on a reachable server reporting healthy; unreachable and
   * any non-200 both fold to false, matching LlamaServerClient.health()'s
   * "can I use this right now" contract. */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (!res.ok) return false;
      const body = (await res.json()) as TtsHealthResponse;
      return body.status === "healthy";
    } catch {
      return false;
    }
  }

  /** Returns the response's raw, unbuffered stream: Pocket TTS's real
   * `/tts` response arrives in chunks (confirmed live, 2026-09-04), and a
   * household member hearing the first word as soon as it exists, rather
   * than after the whole reply finishes generating, is the entire point
   * (Jesse, 2026-09-04: "make sure you are streaming responses as you
   * get [them] instead of generating the entire wav and then just
   * playing that"). No voice_url/voice_wav sent - every reply uses
   * Pocket TTS's own default voice.
   *
   * Deliberately does not buffer or fix up the WAV header's declared
   * data-chunk size (an earlier, buffered version of this client did -
   * Pocket TTS's real response ships a bogus ~2,000,000,000-byte
   * placeholder there, written for its own demo page's streaming
   * player, which never checks it either). A real streaming consumer
   * parses the fixed 44-byte header once for format info only
   * (sampleRate/channels/bitsPerSample) and treats everything after as
   * raw PCM until the stream itself ends - frontend/src/lib/
   * streamingWavPlayer.ts is that consumer, the same technique Pocket
   * TTS's own reference implementation uses.
   *
   * `voiceUrl` (2026-09-04, "per user selection of voice"): a built-in
   * preset name (confirmed live: `voice_url=vera` synthesizes real
   * audio in that voice) or a full http(s)/hf:// URL - Pocket TTS's real
   * `/tts` validates this itself (`voice_url must start with http://,
   * https://, or hf://` for anything not one of its own known preset
   * names), so this client sends it through unvalidated rather than
   * duplicating that check; the caller (backend/src/settings/
   * voiceKeys.ts) is what actually restricts which values can ever
   * reach here. Omitted (not sent as an empty form field) when absent,
   * so a request with no voice choice behaves exactly as it did before
   * this parameter existed. */
  async synthesizeStream(text: string, voiceUrl?: string): Promise<TtsSynthesizeResult> {
    const form = new FormData();
    form.append("text", text);
    if (voiceUrl) form.append("voice_url", voiceUrl);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/tts`, { method: "POST", body: form });
    } catch (err) {
      throw new TtsClientError(`could not reach ${this.baseUrl}`, err);
    }
    if (!res.ok) {
      throw new TtsClientError(`POST /tts returned ${res.status}`);
    }
    if (!res.body) {
      throw new TtsClientError(`POST /tts returned no response body`);
    }
    return { body: res.body, contentType: res.headers.get("content-type") ?? "audio/wav" };
  }
}
