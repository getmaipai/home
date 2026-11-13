// SPATIAL-05 / SPATIAL-REACH: the one start of "Spatial sound" on a finished clip. The chat card's menu route (`POST /api/videos/jobs/{id}/spatial-sound`) and
// the Create page's action (`POST /api/plugins/video/actions/spatial-sound`) both call it, so the gate, the lock check and the edit are written once.
import type { PersonRow } from "@/types";
import { getVideoJobByFileFor, getVideoJobFor, type VideoJob } from "./jobs";
import { editRefusal } from "./editGate";
import { refusalLineOf, runEditVideo, type RunEditVideoInput } from "./editTool";
import { videoJobLockState, LOCKED_START_LINE } from "./lock";
import { makeAudienceOf } from "./make";

export type SpatialStart =
  | { ok: true; job: VideoJob }
  | { ok: false; status: 403 | 404 | 422 | 423; error: string; code: string; locked?: true };

/** The one edit gate first (a child or teen gets the edit line whatever clip they name), then the person's own finished, open clip, then the edit the chat tool runs. */
export async function startSpatialSound(actor: PersonRow, id: string, asked: { surround?: unknown; side?: unknown }): Promise<SpatialStart> {
  const gate = editRefusal(makeAudienceOf(actor), "");
  if (gate) return { ok: false, status: gate.kind === "denied" ? 403 : 422, error: gate.line, code: gate.kind === "denied" ? gate.why : "minor" };
  const source = getVideoJobFor(actor, id) ?? getVideoJobByFileFor(actor, id);
  if (!source || source.state !== "done") return { ok: false, status: 404, error: "That video isn't available any more. Ask for it again.", code: "not_found" };
  if (videoJobLockState(actor, source) !== "open") return { ok: false, status: 423, error: LOCKED_START_LINE, code: "locked", locked: true };
  const state = { actor, surface: "chat", conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, planBasis: { surfaceClass: "written" }, context: [], utterance: "", persona: null, crisis: false } as unknown as RunEditVideoInput["state"];
  const outcome = await runEditVideo({ state, args: { clip: source.id, change: "spatial_sound", ...(asked.surround === true ? { surround: true } : {}), ...(asked.side === "left" || asked.side === "right" ? { side: asked.side } : {}) }, callId: "route-spatial-sound", spoken: false });
  const started = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!started) return { ok: false, status: 422, error: refusalLineOf(outcome) ?? "I couldn't change the sound of that video. Try again.", code: String((outcome.result?.data as { refused?: string } | undefined)?.refused ?? "spatial_failed") };
  const job = getVideoJobFor(actor, started);
  return job ? { ok: true, job } : { ok: false, status: 404, error: "That video isn't available any more.", code: "not_found" };
}
