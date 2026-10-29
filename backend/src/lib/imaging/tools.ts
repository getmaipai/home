import { fileTypeFromBuffer } from "file-type";
import type { PersonRow } from "@/types";
import { editToolsStatus } from "@/lib/imageEdit";
import { getStackClient } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";

const BUSY = "The picture tools are busy with another request. Try again in a moment.";
export interface ImageToolResult { png: Uint8Array; width: number; height: number; engine: string; model: string; ms: number }
export interface ImageToolOptions { mediaType?: string; extra?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; pollEveryMs?: number; pollTimeoutMs?: number }
export type ImageToolParams = { scale?: number | string; width?: number | string; height?: number | string; factor?: number | string; mask?: Uint8Array };
export type ImageToolSubmission = { kind: "done"; png: Uint8Array; item: { width: number; height: number; engine?: string; model?: string; ms?: number } } | { kind: "job"; job: string };
export async function submitImageTool(operation: string, bytes: Uint8Array, params: ImageToolParams = {}, options: { signal?: AbortSignal; timeoutMs?: number; mediaType?: string } = {}): Promise<ImageToolSubmission> {
  const mediaType = options.mediaType ?? (await fileTypeFromBuffer(bytes))?.mime ?? "image/png";
  const form = new FormData();
  form.append("image", new File([new Uint8Array(bytes)], "picture", { type: mediaType }));
  form.append("operation", operation);
  if (params.mask) form.append("mask", new File([new Uint8Array(params.mask)], "mask.png", { type: "image/png" }));
  for (const key of ["scale", "width", "height", "factor"] as const) if (params[key] !== undefined) form.append(key, String(params[key]));
  form.append("timeout_ms", String(options.timeoutMs ?? 150000));
  const reply = await getStackClient().imageEdit(form, { signal: options.signal });
  if (reply.kind === "done") return { kind: "done", png: new Uint8Array(Buffer.from(reply.item.b64_json, "base64")), item: reply.item };
  return { kind: "job", job: reply.job };
}
export async function fetchImageToolResult(job: string, options: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
  return getStackClient().imageEditResult(job, { signal: options.signal });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function toolMissing(operation: string): string {
  const name = operation === "remove_background" ? "background remover" : operation === "upscale" ? "upscaler" : "image tool";
  return `The ${name} isn't installed. Install it from the engine's model list, then try again.`;
}

export async function runImageTool(operation: string, bytes: Uint8Array, options: ImageToolOptions = {}): Promise<ImageToolResult> {
  try {
    const params = options.extra as ImageToolParams | undefined;
    const reply = await submitImageTool(operation, bytes, params, { mediaType: options.mediaType, signal: options.signal, timeoutMs: options.timeoutMs });
    if (reply.kind === "done") return { png: reply.png, width: reply.item.width, height: reply.item.height, engine: reply.item.engine ?? operation, model: reply.item.model ?? operation, ms: reply.item.ms ?? 0 };
    const deadline = Date.now() + (options.pollTimeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      await pause(options.pollEveryMs ?? 500);
      const job = await getStackClient().job(reply.job, { signal: options.signal });
      if (job.state === "failed") throw new Error(job.reason ?? (operation === "remove_background" ? "The background remover could not finish. Try another picture." : BUSY));
      if (job.state === "cancelled") throw new Error(operation === "remove_background" ? "The background removal was cancelled. Add the picture again to retry." : "The picture edit was cancelled.");
      if (job.state === "done") {
        const png = await fetchImageToolResult(reply.job, { signal: options.signal });
        return { png, width: 0, height: 0, engine: operation, model: operation, ms: 0 };
      }
    }
    throw new Error(operation === "remove_background" ? "The background remover took too long. Try a smaller picture." : BUSY);
  } catch (error) {
    if (error instanceof Error && !(error instanceof StackError)) throw error;
    if (error instanceof StackError && (error.kind === "unreachable" || error.kind === "offline")) throw new Error("The editing tools aren't running. Check that the engine on this computer is running, then try again.");
    if (error instanceof StackError && error.kind === "timeout") throw new Error(operation === "remove_background" ? "The background remover took too long. Try a smaller picture." : BUSY);
    throw new Error(operation === "remove_background" ? "The background remover could not finish. Check the editing tools and try again." : BUSY);
  }
}

export async function removeBackground(actor: PersonRow, bytes: Uint8Array): Promise<Uint8Array> {
  const status = await editToolsStatus(actor);
  if (!status.tools.remove_background.enabled) {
    const reason = status.tools.remove_background.reason ?? status.note ?? toolMissing("remove_background");
    throw new Error(/background remover.*isn't installed/i.test(reason) ? toolMissing("remove_background") : reason);
  }
  return (await runImageTool("remove_background", bytes, { timeoutMs: 2500 })).png;
}
export async function upscale(actor: PersonRow, bytes: Uint8Array, extra: Record<string, string> = {}): Promise<Uint8Array> {
  const status = await editToolsStatus(actor);
  if (!status.tools.resize.enabled) throw new Error(status.tools.resize.reason ?? toolMissing("upscale"));
  return (await runImageTool("upscale", bytes, { extra: { scale: "2", ...extra } })).png;
}
