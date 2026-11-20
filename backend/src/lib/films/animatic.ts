// FILM-ANIMATIC-01: the film as an animatic before any clip is rendered. Each planned shot's still is held for the shot's seconds with the
// plan's own motion, the shot's line is shown as words, and the pieces are joined. The Stack's `media.rough_cut` job (VF-ROUGHCUT-01) does
// that work with no lines voiced; Home builds the request from the plan, waits for the job, and keeps the file. No model runs, so it takes
// seconds. The finished file goes through the same finished-video check as every other film file (fails closed).
import { existsSync, readFileSync, statSync } from "node:fs";
import type { PersonRow } from "@/types";
import { readAttachment, storeFile } from "@/lib/attachments";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import { EDIT_REMOTE_LINE, plainStackLine, stageFilesForStack } from "@/lib/videos/stackEdit";
import { isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";
import { createStackHttp } from "@/lib/stack/http";
import { fullViewForJob, type FullView } from "@/lib/stack/fullView";
import { getMediaProduction } from "@/lib/mediaProductions";
import type { FilmPlan } from "./plan";

export type AnimaticResult = { ok: true; fileId: string; seconds: number; shots: number } | { ok: false; line: string };

type PlanShot = FilmPlan["shots"][number];

/** The `media.rough_cut` request for the silent animatic (commons spec `stack-rough-cut-request`, `caption` from 0.1.444). Pure; `pictures` are the paths the Stack may read, one per shot. */
export interface AnimaticRequest { audience: "adult"; shots: Array<{ id: string; picture: string; seconds: number; motion?: string; caption?: string }> }
export function animaticRequest(shots: PlanShot[], pictures: string[]): AnimaticRequest {
  return { audience: "adult", shots: shots.map((shot, index) => {
    const caption = shot.line?.trim().slice(0, 200);
    return { id: shot.id, picture: pictures[index]!, seconds: shot.seconds, ...(shot.motion ? { motion: shot.motion } : {}), ...(caption ? { caption } : {}) };
  }) };
}

export const ANIMATIC_OLD_STACK_LINE = "The storyboard could not be made. The AI engine does not have the storyboard step yet. Update it, then try again.";
export const ANIMATIC_FAILED_LINE = "The storyboard could not be made. Try again.";
export const ANIMATIC_TIMEOUT_LINE = "The storyboard took longer than expected. Try again.";
export const ANIMATIC_MISSING_LINE = "The storyboard could not be read back. Try again.";

export interface RoughCutJobDeps {
  submit(input: Record<string, unknown>): Promise<{ id: string; state: string; reason?: string | null; result?: unknown }>;
  job(id: string): Promise<{ id: string; state: string; reason?: string | null; result?: unknown }>;
  cancel(id: string): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  now(): number;
  readFile(path: string): Uint8Array | null;
}
const stack = createStackHttp({ makeError: (status, code, message) => Object.assign(new Error(message), { status, code }), noStackMessage: ANIMATIC_FAILED_LINE, unreachableMessage: ANIMATIC_FAILED_LINE });
type JobView = { id: string; state: string; reason?: string | null; result?: unknown };
/** The Stack's own sentence for a request it refused on the pictures or the plan (422 `bad_input`); anything else at submit means a Stack without this step. */
async function submitRoughCut(input: Record<string, unknown>, view?: FullView): Promise<JobView> {
  const res = await stack.request("/stack/v1/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "media.rough_cut", input }), timeoutMs: 30_000 }, view);
  const body = await res.json().catch(() => ({})) as { job?: JobView; reason?: unknown; error?: unknown; code?: unknown };
  if (res.ok && body.job) return body.job;
  if (res.status === 422 && body.code === "bad_input") return { id: "", state: "failed", reason: typeof body.reason === "string" ? body.reason : typeof body.error === "string" ? body.error : null };
  throw new Error("The Stack did not take the storyboard job.");
}
const realJobDeps = (view?: FullView): RoughCutJobDeps => ({
  submit: (input) => submitRoughCut(input, view),
  job: async (id) => { const res = await stack.request(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "GET", timeoutMs: 8_000 }, view); const body = await res.json() as { job?: JobView }; if (!res.ok || !body.job) throw new Error("job"); return body.job; },
  cancel: (id) => stack.request(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: 8_000 }, view),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => Date.now(),
  readFile: (path) => { try { if (!existsSync(path)) return null; const size = statSync(path).size; return size > 0 && size <= 1024 ** 3 ? new Uint8Array(readFileSync(path)) : null; } catch { return null; } },
});
const ACTIVE = new Set(["queued", "running", "paused", "stalled", "waiting_for_you"]);
const POLL_MS = 500, DEADLINE_MS = 20 * 60_000;

/** Runs one `media.rough_cut` job and reads its file. One plain line on any failure; a Stack older than the op answers its submit with an error, which is the `ANIMATIC_OLD_STACK_LINE`. `ms` is the wall time from submit to done. */
export async function runRoughCutJob(request: AnimaticRequest, signal: AbortSignal | undefined, deps: RoughCutJobDeps): Promise<{ ok: true; bytes: Uint8Array; seconds: number; ms: number } | { ok: false; line: string }> {
  const started = deps.now();
  let job: Awaited<ReturnType<RoughCutJobDeps["submit"]>>;
  try { job = await deps.submit({ ...request }); } catch { return { ok: false, line: ANIMATIC_OLD_STACK_LINE }; }
  try {
    const deadline = started + DEADLINE_MS;
    while (ACTIVE.has(job.state)) {
      if (signal?.aborted) { void deps.cancel(job.id).catch(() => undefined); return { ok: false, line: ANIMATIC_FAILED_LINE }; }
      if (deps.now() > deadline) { void deps.cancel(job.id).catch(() => undefined); return { ok: false, line: ANIMATIC_TIMEOUT_LINE }; }
      await deps.sleep(POLL_MS);
      job = await deps.job(job.id);
    }
    if (job.state !== "done") return { ok: false, line: plainStackLine(job.reason) ?? ANIMATIC_FAILED_LINE };
    const result = (job.result ?? {}) as { file?: unknown; total_s?: unknown };
    const bytes = typeof result.file === "string" ? deps.readFile(result.file) : null;
    if (!bytes || typeof result.total_s !== "number") return { ok: false, line: ANIMATIC_MISSING_LINE };
    return { ok: true, bytes, seconds: result.total_s, ms: deps.now() - started };
  } catch { return { ok: false, line: ANIMATIC_FAILED_LINE }; }
}

export async function makeFilmAnimatic(input: { actor: PersonRow; productionId: string; plan: FilmPlan; signal?: AbortSignal }): Promise<AnimaticResult> {
  const { actor, productionId, plan, signal } = input;
  const production = getMediaProduction(actor, productionId);
  if (!production || production.owner_person_id !== actor.id) return { ok: false, line: "That film is not available to you." };
  const stored = production.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
  if (plan.shots.length === 0) return { ok: false, line: "This film has no shots yet." };
  const files: Array<{ bytes: Uint8Array; ext: string }> = [];
  for (const shot of plan.shots) {
    const pictureId = stored.find((item) => item.id === shot.id)?.picture_file_id;
    if (!pictureId) return { ok: false, line: "The pictures are not ready yet. Wait for the stills, then play the animatic." };
    const picture = readAttachment(actor, pictureId);
    if (!picture.ok) return { ok: false, line: "One of the film's pictures is missing. Make that shot's picture again." };
    files.push({ bytes: picture.value.bytes, ext: "png" });
  }
  if (!isStackConfigured()) return { ok: false, line: ANIMATIC_FAILED_LINE };
  if (isRemoteStackSelected()) return { ok: false, line: EDIT_REMOTE_LINE };
  const staged = await stageFilesForStack(files);
  if (!staged) return { ok: false, line: ANIMATIC_FAILED_LINE };
  let joined: Awaited<ReturnType<typeof runRoughCutJob>>;
  try { joined = await runRoughCutJob(animaticRequest(plan.shots, staged.paths), signal, realJobDeps(fullViewForJob("adult", actor))); } finally { staged.cleanup(); }
  if (!joined.ok) return { ok: false, line: joined.line };
  console.log("[film-animatic] rough cut: %d shots, %d ms", plan.shots.length, joined.ms);
  const frames = await extractKeyframes(joined.bytes, joined.seconds);
  if (!frames?.length) return { ok: false, line: "The animatic could not be checked, so it was not kept. Try again." };
  const checks = await checkImages(frames, "video");
  const decision = await gateFinished({ actor, kind: "video", jobId: `film-animatic:${productionId}`, adultOnly: true, checks, images: frames, prompt: plan.shots.map((shot) => shot.still).join(" ") });
  if (decision.action === "withhold") return { ok: false, line: decision.line };
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: joined.bytes, provenance: `video-edit:${JSON.stringify({ v: 1, kind: "film-animatic", production: productionId, shots: plan.shots.length, seconds: joined.seconds })}`, retention: "kept", name: "Film animatic", deduplicate: false });
  if (!saved.ok) return { ok: false, line: saved.error };
  return { ok: true, fileId: saved.value.id, seconds: joined.seconds ?? 0, shots: plan.shots.length };
}
