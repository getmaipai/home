// MAKE-CLEARER-01: which levels of Make clearer a video can run now, in the one shape the registry and the chat tool read. Quick (the Stack's denoise and sharpen
// steps) and Better (its upscale step) need only the local video editor. Best is the AI restore the Stack does not have yet (CREATOR-52): until its `media.edit`
// lists a restore step this is off with one plain line for an admin, never hidden.
import { isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";
import { EDIT_REMOTE_LINE, EDIT_UNAVAILABLE_LINE } from "./stackEdit";
import { BEST_NEEDS_DOWNLOAD, type ClearerLevel, type EditToolState } from "@/lib/imageEdit";

/** The Stack's `media.edit` has no restore step yet; flip this to a read of the Stack's step list when it does. */
export const STACK_HAS_VIDEO_RESTORE = false;

export async function videoClearerLevels(_actor?: unknown): Promise<Record<ClearerLevel, EditToolState>> {
  const best: EditToolState = STACK_HAS_VIDEO_RESTORE ? { enabled: true } : { enabled: false, reason: BEST_NEEDS_DOWNLOAD };
  if (!isStackConfigured()) return { quick: { enabled: false, reason: EDIT_UNAVAILABLE_LINE }, better: { enabled: false, reason: EDIT_UNAVAILABLE_LINE }, best: { enabled: false, reason: EDIT_UNAVAILABLE_LINE } };
  if (isRemoteStackSelected()) return { quick: { enabled: false, reason: EDIT_REMOTE_LINE }, better: { enabled: false, reason: EDIT_REMOTE_LINE }, best: { enabled: false, reason: EDIT_REMOTE_LINE } };
  return { quick: { enabled: true }, better: { enabled: true }, best };
}
