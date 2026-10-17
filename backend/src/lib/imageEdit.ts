// IMGTOOLS-03/04: the picture editor's server half. The person opens a
// picture they already have (a chat attachment) in the canvas and runs a
// tool on it: remove the background, erase an object under a painted mask,
// resize or upscale (the Stack's image tools, `POST /v1/images/edits`), or
// save markup drawn in the browser. Home owns who may do this and where the
// result lives; the Stack only transforms pixels and is only ever called
// from here.
//
// Gates (rule 0): the same photo gate that governs sending a picture in
// chat (`photoUploadsAllowed`: the capability, `chat.photo_uploads`, a
// child only after a parent turned photos on) decides whether the editor
// opens at all; a picture is read only through the conversation reader
// `readAttachmentForConversation` (nobody else's attachments), and a result
// is written only into a conversation the person owns. No identity, face or
// age feature runs on these pixels.
//
// Versions (org principle 3): a result is a new attachment of the same
// conversation and turn, so nothing is lost, with its provenance spelled
// out in the File record's note: the operation, the source picture and its
// sha256, the root picture, the engine and model, and the clock stamp is
// the record's own `hlc`. Temporary chats keep versions in process memory
// only, under the temporary chat's own rules. EXIF is dropped: the Stack
// writes a bare PNG, and an uploaded markup PNG is re-encoded here.
//
// Logs: nothing here logs a picture, a mask, a name or an id (rule 6a).
import { createHash, randomBytes } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversations } from "@/db/schema";
import { newFileId } from "@/lib/id";
import { createAttachment, getTemporaryChatImage, getTemporaryChatImageForReader, listTemporaryChatImageVersions, readAttachmentForConversation, storeTemporaryChatImage } from "@/lib/attachments";
import { isTemporaryConversation } from "@/lib/conversationHistory";
import { photoUploadsAllowed } from "@/lib/chatPictures";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { checkImages, decideAgeCheck, promptHash, recordWithheld } from "@/lib/pictures/ageCheck";
import { mentionsSexualWord } from "@/lib/pictures/minorLine";
import { asksToUndress, pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt, type PictureAudience } from "@/lib/pictures/policy";
import { cancelOrDelete, fetchPicture, getGenerationJob, StackPicturesError, submitEdit } from "@/lib/pictures/stack";
import { pictureEngineStatus } from "@/lib/pictures/ready";
import { speakerAgeBand } from "@/lib/ageBand";
import { prepareEditSource } from "@/lib/pictures/editSources";
import { MANY_PEOPLE_LINE } from "@/lib/likeness/apply";
import { likenessStillAllowed, type JobLikeness } from "@/lib/likeness/guard";
import { recordLikenessUse } from "@/lib/likeness/uses";
import { StackError } from "@/lib/stack/errors";
import type { StackImageToolsStatus } from "@/lib/stack/client";
import type { PersonRow } from "@/types";

export class ImageEditError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 500 | 502 | 503, message: string, readonly code = "failed") { super(message); }
}

export const EDIT_OPERATIONS = ["remove_background", "erase", "upscale", "resize"] as const;
export type EditOperation = typeof EDIT_OPERATIONS[number];
/** The change a Comment asks for in words (the Stack's generative edit, IMGGEN-EDITOR-01). */
export type AnyEditOp = EditOperation | "comment";
/** An operation, a comment or `markup` (drawn in the browser, saved through the upload route). */
export type EditProvenanceOp = AnyEditOp | "markup";

/** The most pixels Home accepts for a saved markup picture (the Stack's own resize output limit). */
const MAX_SAVED_PIXELS = 36_000_000;
const PREVIEW_TTL_MS = 10 * 60_000;
const PREVIEWS_PER_PERSON = 6;
const JOB_TTL_MS = 60 * 60_000;
/** How long the first answer waits before the edit continues as a job the browser polls (fast tools finish inside it). */
export const EDIT_WAIT_MS = 2500;

export const PICTURES_OFF_REASON = "Picture editing is off for this profile. A parent can turn pictures on in settings.";
export const COMMENT_NOT_SET_UP = "Picture creation isn't set up yet. Describing a change needs a picture-making model that is installed and running on this computer. An admin can check Settings, Pictures and videos.";

// ---------------------------------------------------------------- tools status

export interface EditToolState { enabled: boolean; reason?: string }
export type EditToolKey = "markup" | "comment" | "remove_background" | "erase" | "resize";
export interface EditToolsStatus {
  state: "ready" | "preparing" | "not_installed" | "unavailable" | "off";
  /** One plain line for the editor to show, or null when everything is ready. */
  note: string | null;
  tools: Record<EditToolKey, EditToolState>;
  /** Megapixels each Stack tool accepts, for wording a refusal before it happens. */
  limits: Record<string, number>;
}

let toolsStatusForTests: StackImageToolsStatus | null | undefined;
let imageEngineForTests: boolean | undefined;
/** Test seam: the Stack's tools answer (null = the Stack has no such route) and whether it reports a picture-making engine. */
export function __setImageToolsForTests(status: StackImageToolsStatus | null | undefined, imageEngine?: boolean): void { toolsStatusForTests = status; imageEngineForTests = imageEngine; }

/** The editor's own audience: the signed-in person on the web chat screen. */
function editorAudience(actor: PersonRow): PictureAudience {
  return { actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false };
}

/** Whether Comment can change a picture in words for this person: they may make pictures at all (an adult on their own screen) and the Stack reports a generative edit model. */
async function commentState(actor: PersonRow): Promise<EditToolState> {
  const denial = pictureDenial(editorAudience(actor));
  if (denial) return { enabled: false, reason: PICTURE_DENIAL_LINE[denial] };
  if (imageEngineForTests !== undefined) return imageEngineForTests ? { enabled: true } : { enabled: false, reason: COMMENT_NOT_SET_UP };
  const status = await pictureEngineStatus().catch(() => null);
  if (status?.edit?.generative && status.available !== false) return { enabled: true };
  return { enabled: false, reason: COMMENT_NOT_SET_UP };
}

function off(reason: string): Record<EditToolKey, EditToolState> {
  return { markup: { enabled: false, reason }, comment: { enabled: false, reason }, remove_background: { enabled: false, reason }, erase: { enabled: false, reason }, resize: { enabled: false, reason } };
}

export async function editToolsStatus(actor: PersonRow): Promise<EditToolsStatus> {
  if (!photoUploadsAllowed(actor)) return { state: "off", note: PICTURES_OFF_REASON, tools: off(PICTURES_OFF_REASON), limits: {} };
  const comment: EditToolState = await commentState(actor);
  const withStackDown = (note: string, state: EditToolsStatus["state"]): EditToolsStatus => ({ state, note, tools: { ...off(note), markup: { enabled: true }, comment }, limits: {} });
  if (toolsStatusForTests === undefined && !isStackConfigured()) return withStackDown("Editing tools aren't available: no editing engine is set up on this computer.", "unavailable");
  let status: StackImageToolsStatus | null;
  try {
    status = toolsStatusForTests !== undefined ? toolsStatusForTests : await getStackClient().imageTools();
  } catch (error) {
    // An older Stack answers 404 for a route it does not have: the tools are not installed there.
    if (error instanceof StackError && error.status === 404) return withStackDown("Editing tools aren't installed. The engine on this computer needs its next update to add them.", "not_installed");
    return withStackDown("Editing tools aren't reachable right now. Check that the engine is running, then try again.", "unavailable");
  }
  if (!status) return withStackDown("Editing tools aren't installed. The engine on this computer needs its next update to add them.", "not_installed");
  if (status.state === "unsupported") {
    const why = status.reason ? ` ${status.reason}` : "";
    return withStackDown(`Editing tools aren't installed on this computer.${why}`.trim(), "not_installed");
  }
  const limits = status.limits;
  const preparing = status.state === "building";
  const prepareReason = "Getting the editing tools ready. This takes a few minutes the first time.";
  const needs = (key: string, fallbackOk: boolean, what: string): EditToolState => {
    if (preparing) return { enabled: false, reason: prepareReason };
    if (status!.models[key] === true || fallbackOk) return { enabled: true };
    return { enabled: false, reason: `${what} isn't installed yet. Install the editing models from the engine's model list, then try again.` };
  };
  const tools: Record<EditToolKey, EditToolState> = {
    markup: { enabled: true },
    comment,
    remove_background: needs("isnet", status.vision, "The background remover"),
    erase: needs("lama", false, "The eraser"),
    resize: preparing ? { enabled: false, reason: prepareReason } : { enabled: true },
  };
  if (preparing) return { state: "preparing", note: status.phase ? `Getting the editing tools ready (${status.phase}).` : "Getting the editing tools ready.", tools, limits };
  if (status.state === "needs-setup") return { state: "ready", note: "The first edit takes a few minutes while the editing tools get ready.", tools, limits };
  return { state: "ready", note: null, tools, limits };
}

// ---------------------------------------------------------------- sources and versions

export interface SourcePicture {
  id: string;
  conversationId: string;
  temporary: boolean;
  /** The turn the picture belongs to (stored chats), where new versions attach. */
  turnId: string | null;
  mediaType: string;
  name: string;
  bytes: Uint8Array;
  sha256: string;
  /** The first picture this chain of edits started from. */
  rootId: string;
}

const EDIT_NOTE = "image-edit:";
export interface EditProvenance { v: 1; op: EditProvenanceOp; label: string; source: string; source_sha256: string; root: string; engine?: string; model?: string; ms?: number; width: number; height: number }

function parseProvenance(note: string): EditProvenance | null {
  if (!note.startsWith(EDIT_NOTE)) return null;
  try {
    const value = JSON.parse(note.slice(EDIT_NOTE.length)) as EditProvenance;
    return value && value.v === 1 && typeof value.root === "string" ? value : null;
  } catch { return null; }
}

function sha(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** Reads a picture the actor may see (the conversation reader's rule). `write` also requires the conversation to be theirs. */
export function loadSource(actor: PersonRow, conversationId: string, id: string, write: boolean): SourcePicture {
  if (!photoUploadsAllowed(actor)) throw new ImageEditError(403, PICTURES_OFF_REASON, "pictures_off");
  const gone = new ImageEditError(404, "That picture isn't available. Open it from the chat again.", "not_found");
  if (isTemporaryConversation(conversationId) || getTemporaryChatImageForReader(actor, conversationId, id)) {
    const image = write ? getTemporaryChatImage(actor, conversationId, id) : getTemporaryChatImageForReader(actor, conversationId, id);
    if (!image || !image.mediaType.startsWith("image/")) throw gone;
    return { id, conversationId, temporary: true, turnId: null, mediaType: image.mediaType, name: image.name, bytes: image.bytes, sha256: sha(image.bytes), rootId: image.edit?.root ?? image.id };
  }
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row || row.conversationId !== conversationId || !row.mediaType.startsWith("image/")) throw gone;
  const read = readAttachmentForConversation(actor, conversationId, id);
  if (!read.ok) throw gone;
  if (write) {
    const conversation = db.select({ personId: conversations.personId }).from(conversations).where(eq(conversations.id, conversationId)).get();
    if (!conversation || conversation.personId !== actor.id) throw new ImageEditError(403, "You can edit pictures from your own chats. Save a copy of this one first.", "not_yours");
  }
  const provenance = parseProvenance(row.provenance);
  return { id, conversationId, temporary: false, turnId: row.turnId, mediaType: row.mediaType, name: row.provenance.replace(/^composer:/, "").slice(0, 120) || "picture", bytes: read.value.bytes, sha256: row.sha256, rootId: provenance?.root ?? row.id };
}

export interface PictureVersion { id: string; url: string; label: string; created_at: string; op: EditProvenanceOp | "original"; width: number | null; height: number | null; media_type: string; source: string | null; source_sha256: string | null }

export function pictureUrl(conversationId: string, id: string): string {
  return `/api/image-edit/pictures/${encodeURIComponent(id)}?conversation_id=${encodeURIComponent(conversationId)}`;
}

/** Every version of the picture's chain, oldest first, the original first. */
export function listVersions(actor: PersonRow, conversationId: string, id: string): PictureVersion[] {
  const source = loadSource(actor, conversationId, id, false);
  const versions: PictureVersion[] = [];
  if (source.temporary) {
    const root = getTemporaryChatImageForReader(actor, conversationId, source.rootId);
    if (root) versions.push({ id: root.id, url: pictureUrl(conversationId, root.id), label: "Original", created_at: new Date(root.createdAt).toISOString(), op: "original", width: root.width, height: root.height, media_type: root.mediaType, source: null, source_sha256: null });
    for (const image of listTemporaryChatImageVersions(actor, conversationId, source.rootId)) {
      versions.push({ id: image.id, url: pictureUrl(conversationId, image.id), label: image.edit!.label, created_at: new Date(image.createdAt).toISOString(), op: image.edit!.op as EditProvenanceOp, width: image.width, height: image.height, media_type: image.mediaType, source: image.edit!.source, source_sha256: image.edit!.source_sha256 });
    }
    return versions;
  }
  const root = db.select().from(attachments).where(eq(attachments.id, source.rootId)).get();
  if (root && root.conversationId === conversationId) versions.push({ id: root.id, url: pictureUrl(conversationId, root.id), label: "Original", created_at: root.createdAt, op: "original", width: null, height: null, media_type: root.mediaType, source: null, source_sha256: null });
  const rows = db.select().from(attachments).where(and(eq(attachments.conversationId, conversationId), like(attachments.provenance, `${EDIT_NOTE}%`))).all();
  const chain = rows.map((row) => ({ row, p: parseProvenance(row.provenance) })).filter((entry): entry is { row: typeof entry.row; p: EditProvenance } => entry.p !== null && entry.p.root === source.rootId);
  chain.sort((a, b) => (a.row.createdAt === b.row.createdAt ? a.row.hlc.localeCompare(b.row.hlc) : a.row.createdAt.localeCompare(b.row.createdAt)));
  for (const { row, p } of chain) versions.push({ id: row.id, url: pictureUrl(conversationId, row.id), label: p.label, created_at: row.createdAt, op: p.op, width: p.width, height: p.height, media_type: row.mediaType, source: p.source, source_sha256: p.source_sha256 });
  return versions;
}

/** The bytes of a picture for the editor's stage (any image type the editor saved). */
export function readPicture(actor: PersonRow, conversationId: string, id: string): { bytes: Uint8Array; mediaType: string } {
  const source = loadSource(actor, conversationId, id, false);
  return { bytes: source.bytes, mediaType: source.mediaType };
}

/** Writes a PNG as the next version of `source`'s chain. The bytes are re-encoded here (metadata dropped), never trusted as sent. */
export async function saveVersion(actor: PersonRow, source: SourcePicture, png: Uint8Array, meta: { op: EditProvenanceOp; label: string; engine?: string; model?: string; ms?: number }): Promise<PictureVersion> {
  let clean: Buffer;
  let info: OutputInfo;
  try {
    const detected = await fileTypeFromBuffer(png);
    if (!detected || !["image/png", "image/jpeg", "image/webp"].includes(detected.mime)) throw new Error("not a picture");
    ({ data: clean, info } = await sharp(png, { limitInputPixels: MAX_SAVED_PIXELS, failOn: "error" }).png().toBuffer({ resolveWithObject: true }));
  } catch {
    throw new ImageEditError(422, "That picture could not be read. Try the edit again.", "bad_image");
  }
  const bytes = new Uint8Array(clean);
  const provenance: EditProvenance = { v: 1, op: meta.op, label: meta.label.slice(0, 80), source: source.id, source_sha256: source.sha256, root: source.rootId, ...(meta.engine ? { engine: meta.engine } : {}), ...(meta.model ? { model: meta.model } : {}), ...(meta.ms !== undefined ? { ms: meta.ms } : {}), width: info.width, height: info.height };
  if (source.temporary) {
    const id = newFileId();
    storeTemporaryChatImage({ id, turnId: `edit-${source.rootId}`, conversationId: source.conversationId, ownerPersonId: actor.id, name: source.name, mediaType: "image/png", width: info.width, height: info.height, bytes, edit: provenance });
    return { id, url: pictureUrl(source.conversationId, id), label: provenance.label, created_at: new Date().toISOString(), op: meta.op, width: info.width, height: info.height, media_type: "image/png", source: source.id, source_sha256: source.sha256 };
  }
  if (!source.turnId) throw new ImageEditError(404, "That picture isn't available. Open it from the chat again.", "not_found");
  const created = createAttachment(actor, { conversationId: source.conversationId, turnId: source.turnId, mediaType: "image/png", bytes, provenance: `${EDIT_NOTE}${JSON.stringify(provenance)}`, deduplicate: false });
  if (!created.ok) throw new ImageEditError(created.status === 403 ? 403 : created.status === 404 ? 404 : 500, created.status === 403 ? created.error : "The edited picture could not be saved. Try again.", created.status === 403 ? "storage_full" : "save_failed");
  return { id: created.value.id, url: pictureUrl(source.conversationId, created.value.id), label: provenance.label, created_at: created.value.created_at, op: meta.op, width: info.width, height: info.height, media_type: "image/png", source: source.id, source_sha256: source.sha256 };
}

// ---------------------------------------------------------------- running a Stack edit

interface Preview { token: string; personId: string; png: Uint8Array; width: number; height: number; op: AnyEditOp; engine?: string; model?: string; ms?: number; sourceId: string; conversationId: string; createdAt: number; /** LIKENESS-01: the edit shows this household adult; their agreement is checked again when the preview is applied. */ likeness?: JobLikeness }
const previews = new Map<string, Preview>();
interface EditJob { personId: string; sourceId: string; conversationId: string; op: AnyEditOp; createdAt: number; finalising?: Promise<PreviewInfo>; /** A Comment: the job lives on the picture engine (/v1/images/generations/{job}), not the editing tools. */ generative?: boolean; /** The words carry a sexual or nudity word: the finished picture is checked as an adult-only one. */ adultOnly?: boolean; /** A hash of the words, for the safety log; never the words. */ promptHash?: string; /** LIKENESS-01: the photo shows this household adult; checked again on every poll and when the preview is applied. */ likeness?: JobLikeness }
const jobs = new Map<string, EditJob>();

export interface PreviewInfo { token: string; url: string; width: number; height: number; operation: AnyEditOp; engine: string | null; model: string | null; ms: number | null; transparent: boolean }
export type EditProgress =
  | { state: "done"; preview: PreviewInfo }
  | { state: "queued" | "running"; job: string; percent: number | null; label: string }
  | { state: "failed" | "cancelled"; error: string; code: string };

function sweep(now = Date.now()): void {
  for (const [token, value] of previews) if (now - value.createdAt > PREVIEW_TTL_MS) previews.delete(token);
  for (const [id, value] of jobs) if (now - value.createdAt > JOB_TTL_MS) jobs.delete(id);
}

function keepPreview(actor: PersonRow, source: SourcePicture, op: AnyEditOp, png: Uint8Array, item: { width: number; height: number; engine?: string; model?: string; ms?: number; likeness?: JobLikeness }): PreviewInfo {
  sweep();
  const mine = [...previews.values()].filter((value) => value.personId === actor.id).sort((a, b) => a.createdAt - b.createdAt);
  for (const old of mine.slice(0, Math.max(0, mine.length - (PREVIEWS_PER_PERSON - 1)))) previews.delete(old.token);
  const token = `prev-${randomBytes(12).toString("hex")}`;
  previews.set(token, { token, personId: actor.id, png, width: item.width, height: item.height, op, engine: item.engine, model: item.model, ms: item.ms, sourceId: source.id, conversationId: source.conversationId, createdAt: Date.now(), ...(item.likeness ? { likeness: item.likeness } : {}) });
  return { token, url: `/api/image-edit/previews/${token}`, width: item.width, height: item.height, operation: op, engine: item.engine ?? null, model: item.model ?? null, ms: item.ms ?? null, transparent: op === "remove_background" };
}

/** A Stack refusal or failure in the person's words: the Stack's own sentence says what happened and what to do. */
export function editErrorFrom(error: unknown): ImageEditError {
  if (error instanceof ImageEditError) return error;
  if (error instanceof StackError) {
    let code = "failed";
    try { const parsed = error.body ? JSON.parse(error.body) as { code?: string } : null; if (parsed?.code) code = parsed.code; } catch { /* the body was not JSON */ }
    if (error.kind === "unreachable" || error.kind === "offline") return new ImageEditError(503, "The editing tools aren't running. Check that the engine on this computer is running, then try again.", "unavailable");
    if (error.kind === "timeout") return new ImageEditError(502, "The editing tools took too long. Try a smaller picture.", "timeout");
    if (error.kind === "cancelled") return new ImageEditError(409, "The edit was cancelled.", "cancelled");
    const status = error.status;
    if (status === 413) return new ImageEditError(413, error.message, code);
    if (status === 422) return new ImageEditError(422, error.message, code);
    if (status === 503 || status === 507) return new ImageEditError(503, error.message, code);
    return new ImageEditError(502, error.message || "The editing tools could not finish this edit. Try again.", code);
  }
  return new ImageEditError(500, "The edit could not be finished. Try again.", "failed");
}

export interface StartEditInput { operation: EditOperation; mask?: Uint8Array; scale?: number; width?: number; height?: number; factor?: number }

/** Sends a picture to the Stack's image tools. Fast tools answer at once; slow ones continue as a job the browser polls. */
export async function startEdit(actor: PersonRow, conversationId: string, id: string, input: StartEditInput, signal?: AbortSignal): Promise<EditProgress> {
  const source = loadSource(actor, conversationId, id, true);
  if (input.operation === "erase" && (!input.mask || input.mask.byteLength === 0)) throw new ImageEditError(422, "Paint over what you want gone, then press Erase.", "mask_empty");
  const status = await editToolsStatus(actor);
  const tool: EditToolKey = input.operation === "remove_background" ? "remove_background" : input.operation === "erase" ? "erase" : "resize";
  if (!status.tools[tool].enabled) throw new ImageEditError(503, status.tools[tool].reason ?? status.note ?? "This tool isn't available yet.", "unavailable");
  const form = new FormData();
  form.append("image", new File([new Uint8Array(source.bytes)], "picture", { type: source.mediaType }));
  form.append("operation", input.operation);
  if (input.mask) form.append("mask", new File([new Uint8Array(input.mask)], "mask.png", { type: "image/png" }));
  if (input.scale !== undefined) form.append("scale", String(input.scale));
  if (input.width !== undefined) form.append("width", String(input.width));
  if (input.height !== undefined) form.append("height", String(input.height));
  if (input.factor !== undefined) form.append("factor", String(input.factor));
  form.append("timeout_ms", String(EDIT_WAIT_MS));
  try {
    const reply = await getStackClient().imageEdit(form, { signal });
    if (reply.kind === "done") {
      const png = new Uint8Array(Buffer.from(reply.item.b64_json, "base64"));
      return { state: "done", preview: keepPreview(actor, source, input.operation, png, reply.item) };
    }
    sweep();
    jobs.set(reply.job, { personId: actor.id, sourceId: id, conversationId, op: input.operation, createdAt: Date.now() });
    return { state: "running", job: reply.job, percent: null, label: "Working on it" };
  } catch (error) {
    throw editErrorFrom(error);
  }
}

const OP_LABEL: Record<AnyEditOp, string> = { remove_background: "Removing the background", erase: "Erasing", upscale: "Making it bigger", resize: "Resizing", comment: "Making your change" };

/** The state of a running edit; the first poll that sees it finished takes the PNG from the Stack and keeps it as a preview. */
export async function pollEdit(actor: PersonRow, jobId: string): Promise<EditProgress> {
  const job = jobs.get(jobId);
  if (!job || job.personId !== actor.id) throw new ImageEditError(404, "That edit isn't running any more. Start it again.", "not_found");
  try {
    if (job.finalising) return { state: "done", preview: await job.finalising };
    if (job.generative) return await pollComment(actor, jobId, job);
    const stack = await getStackClient().job(jobId);
    if (stack.state === "queued" || stack.state === "running" || stack.state === "paused" || stack.state === "stalled" || stack.state === "waiting_for_you") {
      return { state: stack.state === "queued" ? "queued" : "running", job: jobId, percent: stack.percent > 0 ? stack.percent : null, label: stack.position && stack.position > 1 ? `Waiting your turn (${stack.position})` : OP_LABEL[job.op] };
    }
    if (stack.state === "cancelled") { jobs.delete(jobId); return { state: "cancelled", error: "The edit was cancelled.", code: "cancelled" }; }
    if (stack.state === "failed") {
      jobs.delete(jobId);
      return { state: "failed", error: stack.reason ?? "The editing tools could not finish this edit. Try again.", code: "failed" };
    }
    // A tool that declines the picture (an empty mask, no subject found) finishes the job with a reason, not a failure.
    const outcome = stack.result as { images?: Array<{ width: number; height: number; engine?: string; model?: string; ms?: number }>; rejected?: { code: string; message: string } } | null;
    if (outcome?.rejected) { jobs.delete(jobId); return { state: "failed", error: outcome.rejected.message, code: outcome.rejected.code }; }
    const source = loadSource(actor, job.conversationId, job.sourceId, true);
    job.finalising = (async () => {
      const png = await getStackClient().imageEditResult(jobId);
      const meta = await sharp(png).metadata();
      const made = outcome?.images?.[0];
      return keepPreview(actor, source, job.op, png, { width: meta.width ?? made?.width ?? 0, height: meta.height ?? made?.height ?? 0, engine: made?.engine, model: made?.model, ms: made?.ms });
    })();
    job.finalising.catch(() => { job.finalising = undefined; });
    return { state: "done", preview: await job.finalising };
  } catch (error) {
    const mapped = editErrorFrom(error);
    return { state: "failed", error: mapped.message, code: mapped.code };
  }
}

export async function cancelEdit(actor: PersonRow, jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || job.personId !== actor.id) return;
  jobs.delete(jobId);
  if (job.generative) { await cancelOrDelete(jobId); return; }
  try { await getStackClient().cancelJob(jobId); } catch { /* it had already finished or the Stack is gone: either way nothing is running for this person */ }
}

export function readPreview(actor: PersonRow, token: string): Preview {
  sweep();
  const value = previews.get(token);
  if (!value || value.personId !== actor.id) throw new ImageEditError(404, "That preview expired. Run the edit again.", "expired");
  return value;
}

/** Apply: the previewed result becomes a new version of the picture's chain. */
export async function applyPreview(actor: PersonRow, token: string, label?: string): Promise<PictureVersion> {
  const preview = readPreview(actor, token);
  // LIKENESS-01: a preview that shows a household adult is thrown away if they took their agreement back before it was applied.
  if (preview.likeness) {
    const still = likenessStillAllowed(preview.likeness);
    if (!still.ok) { previews.delete(token); throw new ImageEditError(403, still.line, "likeness_withdrawn"); }
  }
  const source = loadSource(actor, preview.conversationId, preview.sourceId, true);
  const defaults: Record<AnyEditOp, string> = { remove_background: "Background removed", erase: "Object erased", upscale: "Enlarged", resize: "Resized", comment: "Changed as described" };
  const version = await saveVersion(actor, source, preview.png, { op: preview.op, label: label?.trim() || defaults[preview.op], engine: preview.engine, model: preview.model, ms: preview.ms });
  previews.delete(token);
  return version;
}

/** Markup (or any flattened PNG) the browser drew: saved as a new version after Home re-encodes it. */
export async function saveUploadedVersion(actor: PersonRow, conversationId: string, id: string, bytes: Uint8Array, label: string): Promise<PictureVersion> {
  const source = loadSource(actor, conversationId, id, true);
  return saveVersion(actor, source, bytes, { op: "markup", label: label.trim() || "Markup" });
}

// ---------------------------------------------------------------- Comment: a change in words (IMGGEN-EDITOR-01)

export interface CommentRegion { x: number; y: number; width: number; height: number }
export const COMMENT_NOT_READY_LINE = COMMENT_NOT_SET_UP;

function clamp01(value: number): number { return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)); }

/** The normalized x,y,w,h the Stack takes, from the editor's box. A click (no size) becomes a small box around the point; a box is kept inside the picture. */
export function regionForStack(region: CommentRegion | null | undefined): string | null {
  if (!region || ![region.x, region.y, region.width, region.height].every(Number.isFinite)) return null;
  // A box dragged right to left or bottom to top has a negative size: take its other corner.
  let x = region.width < 0 ? region.x + region.width : region.x;
  let y = region.height < 0 ? region.y + region.height : region.y;
  let width = Math.abs(region.width);
  let height = Math.abs(region.height);
  const MIN = 0.12;
  if (width < MIN) { x -= (MIN - width) / 2; width = MIN; }
  if (height < MIN) { y -= (MIN - height) / 2; height = MIN; }
  width = Math.min(width, 1);
  height = Math.min(height, 1);
  x = Math.min(clamp01(x), 1 - width);
  y = Math.min(clamp01(y), 1 - height);
  return [x, y, width, height].map((n) => Number(n.toFixed(4))).join(",");
}

/** A Comment: the person describes a change, optionally pointing at an area, and the picture engine changes only that area (the rest of the picture stays as it was). The result is a preview the person applies as a new version, exactly like Erase. Gates run first: only a person who may make pictures, and the two absolute lines on the words. */
export async function startComment(actor: PersonRow, conversationId: string, id: string, input: { prompt: string; region?: CommentRegion | null; subjectPersonId?: string | null; /** IMGEDIT-01: a painted area (white is changeable) as PNG bytes; only that area can differ. */ maskPng?: Uint8Array | null; /** IMGEDIT-01: another picture of this chat the change draws on (the person to add). */ referenceId?: string | null; referenceSubjectPersonId?: string | null }): Promise<EditProgress> {
  const source = loadSource(actor, conversationId, id, true);
  const denial = pictureDenial(editorAudience(actor));
  if (denial) throw new ImageEditError(403, PICTURE_DENIAL_LINE[denial], `pictures_${denial}`);
  const prompt = input.prompt.trim();
  if (!prompt) throw new ImageEditError(422, "Say what to change, then send it.", "prompt_required");
  const refused = refusePrompt(prompt);
  if (refused) throw new ImageEditError(422, PROMPT_REFUSAL_LINE[refused], `refused_${refused}`);
  // A picture the person did not generate here (an upload) may show a real person: it is never changed into something sexual.
  const generated = await isGeneratedPicture(actor, source);
  if (!generated && asksToUndress(prompt)) throw new ImageEditError(422, PROMPT_REFUSAL_LINE.real_person, "refused_real_person");
  const comment = await commentState(actor);
  if (!comment.enabled) throw new ImageEditError(503, comment.reason ?? COMMENT_NOT_SET_UP, "not_set_up");
  const region = regionForStack(input.region);
  // LIKENESS-01: where the picture came from decides what the Stack is told (pictures/editSources.ts, shared with the chat tool).
  const rootLikeness = generated ? await generatedPictureLikeness(source) : null;
  const prepared = await prepareEditSource({ audience: editorAudience(actor), bytes: source.bytes, generated, rootLikeness, declaredSubjectId: input.subjectPersonId ?? null, text: prompt, source: "editor" });
  if (!prepared.ok) throw new ImageEditError(prepared.status, prepared.line, prepared.code);
  const imageSource = prepared.imageSource;
  const consentProof = prepared.proof;
  const likeness = prepared.likeness;
  const subjectForLog = prepared.subjectId;
  // IMGEDIT-01: a second picture the change draws on (the person to add to the scene), decided the same way, with its own proof.
  let reference: { source: SourcePicture; prepared: Extract<Awaited<ReturnType<typeof prepareEditSource>>, { ok: true }> } | null = null;
  if (input.referenceId) {
    const referenceSource = loadSource(actor, conversationId, input.referenceId, false);
    if (referenceSource.id === source.id) throw new ImageEditError(422, "Choose a different picture to draw on than the one you are changing.", "reference_same");
    const status = await pictureEngineStatus().catch(() => null);
    if ((status?.edit?.references ?? 0) < 1) throw new ImageEditError(503, "The picture engine on this computer needs its next update before it can use a second picture.", "references_unsupported");
    const referenceGenerated = await isGeneratedPicture(actor, referenceSource);
    const referencePrepared = await prepareEditSource({ audience: editorAudience(actor), bytes: referenceSource.bytes, generated: referenceGenerated, rootLikeness: referenceGenerated ? await generatedPictureLikeness(referenceSource) : null, declaredSubjectId: input.referenceSubjectPersonId ?? null, text: prompt, source: "editor" });
    if (!referencePrepared.ok) throw new ImageEditError(referencePrepared.status, referencePrepared.line, referencePrepared.code);
    if (referencePrepared.subjectId && subjectForLog && referencePrepared.subjectId !== subjectForLog) throw new ImageEditError(422, MANY_PEOPLE_LINE, "many_people");
    reference = { source: referenceSource, prepared: referencePrepared };
  }
  const household = imageSource === "household_photo" || reference?.prepared.imageSource === "household_photo";
  const likenessAll = likeness ?? reference?.prepared.likeness;
  const form = new FormData();
  form.append("image", new File([new Uint8Array(source.bytes)], "picture", { type: source.mediaType }));
  const painted = input.maskPng && input.maskPng.byteLength > 0 ? input.maskPng : null;
  form.append("operation", region || painted ? "edit_masked" : "edit");
  form.append("instruction", prompt);
  if (painted) form.append("mask", new File([new Uint8Array(painted)], "mask.png", { type: "image/png" }));
  else if (region) form.append("region", region);
  form.append("image_source", imageSource);
  if (consentProof) form.append("consent_proof", consentProof);
  if (reference) {
    form.append("reference", new File([new Uint8Array(reference.source.bytes)], "reference", { type: reference.source.mediaType }));
    form.append("reference_source", reference.prepared.imageSource);
    if (reference.prepared.proof) form.append("reference_proof", reference.prepared.proof);
  }
  if (household) form.append("audience", "adult");
  // timeout_ms is how long the Stack holds this request for a finished picture before it answers 202 with the job id: 1 asks for the id at once, and Home polls.
  form.append("timeout_ms", "1");
  try {
    const { job } = await submitEditSource(form, imageSource, generated);
    sweep();
    jobs.set(job, { personId: actor.id, sourceId: id, conversationId, op: "comment", createdAt: Date.now(), generative: true, adultOnly: mentionsSexualWord(prompt), promptHash: promptHash(prompt), ...(likenessAll ? { likeness: likenessAll } : {}) });
    for (const subjectId of new Set([subjectForLog, reference?.prepared.subjectId ?? null])) if (subjectId) await recordLikenessUse({ subjectPersonId: subjectId, requesterPersonId: actor.id, medium: "picture", way: "photo", adultContent: false, source: "editor" });
    return { state: "running", job, percent: null, label: OP_LABEL.comment };
  } catch (error) {
    throw commentErrorFrom(error);
  }
}

function commentErrorFrom(error: unknown): ImageEditError {
  if (error instanceof ImageEditError) return error;
  if (error instanceof StackPicturesError) {
    if (error.code === "unreachable" || error.code === "no_stack") return new ImageEditError(503, "The picture engine isn't answering. Check that the engine is running, then try again.", "unavailable");
    if (error.code === "queue_full" || error.code === "no_memory") return new ImageEditError(503, error.message, error.code);
    if (error.status === 422) return new ImageEditError(422, error.message, error.code);
    if (error.status === 503) return new ImageEditError(503, error.message, error.code);
    return new ImageEditError(502, error.message, error.code);
  }
  return editErrorFrom(error);
}

/** A picture this home made is first sent as `generated` (the Stack checks its hash). A version the editor re-encoded, such as a markup, is not in the Stack's ledger: it is then sent as `uploaded`, which is true of it (Home made it from a picture it made, with no person in it). */
async function submitEditSource(form: FormData, source: "generated" | "uploaded" | "household_photo", generated: boolean): Promise<{ job: string }> {
  try {
    return await submitEdit(form);
  } catch (error) {
    if (generated && source === "generated" && error instanceof StackPicturesError && error.code === "reference_not_generated") {
      form.set("image_source", "uploaded");
      return await submitEdit(form);
    }
    throw error;
  }
}

/** The household adult a picture this home made was made to look like (its provenance records it), or null. */
export async function generatedPictureLikeness(source: SourcePicture): Promise<string | null> {
  if (source.temporary) return null;
  const row = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, source.rootId)).get();
  const note = row?.provenance ?? "";
  if (!note.startsWith("picture-gen:")) return null;
  try {
    const meta = JSON.parse(note.slice(note.indexOf(":") + 1)) as { likeness?: unknown };
    return typeof meta.likeness === "string" && meta.likeness ? meta.likeness : null;
  } catch { return null; }
}

export async function isGeneratedPicture(actor: PersonRow, source: SourcePicture): Promise<boolean> {
  if (source.temporary) return getTemporaryChatImageForReader(actor, source.conversationId, source.rootId)?.generated === true;
  const row = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, source.rootId)).get();
  return typeof row?.provenance === "string" && row.provenance.startsWith("picture-gen:");
}

async function pollComment(actor: PersonRow, jobId: string, job: EditJob): Promise<EditProgress> {
  let status;
  try {
    status = await getGenerationJob(jobId);
  } catch (error) {
    jobs.delete(jobId);
    const mapped = commentErrorFrom(error);
    return { state: "failed", error: mapped.message, code: mapped.code };
  }
  // LIKENESS-01: the person it shows can take their agreement back while the edit waits; then it is stopped and thrown away.
  if (job.likeness) {
    const still = likenessStillAllowed(job.likeness);
    if (!still.ok) { jobs.delete(jobId); void cancelOrDelete(jobId); return { state: "failed", error: still.line, code: "likeness_withdrawn" }; }
  }
  if (status.state === "queued" || status.state === "running") {
    return { state: status.state, job: jobId, percent: status.progress > 0 ? Math.min(99, Math.round(status.progress)) : null, label: status.position && status.position > 1 ? `Waiting your turn (${status.position})` : OP_LABEL.comment };
  }
  if (status.state === "cancelled") { jobs.delete(jobId); return { state: "cancelled", error: "The change was cancelled. Nothing was changed.", code: "cancelled" }; }
  if (status.state === "failed") { jobs.delete(jobId); return { state: "failed", error: status.error ?? "The picture engine could not make that change. Try again, or describe it differently.", code: status.code ?? "failed" }; }
  job.finalising = (async () => {
    // The finished picture is kept as a preview first; the engine's copy is deleted only after that worked.
    const source = loadSource(actor, job.conversationId, job.sourceId, true);
    const png = await fetchPicture(jobId, 0);
    const meta = await sharp(png).metadata();
    const made = status.data[0];
    // IMGGEN-SAFE-01: a described change is a new picture, so it passes the same finished-output check before it is kept as a preview.
    const checks = await checkImages([png], "picture");
    const decision = decideAgeCheck(checks, job.adultOnly === true, "picture");
    if (decision.action === "withhold") {
      if (decision.reason === "minor_sexual") await recordWithheld({ kind: "picture", personId: actor.id, jobId, promptHash: job.promptHash, adultOnly: job.adultOnly === true, checks });
      throw new ImageEditError(422, decision.line, `withheld_${decision.reason}`);
    }
    const kept = keepPreview(actor, source, "comment", png, { width: meta.width ?? made?.width ?? 0, height: meta.height ?? made?.height ?? 0, model: made?.model, ms: made?.ms, ...(job.likeness ? { likeness: job.likeness } : {}) });
    await cancelOrDelete(jobId);
    return kept;
  })();
  try {
    return { state: "done", preview: await job.finalising };
  } catch (error) {
    // A picture that cannot be kept ends the job here, with the engine's copy removed, instead of failing on every poll.
    jobs.delete(jobId);
    void cancelOrDelete(jobId);
    const mapped = commentErrorFrom(error);
    return { state: "failed", error: mapped.message, code: mapped.code };
  }
}

export function __resetImageEditForTests(): void { previews.clear(); jobs.clear(); toolsStatusForTests = undefined; imageEngineForTests = undefined; }
