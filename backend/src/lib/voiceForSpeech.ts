import type { PersonRow } from "@/types";
import { getDeviceSettingValue, getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { getDeviceById } from "@/lib/devices";
import { mayUseClipVoices } from "@/lib/access";
import { robotCompanionOf } from "@/lib/robotCompanion";
import { VOICE_ENGINE_DEFAULT, VOICE_PRESET_NAMES } from "@/settings/voiceKeys";
import { voicePresetName } from "@/lib/voiceResolve";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";

export function isPresetVoice(id: string): boolean {
  return id === VOICE_ENGINE_DEFAULT || VOICE_PRESET_NAMES.some((name) => id === name || voicePresetName(id) === name);
}

export function voiceForSpeech(input: { actor: PersonRow; deviceId?: string; companionVoice?: string }): string {
  const personVoice = String(getPersonSettingValue(input.actor, "tts.voice_id") ?? VOICE_ENGINE_DEFAULT);
  let selected = input.companionVoice ?? personVoice;
  if (input.deviceId && getDeviceById(input.deviceId)?.kind === "robot") {
    // The most specific choice wins: the robot's own voice, then its companion's voice (a household setting, one per companion), then
    // the person's. A robot with a companion that has no voice of its own speaks Home's default voice, not its person's.
    const robotVoice = getDeviceSettingValue(input.deviceId, "robot.voice.id");
    const companion = robotCompanionOf(input.deviceId);
    if (typeof robotVoice === "string" && robotVoice !== VOICE_ENGINE_DEFAULT) selected = robotVoice;
    else if (companion) {
      const companionVoice = getHouseholdSettingValue(companionVoiceKey(companion.id));
      selected = input.companionVoice ?? (typeof companionVoice === "string" && companionVoice !== VOICE_ENGINE_DEFAULT && companionVoice ? companionVoice : VOICE_ENGINE_DEFAULT);
    }
  }
  // Nobody (companion, robot or person) chose a voice: Home's default voice, which is the engine's own voice until an admin picks one.
  if (selected === VOICE_ENGINE_DEFAULT) selected = String(getHouseholdSettingValue("tts.home_voice") ?? VOICE_ENGINE_DEFAULT);
  // AUDIO-PARITY-01 V4 (owner-approved 2026-11-05): a voice made from a clip is spoken in every band, a minor's robot included, under the same
  // text floors as every voice. A guest speaks a preset or the engine default only (no clip voice in a guest session).
  if (!mayUseClipVoices(input.actor) && !isPresetVoice(selected)) return isPresetVoice(personVoice) ? personVoice : VOICE_ENGINE_DEFAULT;
  return selected;
}
