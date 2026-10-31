// VOICE-PICK-01: which voice the speech engine in use is actually asked for.
//
// `tts.voice_id` is a person's saved choice and outlives engine changes: a name saved while Pocket TTS spoke
// ("javert") means nothing to Chatterbox. The Stack ignores a voice_url it cannot use, so the spoken voice was the
// engine default while the settings page still showed the old name. This module is the one place that decides, from
// the voices the engine offers right now, what is sent and whether the saved choice had to be set aside.
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { VOICE_ENGINE_DEFAULT, VOICE_PRESET_NAMES } from "@/settings/voiceKeys";
import type { StackVoice } from "@/lib/stack/types";

export interface VoiceResolution {
  /** What goes in the engine's voice_url; undefined means the engine's own default voice. */
  voiceUrl: string | undefined;
  /** True when a saved choice was set aside because the engine in use does not offer it. */
  unavailable: boolean;
}

export function voiceMatchesLanguage(language: string, voiceLanguage: string): boolean {
  const primary = (tag: string) => tag.split("-")[0]?.toLowerCase() ?? "";
  return primary(language) !== "" && primary(language) === primary(voiceLanguage);
}

/** A saved name matches an offered voice by its id or by the preset name its id ends with. */
export function voiceMatchesStored(voiceId: string, stored: string): boolean {
  return voiceId === stored || voiceId.endsWith(`-${stored}`);
}

/** The Stack's short picker name, derived with the same exact matching rule as saved voices. */
export function voicePresetName(voiceId: string): string | undefined {
  return VOICE_PRESET_NAMES.find((name) => voiceId.endsWith(`-${name}`));
}

/** `offered` is null when the Stack's list could not be read: the saved value is sent as before. */
export function resolveVoice(stored: unknown, offered: readonly Pick<StackVoice, "id">[] | null): VoiceResolution {
  if (typeof stored !== "string" || !stored.trim() || stored === VOICE_ENGINE_DEFAULT) return { voiceUrl: undefined, unavailable: false };
  // A catalog or recorded voice is saved as an address; the engine decides whether it can use one.
  if (/[:/]/.test(stored) || offered === null) return { voiceUrl: stored, unavailable: false };
  const hit = offered.find((voice) => voiceMatchesStored(voice.id, stored));
  return hit ? { voiceUrl: stored, unavailable: false } : { voiceUrl: undefined, unavailable: true };
}

const CACHE_MS = 30_000;
let cached: { at: number; voices: StackVoice[] | null } | null = null;
let override: StackVoice[] | null | undefined;

/** The voices the engine in use offers, cached briefly because speech asks once per sentence. Null: could not read. */
export async function getOfferedVoices(): Promise<StackVoice[] | null> {
  if (override !== undefined) return override;
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.voices;
  let voices: StackVoice[] | null = null;
  if (isStackConfigured()) {
    try { voices = await getStackClient().voices(); } catch { voices = null; }
  }
  cached = { at: now, voices };
  return voices;
}

/** Test hook: pins the offered list (null = unreadable); `undefined` returns to the real Stack. */
export function __setOfferedVoicesForTests(voices: StackVoice[] | null | undefined): void {
  override = voices;
  cached = null;
}
