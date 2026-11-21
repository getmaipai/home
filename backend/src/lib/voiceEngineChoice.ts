// VOICE-VOXCPM2-01: the admin's choice of speaking voice engine. The Stack owns the setting (`stack.voice.engine`, one store);
// Home reads its value and applies a change through the Stack client. The household's own clip voices keep working on every choice.
import { getStackClient } from "@/lib/stackEngine";

export const VOICE_ENGINE_SETTING_KEY = "stack.voice.engine";
/** What the Stack accepts and Home offers: Standard (the default), VoxCPM2 and VoxCPM2 Reduced. Plain copy lives in the Settings card. */
export const VOICE_ENGINE_CHOICES = ["auto", "voxcpm2", "voxcpm2-reduced"] as const;
export type VoiceEngineChoice = (typeof VOICE_ENGINE_CHOICES)[number];

export interface VoiceEngineView {
  /** The choice speaking now. Any value outside the offered three (Pocket, an older pick) reads as Standard. */
  current: VoiceEngineChoice;
  /** A saved choice that starts when the voice service restarts, or null. */
  pending: VoiceEngineChoice | null;
  /** False on a Stack too old to list the setting. */
  available: boolean;
}

const asChoice = (value: unknown): VoiceEngineChoice => ((VOICE_ENGINE_CHOICES as readonly string[]).includes(String(value)) ? (value as VoiceEngineChoice) : "auto");

export async function readVoiceEngineChoice(): Promise<VoiceEngineView> {
  const { settings } = await getStackClient().settings();
  const found = settings.find((setting) => setting.key === VOICE_ENGINE_SETTING_KEY);
  if (!found) return { current: "auto", pending: null, available: false };
  return { current: asChoice(found.in_effect), pending: found.pending === null || found.pending === undefined ? null : asChoice(found.pending), available: true };
}

export async function applyVoiceEngineChoice(choice: VoiceEngineChoice): Promise<VoiceEngineView> {
  await getStackClient().applySettings({ [VOICE_ENGINE_SETTING_KEY]: choice });
  return readVoiceEngineChoice();
}
