// The `tts` role port (platform plan 4.11), the same shape llm.ts's
// complete() already set for `chat`: validate, resolve a backend, turn a
// client failure into a typed result a route can translate straight into
// an HTTP response, instead of a thrown error a caller has to guess the
// right status code for.
import { getTtsTags } from "@/lib/ttsCapabilities";
import { sanitizeSpeechTags } from "@/lib/voiceCues";
import { toSpokenText } from "@/lib/spokenText";
import { getOfferedVoices, resolveVoice } from "@/lib/voiceResolve";
import { householdVoiceSpeech } from "@/lib/clonedVoices";
import { getStackClient, isStackConfigured, resolveStackOffline, stackFailureResult } from "@/lib/stackEngine";

const TTS_UNAVAILABLE_COPY = "Home can't speak right now because its voice engine is not running. Read the reply on screen and try again in a minute. If it keeps happening, an owner or admin can check Repairs.";

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
async function synthesizeViaStack(text: string, voiceUrl?: string, household?: { temperature?: number; pitchSemitones?: number }): Promise<TtsOpResult> {
  const form = new FormData();
  form.append("text", text);
  if (voiceUrl) form.append("voice_url", voiceUrl);
  // VOICES-04: a household voice carries its own sampling temperature and pitch offset (set when it was made, never per request).
  if (household?.temperature !== undefined) form.append("temperature", String(household.temperature));
  if (household?.pitchSemitones !== undefined && household.pitchSemitones !== 0) form.append("pitch_semitones", String(household.pitchSemitones));
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

export async function synthesizeSpeech(rawText: string, voiceUrl?: string, opts: { normalize?: boolean } = {}): Promise<TtsOpResult> {
  // REG-02: a bracketed tag the active engine does not advertise is dropped here, the last step before the engine, so "[laugh]" is never read aloud.
  const taggedText = typeof rawText === "string" ? sanitizeSpeechTags(rawText, await getTtsTags()) : rawText;
  const text = typeof taggedText === "string" && opts.normalize !== false ? toSpokenText(taggedText) : taggedText;
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "text must be a non-empty string" };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, status: 400, code: "invalid_input", error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` };
  }

  if (!isStackConfigured()) {
    return { ok: false, status: 503, code: "unavailable", error: TTS_UNAVAILABLE_COPY };
  }

  try {
    // VOICE-PICK-01: a saved voice the engine in use does not offer, or "default", is not sent; the engine speaks its own default.
    // A voice an admin made from a clip is not on the Stack's list: Home sends its clip address and its own settings.
    const household = householdVoiceSpeech(voiceUrl);
    const result = household
      ? await synthesizeViaStack(text, household.voiceUrl, household)
      : await synthesizeViaStack(text, resolveVoice(voiceUrl, await getOfferedVoices()).voiceUrl);
    return result.ok ? result : { ...result, error: TTS_UNAVAILABLE_COPY };
  } catch {
    return { ok: false, status: 503, code: "unavailable", error: TTS_UNAVAILABLE_COPY };
  }
}
