import type { StackVoice } from "@/lib/stack/types";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { householdVoiceEntries } from "@/lib/clonedVoices";
import { liveClipEngine } from "@/lib/clipVoiceEngine";

/** The Stack voices offered by the person voice picker. */
export function playableVoices(rows: readonly StackVoice[]): StackVoice[] {
  return rows.filter((voice) => voice.source === "preset" || voice.source === "cloned");
}

/** Resolve the exact selectable TTS presets from the Stack's live catalog. */
export async function listPlayableVoices(): Promise<StackVoice[]> {
  if (!isStackConfigured()) return [];
  const stack = await getStackClient().voices().catch(() => [] as StackVoice[]);
  // Voices made from a clip are offered only beside an engine that can speak a clip: Chatterbox Turbo or VoxCPM2 (VOICES-04, VOICE-VOXCPM2-01).
  const clipEngine = liveClipEngine(stack);
  return playableVoices([...stack, ...(clipEngine ? householdVoiceEntries(clipEngine) : [])]);
}

/** Accept picker ids and the short engine voice names the person setting stores. */
export function isPlayableVoiceId(rows: readonly StackVoice[], id: string): boolean {
  return playableVoices(rows).some((voice) => voice.id === id || voice.id.endsWith(`-${id}`));
}
