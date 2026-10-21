import sharp from "sharp";
import { addVersion, compositeOnKey, keyOut, lookPromptFor, normalizePicture, readLook, versionPath } from "@/lib/companionLook";
import { routeAudience } from "@/lib/pictures/audience";
import { laneOf } from "@/lib/pictures/lane";
import { pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt } from "@/lib/pictures/policy";
import { QUICK_MODEL } from "@/lib/pictures/quality";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { cancelOrDelete, fetchPicture, getGenerationJob, submitEdit, submitGeneration } from "@/lib/pictures/stack";
import { promptRefusalLineFor } from "@/lib/pictures/ageCheck";
import { readFileSync } from "node:fs";
import type { PersonRow } from "@/types";

export const LOOK_JOB_BUSY_LINE = "A picture is already being made for this companion. Wait for it or stop it.";
export const LOOK_PROMPT_REQUIRED_LINE = "Write a look prompt first: say what the character looks like.";
export const LOOK_EDIT_PROMPT_LINE = "Say what to change, then send it.";
export const LOOK_ENGINE_NOT_READY_LINE = "Picture creation isn't set up yet. An admin can add a picture model in Settings, Pictures and videos.";

export type LookJobState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface LookJob {
  companionId: string;
  personId: string;
  state: LookJobState;
  percent: number;
  versions: string[];
  error: string | null;
  count: number;
  key: string;
  sourceVersion: string | null;
  instruction: string | null;
  finalising?: Promise<void>;
}
const jobs = new Map<string, LookJob>();
const activeByCompanion = new Map<string, string>();
const startingCompanions = new Set<string>();

export function __clearCompanionLookJobsForTests(): void { jobs.clear(); activeByCompanion.clear(); startingCompanions.clear(); }
export function activeLookJob(companionId: string): boolean {
  const id = activeByCompanion.get(companionId), job = id ? jobs.get(id) : null;
  return startingCompanions.has(companionId) || Boolean(job && (job.state === "queued" || job.state === "running"));
}

export function lookGenerationGate(actor: PersonRow, prompt: string): { status: 403 | 422; error: string } | null {
  const audience = routeAudience(actor);
  const denial = pictureDenial(audience);
  if (denial) return { status: 403, error: PICTURE_DENIAL_LINE[denial] };
  const refused = refusePrompt(prompt, { lane: laneOf(audience) });
  if (refused) return { status: 422, error: promptRefusalLineFor(refused, "picture", actor, audience.band, prompt, PROMPT_REFUSAL_LINE[refused]) };
  return null;
}

export async function canGenerateLook(actor: PersonRow, companionId: string): Promise<{ can_generate: boolean; generate_reason?: string }> {
  const audience = routeAudience(actor);
  const denial = pictureDenial(audience);
  if (denial) return { can_generate: false, generate_reason: PICTURE_DENIAL_LINE[denial] };
  if (!(await pictureEngineReady())) return { can_generate: false, generate_reason: LOOK_ENGINE_NOT_READY_LINE };
  if (activeLookJob(companionId)) return { can_generate: false, generate_reason: LOOK_JOB_BUSY_LINE };
  return { can_generate: true };
}

function register(jobId: string, job: LookJob): void {
  jobs.set(jobId, job);
  activeByCompanion.set(job.companionId, jobId);
}

export async function startLookGeneration(input: { actor: PersonRow; companionId: string; lookPrompt: string; prompt?: string; count: number }): Promise<string> {
  const promptText = input.prompt?.trim() || input.lookPrompt.trim();
  if (!promptText) throw Object.assign(new Error(LOOK_PROMPT_REQUIRED_LINE), { status: 400 });
  const prompt = lookPromptFor(promptText, readLook(input.companionId).key);
  const denied = lookGenerationGate(input.actor, prompt);
  if (denied) throw Object.assign(new Error(denied.error), { status: denied.status });
  if (!(await pictureEngineReady())) throw Object.assign(new Error(LOOK_ENGINE_NOT_READY_LINE), { status: 503 });
  if (activeLookJob(input.companionId)) throw Object.assign(new Error(LOOK_JOB_BUSY_LINE), { status: 409 });
  const key = readLook(input.companionId).key;
  startingCompanions.add(input.companionId);
  try {
    const submitted = await submitGeneration({ prompt, model: QUICK_MODEL, size: "1024x1024", n: input.count, seed: Math.floor(Math.random() * 2_147_483_647), audience: "all-ages", timeout_ms: 1 });
    register(submitted.job, { companionId: input.companionId, personId: input.actor.id, state: "queued", percent: 0, versions: [], error: null, count: input.count, key, sourceVersion: null, instruction: null });
    return submitted.job;
  } finally { startingCompanions.delete(input.companionId); }
}

export async function startLookEdit(input: { actor: PersonRow; companionId: string; versionId: string; instruction: string }): Promise<string> {
  const instruction = input.instruction.trim();
  if (!instruction) throw Object.assign(new Error(LOOK_EDIT_PROMPT_LINE), { status: 400 });
  const denied = lookGenerationGate(input.actor, instruction);
  if (denied) throw Object.assign(new Error(denied.error), { status: denied.status });
  if (!(await pictureEngineReady())) throw Object.assign(new Error(LOOK_ENGINE_NOT_READY_LINE), { status: 503 });
  if (activeLookJob(input.companionId)) throw Object.assign(new Error(LOOK_JOB_BUSY_LINE), { status: 409 });
  startingCompanions.add(input.companionId);
  try {
    const look = readLook(input.companionId), version = look.versions.find((item) => item.id === input.versionId), path = versionPath(input.companionId, input.versionId);
    if (!version || !path) throw Object.assign(new Error("That picture could not be found. Choose one of this companion's pictures."), { status: 404 });
    const png = new Uint8Array(readFileSync(path));
    const keyed = await compositeOnKey(png, look.key);
    const form = new FormData();
    form.append("image", new File([new Uint8Array(keyed)], "picture.png", { type: "image/png" }));
    form.append("operation", "edit");
    form.append("instruction", instruction);
    form.append("image_source", "uploaded");
    form.append("audience", "all-ages");
    form.append("timeout_ms", "1");
    const submitted = await submitEdit(form);
    register(submitted.job, { companionId: input.companionId, personId: input.actor.id, state: "queued", percent: 0, versions: [], error: null, count: 1, key: look.key, sourceVersion: version.id, instruction });
    return submitted.job;
  } finally { startingCompanions.delete(input.companionId); }
}

export function lookJobFor(id: string, actor: PersonRow, companionId: string): LookJob | null {
  const job = jobs.get(id);
  return job?.personId === actor.id && job.companionId === companionId ? job : null;
}

function publicJob(job: LookJob) {
  const look = readLook(job.companionId);
  return { state: job.state, percent: job.percent, label: job.state === "queued" ? "Waiting to make the picture" : job.state === "running" ? "Making the picture" : job.state === "done" ? "Pictures ready" : job.state === "cancelled" ? "Picture making stopped" : "Picture making failed",
    versions: job.versions.map((id) => { const version = look.versions.find((item) => item.id === id); return { id, url: `/api/companions/${encodeURIComponent(job.companionId)}/look/${id}/image`, label: version?.label ?? "Picture" }; }), error: job.error };
}

export async function pollLookJob(id: string, actor: PersonRow, companionId: string) {
  const job = lookJobFor(id, actor, companionId);
  if (!job) return null;
  if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return publicJob(job);
  const wasCancelled = (): boolean => job.state === "cancelled";
  try {
    const stack = await getGenerationJob(id);
    if (stack.state === "queued") { job.state = "queued"; job.percent = 0; }
    else if (stack.state === "running") {
      job.state = "running";
      const fraction = typeof stack.progress_fraction === "number" ? stack.progress_fraction * 100 : stack.progress;
      job.percent = Math.max(0, Math.min(99, Math.round(fraction)));
    }
    else if (stack.state === "failed") { job.state = "failed"; job.error = stack.error || "The picture engine could not finish. Try again."; activeByCompanion.delete(companionId); }
    else if (stack.state === "cancelled") { job.state = "cancelled"; activeByCompanion.delete(companionId); }
    else {
      if (!job.finalising) job.finalising = (async () => {
        const images = await Promise.all(Array.from({ length: job.count }, (_, index) => fetchPicture(id, index)));
        for (let index = 0; index < images.length; index++) {
          if (wasCancelled()) return;
          let picture = job.sourceVersion ? images[index]! : await keyOut(images[index]!, job.key);
          let label = job.sourceVersion ? (job.instruction ?? "Edited picture").slice(0, 60) : `Candidate ${index + 1}`;
          if (job.sourceVersion) {
            const meta = await sharp(picture).metadata();
            if (!meta.hasAlpha) picture = await keyOut(picture, job.key);
            else {
              // If the edit came back opaque, key it; transparent results retain their alpha.
              const stats = await sharp(picture).ensureAlpha().stats();
              if ((stats.channels[3]?.min ?? 255) === 255) picture = await keyOut(picture, job.key);
            }
          }
          const rgba = await sharp(picture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          let opaque = 0;
          for (let offset = 3; offset < rgba.data.length; offset += 4) if (rgba.data[offset]! > 0) opaque++;
          const fraction = opaque / (rgba.info.width * rgba.info.height);
          if (fraction < 0.05 || fraction > 0.95) label += " (check the edges)";
          const normalized = await normalizePicture(picture, { removeBackground: async (bytes) => bytes });
          const saved = addVersion(job.companionId, normalized, { source: job.sourceVersion ? "edit" : "generated", label, width: 1024, height: 1024, from: job.sourceVersion });
          job.versions.push(saved.id);
        }
        if (wasCancelled()) return;
        job.state = "done"; job.percent = 100; activeByCompanion.delete(companionId);
      })();
      try { await job.finalising; } catch (error) { if (!wasCancelled()) { job.state = "failed"; job.error = error instanceof Error ? error.message : "The picture could not be saved. Try again."; activeByCompanion.delete(companionId); } }
    }
  } catch (error) {
    job.state = "failed"; job.error = error instanceof Error ? error.message : "The picture job could not be checked. Try again."; activeByCompanion.delete(companionId);
  }
  return publicJob(job);
}

export async function cancelLookJob(id: string, actor: PersonRow, companionId: string): Promise<boolean> {
  const job = lookJobFor(id, actor, companionId);
  if (!job) return false;
  job.state = "cancelled"; job.error = null; activeByCompanion.delete(companionId);
  await cancelOrDelete(id);
  return true;
}
