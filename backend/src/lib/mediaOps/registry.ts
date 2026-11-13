import { speakerAgeBand } from "@/lib/ageBand";
import { ImageEditError, editToolsStatus } from "@/lib/imageEdit";
import { roleHealth } from "@/lib/roleHealth";
import { photoUploadsAllowed } from "@/lib/chatPictures";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { kidLaneOn } from "@/lib/pictures/lane";
import type { MediaOp, MediaKind, MediaLevel, MediaRef } from "./types";
import type { PersonRow } from "@/types";
const ops = new Map<string, MediaOp>();
let loadedPictures = false;
async function ensureRegistered() {
 if (!loadedPictures) {
  await import("./picture");
  await import("./video");
  loadedPictures = true;
 }
}

export function registerMediaOp<T extends MediaOp>(op: T): T {
 if (ops.has(op.id)) throw new Error(`Media operation already registered: ${op.id}`);
 ops.set(op.id, op);
 return op;
}

/** One registered operation by id (the picture operations load on first use). */
export async function getMediaOp(id: string): Promise<MediaOp | undefined> {
 await ensureRegistered();
 return ops.get(id);
}

export function registeredMediaOps(): readonly MediaOp[] {
 return [...ops.values()];
}

function bandAllowed(actor: PersonRow, min: MediaOp["minBand"]): boolean {
 if (actor.role === "guest") return false;
 const rank = { child: 0, teen: 1, adult: 2 };
 return rank[speakerAgeBand(actor, new Date())] >= rank[min];
}

type LevelState = { enabled: boolean; reason?: string };
/** A level as listed: its words and whether it can run now (with the reason when it cannot). */
export type ListedLevel = MediaLevel & LevelState;
/** MAKE-CLEARER-01: the operation is ready when its first level is; each level also says whether it is, with the reason when it is not. */
async function availability(actor: PersonRow, op: MediaOp): Promise<{ ready: boolean; reason?: string; levels?: Record<string, LevelState> }> {
 if (!bandAllowed(actor, op.minBand)) {
  return { ready: false, reason: "This operation isn't available for this profile." };
 }
 if (op.input === "video") {
  const { videoClearerLevels } = await import("@/lib/videos/clearerLevels");
  const levels = await videoClearerLevels(actor);
  return { ready: levels.quick.enabled, ...(levels.quick.enabled ? {} : { reason: levels.quick.reason }), levels };
 }
 if (op.needs === "image") {
  const health = await roleHealth("image");
  if (health.availability !== "ready") return { ready: false, reason: health.detail ?? health.reason ?? "Picture creation isn't set up yet." };
  // Describing a change is also refused to a profile that may not make pictures (the editor's own picture gate): say so here, so the button is off with the reason.
  const comment = (await editToolsStatus(actor)).tools.comment;
  return comment.enabled ? { ready: true } : { ready: false, reason: comment.reason ?? "Picture creation isn't available for this profile." };
 }
 const status = await editToolsStatus(actor);
 if (op.id === "picture.make_clearer") {
  const { clearer } = status;
  return { ready: clearer.quick.enabled, ...(clearer.quick.enabled ? {} : { reason: clearer.quick.reason ?? status.note ?? "This operation isn't available yet." }), levels: clearer };
 }
 const key = op.id === "picture.upscale"
  ? "resize"
  : op.id === "picture.locate"
   ? (status.tools.find_subjects?.enabled ? "find_subjects" : "find_people")
   : op.id.slice("picture.".length);
 const state = status.tools[key as keyof typeof status.tools];
 return state?.enabled ? { ready: true } : { ready: false, reason: state?.reason ?? status.note ?? "This operation isn't available yet." };
}
export async function listMediaOps(actor: PersonRow, filter: { input?: MediaKind; output?: MediaKind; includeHelpers?: boolean } = {}) {
 await ensureRegistered();
 const pictureOk = photoUploadsAllowed(actor) || (laneOfPerson(actor) === "child" && kidLaneOn(actor));
 if (!pictureOk && filter.input !== "video") return [];
 const visible = [...ops.values()].filter((op) =>
  (filter.includeHelpers || op.listed !== false) &&
  (!filter.input || op.input === filter.input) && (pictureOk || op.input === "video") &&
  (!filter.output || op.output === filter.output) &&
  bandAllowed(actor, op.minBand));
 return Promise.all(visible.map(async (op) => { const state = await availability(actor, op); const { levels: states, ...rest } = state; const levels: ListedLevel[] | undefined = op.levels?.map((level) => ({ ...level, enabled: states?.[level.id]?.enabled ?? false, ...(states?.[level.id]?.reason ? { reason: states[level.id]!.reason } : {}) })); const { levels: _static, ...plain } = op; let controls = op.controls; if (op.id === "picture.angle") { const { listFragments } = await import("@/lib/media/templates"); controls = op.controls.map((control) => control.name === "angle" ? { ...control, options: listFragments({ actor, group: "angle" }).map((row) => row.title) } : control); } return { ...plain, controls, ...(levels ? { levels } : {}), ready: rest.ready, enabled: rest.ready, ...(rest.reason ? { reason: rest.reason } : {}) }; }));
}
export async function runMediaOp(actor: PersonRow, id: string, input: { source: MediaRef; args: unknown }, signal?: AbortSignal) {
 await ensureRegistered();
 const op = ops.get(id);
 if (!op) throw new ImageEditError(404, "Unknown media operation.", "not_found");
 if (op.input !== "video" && !photoUploadsAllowed(actor) && !(laneOfPerson(actor) === "child" && kidLaneOn(actor))) {
  throw new ImageEditError(403, "Picture editing is off for this profile.", "pictures_off");
 }
 if (!bandAllowed(actor, op.minBand)) {
  throw new ImageEditError(403, "This operation isn't available for this profile.", "forbidden");
 }
 let args: unknown;
 try { args = op.args.parse(input.args); }
 catch (error) {
  if (error instanceof Error && error.name === "ZodError") throw new ImageEditError(422, "Those arguments don't fit this picture operation.", "bad_arguments");
  throw error;
 }
 if (input.source.kind !== op.input) throw new ImageEditError(422, "That source is not the right media type.", "bad_source");
 return op.run({ actor, signal }, { source: input.source, args });
}
export async function getMediaOpJob(actor: PersonRow, job: string) { const { pollEdit } = await import("@/lib/imageEdit"); return pollEdit(actor, job); }

export async function runPictureEdit(actor: PersonRow, legacy: string, input: { source: MediaRef; args: unknown }, signal?: AbortSignal) { return runMediaOp(actor, `picture.${legacy}`, input, signal); }
