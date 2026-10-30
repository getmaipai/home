// IMGGEN-HOME-01: Home's calls to the Stack's picture engine (docs/design/image-engine-2026-10-17.md,
// section 9, and the Stack's own routes under /v1/images and /stack/v1/image). One module, loopback only
// (the Stack's URL setting already guarantees it). The prompt and the pictures travel in bodies and are
// never logged or put in an error message (rule 6a). A test replaces `fetch` with `__setPicturesFetchForTests`.
import { plainEngineLine } from "@/lib/pictures/plainLine";
import { getStackUrl } from "@/lib/stackEngine";
import type { StackLiveFields } from "@/lib/genLive";

export type StackPicState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface StackPic {
  url?: string;
  thumbnail_url?: string;
  b64_json?: string;
  content_type?: string;
  seed?: number;
  width?: number;
  height?: number;
  model?: string;
  steps?: number;
  ms?: number;
  lora_ids?: string[];
}

export interface StackPicJob extends StackLiveFields {
  job: string;
  state: StackPicState;
  phase: string | null;
  progress: number;
  phase_progress: number | null;
  position: number | null;
  error: string | null;
  code: string | null;
  data: StackPic[];
}

export interface StackImageStatus {
  state: "unsupported" | "off" | "not-installed" | "needs-setup" | "building" | "idle" | "running";
  phase: string | null;
  available: boolean;
  reason: string | null;
  default_model: string | null;
  models: Array<{ id: string; family?: string; label?: string; installed: boolean; default?: boolean; available?: boolean; licence?: string; loras?: boolean; edit?: boolean; steps_default?: number; peak_gb?: number; install?: { remaining_bytes: number } }>;
  lora_count?: number;
  code?: string | null;
  install?: { remaining_bytes: number };
  loras_supported: boolean;
  edit: { generative: boolean; masked: boolean; /** IMGEDIT-01: extra pictures an edit takes beside the one it changes; absent on an older Stack. */ references?: number };
  limits: { min_side?: number; max_side?: number; size_step?: number; max_n?: number; max_prompt_chars?: number; max_loras?: number; max_edit_megapixels?: number; queue_max?: number };
  idle_unload_s?: number;
  memory?: { fits: boolean; reason: string | null; peak_gb: number | null };
}

export interface StackLora {
  id: string;
  name: string;
  file?: string;
  sha256: string;
  bytes: number;
  rank?: number;
  modules?: number;
  base_model: string;
  licence: string | null;
  licence_class?: "free" | "acknowledged";
  source_url: string | null;
  classification: "all-ages" | "adult-only";
  classification_note?: string | null;
  trigger_words: string[];
  strength_default: number;
  added_by?: string | null;
  added_at: string;
}

export interface GenerationBody {
  prompt: string;
  negative_prompt?: string;
  model?: string;
  size?: string;
  n?: number;
  seed?: number;
  steps?: number;
  loras?: Array<{ id: string; scale: number }>;
  audience: "all-ages" | "adult";
  init_image?: string;
  image_source?: "generated" | "uploaded";
  strength?: number;
  timeout_ms: number;
}

/** A refusal or failure the Stack answered with. `message` is the Stack's plain sentence (it says what to do); `code` is its machine code. */
export class StackPicturesError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly job?: string) {
    super(message);
    this.name = "StackPicturesError";
  }
}

let fetchForTests: typeof fetch | null = null;
/** Test seam: a function that answers the Stack's picture routes. */
export function __setPicturesFetchForTests(fn: typeof fetch | null): void { fetchForTests = fn; }

function baseUrl(): string {
  if (fetchForTests) return "http://127.0.0.1:1";
  const url = getStackUrl();
  if (!url) throw new StackPicturesError(503, "no_stack", "The engine isn't set up on this computer yet. Ask an admin to check Settings, Engine.");
  return url.replace(/\/$/, "");
}

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const doFetch = fetchForTests ?? globalThis.fetch;
  const { timeoutMs = 15_000, ...rest } = init;
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    return await doFetch(baseUrl() + path, { ...rest, signal });
  } catch (error) {
    if (error instanceof StackPicturesError) throw error;
    throw new StackPicturesError(503, "unreachable", "The picture engine isn't answering. Check that the engine is running, then try again.");
  }
}

async function failure(res: Response): Promise<never> {
  let body: { error?: unknown; code?: unknown; job?: unknown } = {};
  try { body = await res.json() as typeof body; } catch { /* a body that is not JSON carries no detail */ }
  const message = typeof body.error === "string" && body.error ? plainEngineLine(body.error) : `The picture engine answered ${res.status}.`;
  throw new StackPicturesError(res.status, typeof body.code === "string" ? body.code : `http_${res.status}`, message, typeof body.job === "string" ? body.job : undefined);
}

/** Submits a picture and returns the job id at once (the Stack's 202 with `timeout_ms: 1`; a 200 means it was already done, and its pictures ride along). */
export async function submitGeneration(body: GenerationBody): Promise<{ job: string; done: StackPic[] | null }> {
  const res = await request("/v1/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 202 || res.status === 200) {
    const parsed = await res.json() as { job?: string; data?: StackPic[] };
    if (!parsed.job) throw new StackPicturesError(502, "bad_reply", "The picture engine's answer was not understood. Try again.");
    return { job: parsed.job, done: res.status === 200 && Array.isArray(parsed.data) && parsed.data.length > 0 ? parsed.data : null };
  }
  return failure(res);
}

/** Submits a described edit (POST /v1/images/edits operation edit or edit_masked). The picture and mask ride as files. */
export async function submitEdit(form: FormData): Promise<{ job: string }> {
  const res = await request("/v1/images/edits", { method: "POST", body: form, timeoutMs: 30_000 });
  if (res.status === 202 || res.status === 200) {
    const parsed = await res.json() as { job?: string };
    if (!parsed.job) throw new StackPicturesError(502, "bad_reply", "The picture engine's answer was not understood. Try again.");
    return { job: parsed.job };
  }
  return failure(res);
}

export async function getGenerationJob(job: string): Promise<StackPicJob> {
  const res = await request(`/v1/images/generations/${encodeURIComponent(job)}`, { method: "GET" });
  if (!res.ok) return failure(res);
  const body = await res.json() as Partial<StackPicJob>;
  return {
    job: body.job ?? job,
    state: body.state ?? "running",
    phase: body.phase ?? null,
    progress: typeof body.progress === "number" ? body.progress : 0,
    phase_progress: body.phase_progress ?? null,
    position: body.position ?? null,
    error: typeof body.error === "string" ? plainEngineLine(body.error) : null,
    code: body.code ?? null,
    data: Array.isArray(body.data) ? body.data : [],
    progress_fraction: body.progress_fraction ?? null, stage: body.stage ?? null, stage_label: body.stage_label ?? null, step: body.step ?? null, steps: body.steps ?? null,
    eta_seconds: body.eta_seconds ?? null, preview_url: body.preview_url ?? null, preview_step: body.preview_step ?? null,
  };
}

/** The latest preview JPEG of a running picture (GENPREVIEW-01). */
export async function fetchPicturePreview(job: string): Promise<Uint8Array> {
  const res = await request(`/v1/images/generations/${encodeURIComponent(job)}/preview.jpg`, { method: "GET" });
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** One finished picture's PNG bytes. */
export async function fetchPicture(job: string, index: number): Promise<Uint8Array> {
  const res = await request(`/v1/images/generations/${encodeURIComponent(job)}/${index}.png`, { method: "GET", timeoutMs: 60_000 });
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** Stops a queued or running job, or deletes a finished one's files. Best effort: the caller never fails on it. */
export async function cancelOrDelete(job: string): Promise<void> {
  try {
    const res = await request(`/v1/images/generations/${encodeURIComponent(job)}`, { method: "DELETE" });
    await res.arrayBuffer().catch(() => undefined);
  } catch { /* the Stack removes its own files after 24 hours */ }
}

export async function imageStatus(): Promise<StackImageStatus | null> {
  try {
    const res = await request("/stack/v1/image", { method: "GET", timeoutMs: 5_000 });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = await res.json() as { image?: StackImageStatus };
    return body.image ?? null;
  } catch {
    return null;
  }
}

export async function listLoras(): Promise<StackLora[]> {
  const res = await request("/stack/v1/image/loras", { method: "GET", timeoutMs: 8_000 });
  if (res.status === 404) return [];
  if (!res.ok) return failure(res);
  const body = await res.json() as { loras?: StackLora[] } | StackLora[];
  return Array.isArray(body) ? body : Array.isArray(body.loras) ? body.loras : [];
}

/** Adds a LoRA from a file the admin uploaded. The Stack reads the tensors, hashes the file and refuses a file that cannot work or contains prohibited training material. */
export async function addLoraFile(form: FormData): Promise<StackLora> {
  const res = await request("/stack/v1/image/loras", { method: "POST", body: form, timeoutMs: 600_000 });
  if (!res.ok) return failure(res);
  return await res.json() as StackLora;
}

/** Adds a LoRA from a Hugging Face file link: an install job; poll it with `getStackJob`. */
export async function addLoraUrl(body: { url: string; name: string; licence?: string; licence_acknowledged?: boolean; classification?: "all-ages" | "adult-only"; trigger_words?: string[]; added_by?: string }): Promise<{ job: string }> {
  const res = await request("/stack/v1/image/loras/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 20_000 });
  if (!res.ok) return failure(res);
  return await res.json() as { job: string };
}

export async function patchLora(id: string, body: { name?: string; classification?: "all-ages" | "adult-only"; trigger_words?: string[]; strength_default?: number }): Promise<StackLora> {
  const res = await request(`/stack/v1/image/loras/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) return failure(res);
  return await res.json() as StackLora;
}

export async function removeLora(id: string): Promise<void> {
  const res = await request(`/stack/v1/image/loras/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return failure(res);
}

/** Starts the install of a picture model family (the pinned files, then the engine environment, one job). */
export async function installPictureModel(family?: string): Promise<{ job: string; family: string; joined: boolean }> {
  const res = await request("/stack/v1/image/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(family ? { family } : {}), timeoutMs: 20_000 });
  if (!res.ok) return failure(res);
  return await res.json() as { job: string; family: string; joined: boolean };
}

export interface StackBackgroundJob { id: string; state: string; percent?: number; status?: string; reason?: string | null; result?: { lora?: StackLora } | null }
/** A Stack job (model install, a LoRA fetch). */
export async function getStackJob(id: string): Promise<StackBackgroundJob> {
  const res = await request(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "GET", timeoutMs: 8_000 });
  if (!res.ok) return failure(res);
  const body = await res.json() as { job?: StackBackgroundJob };
  return body.job ?? { id, state: "failed", reason: "The job could not be read." };
}

