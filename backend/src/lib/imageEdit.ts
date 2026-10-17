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
import { StackError } from "@/lib/stack/errors";
import type { StackImageToolsStatus } from "@/lib/stack/client";
import type { PersonRow } from "@/types";

export class ImageEditError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 500 | 502 | 503, message: string, readonly code = "failed") { super(message); }
}

export const EDIT_OPERATIONS = ["remove_background", "erase", "upscale", "resize"] as const;
export type EditOperation = typeof EDIT_OPERATIONS[number];
/** An operation or `markup` (drawn in the browser, saved through the upload route). */
export type EditProvenanceOp = EditOperation | "markup";

/** The most pixels Home accepts for a saved markup picture (the Stack's own resize output limit). */
const MAX_SAVED_PIXELS = 36_000_000;
const PREVIEW_TTL_MS = 10 * 60_000;
const PREVIEWS_PER_PERSON = 6;
const JOB_TTL_MS = 60 * 60_000;
/** How long the first answer waits before the edit continues as a job the browser polls (fast tools finish inside it). */
export const EDIT_WAIT_MS = 2500;

export const PICTURES_OFF_REASON = "Picture editing is off for this profile. A parent can turn pictures on in settings.";
export const COMMENT_NOT_SET_UP = "Picture creation isn't set up yet. Describing a change needs a picture-making model, and none is installed on this computer.";

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

async function stackImageEngineReady(): Promise<boolean> {
  if (imageEngineForTests !== undefined) return imageEngineForTests;
  try {
    const { roles } = await getStackClient().roles();
    const row = roles.find((role) => role.id === "image");
    const state = row?.state.state;
    return state === "ready" || state === "loaded" || state === "installed";
  } catch { return false; }
}

function off(reason: string): Record<EditToolKey, EditToolState> {
  return { markup: { enabled: false, reason }, comment: { enabled: false, reason }, remove_background: { enabled: false, reason }, erase: { enabled: false, reason }, resize: { enabled: false, reason } };
}

export async function editToolsStatus(actor: PersonRow): Promise<EditToolsStatus> {
  if (!photoUploadsAllowed(actor)) return { state: "off", note: PICTURES_OFF_REASON, tools: off(PICTURES_OFF_REASON), limits: {} };
  const commentReady = await stackImageEngineReady().catch(() => false);
  const comment: EditToolState = commentReady ? { enabled: true } : { enabled: false, reason: COMMENT_NOT_SET_UP };
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

interface Preview { token: string; personId: string; png: Uint8Array; width: number; height: number; op: EditOperation; engine?: string; model?: string; ms?: number; sourceId: string; conversationId: string; createdAt: number }
const previews = new Map<string, Preview>();
interface EditJob { personId: string; sourceId: string; conversationId: string; op: EditOperation; createdAt: number; finalising?: Promise<PreviewInfo> }
const jobs = new Map<string, EditJob>();

export interface PreviewInfo { token: string; url: string; width: number; height: number; operation: EditOperation; engine: string | null; model: string | null; ms: number | null; transparent: boolean }
export type EditProgress =
  | { state: "done"; preview: PreviewInfo }
  | { state: "queued" | "running"; job: string; percent: number | null; label: string }
  | { state: "failed" | "cancelled"; error: string; code: string };

function sweep(now = Date.now()): void {
  for (const [token, value] of previews) if (now - value.createdAt > PREVIEW_TTL_MS) previews.delete(token);
  for (const [id, value] of jobs) if (now - value.createdAt > JOB_TTL_MS) jobs.delete(id);
}

function keepPreview(actor: PersonRow, source: SourcePicture, op: EditOperation, png: Uint8Array, item: { width: number; height: number; engine?: string; model?: string; ms?: number }): PreviewInfo {
  sweep();
  const mine = [...previews.values()].filter((value) => value.personId === actor.id).sort((a, b) => a.createdAt - b.createdAt);
  for (const old of mine.slice(0, Math.max(0, mine.length - (PREVIEWS_PER_PERSON - 1)))) previews.delete(old.token);
  const token = `prev-${randomBytes(12).toString("hex")}`;
  previews.set(token, { token, personId: actor.id, png, width: item.width, height: item.height, op, engine: item.engine, model: item.model, ms: item.ms, sourceId: source.id, conversationId: source.conversationId, createdAt: Date.now() });
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

const OP_LABEL: Record<EditOperation, string> = { remove_background: "Removing the background", erase: "Erasing", upscale: "Making it bigger", resize: "Resizing" };

/** The state of a running edit; the first poll that sees it finished takes the PNG from the Stack and keeps it as a preview. */
export async function pollEdit(actor: PersonRow, jobId: string): Promise<EditProgress> {
  const job = jobs.get(jobId);
  if (!job || job.personId !== actor.id) throw new ImageEditError(404, "That edit isn't running any more. Start it again.", "not_found");
  try {
    if (job.finalising) return { state: "done", preview: await job.finalising };
    const stack = await getStackClient().job(jobId);
    if (stack.state === "queued" || stack.state === "running" || stack.state === "paused" || stack.state === "stalled" || stack.state === "waiting_for_you") {
      return { state: stack.state === "queued" ? "queued" : "running", job: jobId, percent: stack.percent > 0 ? stack.percent : null, label: stack.position && stack.position > 1 ? `Waiting your turn (${stack.position})` : OP_LABEL[job.op] };
    }
    if (stack.state === "cancelled") { jobs.delete(jobId); return { state: "cancelled", error: "The edit was cancelled.", code: "cancelled" }; }
    if (stack.state === "failed") {
      jobs.delete(jobId);
      return { state: "failed", error: stack.reason ?? "The editing tools could not finish this edit. Try again.", code: "failed" };
    }
    const source = loadSource(actor, job.conversationId, job.sourceId, true);
    job.finalising = (async () => {
      const png = await getStackClient().imageEditResult(jobId);
      const meta = await sharp(png).metadata();
      return keepPreview(actor, source, job.op, png, { width: meta.width ?? 0, height: meta.height ?? 0 });
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
  const source = loadSource(actor, preview.conversationId, preview.sourceId, true);
  const defaults: Record<EditOperation, string> = { remove_background: "Background removed", erase: "Object erased", upscale: "Enlarged", resize: "Resized" };
  const version = await saveVersion(actor, source, preview.png, { op: preview.op, label: label?.trim() || defaults[preview.op], engine: preview.engine, model: preview.model, ms: preview.ms });
  previews.delete(token);
  return version;
}

/** Markup (or any flattened PNG) the browser drew: saved as a new version after Home re-encodes it. */
export async function saveUploadedVersion(actor: PersonRow, conversationId: string, id: string, bytes: Uint8Array, label: string): Promise<PictureVersion> {
  const source = loadSource(actor, conversationId, id, true);
  return saveVersion(actor, source, bytes, { op: "markup", label: label.trim() || "Markup" });
}

/** Describe-a-change edits belong to the picture-making model; until one is installed this answers plainly and changes nothing. */
export async function commentEdit(actor: PersonRow, conversationId: string, id: string): Promise<{ done: false; code: "not_set_up"; message: string }> {
  loadSource(actor, conversationId, id, false);
  return { done: false, code: "not_set_up", message: COMMENT_NOT_SET_UP };
}

export function __resetImageEditForTests(): void { previews.clear(); jobs.clear(); toolsStatusForTests = undefined; imageEngineForTests = undefined; }
