// IMG-STUDIO-02: what the picture Studio page (package `image`, page `studio`) reads and calls. The kit's `image_editor` node does the drawing; this file is
// only the glue it asks the host for: the opened picture and its versions, the extra operations from the registry, and five calls (run, comment, apply,
// markup) whose answers have the shapes the kit contract names. The kit's call has no way to poll a job, so `run` waits here until the operation is done
// and answers once with the preview. Every gate is the one the generic routes use (registry gates in runMediaOp, source rules in loadSource); nothing here
// decides who may edit.
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { fileLockState } from "@/lib/adultLock";
import { ImageEditError, LIBRARY_SOURCE, applyPreview, cancelEdit, editErrorFrom, listVersions, loadSource, readPicture, pollEdit, saveUploadedVersion, type EditProgress, type PictureVersion } from "@/lib/imageEdit";
import { listLibrary } from "@/lib/library";
import { MediaOpRequest, startLibraryOp } from "@/lib/mediaOps/http";
import { listMediaOps } from "@/lib/mediaOps/registry";
import type { PersonRow } from "@/types";

/** Operations the editor's own tool rail already draws. Everything else the registry lists goes under More. */
const BUILT_IN = new Set(["picture.remove_background", "picture.erase", "picture.resize", "picture.crop", "picture.adjust", "picture.rotate", "picture.flip", "picture.change"]);
/** The editor's own tools and the registry operation each one needs: the readiness rows `studio-tools` answers with, so a tool whose engine is not ready is drawn disabled before a click (EDITOR-TOOLS-READY). */
const TOOL_OF: Record<string, string> = { "picture.remove_background": "remove_background", "picture.erase": "erase", "picture.resize": "resize", "picture.crop": "crop", "picture.adjust": "adjust", "picture.change": "comment" };
/** The one line shown when a tool is off and the reason the registry kept is a machine word ("failed_start"), not a sentence: the same words the Make pages use while pictures are not ready (RULES S6). */
export const PICTURES_NOT_READY_LINE = "Pictures are not ready yet. Try again in a minute.";
const plainReason = (reason: string | undefined): string => (reason && /\s/.test(reason.trim()) && reason.trim().length >= 12 ? reason : PICTURES_NOT_READY_LINE);

const WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 700;
const MAX_MARKUP_BYTES = 40 * 1024 * 1024;

const nameRow = (id: string): string | undefined => db.select({ name: attachments.name }).from(attachments).where(eq(attachments.id, id)).get()?.name?.trim() || undefined;
/** The name of the picture the person opened: an edited version has no name of its own, so the name is the root picture's, then the opened one's. */
const nameOf = (rootId: string, id: string): string => nameRow(rootId) ?? nameRow(id) ?? "Picture";
const missing = (id: unknown) => typeof id !== "string" || id === "" || id.startsWith("$");

function fail(error: unknown): never {
  throw error instanceof ImageEditError ? error : editErrorFrom(error);
}

/** What the person is told when an edit was saved behind their Adult lock: the new version cannot be shown to them until they unlock it in the Library. */
export const STUDIO_SAVED_LOCKED_NOTE = "Saved to your Library behind your Adult lock. Unlock it there to keep editing it.";

/** The reply of Apply or Markup: the new version, and when it was saved locked for this person (so its picture cannot load here) `locked` and the plain line. */
function versionReply(person: PersonRow, version: PictureVersion) {
  const base = { id: version.id, url: version.url, label: version.label, width: version.width, height: version.height, created_at: version.created_at };
  return fileLockState(person, version.id) === "open" ? base : { ...base, locked: true, note: STUDIO_SAVED_LOCKED_NOTE };
}

/**
 * The opened picture as the `image_editor` node reads it: one row with its versions. A locked picture is a locked row (the node draws a lock tile and reads nothing else).
 * With no picture chosen the answer is no row when the person has pictures to pick from (the page's picker shows), and one placeholder row (`empty`) when they have none
 * (the page draws its own empty state with what to do next).
 */
export async function studioRows(person: PersonRow, input: { id?: unknown }): Promise<Array<Record<string, unknown>>> {
  if (missing(input.id)) return studioPickerRows(person, {}).length === 0 ? [{ id: "", empty: true }] : [];
  const id = String(input.id);
  try {
    const source = loadSource(person, LIBRARY_SOURCE, id, false);
    const versions = await Promise.all(listVersions(person, LIBRARY_SOURCE, id).map((v) => sized(person, v)));
    const shown = versions.find((v) => v.id === id);
    return [{ id, title: nameOf(source.rootId, id), url: `/api/media-ops/files/${encodeURIComponent(id)}/content`, width: shown?.width ?? null, height: shown?.height ?? null, locked: false, root: source.rootId, versions: versions.map(versionRow) }];
  } catch (error) {
    const mapped = error instanceof ImageEditError ? error : editErrorFrom(error);
    if (mapped.status === 423) return [{ id, title: "Locked picture", locked: true }];
    throw mapped;
  }
}

/** The first picture of a chain (an upload, a made picture) carries no size in its note, and the editor's Compare must know every size to pair like with like: read it from the file. */
async function sized(person: PersonRow, v: PictureVersion): Promise<PictureVersion> {
  if (v.width && v.height) return v;
  try {
    const meta = await sharp(readPicture(person, LIBRARY_SOURCE, v.id).bytes).metadata();
    return meta.width && meta.height ? { ...v, width: meta.width, height: meta.height } : v;
  } catch {
    return v;
  }
}

function versionRow(v: PictureVersion) {
  return { id: v.id, url: v.url, label: v.label, created_at: v.created_at, width: v.width, height: v.height };
}

/** The registry's extra operations (Blur background and whatever is added later), with the reason a disabled one keeps. */
export async function studioOperationRows(person: PersonRow, input: { id?: unknown }): Promise<Array<Record<string, unknown>>> {
  let blocked: string | null = null;
  if (!missing(input.id)) {
    try { loadSource(person, LIBRARY_SOURCE, String(input.id), false); }
    catch (error) { const mapped = error instanceof ImageEditError ? error : editErrorFrom(error); if (mapped.status !== 404) blocked = mapped.message; }
  }
  const ops = await listMediaOps(person, { input: "picture", output: "picture" });
  // One row per built-in tool, `{ tool, enabled, reason }`: the kit draws that tool off from the start with the reason (and keeps it out of More).
  const toolRows = ops.filter((op) => TOOL_OF[op.id]).map((op) => ({
    id: op.id,
    tool: TOOL_OF[op.id]!,
    enabled: blocked ? false : op.enabled,
    ...(blocked ? { reason: blocked } : !op.enabled ? { reason: plainReason(op.reason) } : {}),
  }));
  const extra = ops.filter((op) => !BUILT_IN.has(op.id)).map((op) => ({
    id: op.id,
    label: op.label,
    summary: op.summary,
    ...(op.levels ? { levels: op.levels } : {}),
    controls: op.controls.flatMap((control): Array<Record<string, unknown>> => {
      const c = control as { kind: string; name: string; label: string; min?: number; max?: number; options?: string[] };
      if (c.kind === "number" && typeof c.min === "number" && typeof c.max === "number") return [{ kind: "number" as const, name: c.name, label: c.label, min: c.min, max: c.max }];
      if (c.kind === "choice" && Array.isArray(c.options)) return [{ kind: "choice" as const, name: c.name, label: c.label, options: c.options }];
      return [];
    }),
    enabled: blocked ? false : op.enabled,
    ...(blocked ? { reason: blocked } : !op.enabled ? { reason: plainReason(op.reason) } : {}),
  }));
  return [...toolRows, ...extra];
}

/** The person's own Library pictures, newest first: the picker shown when no picture is open. */
export function studioPickerRows(person: PersonRow, input: { id?: unknown }): Array<Record<string, unknown>> {
  if (!missing(input.id)) return [];
  return listLibrary(person, { type: "image", owner: "me", sort: "newest", limit: 60 }).items.map((file) => ({ id: file.id, title: file.name, subtitle: "", thumbnail: file.thumb_url, kind: "image", created_at: file.created_at }));
}

/** A PNG the browser drew, as a data URL, to raw base64 (the generic routes take base64 beside `args`). */
export function pngBase64(value: unknown, what: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  // The page's call leaves `{mask}` as written when the editor had nothing painted (a null is not substituted): that is no painted area, not a mask.
  if (typeof value === "string" && /^\{[a-z_]+\}$/.test(value)) return null;
  if (typeof value !== "string") throw new ImageEditError(422, `${what} could not be read. Try again.`, "bad_mask");
  const at = value.indexOf("base64,");
  return at >= 0 ? value.slice(at + 7) : value;
}

type Wanted = { opId: string; args: Record<string, unknown> };

function wantedFrom(operation: string, rawArgs: Record<string, unknown>): Wanted {
  const args = { ...rawArgs };
  delete args.mask;
  switch (operation) {
    case "crop": {
      // The rectangle is the truth; the aspect is only the preset the person chose.
      const { x, y, width, height, rotate, flip_horizontal, flip_vertical } = args as Record<string, unknown>;
      return { opId: "picture.crop", args: { x, y, width, height, ...(rotate ? { rotate } : {}), ...(flip_horizontal ? { flipHorizontal: true } : {}), ...(flip_vertical ? { flipVertical: true } : {}) } };
    }
    case "adjust": case "upscale": case "resize": case "remove_background": case "erase":
      return { opId: `picture.${operation}`, args };
    default:
      return { opId: operation.startsWith("picture.") ? operation : `picture.${operation}`, args };
  }
}

/** Waits for a started operation to finish and returns its preview. A person who closes the page stops the wait and the job. */
async function settle(person: PersonRow, progress: EditProgress, signal?: AbortSignal): Promise<{ token: string; url: string; width: number; height: number }> {
  const until = Date.now() + WAIT_MS;
  let current = progress;
  for (;;) {
    if (current.state === "done") return current.preview;
    if (current.state === "failed" || current.state === "cancelled") throw new ImageEditError(current.state === "cancelled" ? 409 : 502, current.error, current.code);
    if (current.state !== "queued" && current.state !== "running") throw new ImageEditError(502, "That did not finish. Try again.", "failed");
    if (signal?.aborted) { await cancelEdit(person, current.job); throw new ImageEditError(409, "Stopped. Nothing was changed.", "cancelled"); }
    if (Date.now() > until) { await cancelEdit(person, current.job); throw new ImageEditError(502, "That took too long and was stopped. Try again, or try a smaller change.", "timed_out"); }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    current = await pollEdit(person, current.job);
  }
}

const preview = (p: { token: string; url: string; width: number; height: number }) => ({ token: p.token, preview_url: p.url, width: p.width, height: p.height });

/** The kit's `run` handler: one operation on the open picture, answered with the preview. */
export async function studioRun(person: PersonRow, body: Record<string, unknown>, signal?: AbortSignal) {
  if (typeof body.file !== "string" || typeof body.operation !== "string") throw new ImageEditError(422, "Say which picture and which tool, then try again.", "bad_arguments");
  const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
  const wanted = wantedFrom(body.operation, args);
  const request = MediaOpRequest.safeParse({ file_id: body.file, args: wanted.args, mask: pngBase64(args.mask, "The painted area") });
  if (!request.success) throw new ImageEditError(422, "That change doesn't fit this picture. Check the numbers and try again.", "bad_arguments");
  const started = await startLibraryOp(person, wanted.opId, request.data, signal);
  if (!started.ok) throw new ImageEditError(started.status as ImageEditError["status"], started.error, started.code);
  return preview(await settle(person, started.progress, signal));
}

/** The kit's `comment` handler: a described change, whole picture or the painted area, with an optional second picture. */
export async function studioComment(person: PersonRow, body: Record<string, unknown>, signal?: AbortSignal) {
  if (typeof body.file !== "string" || typeof body.prompt !== "string" || !body.prompt.trim()) throw new ImageEditError(422, "Say what to change, then send it.", "prompt_required");
  const region = body.region && typeof body.region === "object" ? body.region : null;
  const reference = body.reference && typeof body.reference === "object" && typeof (body.reference as { id?: unknown }).id === "string" ? [(body.reference as { id: string }).id] : undefined;
  const request = MediaOpRequest.safeParse({ file_id: body.file, args: { prompt: body.prompt.trim(), ...(region ? { region } : {}) }, mask: pngBase64(body.mask, "The painted area"), ...(reference ? { references: reference } : {}) });
  if (!request.success) throw new ImageEditError(422, "That change doesn't fit this picture. Check your words and try again.", "bad_arguments");
  const started = await startLibraryOp(person, "picture.change", request.data, signal);
  if (!started.ok) throw new ImageEditError(started.status as ImageEditError["status"], started.error, started.code);
  return { message: "Here is the change. Apply it to keep it, or discard it.", preview: preview(await settle(person, started.progress, signal)) };
}

/** The kit's `apply` handler: the previewed result becomes a new version of the picture. */
export async function studioApply(person: PersonRow, body: Record<string, unknown>) {
  if (typeof body.token !== "string" || body.token === "") throw new ImageEditError(422, "That result expired. Run the tool again.", "expired");
  try {
    return versionReply(person, await applyPreview(person, body.token, typeof body.label === "string" ? body.label : undefined));
  } catch (error) { return fail(error); }
}

/** The kit's `markup` handler: the flattened drawing as a new version. */
export async function studioMarkup(person: PersonRow, body: Record<string, unknown>) {
  if (typeof body.file !== "string") throw new ImageEditError(422, "Say which picture to save the markup on, then try again.", "bad_arguments");
  const base64 = pngBase64(body.png, "The markup");
  if (!base64) throw new ImageEditError(422, "There is no markup to save. Draw something first.", "bad_arguments");
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.byteLength === 0) throw new ImageEditError(422, "The markup could not be read. Try again.", "bad_mask");
  if (bytes.byteLength > MAX_MARKUP_BYTES) throw new ImageEditError(413, "The markup is too big. Try a smaller picture.", "too_large");
  try {
    return versionReply(person, await saveUploadedVersion(person, LIBRARY_SOURCE, body.file, bytes, "Markup"));
  } catch (error) { return fail(error); }
}
