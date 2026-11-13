// MAKE-CLEARER-01: which levels of Make clearer a video can run now, in the one shape the registry and the chat tool read. Quick (the Stack's denoise and sharpen
// steps) and Better (its upscale step) need only the local video editor. Best is the AI restore the Stack does not have yet (CREATOR-52): until its `media.edit`
// lists a restore step this is off with one plain line for an admin, never hidden.
import { isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";
import { EDIT_REMOTE_LINE, EDIT_UNAVAILABLE_LINE } from "./stackEdit";
import { type ClearerLevel, type EditToolState } from "@/lib/imageEdit";

/** MAKE-CLEARER-2026-11-13: Best for pictures is the SeedVR2 component an admin adds in Settings, AI & models; for clips it is not proven (per-frame restore flickers, the temporal path is unbenched), so the line says so and names no setting. */
export const BEST_VIDEO_NOT_YET = "Best is not available for clips yet.";

/** The Stack's `media.edit` has no restore step yet; flip this to a read of the Stack's step list when it does. */
export const STACK_HAS_VIDEO_RESTORE = false;

export async function videoClearerLevels(_actor?: unknown): Promise<Record<ClearerLevel, EditToolState>> {
  const best: EditToolState = STACK_HAS_VIDEO_RESTORE ? { enabled: true } : { enabled: false, reason: BEST_VIDEO_NOT_YET };
  if (!isStackConfigured()) return { quick: { enabled: false, reason: EDIT_UNAVAILABLE_LINE }, better: { enabled: false, reason: EDIT_UNAVAILABLE_LINE }, best: { enabled: false, reason: EDIT_UNAVAILABLE_LINE } };
  if (isRemoteStackSelected()) return { quick: { enabled: false, reason: EDIT_REMOTE_LINE }, better: { enabled: false, reason: EDIT_REMOTE_LINE }, best: { enabled: false, reason: EDIT_REMOTE_LINE } };
  return { quick: { enabled: true }, better: { enabled: true }, best };
}
