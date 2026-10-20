// VOICES-04: a voice made from a clip is rendered once right after it is made. That proves the engine accepts the clip
// (the engine measures its length and refuses one outside 6 to 30 seconds) and warms the engine's per-clip cache, so the
// first spoken sentence is not the slow one. A Stack that is down or busy does not undo the voice: the clip is kept and
// the first preview says what is wrong.
import { StackError } from "@/lib/stack/errors";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { householdVoiceSpeech } from "@/lib/clonedVoices";

export const HOUSEHOLD_PREVIEW_SENTENCE = "Hello, this is my voice.";

export type HouseholdVoiceCheck = { ok: true; audio: Uint8Array | null } | { ok: false; error: string };

function clipMessage(error: StackError): string | null {
  if (error.kind !== "unknown" || !error.body) return null;
  try {
    const parsed = JSON.parse(error.body) as { detail?: unknown; error?: unknown };
    const text = typeof parsed.detail === "string" ? parsed.detail : typeof parsed.error === "string" ? parsed.error : null;
    return text && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

/** Renders the preview sentence in a household voice. `ok: false` carries the engine's plain refusal of the clip (400);
 * any other failure answers `ok: true` with no audio, because the voice itself is fine. */
export async function renderHouseholdVoice(id: string, signal?: AbortSignal): Promise<HouseholdVoiceCheck> {
  const household = householdVoiceSpeech(id);
  if (!household || !isStackConfigured()) return { ok: true, audio: null };
  const form = new FormData();
  form.append("text", HOUSEHOLD_PREVIEW_SENTENCE);
  form.append("model", "tts");
  form.append("voice_url", household.voiceUrl);
  if (household.temperature !== undefined) form.append("temperature", String(household.temperature));
  if (household.pitchSemitones !== undefined && household.pitchSemitones !== 0) form.append("pitch_semitones", String(household.pitchSemitones));
  try {
    const response = await getStackClient().speak(form, { signal });
    return { ok: true, audio: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    if (error instanceof StackError) {
      const message = clipMessage(error);
      if (message) return { ok: false, error: message };
    }
    return { ok: true, audio: null };
  }
}

// The first preview is kept in memory (a voice never changes after it is made); deleting the voice drops it.
const previews = new Map<string, Uint8Array>();
export function cacheHouseholdPreview(id: string, audio: Uint8Array): void { previews.set(id, audio); }
export function dropHouseholdPreview(id: string): void { previews.delete(id); }
export function householdPreviewAudio(id: string): Uint8Array | undefined { return previews.get(id); }
