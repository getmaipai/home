// SPATIAL-05 / SPATIAL-REACH: the one start of "Spatial sound" on a finished clip. The chat card's menu route (`POST /api/videos/jobs/{id}/spatial-sound`) and
// the Create page's action (`POST /api/plugins/video/actions/spatial-sound`) both call it; the gate, the lock check and the edit are written once in clipEditStart.
import type { PersonRow } from "@/types";
import { startClipEdit, type ClipEditStart } from "./clipEditStart";

export type SpatialStart = ClipEditStart;

export function startSpatialSound(actor: PersonRow, id: string, asked: { surround?: unknown; side?: unknown }): Promise<SpatialStart> {
  return startClipEdit(actor, id, { change: "spatial_sound", ...(asked.surround === true ? { surround: true } : {}), ...(asked.side === "left" || asked.side === "right" ? { side: asked.side } : {}) },
    "I couldn't change the sound of that video. Try again.", "spatial_failed");
}
