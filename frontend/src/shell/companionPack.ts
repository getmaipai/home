// PACK-06: the companion pack seam between Home and the kit's CompanionPackPlayer.
import type { StageMode } from "@maipai/ui/src/elements/companion-stage";
import type { PackState } from "@maipai/ui/src/elements/companion-pack";

/** The pack the avatar route returns when the companion has a valid pack folder. */
export type AvatarPack = { url: string; manifest: Record<string, unknown> };

/** The stage mode as a pack state. Working reads as thinking. */
export function packStateFor(mode: StageMode): PackState {
  return mode === "listening" ? "listen" : mode === "speaking" ? "speak" : mode === "thinking" || mode === "working" ? "think" : "idle";
}

/**
 * Speech seam (lands with PACK-05): the extra player props (cues and the audio clock) for the current reply.
 * The kit player has no `speech` prop yet, so this returns undefined and nothing is spread.
 */
export function usePackSpeech(): Record<string, never> | undefined {
  return undefined;
}
