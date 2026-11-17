// CREATOR-57a: one local Stack call for the H3 swap route. The Stack owns the model and job;
// Home stages only this clip, sends cast photos as multipart, and reads only this job's result.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { dataDir } from "@/lib/paths";
import { newFileId } from "@/lib/id";
import { getStackClient, isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";
import { createStackHttp } from "@/lib/stack/http";
import { stageClipForStack, type StackEditResult } from "./stackEdit";

const NOT_READY = "Swapping a face is not available on this computer yet.";
const MAX_RESULT_BYTES = 1024 * 1024 * 1024;
const http = createStackHttp({ makeError: (status, code, message) => Object.assign(new Error(message), { status, code }), noStackMessage: NOT_READY, unreachableMessage: NOT_READY, timeoutMs: 30_000 });
export const __setSwapFetchForTests = http.__setFetchForTests;
let pollMs = 500, deadlineMs = 30 * 60 * 1000;
export function __setStackSwapTimingForTests(timing: { pollMs: number; deadlineMs: number } | null): void { pollMs = timing?.pollMs ?? 500; deadlineMs = timing?.deadlineMs ?? 30 * 60 * 1000; }
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolveSleep) => { const timer = setTimeout(resolveSleep, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); resolveSleep(); }, { once: true }); });
function plain(text: unknown): string | null { const line = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : ""; return line && line.length <= 240 && !/[\\/]/.test(line) ? /[.!?]$/.test(line) ? line : `${line}.` : null; }
async function failure(res: Response): Promise<never> { let body: { error?: unknown; code?: unknown } = {}; try { body = await res.json() as typeof body; } catch { /* no body */ } const status = res.status; throw Object.assign(new Error(status === 404 ? NOT_READY : plain(body.error) ?? (status === 422 ? "The swap request could not be used." : "The swap did not finish. Try again.")), { status, code: body.code }); }

export interface StackSwapRequest { sourcePath: string; references: Array<{ bytes: Uint8Array; mediaType: string }>; description: string; size: string; startSeconds: number; seconds: number; signal?: AbortSignal; onProgress?: (progress: number, line?: string) => void }
export async function runStackSwap(input: StackSwapRequest): Promise<StackEditResult> {
  if (!isStackConfigured() || isRemoteStackSelected()) return { ok: false, code: "unavailable", line: NOT_READY };
  const staged = await stageClipForStack(input.sourcePath);
  if (!staged) return { ok: false, code: "unavailable", line: NOT_READY };
  const root = resolve(dataDir, "video-swap"), dir = join(root, newFileId());
  let jobId: string | null = null;
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 }); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const form = new FormData();
    form.set("source", new Blob([readFileSync(staged.path)], { type: "video/mp4" }), "source.mp4");
    input.references.forEach((photo, i) => form.append("references", new Blob([photo.bytes], { type: photo.mediaType }), `reference-${i + 1}.${photo.mediaType === "image/png" ? "png" : "jpg"}`));
    form.set("description", input.description); form.set("size", input.size); form.set("from_s", String(input.startSeconds)); form.set("seconds", String(input.seconds));
    let res = await http.request("/v1/videos/swap", { method: "POST", body: form, signal: input.signal, timeoutMs: 60_000 });
    if (res.status !== 200 && res.status !== 202) await failure(res);
    const submitted = await res.json() as { job?: unknown; data?: unknown };
    if (typeof submitted.job !== "string") throw new Error("bad reply");
    jobId = submitted.job;
    const deadline = Date.now() + deadlineMs; let status: { state: string; progress?: number; phase?: string | null; data?: unknown; error?: unknown; reason?: unknown } | null = res.status === 200 ? { state: "done", progress: 100, phase: "ready", data: submitted.data } : null;
    while (!status || ["queued", "running", "paused", "stalled", "waiting_for_you"].includes(String(status.state))) {
      if (input.signal?.aborted) { void http.request(`/v1/videos/swap/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined); return { ok: false, code: "cancelled", line: "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." }; }
      if (Date.now() > deadline) { void http.request(`/v1/videos/swap/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined); return { ok: false, code: "timeout", line: "I couldn't change that video. It took longer than expected. Try again with a shorter clip." }; }
      await sleep(pollMs, input.signal); if (input.signal?.aborted) continue;
      res = await http.request(`/v1/videos/swap/${encodeURIComponent(jobId)}`, { method: "GET", signal: input.signal }); if (!res.ok) await failure(res);
      status = await res.json() as typeof status;
      input.onProgress?.(Math.max(0, Math.min(100, Number(status?.progress) || 0)), plain(status?.phase) ?? undefined);
    }
    const finalStatus = status as { state: string; data?: unknown; error?: unknown; reason?: unknown };
    if (finalStatus.state !== "done") return { ok: false, code: "failed", line: plain(finalStatus.error) ?? plain(finalStatus.reason) ?? "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." };
    const output = finalStatus.data && typeof finalStatus.data === "object" ? finalStatus.data as { path?: unknown; duration_s?: unknown; width?: unknown; height?: unknown; audio_codec?: unknown; elapsed_ms?: unknown } : {};
    const path = typeof output.path === "string" ? resolve(output.path) : "";
    if (!path.startsWith(dir + sep) || !existsSync(path)) return { ok: false, code: "unreadable", line: "I couldn't change that video. The edited video could not be read back. Try again." };
    const size = statSync(path).size; if (!size || size > MAX_RESULT_BYTES) return { ok: false, code: "unreadable", line: "I couldn't change that video. The edited video could not be read back. Try again." };
    const num = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : null;
    return { ok: true, bytes: new Uint8Array(readFileSync(path)), seconds: num(output.duration_s), width: num(output.width), height: num(output.height), audio: typeof output.audio_codec === "string", ms: num(output.elapsed_ms) ?? 0 };
  } catch (error) {
    if (jobId && input.signal?.aborted) void http.request(`/v1/videos/swap/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined);
    const shaped = error as { status?: number; code?: string; message?: string };
    if (shaped.status === 404 || shaped.status === 503 && shaped.code === "not_found") return { ok: false, code: "unavailable", line: NOT_READY };
    return { ok: false, code: "failed", line: shaped.message === NOT_READY ? NOT_READY : plain(shaped.message) ?? "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." };
  } finally { staged.cleanup(); rmSync(dir, { recursive: true, force: true }); }
}
