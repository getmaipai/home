// VOICE-VOXCPM2-01: voices made from a clip are spoken by whichever clip-capable engine the Stack runs.
// One list, one place: Chatterbox Turbo (the default) and the two VoxCPM2 sizes.
import type { StackVoice } from "@/lib/stack/types";

export const CLIP_VOICE_ENGINES = ["chatterbox-turbo", "voxcpm2", "voxcpm2-reduced"] as const;

/** The clip-capable engine named by the Stack's own voice list, or null when the live engine cannot speak a clip (Pocket). */
export function liveClipEngine(stackVoices: readonly StackVoice[]): string | null {
  return stackVoices.find((voice) => (CLIP_VOICE_ENGINES as readonly string[]).includes(voice.engine ?? ""))?.engine ?? null;
}
