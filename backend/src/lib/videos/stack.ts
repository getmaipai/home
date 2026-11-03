// VIDEO-GEN-05: Home's calls to the Stack's video engine (docs/design/video-generation-2026-10-17.md, section 12,
// and the Stack's own routes under /v1/videos and /stack/v1/video). One module, loopback only (the Stack's URL
// setting already guarantees it). The prompt and the reference picture travel in bodies and are never logged or
// put in an error message (rule 6a). A test replaces `fetch` with `__setVideosFetchForTests`.
import { makingStateOf, plainMakingLine } from "@/lib/pictures/plainLine";
import { forgetMediaRefusal, getStackUrl, rememberMediaRefusal } from "@/lib/stackEngine";
import type { StackLiveFields } from "@/lib/genLive";
import { sendWithView, StackViewError, VIEW_KEY_LINE, type FullView } from "@/lib/stack/fullView";

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
  /** VIDEO-LTX-01: which model made it, and whether it has a sound track the model made (absent on an older Stack: Quick, silent). */
  quality?: "quick" | "detailed" | "ltx25" | "ltx25max";
  audio?: boolean;
  ms?: number;
  bytes?: number;
  poster_bytes?: number;
}

export interface StackVideoJob extends StackLiveFields {
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

/** VIDEO-LTX-01: one of the Stack's two video models, as `GET /stack/v1/video` reports it (absent on an older Stack). */
export interface StackVideoQuality {
  id: string;
  installed: boolean;
  available: boolean;
  audio: boolean;
  limits: Record<string, number | string>;
  memory: { fits: boolean; reason: string | null; peak_gb: number };
  install: { models: Array<{ id: string; approx_bytes: number; installed: boolean }>; remaining_bytes: number; download_bytes: number };
  licence: { id: string; name: string; url: string } | null;
  lora_base_model: string;
  /** A picture can start a clip of this model. Absent on a Stack older than 2026-10-17, which keeps Detailed to words (VIDEO-LTX-02). */
  image_to_video?: boolean;
}

/** VIDEO-TIERS-01: one size LTX-2.5 runs at, as `qualities.ltx25.profiles[]` reports it (true output size, memory in GB). */
export interface StackLtx25Profile {
  name: "standard" | "boost" | "max";
  size: string;
  width: number;
  height: number;
  max_seconds: number;
  max_frames?: number;
  peak_gb?: number;
  /** What the Stack reserves to admit a clip (Max only). */
  admit_gb?: number;
  short_peak_gb?: number;
}

/** VIDEO-TIERS-01: LTX-2.5 (sound, adults only), as `GET /stack/v1/video` reports it. Absent on a Stack that does not serve it. */
export interface StackLtx25Quality {
  /** The Stack can take an LTX-2.5 job now (installed, available and its runtime environment in place). */
  ready: boolean;
  installed?: boolean;
  available?: boolean;
  environment?: unknown;
  limits?: Record<string, number | string>;
  /** VIDEO-INPUTS-01: a first picture can start a clip of this model, and a second picture can end it. Absent or false on a Stack older than 2026-11-02: words only. */
  image_to_video?: boolean;
  end_image?: boolean;
  profiles?: StackLtx25Profile[];
  /** VIDEO-LORA-05 (Stack): LoRA support on this model. Absent or `supported` false on a Stack that lacks it: Home sends no LoRA to it. */
  loras?: { supported: boolean; max?: number; mode?: "fused" | "unfused"; negative_prompt?: "none" | "nag" };
  /** The pieces to download (LTX25-MAX-01 reports them; `download_bytes` is the whole pack). */
  install?: { download_bytes?: number; remaining_bytes?: number };
  licence?: { id: string; name: string; url: string } | null;
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
  /** VIDEO-LTX-01: the two models. An older Stack has none: Quick only, from the fields above. */
  qualities?: { quick: StackVideoQuality; detailed: StackVideoQuality; ltx25?: StackLtx25Quality; /** LTX25-MAX-01: the Max profile, the same shape as `ltx25` with one `max` profile; absent on a Stack that lacks it. */ ltx25max?: StackLtx25Quality };
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
  negative_prompt?: string;
  size?: string;
  seconds?: number;
  seed?: number;
  image?: string;
  image_source?: "generated" | "uploaded";
  /** VIDEO-INPUTS-01: a last picture for an LTX-2.5 clip (needs `image`; the Stack refuses it on Quick and Detailed). Sent only when `qualities.<model>.end_image` is true. */
  end_image?: string;
  loras?: Array<{ id: string; strength: number; sha256?: string }>;
  audience: "all-ages" | "adult";
  /** The video model, when the caller picks one: "detailed" is the sound-and-speech model (VIDEO-LTX-01, adults only), "ltx25-q8" is LTX-2.5 with sound (VIDEO-TIERS-01, adults only; the Stack answers 422 to a LoRA, and to a picture unless its `image_to_video` flag is true), left out is Quick; a teen or a child is always sent the Quick one (lib/pictures/lane.ts, videoModelForLane). */
  model?: string;
  /** TIER-HOME-04: the level the job runs at, from the slot (`lib/videos/slotBody.ts`); left out at Standard. */
  tier?: "boost" | "max";
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
  if (!url) throw new StackVideoError(503, "no_stack", "Videos are not set up on this computer yet. Ask an admin.");
  return url.replace(/\/$/, "");
}

/** `view` (ADULT-LOCK-03) is the full-view grant of an adult job; without it the call is the plain one and carries no extra header. */
async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}, view?: FullView): Promise<Response> {
  const doFetch = fetchForTests ?? globalThis.fetch;
  const { timeoutMs = 15_000, ...rest } = init;
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    return await sendWithView(doFetch, baseUrl(), path, { ...rest, signal }, view);
  } catch (error) {
    if (error instanceof StackVideoError) throw error;
    if (error instanceof StackViewError) throw new StackVideoError(503, error.code, VIEW_KEY_LINE);
    throw new StackVideoError(503, "unreachable", "Videos are not ready yet. Try again in a few minutes.");
  }
}

async function failure(res: Response): Promise<never> {
  let body: { error?: unknown; code?: unknown; job?: unknown } = {};
  try { body = await res.json() as typeof body; } catch { /* a body that is not JSON carries no detail */ }
  const code = typeof body.code === "string" ? body.code : null;
  const message = plainMakingLine("video", code, typeof body.error === "string" && body.error ? body.error : "Videos could not be made right now. Try again in a few minutes.");
  // ENGINE-STATUS-MEDIA-01: a refusal that is a state Home can show in advance is remembered for the health row.
  const state = makingStateOf(code);
  if (state === "memory" || state === "restarting") rememberMediaRefusal("video", state, code!, message);
  throw new StackVideoError(res.status, typeof body.code === "string" ? body.code : `http_${res.status}`, message, typeof body.job === "string" ? body.job : undefined);
}

/** Starts a clip and returns the job id at once (`timeout_ms` 1: the Stack answers 202 with the job; a clip takes over two minutes). */
export async function submitVideo(body: VideoBody): Promise<{ job: string; done: StackClip[] | null }> {
  const res = await request("/v1/videos/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 60_000 });
  if (res.status === 202 || res.status === 200) {
    forgetMediaRefusal("video");
    const parsed = await res.json() as { job?: string; data?: StackClip[] };
    if (!parsed.job) throw new StackVideoError(502, "bad_reply", "That did not work. Try again.");
    return { job: parsed.job, done: res.status === 200 && Array.isArray(parsed.data) && parsed.data.length > 0 ? parsed.data : null };
  }
  return failure(res);
}

/** Asks the Stack to prepare an mp4 for messaging apps (a silent AAC track, a title, at most 20 MB). The title (from the prompt) travels in a header, percent-encoded, never in the URL. Nothing is kept on the Stack. */
export async function convertForMessages(bytes: Uint8Array, title: string): Promise<Uint8Array> {
  const res = await request("/v1/videos/messages", { method: "POST", headers: { "content-type": "video/mp4", "x-title": encodeURIComponent(title) }, body: new Blob([bytes as unknown as ArrayBuffer], { type: "video/mp4" }), timeoutMs: 120_000 });
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getVideoJob(job: string, view?: FullView): Promise<StackVideoJob> {
  const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}`, { method: "GET" }, view);
  if (!res.ok) return failure(res);
  const body = await res.json() as Partial<StackVideoJob>;
  return {
    job: body.job ?? job,
    state: body.state ?? "running",
    phase: body.phase ?? null,
    progress: typeof body.progress === "number" ? body.progress : 0,
    phase_progress: body.phase_progress ?? null,
    position: body.position ?? null,
    error: typeof body.error === "string" ? plainMakingLine("video", typeof body.code === "string" ? body.code : null, body.error) : null,
    code: body.code ?? null,
    data: Array.isArray(body.data) ? body.data : [],
    progress_fraction: body.progress_fraction ?? null, stage: body.stage ?? null, stage_label: body.stage_label ?? null, step: body.step ?? null, steps: body.steps ?? null,
    eta_seconds: body.eta_seconds ?? null, preview_url: body.preview_url ?? null, preview_step: body.preview_step ?? null,
  };
}

/** The first-frame preview JPEG of a running clip (GENPREVIEW-01). */
export async function fetchVideoPreview(job: string, view?: FullView): Promise<Uint8Array> {
  const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}/preview.jpg`, { method: "GET" }, view);
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** The finished clip's mp4 bytes. */
export async function fetchClip(job: string, view?: FullView): Promise<Uint8Array> {
  const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}/video.mp4`, { method: "GET", timeoutMs: 120_000 }, view);
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** The finished clip's JPEG poster (frame 0). */
export async function fetchPoster(job: string, view?: FullView): Promise<Uint8Array> {
  const res = await request(`/v1/videos/generations/${encodeURIComponent(job)}/poster.jpg`, { method: "GET", timeoutMs: 30_000 }, view);
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

/** VIDEO-TIERS-01: `qualities.ltx25` is read defensively. `ready` counts only when it is exactly `true`, and a profile with an unusable size or length is dropped, so a half-written reply never offers a tier the Stack cannot run. */
export function withCheckedLtx25(status: StackVideoStatus): StackVideoStatus {
  if (!status.qualities) return status;
  const qualities = { ...status.qualities };
  const checked = (raw: unknown, names: ReadonlyArray<StackLtx25Profile["name"]>): StackLtx25Quality | undefined => {
    if (!raw || typeof raw !== "object") return undefined;
    const quality = raw as Partial<StackLtx25Quality> & { profiles?: unknown };
    const profiles = (Array.isArray(quality.profiles) ? quality.profiles : []).flatMap((p): StackLtx25Profile[] => {
      const x = p as Partial<StackLtx25Profile> | null;
      if (!x || !names.includes(x.name as StackLtx25Profile["name"]) || typeof x.width !== "number" || typeof x.height !== "number" || typeof x.max_seconds !== "number") return [];
      if (!(x.width > 0) || !(x.height > 0) || !(x.max_seconds > 0)) return [];
      return [{ ...x, name: x.name as StackLtx25Profile["name"], width: x.width, height: x.height, size: `${x.width}x${x.height}`, max_seconds: x.max_seconds } as StackLtx25Profile];
    });
    return { ...quality, ready: quality.ready === true, profiles };
  };
  const ltx25 = checked(qualities.ltx25, ["standard", "boost"]);
  const ltx25max = checked(qualities.ltx25max, ["max"]);
  if (ltx25) qualities.ltx25 = ltx25; else delete qualities.ltx25;
  if (ltx25max) qualities.ltx25max = ltx25max; else delete qualities.ltx25max;
  return { ...status, qualities };
}

export async function videoStatus(): Promise<StackVideoStatus | null> {
  try {
    const res = await request("/stack/v1/video", { method: "GET", timeoutMs: 5_000 });
    if (!res.ok) return null;
    const body = await res.json() as { video?: StackVideoStatus };
    return body.video ? withCheckedLtx25(body.video) : null;
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
