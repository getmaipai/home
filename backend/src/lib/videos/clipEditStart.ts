// PHOSPHENE-PARITY-01: the one start of a one-click edit on a finished clip (Spatial sound, Reshape, Sharpen). The chat card's menu route and the Create
// page's actions call it, so the gate, the lock check and the edit are written once: the edit gate first (a child or teen gets the edit line whatever clip
// they name), then the person's own finished, open clip, then the edit the chat tool (`edit_video`) runs.
import type { PersonRow } from "@/types";
import { getVideoJobByFileFor, getVideoJobFor, type VideoJob } from "./jobs";
import { editRefusal } from "./editGate";
import { refusalLineOf, runEditVideo, type RunEditVideoInput } from "./editTool";
import { videoJobLockState, LOCKED_START_LINE } from "./lock";
import { makeAudienceOf } from "./make";

export type ClipEditStart =
  | { ok: true; job: VideoJob }
  | { ok: false; status: 403 | 404 | 422 | 423; error: string; code: string; locked?: true };

export async function startClipEdit(actor: PersonRow, id: string, args: Record<string, unknown>, failedLine: string, failedCode: string): Promise<ClipEditStart> {
  const gate = editRefusal(makeAudienceOf(actor), "");
  if (gate) return { ok: false, status: gate.kind === "denied" ? 403 : 422, error: gate.line, code: gate.kind === "denied" ? gate.why : "minor" };
  const source = getVideoJobFor(actor, id) ?? getVideoJobByFileFor(actor, id);
  if (!source || source.state !== "done") return { ok: false, status: 404, error: "That video isn't available any more. Ask for it again.", code: "not_found" };
  if (videoJobLockState(actor, source) !== "open") return { ok: false, status: 423, error: LOCKED_START_LINE, code: "locked", locked: true };
  const state = { actor, surface: "chat", conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, planBasis: { surfaceClass: "written" }, context: [], utterance: "", persona: null, crisis: false } as unknown as RunEditVideoInput["state"];
  const outcome = await runEditVideo({ state, args: { clip: source.id, ...args }, callId: `route-${String(args.change)}`, spoken: false });
  const started = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!started) return { ok: false, status: 422, error: refusalLineOf(outcome) ?? failedLine, code: String((outcome.result?.data as { refused?: string } | undefined)?.refused ?? failedCode) };
  const job = getVideoJobFor(actor, started);
  return job ? { ok: true, job } : { ok: false, status: 404, error: "That video isn't available any more.", code: "not_found" };
}

/** The shapes the Create feed offers, by the word a person uses; each is the Stack's `reframe` with a soft blurred copy of the clip filling the space. */
export const RESHAPES = { vertical: "9:16", portrait: "4:5", square: "1:1", wide: "16:9" } as const;
export type Reshape = keyof typeof RESHAPES;
export const isReshape = (value: unknown): value is Reshape => typeof value === "string" && Object.prototype.hasOwnProperty.call(RESHAPES, value);

export function startReshape(actor: PersonRow, id: string, shape: Reshape): Promise<ClipEditStart> {
  return startClipEdit(actor, id, { change: "reframe", aspect: RESHAPES[shape], fill: "blur" }, "I couldn't change the shape of that video. Try again.", "reshape_failed");
}

export function startSharpen(actor: PersonRow, id: string): Promise<ClipEditStart> {
  return startClipEdit(actor, id, { change: "upscale" }, "I couldn't sharpen that video. Try again.", "sharpen_failed");
}
