// IMG-OPS-02: the one start of a picture operation addressed by Library file id. The generic route (POST /api/media-ops/{id}), the package-page action
// (POST /api/plugins/image/actions/op) and the Studio's words box all call it, so the gates are written once: the registry's own (age band, lane, photo
// uploads, child cartoon lane) run on every call inside runMediaOp, and the Library source rules (owner only, not in Trash, not locked) run in
// lib/imageEdit.ts's loadSource. Nothing here decides who may edit; it only shapes the request and the answer.
import { z } from "zod";
import { ImageEditError, editErrorFrom, type EditProgress } from "@/lib/imageEdit";
import { getMediaOp, runMediaOp } from "@/lib/mediaOps/registry";
import type { MediaOp } from "@/lib/mediaOps/types";
import type { PersonRow } from "@/types";

const MAX_MASK_BYTES = 20 * 1024 * 1024;

export const MediaOpRequest = z.object({
  file_id: z.string().min(1).max(80).describe("The Library picture to run the operation on."),
  args: z.record(z.string(), z.unknown()).optional().describe("The operation's own arguments (GET /api/media-ops gives each one's `params`)."),
  mask: z.string().max(14_000_000).nullable().optional().describe("A painted area as a base64 PNG (white is the part to change or erase). Only for an operation whose controls include a mask or that describes a change in words."),
  references: z.array(z.string().min(1).max(80)).max(2).optional().describe("Other Library pictures a described change draws on (only for picture.change)."),
});
export type MediaOpRequestBody = z.infer<typeof MediaOpRequest>;

export type MediaOpStart = { ok: true; progress: EditProgress } | { ok: false; status: number; error: string; code: string };

function shapeOf(op: MediaOp): Record<string, unknown> {
  return (op.args as unknown as { shape?: Record<string, unknown> }).shape ?? {};
}

/** The operation's arguments with the painted area and reference pictures put under the keys that operation reads (`mask` for erase, `maskPng` for a described change). */
export function withAttachments(op: MediaOp, body: Pick<MediaOpRequestBody, "args" | "mask" | "references">, chat?: { conversationId?: string }): Record<string, unknown> {
  const shape = shapeOf(op);
  const args: Record<string, unknown> = { ...(body.args ?? {}) };
  // A byte field can only arrive as base64 beside `args`, never inside it.
  delete args.mask; delete args.maskPng;
  if (body.mask) {
    const bytes = new Uint8Array(Buffer.from(body.mask, "base64"));
    if (bytes.byteLength > MAX_MASK_BYTES) throw new ImageEditError(413, "The painted area is too big. Paint a smaller area.", "too_large");
    if (bytes.byteLength === 0) throw new ImageEditError(422, "The painted area could not be read. Paint it again.", "bad_mask");
    if ("mask" in shape) args.mask = bytes;
    else if ("maskPng" in shape) args.maskPng = bytes;
    else throw new ImageEditError(422, "This tool doesn't use a painted area. Run it without one.", "mask_not_used");
  }
  if (body.references?.length) {
    if (!("references" in shape)) throw new ImageEditError(422, "This tool doesn't use a second picture. Run it without one.", "references_not_used");
    args.references = body.references.map((id) => chat ? { kind: "picture" as const, via: "chat" as const, id, ...(chat.conversationId ? { conversationId: chat.conversationId } : {}) } : { kind: "picture" as const, via: "file" as const, id });
  }
  return args;
}

/** Runs one listed picture operation on a Library picture. A fast operation answers `done` with a preview to apply; a slow one answers with a job to poll. */
export async function startLibraryOp(actor: PersonRow, opId: string, body: MediaOpRequestBody, signal?: AbortSignal): Promise<MediaOpStart> {
  try {
    const op = await getMediaOp(opId);
    // A helper (locate, save_subject) is not offered to a person, so it is not run from a page either.
    if (!op || op.listed === false || op.input !== "picture" || op.output !== "picture") throw new ImageEditError(404, "That picture operation doesn't exist. Choose one from the list.", "unknown_operation");
    const result = await runMediaOp(actor, op.id, { source: { kind: "picture", via: "file", id: body.file_id }, args: withAttachments(op, body) }, signal);
    return { ok: true, progress: ("job" in result ? result.job : result.file) as EditProgress };
  } catch (error) {
    const mapped = error instanceof ImageEditError ? error : editErrorFrom(error);
    return { ok: false, status: mapped.status, error: mapped.message, code: mapped.code };
  }
}
