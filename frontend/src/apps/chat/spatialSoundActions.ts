// SPATIAL-05 (docs/design/spatial-sound-2026-11-06.md, section 4): the "Spatial sound" entries of a finished clip's More menu, as the kit
// VideoPlayer's `actionItems` take them (per-action `disabledReason`, no wrapper, no class). Pure: the card hands in what it knows.
import type { VideoPlayerAction } from "@maipai/ui/src/elements/video-player";

export const SPATIAL_LABEL = "Spatial sound";
export const SPATIAL_SURROUND_LABEL = "Spatial sound with 5.1 file";
// Short on purpose: the kit menu shows it under the label, and a long line runs off a phone screen. The full line is the route's answer if the action is tried anyway.
export const SPATIAL_NO_SOUND_HINT = "This clip has no sound to place.";
export const SPATIAL_BUSY_HINT = "Working on the sound. This takes about a minute.";

export interface SpatialActionInput {
  /** The clip has a sound track (`clip.has_sound`). */
  hasSound: boolean;
  /** The one line the video row shows while making is not ready (useMakingAvailability), or null. */
  makingReason: string | null;
  /** A spatial request from this card is on its way. */
  busy: boolean;
  /** Runs the edit; `surround` also asks for the 5.1 file. */
  onRun: (surround: boolean) => void;
}

/** Two entries, in the order a person reads them. Each is disabled with its reason, never hidden, so the person learns why. */
export function spatialActionItems(input: SpatialActionInput): VideoPlayerAction[] {
  const disabledReason = !input.hasSound ? SPATIAL_NO_SOUND_HINT : input.makingReason ?? (input.busy ? SPATIAL_BUSY_HINT : undefined);
  const entry = (key: string, label: string, surround: boolean): VideoPlayerAction => ({ key, label, when: ["ready"], onSelect: () => input.onRun(surround), ...(disabledReason ? { disabledReason } : {}) });
  return [entry("spatial-sound", SPATIAL_LABEL, false), entry("spatial-sound-51", SPATIAL_SURROUND_LABEL, true)];
}
