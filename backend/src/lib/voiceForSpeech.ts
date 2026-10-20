import type { PersonRow } from "@/types";
import { getDeviceSettingValue, getPersonSettingValue } from "@/lib/settings";
import { getDeviceById } from "@/lib/devices";
import { speakerAgeBand } from "@/lib/ageBand";
import { VOICE_ENGINE_DEFAULT, VOICE_PRESET_NAMES } from "@/settings/voiceKeys";

export function voiceForSpeech(input: { actor: PersonRow; deviceId?: string; companionVoice?: string }): string {
  const personVoice = String(getPersonSettingValue(input.actor, "tts.voice_id") ?? VOICE_ENGINE_DEFAULT);
  let selected = input.companionVoice ?? personVoice;
  if (!input.companionVoice && input.deviceId && getDeviceById(input.deviceId)?.kind === "robot") {
    const robotVoice = getDeviceSettingValue(input.deviceId, "robot.voice.id");
    if (typeof robotVoice === "string" && robotVoice !== VOICE_ENGINE_DEFAULT) selected = robotVoice;
  }
  if (speakerAgeBand(input.actor, new Date()) === "child" && selected !== VOICE_ENGINE_DEFAULT && !VOICE_PRESET_NAMES.includes(selected as typeof VOICE_PRESET_NAMES[number])) return personVoice;
  return selected;
}
