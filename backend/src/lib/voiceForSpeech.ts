import type { PersonRow } from "@/types";
import { getDeviceSettingValue, getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { getDeviceById } from "@/lib/devices";
import { mayUseClipVoices } from "@/lib/access";
import { companionLayersOf, recentRobotTurnBand } from "@/lib/robotCompanion";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { VOICE_ENGINE_DEFAULT, VOICE_PRESET_NAMES } from "@/settings/voiceKeys";
import { voicePresetName } from "@/lib/voiceResolve";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";
import type { AgeBand } from "@/lib/ageBand";

export function isPresetVoice(id: string): boolean {
  return id === VOICE_ENGINE_DEFAULT || VOICE_PRESET_NAMES.some((name) => id === name || voicePresetName(id) === name);
}

/** The voice a synth or companion has chosen for itself: the household voice setting first, then the voice in its own details; undefined when it has none. */
export function companionOwnVoice(id: string): string | undefined {
  const value = getHouseholdSettingValue(companionVoiceKey(id));
  if (typeof value === "string" && value && value !== VOICE_ENGINE_DEFAULT) return value;
  const own = getHouseholdCompanion(id)?.companion?.voice_id;
  return typeof own === "string" && own && own !== VOICE_ENGINE_DEFAULT ? own : undefined;
}

export function voiceForSpeech(input: { actor: PersonRow; deviceId?: string; companionVoice?: string; band?: AgeBand }): string {
  const personVoice = String(getPersonSettingValue(input.actor, "tts.voice_id") ?? VOICE_ENGINE_DEFAULT);
  let selected = input.companionVoice ?? personVoice;
  if (input.deviceId && getDeviceById(input.deviceId)?.kind === "robot") {
    // The most specific choice wins: the robot's own voice, then its companion's voice (a household setting, one per companion), then
    // the person's. A robot with a companion that has no voice of its own speaks Home's default voice, not its person's.
    const robotVoice = getDeviceSettingValue(input.deviceId, "robot.voice.id");
    // Layers (robotCompanion.ts companionLayersOf): a guise is the synth layer without the customization layer, so its voice outranks the robot's own.
    // When the guise does not apply to this speaker, the layers are the assigned companion's and the order above holds.
    const layers = companionLayersOf(input.deviceId, input.actor, input.band ?? recentRobotTurnBand(input.deviceId) ?? "child");
    const guiseSynth = layers.guise ? layers.synth : null;
    const synthVoice = (id: string) => companionOwnVoice(id) ?? VOICE_ENGINE_DEFAULT;
    if (guiseSynth) selected = synthVoice(guiseSynth.id);
    else if (typeof robotVoice === "string" && robotVoice !== VOICE_ENGINE_DEFAULT) selected = robotVoice;
    else if (layers.customization) selected = input.companionVoice ?? synthVoice(layers.customization.id);
  }
  // Nobody (companion, robot or person) chose a voice: Home's default voice, which is the engine's own voice until an admin picks one.
  if (selected === VOICE_ENGINE_DEFAULT) selected = String(getHouseholdSettingValue("tts.home_voice") ?? VOICE_ENGINE_DEFAULT);
  // AUDIO-PARITY-01 V4 (owner-approved 2026-11-05): a voice made from a clip is spoken in every band, a minor's robot included, under the same
  // text floors as every voice. A guest speaks a preset or the engine default only (no clip voice in a guest session).
  if (!mayUseClipVoices(input.actor) && !isPresetVoice(selected)) return isPresetVoice(personVoice) ? personVoice : VOICE_ENGINE_DEFAULT;
  return selected;
}
