import type { StackVoice } from "@/lib/stack/types";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { householdVoiceEntries } from "@/lib/clonedVoices";

/** The Stack voices offered by the person voice picker. */
export function playableVoices(rows: readonly StackVoice[]): StackVoice[] {
  return rows.filter((voice) => voice.source === "preset" || voice.source === "cloned");
}

/** Resolve the exact selectable TTS presets from the Stack's live catalog. */
export async function listPlayableVoices(): Promise<StackVoice[]> {
  if (!isStackConfigured()) return [];
  const stack = await getStackClient().voices().catch(() => [] as StackVoice[]);
  // Voices an admin made from a clip are spoken by Chatterbox Turbo, so they are offered only beside it (VOICES-04).
  return playableVoices([...stack, ...(stack.some((voice) => voice.engine === "chatterbox-turbo") ? householdVoiceEntries() : [])]);
}

/** Accept picker ids and the short engine voice names the person setting stores. */
export function isPlayableVoiceId(rows: readonly StackVoice[], id: string): boolean {
  return playableVoices(rows).some((voice) => voice.id === id || voice.id.endsWith(`-${id}`));
}
