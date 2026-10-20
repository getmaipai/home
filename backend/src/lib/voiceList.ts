import type { StackVoice } from "@/lib/stack/types";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";

/** The Stack voices offered by the person voice picker. */
export function playableVoices(rows: readonly StackVoice[]): StackVoice[] {
  return rows.filter((voice) => voice.source === "preset");
}

/** Resolve the exact selectable TTS presets from the Stack's live catalog. */
export async function listPlayableVoices(): Promise<StackVoice[]> {
  return isStackConfigured() ? playableVoices(await getStackClient().voices().catch(() => [])) : [];
}

/** Accept picker ids and the short engine voice names the person setting stores. */
export function isPlayableVoiceId(rows: readonly StackVoice[], id: string): boolean {
  return playableVoices(rows).some((voice) => voice.id === id || voice.id.endsWith(`-${id}`));
}
