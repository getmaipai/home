// IMGGEN-HOME-01: Home's calls to the Stack's picture engine (docs/design/image-engine-2026-10-17.md,
// section 9, and the Stack's own routes under /v1/images and /stack/v1/image). One module, loopback only
// (the Stack's URL setting already guarantees it). The prompt and the pictures travel in bodies and are
// never logged or put in an error message (rule 6a). A test replaces `fetch` with `__setPicturesFetchForTests`.
import { makingStateOf, plainMakingLine } from "@/lib/pictures/plainLine";
import { forgetMediaRefusal, rememberMediaRefusal } from "@/lib/stackEngine";
import { createStackHttp } from "@/lib/stack/http";
import type { StackLiveFields } from "@/lib/genLive";
import type { FullView } from "@/lib/stack/fullView";
import type { StackJobsCatalogRead } from "@/lib/stack/jobsCatalogShape";
import type { StackMakePictureRequest, StackMakeRefusalRead, StackMakeResultRead } from "@/lib/stack/makeShape";
import { pictureJobView, type PictureJobView, type PictureList } from "./catalog";

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
  models: Array<{ id: string; family?: string; label?: string; installed: boolean; default?: boolean; available?: boolean; licence?: string; loras?: boolean; edit?: boolean; max_references?: number; steps_default?: number; peak_gb?: number; install?: { remaining_bytes: number } }>;
  lora_count?: number;
  code?: string | null;
  install?: { remaining_bytes: number };
  loras_supported: boolean;
  edit: { generative: boolean; masked: boolean; /** Models that can edit, when the Stack lists them. */ models?: string[]; /** IMGEDIT-01: extra pictures an edit takes beside the one it changes; absent on an older Stack. */ references?: number };
  limits: { min_side?: number; max_side?: number; size_step?: number; max_n?: number; max_prompt_chars?: number; max_loras?: number; max_references?: number; max_edit_megapixels?: number; queue_max?: number };
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
  /** TIER-PIC-01: the level the picture runs at (absent: Standard). The Stack opens a Max window for "max". */
  tier?: "boost" | "max";
  /**
   * MODELPACK-HOME-02: what the person asked for, in the words of the generic `picture` job. Set only when the request is nothing but
   * this (no style, no negative prompt, no picture to start from), so a re-make can ask the generic job instead of the size-and-prompt
   * route. `prompt`, `size` and `n` stay for the route that is still the first take.
   */
  ask?: { description: string; words?: string[]; shape: "square" | "landscape" | "portrait" };
  timeout_ms: number;
}

/** A refusal or failure the Stack answered with. `message` is the Stack's plain sentence (it says what to do); `code` is its machine code. */
export class StackPicturesError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly job?: string) {
    super(message);
    this.name = "StackPicturesError";
  }
}

const stack = createStackHttp({
  makeError: (status, code, message, job) => new StackPicturesError(status, code, message, job),
  noStackMessage: "Pictures are not set up on this computer yet. Ask an admin.",
  unreachableMessage: "Pictures are not ready yet. Try again in a few minutes.",
});
/** Test seam: a function that answers the Stack's image routes. */
export const __setPicturesFetchForTests = stack.__setFetchForTests;
const request = stack.request;

function failure(res: Response): Promise<never> {
  return stack.failure(res, {
    fallback: "Pictures could not be made right now. Try again in a few minutes.",
    describe: (code, text) => plainMakingLine("image", code, text),
    // ENGINE-STATUS-MEDIA-01: a refusal that is a state Home can show in advance is remembered for the health row.
    onFailure: (code, message) => { const state = makingStateOf(code); if (state === "memory" || state === "restarting") rememberMediaRefusal("image", state, code!, message); },
  });
}

/** Submits a picture and returns the job id at once (the Stack's 202 with `timeout_ms: 1`; a 200 means it was already done, and its pictures ride along). */
export async function submitGeneration(body: GenerationBody): Promise<{ job: string; done: StackPic[] | null }> {
  // The request names no model of its own: the part the Stack says serves a picture for this list is the one it is asked for (an opaque id from
  // the jobs catalog), and a request that already carries a part, the household's pick for its level, keeps it.
  const { ask: _ask, ...wire } = body;
  const part = body.model ? undefined : await servingPartFor("picture", listOfAudience(body.audience));
  const res = await request("/v1/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...wire, ...(part ? { model: part } : {}) }) });
  if (res.status === 202 || res.status === 200) {
    forgetMediaRefusal("image");
    const parsed = await res.json() as { job?: string; data?: StackPic[] };
    if (!parsed.job) throw new StackPicturesError(502, "bad_reply", "That did not work. Try again.");
    return { job: parsed.job, done: res.status === 200 && Array.isArray(parsed.data) && parsed.data.length > 0 ? parsed.data : null };
  }
  return failure(res);
}

/** Submits a described edit (POST /v1/images/edits operation edit or edit_masked). The picture and mask ride as files. */
export async function submitEdit(form: FormData): Promise<{ job: string }> {
  // The Stack routes an edit that names no model to its own edit default, which can be a model that is gone (measured 2026-11-16: "no picture
  // model is installed" with one installed). An edit that names no part is sent to the part the jobs catalog says serves `picture_edit` for its list
  // (an opaque id the Stack gave), and no part at all when the catalog cannot be read. Only an adult's edit asks the adult list.
  if (!form.has("model")) {
    const part = await servingPartFor("picture_edit", form.get("audience") === "adult" ? "adult" : "minor");
    if (part) form.set("model", part);
  }
  const res = await request("/v1/images/edits", { method: "POST", body: form, timeoutMs: 30_000 });
  if (res.status === 202 || res.status === 200) {
    forgetMediaRefusal("image");
    const parsed = await res.json() as { job?: string };
    if (!parsed.job) throw new StackPicturesError(502, "bad_reply", "That did not work. Try again.");
    return { job: parsed.job };
  }
  return failure(res);
}

/** A single finished PNG from the existing Stack image job interface. */
export async function waitPicture(job: string, signal?: AbortSignal): Promise<{ pic: StackPic; bytes: Uint8Array }> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const status = await getGenerationJob(job);
    if (status.state === "failed") throw new StackPicturesError(503, status.code ?? "failed", status.error ?? "Pictures could not be made right now. Try again.");
    if (status.state === "cancelled") throw new DOMException("Aborted", "AbortError");
    if (status.state === "done") {
      const pic = status.data[0];
      if (!pic) throw new StackPicturesError(502, "bad_reply", "That did not work. Try again.");
      return { pic, bytes: pic.b64_json ? new Uint8Array(Buffer.from(pic.b64_json, "base64")) : await fetchPicture(job, 0) };
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 700);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }
}

export async function getGenerationJob(job: string, view?: FullView): Promise<StackPicJob> {
  const res = await request(`/v1/images/generations/${encodeURIComponent(job)}`, { method: "GET" }, view);
  if (!res.ok) return failure(res);
  const body = await res.json() as Partial<StackPicJob>;
  return {
    job: body.job ?? job,
    state: body.state ?? "running",
    phase: body.phase ?? null,
    progress: typeof body.progress === "number" ? body.progress : 0,
    phase_progress: body.phase_progress ?? null,
    position: body.position ?? null,
    error: typeof body.error === "string" ? plainMakingLine("image", typeof body.code === "string" ? body.code : null, body.error) : null,
    code: body.code ?? null,
    data: Array.isArray(body.data) ? body.data : [],
    progress_fraction: body.progress_fraction ?? null, stage: body.stage ?? null, stage_label: body.stage_label ?? null, step: body.step ?? null, steps: body.steps ?? null,
    eta_seconds: body.eta_seconds ?? null, preview_url: body.preview_url ?? null, preview_step: body.preview_step ?? null,
  };
}

/** The latest preview JPEG of a running picture (GENPREVIEW-01). */
export async function fetchPicturePreview(job: string, view?: FullView): Promise<Uint8Array> {
  const res = await request(`/v1/images/generations/${encodeURIComponent(job)}/preview.jpg`, { method: "GET" }, view);
  if (!res.ok) return failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** One finished picture's PNG bytes. */
export async function fetchPicture(job: string, index: number, view?: FullView): Promise<Uint8Array> {
  const res = await request(`/v1/images/generations/${encodeURIComponent(job)}/${index}.png`, { method: "GET", timeoutMs: 60_000 }, view);
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

// ---------------------------------------------------------------- the jobs catalog and the generic picture job (MODELPACK-HOME-02)

const CATALOG_TTL_MS = 20_000;
const catalogCache = new Map<PictureList, { at: number; catalog: StackJobsCatalogRead }>();
/** Test seam: forget every cached catalog read. */
export function __resetJobsCatalogForTests(): void { catalogCache.clear(); }

/** The list a picture is made for: an adult's picture asks the adult list (the household's order), every other one the minor list (neutral labels, the Stack's own priority, rule E6). */
export const listOfAudience = (audience: "adult" | "all-ages" | undefined): PictureList => (audience === "adult" ? "adult" : "minor");

/**
 * GET /stack/v1/jobs/catalog for one list: what can be made here, now. Null when the Stack cannot be read or is too old to have the route (the
 * caller then asks for nothing in particular and the Stack uses its own default). A good read is kept for 20 seconds; a read under a test fetch
 * is never kept, so a test that changes the Stack's answer sees it at once.
 */
export async function jobsCatalogFor(list: PictureList): Promise<StackJobsCatalogRead | null> {
  const keep = !stack.hasTestFetch();
  const hit = keep ? catalogCache.get(list) : undefined;
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.catalog;
  try {
    const res = await request(`/stack/v1/jobs/catalog?audience=${list}`, { method: "GET", timeoutMs: 5_000 });
    if (!res.ok) { await res.arrayBuffer().catch(() => undefined); return null; }
    const catalog = await res.json() as StackJobsCatalogRead;
    if (!catalog || !Array.isArray(catalog.jobs)) return null;
    if (keep) catalogCache.set(list, { at: Date.now(), catalog });
    return catalog;
  } catch {
    return null;
  }
}

/** What the catalog says about one picture job for a list, or null when it cannot be read. */
export async function pictureJobFor(job: "picture" | "picture_edit", list: PictureList): Promise<PictureJobView | null> {
  const catalog = await jobsCatalogFor(list);
  return catalog ? pictureJobView(catalog, job) : null;
}

/** The id of the part the catalog says serves this job for this list now, or undefined (no part, or no catalog). */
export async function servingPartFor(job: "picture" | "picture_edit", list: PictureList): Promise<string | undefined> {
  const view = await pictureJobFor(job, list);
  return view?.available && view.part ? view.part.id : undefined;
}

/**
 * POST /stack/v1/jobs/make for a `picture`: the generic job, asked without a size or a model. The Stack picks the part (the named one when it
 * serves the job), fills the part's recipe (a request with `words` goes only to a part that spells them, rule W1) and answers when the picture is
 * done or, past its own wait, with the job id; either way the id is the one `getGenerationJob` polls. A refusal is returned, not thrown: it is
 * the Stack's own line and code, and the caller decides what to try next (a re-make tries the next part).
 */
export async function makePicture(body: StackMakePictureRequest): Promise<{ ok: true; job: string; part: string | null; notes: string[] } | { ok: false; refusal: StackMakeRefusalRead }> {
  const res = await request("/stack/v1/jobs/make", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 135_000 });
  if (res.status === 200 || res.status === 202) {
    const result = await res.json() as Partial<StackMakeResultRead>;
    if (!result.id) throw new StackPicturesError(502, "bad_reply", "That did not work. Try again.");
    forgetMediaRefusal("image");
    return { ok: true, job: result.id, part: result.made_with?.part ?? null, notes: result.made_with?.notes ?? [] };
  }
  if (res.status === 409) {
    const refusal = await res.json().catch(() => null) as StackMakeRefusalRead | null;
    if (refusal && typeof refusal.code === "string" && typeof refusal.line === "string") return { ok: false, refusal };
    throw new StackPicturesError(409, "refused", "That picture could not be made right now. Try again in a few minutes.");
  }
  return failure(res);
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

