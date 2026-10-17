// VIDEO-GEN-05: Home's calls to the Stack's video engine (docs/design/video-generation-2026-10-17.md, section 12,
// and the Stack's own routes under /v1/videos and /stack/v1/video). One module, loopback only (the Stack's URL
// setting already guarantees it). The prompt and the reference picture travel in bodies and are never logged or
// put in an error message (rule 6a). A test replaces `fetch` with `__setVideosFetchForTests`.
import { getStackUrl } from "@/lib/stackEngine";

export type StackVideoState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface StackClip {
  url?: string;
  poster_url?: string;
  content_type?: string;
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  seconds?: number;
  seed?: number;
  model?: string;
  mode?: string;
  lora_ids?: string[];
  ms?: number;
  bytes?: number;
  poster_bytes?: number;
}

export interface StackVideoJob {
  job: string;
  state: StackVideoState;
  phase: string | null;
  progress: number;
  phase_progress: number | null;
  position: number | null;
  error: string | null;
  code: string | null;
  data: StackClip[];
}

export interface StackVideoStatus {
  state: "unsupported" | "off" | "not-installed" | "needs-setup" | "building" | "idle" | "running";
  phase: string | null;
  available: boolean;
  code: string | null;
  reason: string | null;
  tier: string;
  memory?: { fits: boolean; reason: string | null; peak_gb: number };
  model?: { id: string; installed: boolean };
  limits: Record<string, number | string>;
  loras_supported: boolean;
  lora_count: number;
  audio: boolean;
  reference_images?: { generated: boolean; uploaded: boolean; reason: string };
}

export interface StackVideoLora {
  id: string;
  name: string;
  file?: string;
  sha256: string;
  bytes: number;
  rank?: number;
  base_model: string;
  licence: string;
  licence_class?: "free" | "acknowledged";
  source_url: string | null;
  classification: "all-ages" | "adult-only";
  classification_note?: string | null;
  strength_default: number;
  trigger_words: string[];
  added_by?: string | null;
  added_at: string;
}

export interface VideoBody {
  prompt: string;
  size?: string;
  seconds?: number;
  seed?: number;
  image?: string;
  image_source?: "generated";
  loras?: Array<{ id: string; strength: number }>;
  audience: "all-ages" | "adult";
  timeout_ms: number;
}

/** A refusal or failure the Stack answered with. `message` is the Stack's plain sentence (it says what to do); `code` is its machine code. */
export class StackVideoError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly job?: string) {
    super(message);
    this.name = "StackVideoError";
  }
}

let fetchForTests: typeof fetch | null = null;
/** Test seam: a function that answers the Stack's video routes. */
export function __setVideosFetchForTests(fn: typeof fetch | null): void { fetchForTests = fn; }

function baseUrl(): string {
  if (fetchForTests) return "http://127.0.0.1:1";
  const url = getStackUrl();
  if (!url) throw new StackVideoError(503, "no_stack", "The engine isn't set up on this computer yet. Ask an admin to check Settings, Engine.");
  return url.replace(/\/$/, "");
}

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const doFetch = fetchForTests ?? globalThis.fetch;
  const { timeoutMs = 15_000, ...rest } = init;
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    return await doFetch(baseUrl() + path, { ...rest, signal });
  } catch (error) {
    if (error instanceof StackVideoError) throw error;
    throw new StackVideoError(503, "unreachable", "The video engine isn't answering. Check that the engine is running, then try again.");
  }
}

async function failure(res: Response): Promise<never> {
  let body: { error?: unknown; code?: unknown; job?: unknown } = {};
  try { body = await res.json() as typeof body; } catch { /* a body that is not JSON carries no detail */ }
  const message = typeof body.error === "string" && body.error ? body.error : `The video engine answered ${res.status}.`;
  throw new StackVideoError(res.status, typeof body.code === "string" ? body.code : `http_${res.status}`, message, typeof body.job === "string" ? body.job : undefined);
}

/** Starts a clip and returns the job id at once (`timeout_ms` 1: the Stack answers 202 with the job; a clip takes over two minutes). */
export async function submitVideo(body: VideoBody): Promise<{ job: string; done: StackClip[] | null }> {
  const res = await request("/v1/videos/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 60_000 });
  if (res.status === 202 || res.status === 200) {
    const parsed = await res.json() as { job?: string; data?: StackClip[] };
    if (!parsed.job) throw new StackVideoError(502, "bad_reply", "The video engine's answer was not understood. Try again.");
    return { job: parsed.job, done: res.status === 200 && Array.isArray(parsed.data) && parsed.data.length > 0 ? parsed.data : null };
  }
  return failure(res);
}

export async function getVideoJob(job: string): Promise<StackVideoJob> {
  const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}`, { method: "GET" });
  if (!res.ok) return failure(res);
  const body = await res.json() as Partial<StackVideoJob>;
  return {
    job: body.job ?? job,
    state: body.state ?? "running",
    phase: body.phase ?? null,
    progress: typeof body.progress === "number" ? body.progress : 0,
    phase_progress: body.phase_progress ?? null,
    position: body.position ?? null,
    error: body.error ?? null,
    code: body.code ?? null,
    data: Array.isArray(body.data) ? body.data : [],
  };
}

/** The finished clip's mp4 bytes. */
export async function fetchClip(job: string): Promise<Uint8Array> {
  const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}/video.mp4`, { method: "GET", timeoutMs: 120_000 });
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** The finished clip's JPEG poster (frame 0). */
export async function fetchPoster(job: string): Promise<Uint8Array> {
  const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}/poster.jpg`, { method: "GET", timeoutMs: 30_000 });
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** Stops a queued or running clip, or deletes a finished one's files. Best effort: the caller never fails on it. */
export async function cancelOrDeleteVideo(job: string): Promise<void> {
  try {
    const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}`, { method: "DELETE" });
    await res.arrayBuffer().catch(() => undefined);
  } catch { /* the Stack removes its own files after a day */ }
}

export async function videoStatus(): Promise<StackVideoStatus | null> {
  try {
    const res = await request("/stack/v1/video", { method: "GET", timeoutMs: 5_000 });
    if (!res.ok) return null;
    const body = await res.json() as { video?: StackVideoStatus };
    return body.video ?? null;
  } catch {
    return null;
  }
}

export async function listVideoLoras(): Promise<StackVideoLora[]> {
  const res = await request("/stack/v1/video/loras", { method: "GET", timeoutMs: 8_000 });
  if (res.status === 404) return [];
  if (!res.ok) return failure(res);
  const body = await res.json() as { loras?: StackVideoLora[] } | StackVideoLora[];
  return Array.isArray(body) ? body : Array.isArray(body.loras) ? body.loras : [];
}

export async function addVideoLora(form: FormData): Promise<StackVideoLora> {
  const res = await request("/stack/v1/video/loras", { method: "POST", body: form, timeoutMs: 600_000 });
  if (!res.ok) return failure(res);
  return await res.json() as StackVideoLora;
}

export async function updateVideoLora(id: string, patch: { name?: string; classification?: "all-ages" | "adult-only"; strength_default?: number; trigger_words?: string[] }): Promise<StackVideoLora> {
  const res = await request(`/stack/v1/video/loras/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!res.ok) return failure(res);
  return await res.json() as StackVideoLora;
}

export async function removeVideoLora(id: string): Promise<void> {
  const res = await request(`/stack/v1/video/loras/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return failure(res);
}
