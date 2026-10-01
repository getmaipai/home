// The `tts` role port (platform plan 4.11), the same shape llm.ts's
// complete() already set for `chat`: validate, resolve a backend, turn a
// client failure into a typed result a route can translate straight into
// an HTTP response, instead of a thrown error a caller has to guess the
// right status code for.
import { getStackClient, isStackConfigured, resolveStackOffline, stackFailureResult } from "@/lib/stackEngine";

// Bound a speech request generously above any real reply length.
const MAX_TEXT_LENGTH = 4_000;

export interface TtsSynthesizeValue {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
}

export type TtsOpResult =
  | { ok: true; value: TtsSynthesizeValue }
  | { ok: false; status: 400 | 503; code: "invalid_input" | "unavailable"; error: string };

/** `voiceUrl` (2026-09-04, "per user selection of voice"): the caller's
 * already-resolved choice (routes/tts.ts reads it from the signed-in
 * actor's `tts.voice_id` person setting) - this function stays a plain
 * passthrough, the same "validate/resolve/call" shape as before this
 * parameter existed, since which values are even reachable here is
 * already restricted by that setting key's own `select` options, not
 * anything this function re-checks. */
/** The Stack's /v1/audio/speech accepts text and voice_url. */
async function synthesizeViaStack(text: string, voiceUrl?: string): Promise<TtsOpResult> {
  const form = new FormData();
  form.append("text", text);
  if (voiceUrl) form.append("voice_url", voiceUrl);
  form.append("model", "tts");
  try {
    const client = getStackClient();
    const res = await client.speak(form);
    resolveStackOffline("tts");
    return { ok: true, value: { stream: res.body!, contentType: res.headers.get("content-type") ?? "audio/wav" } };
  } catch (err) {
    return stackFailureResult(err, "tts");
  }
}

export async function synthesizeSpeech(text: string, voiceUrl?: string): Promise<TtsOpResult> {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "text must be a non-empty string" };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, status: 400, code: "invalid_input", error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` };
  }

  if (!isStackConfigured()) {
    return { ok: false, status: 503, code: "unavailable", error: "voice unavailable: the MaiPai Stack is required for text to speech" };
  }

  try {
    return await synthesizeViaStack(text, voiceUrl);
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `voice unavailable: ${(err as Error).message}` };
  }
}
