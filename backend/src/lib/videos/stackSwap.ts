// CREATOR-57a: one local Stack call for the H3 swap route. The Stack owns the model and job;
// Home stages only this clip, sends cast photos as multipart (the route's own field names), follows the job and downloads video.mp4.
import { readFileSync } from "node:fs";
import { isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";
import { createStackHttp } from "@/lib/stack/http";
import { stageClipForStack, type StackEditResult } from "./stackEdit";

const NO_MEMORY = "I couldn't change that video. There is not enough free memory for a swap right now. Try again when chat and other creating are idle.";
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
  const started = Date.now();
  let jobId: string | null = null;
  const cancel = () => { if (jobId) void http.request(`/v1/videos/swap/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined); };
  try {
    // The Stack's swap route (POST /v1/videos/swap): `source_video`, one to three `references`, `description`, `size`, `start_seconds`, `seconds`.
    const form = new FormData();
    form.set("source_video", new Blob([readFileSync(staged.path)], { type: "video/mp4" }), "source.mp4");
    input.references.forEach((photo, i) => form.append("references", new Blob([photo.bytes], { type: photo.mediaType }), `reference-${i + 1}.${photo.mediaType === "image/png" ? "png" : photo.mediaType === "image/webp" ? "webp" : "jpg"}`));
    form.set("description", input.description); form.set("size", input.size); form.set("start_seconds", String(input.startSeconds)); form.set("seconds", String(input.seconds));
    let res = await http.request("/v1/videos/swap", { method: "POST", body: form, signal: input.signal, timeoutMs: 60_000 });
    if (!res.ok) await failure(res);
    const submitted = await res.json() as { job?: unknown; state?: unknown };
    if (typeof submitted.job !== "string") throw new Error("bad reply");
    jobId = submitted.job;
    // The route answers at once with the job and its state; progress is read from GET /v1/videos/swap/{job} until done, failed or cancelled.
    let status: { state: string; progress?: number; status?: string | null; error?: unknown } = { state: String(submitted.state ?? "running") };
    const deadline = Date.now() + deadlineMs;
    let neverStarted = true; // true while the Stack has only said it is waiting for its turn (it holds a swap until enough memory is free)
    while (["queued", "running", "stalled"].includes(status.state)) {
      if (input.signal?.aborted) { cancel(); return { ok: false, code: "cancelled", line: "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." }; }
      if (Date.now() > deadline) { cancel(); return { ok: false, code: "timeout", line: neverStarted ? NO_MEMORY : "I couldn't change that video. It took longer than expected. Try again with a shorter clip." }; }
      await sleep(pollMs, input.signal); if (input.signal?.aborted) continue;
      res = await http.request(`/v1/videos/swap/${encodeURIComponent(jobId)}`, { method: "GET", signal: input.signal }); if (!res.ok) await failure(res);
      status = await res.json() as typeof status;
      if (status.state === "running" && (Number(status.progress) > 0 || !/wait/i.test(String(status.status ?? "")))) neverStarted = false;
      input.onProgress?.(Math.max(0, Math.min(100, Number(status.progress) || 0)), plain(status.status) ?? undefined);
    }
    if (status.state !== "done") return { ok: false, code: "failed", line: plain(status.error) ?? "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." };
    res = await http.request(`/v1/videos/swap/${encodeURIComponent(jobId)}/video.mp4`, { method: "GET", signal: input.signal, timeoutMs: 120_000 });
    if (!res.ok) return { ok: false, code: "unreadable", line: "I couldn't change that video. The edited video could not be read back. Try again." };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_RESULT_BYTES) return { ok: false, code: "unreadable", line: "I couldn't change that video. The edited video could not be read back. Try again." };
    // The route returns the finished clip with the source's sound laid back; its length and size are read from the file when the clip is saved.
    return { ok: true, bytes, seconds: null, width: null, height: null, audio: true, ms: Date.now() - started };
  } catch (error) {
    if (input.signal?.aborted) cancel();
    const shaped = error as { status?: number; code?: string; message?: string };
    if (shaped.status === 404 || shaped.status === 503 && shaped.code === "not_found") return { ok: false, code: "unavailable", line: NOT_READY };
    return { ok: false, code: "failed", line: shaped.message === NOT_READY ? NOT_READY : plain(shaped.message) ?? "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." };
  } finally { staged.cleanup(); }
}
