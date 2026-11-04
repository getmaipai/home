import { speakerAgeBand } from "@/lib/ageBand";
import { ImageEditError, editToolsStatus } from "@/lib/imageEdit";
import { roleHealth } from "@/lib/roleHealth";
import { photoUploadsAllowed } from "@/lib/chatPictures";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { kidLaneOn } from "@/lib/pictures/lane";
import type { MediaOp, MediaKind, MediaRef } from "./types";
import type { PersonRow } from "@/types";
const ops = new Map<string, MediaOp>();
let loadedPictures = false;
async function ensureRegistered() { if (!loadedPictures) { await import("./picture"); loadedPictures = true; } }
export function registerMediaOp<T extends MediaOp>(op: T): T { if (ops.has(op.id)) throw new Error(`Media operation already registered: ${op.id}`); ops.set(op.id, op); return op; }
export function registeredMediaOps(): readonly MediaOp[] { return [...ops.values()]; }
function bandAllowed(actor: PersonRow, min: MediaOp["minBand"]): boolean { if (actor.role === "guest") return false; const rank = { child: 0, teen: 1, adult: 2 }; return rank[speakerAgeBand(actor, new Date())] >= rank[min]; }
async function availability(actor: PersonRow, op: MediaOp): Promise<{ ready: boolean; reason?: string }> {
 if (!bandAllowed(actor, op.minBand)) return { ready: false, reason: "This operation isn't available for this profile." };
 if (op.needs === "image") {
  const health = await roleHealth("image");
  return health.availability === "ready" ? { ready: true } : { ready: false, reason: health.detail ?? health.reason ?? "Picture creation isn't set up yet." };
 }
 const status = await editToolsStatus(actor); const key = op.id === "picture.upscale" ? "resize" : op.id.slice("picture.".length); const state = status.tools[key as keyof typeof status.tools];
 return state?.enabled ? { ready: true } : { ready: false, reason: state?.reason ?? status.note ?? "This operation isn't available yet." };
}
export async function listMediaOps(actor: PersonRow, filter: { input?: MediaKind; output?: MediaKind } = {}) { await ensureRegistered(); if (!photoUploadsAllowed(actor) && !(laneOfPerson(actor) === "child" && kidLaneOn(actor))) return []; return Promise.all([...ops.values()].filter(op => (!filter.input || op.input === filter.input) && (!filter.output || op.output === filter.output) && bandAllowed(actor, op.minBand)).map(async op => ({ ...op, ...(await availability(actor, op)) }))); }
export async function runMediaOp(actor: PersonRow, id: string, input: { source: MediaRef; args: unknown }, signal?: AbortSignal) {
 await ensureRegistered(); if (!photoUploadsAllowed(actor) && !(laneOfPerson(actor) === "child" && kidLaneOn(actor))) throw new ImageEditError(403, "Picture editing is off for this profile.", "pictures_off"); const op = ops.get(id); if (!op) throw new ImageEditError(404, "Unknown media operation.", "not_found");
 if (!bandAllowed(actor, op.minBand)) throw new ImageEditError(403, "This operation isn't available for this profile.", "forbidden");
 const args = op.args.parse(input.args); if (input.source.kind !== op.input) throw new ImageEditError(422, "That source is not the right media type.", "bad_source");
 if (input.source.via === "file") throw new ImageEditError(501, "Library file addressing is not available yet.", "not_implemented");
 return op.run({ actor, signal }, { source: input.source, args });
}
export async function getMediaOpJob(actor: PersonRow, job: string) { const { pollEdit } = await import("@/lib/imageEdit"); return pollEdit(actor, job); }

export async function runPictureEdit(actor: PersonRow, legacy: string, input: { source: MediaRef; args: unknown }, signal?: AbortSignal) { return runMediaOp(actor, `picture.${legacy}`, input, signal); }
