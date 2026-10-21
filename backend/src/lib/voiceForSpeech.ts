import type { PersonRow } from "@/types";
import { getDeviceSettingValue, getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { getDeviceById } from "@/lib/devices";
import { speakerAgeBand } from "@/lib/ageBand";
import { VOICE_ENGINE_DEFAULT, VOICE_PRESET_NAMES } from "@/settings/voiceKeys";
import { voicePresetName } from "@/lib/voiceResolve";

export function isPresetVoice(id: string): boolean {
  return id === VOICE_ENGINE_DEFAULT || VOICE_PRESET_NAMES.some((name) => id === name || voicePresetName(id) === name);
}

export function voiceForSpeech(input: { actor: PersonRow; deviceId?: string; companionVoice?: string }): string {
  const personVoice = String(getPersonSettingValue(input.actor, "tts.voice_id") ?? VOICE_ENGINE_DEFAULT);
  let selected = input.companionVoice ?? personVoice;
  if (!input.companionVoice && input.deviceId && getDeviceById(input.deviceId)?.kind === "robot") {
    const robotVoice = getDeviceSettingValue(input.deviceId, "robot.voice.id");
    if (typeof robotVoice === "string" && robotVoice !== VOICE_ENGINE_DEFAULT) selected = robotVoice;
  }
  // Nobody (companion, robot or person) chose a voice: Home's default voice, which is the engine's own voice until an admin picks one.
  if (selected === VOICE_ENGINE_DEFAULT) selected = String(getHouseholdSettingValue("tts.home_voice") ?? VOICE_ENGINE_DEFAULT);
  // A child or teen never speaks in a voice made from a clip (VOICES-04), whoever chose it: only a preset or the engine default.
  if (speakerAgeBand(input.actor, new Date()) !== "adult" && !isPresetVoice(selected)) return isPresetVoice(personVoice) ? personVoice : VOICE_ENGINE_DEFAULT;
  return selected;
}
