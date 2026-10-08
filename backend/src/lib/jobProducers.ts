import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, modelDownloadJobs } from "@/db/schema";
import { createJob, updateJob, type HomeJob } from "@/lib/jobs";
import type { StackJob } from "@/lib/stack/types";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";

const stateMap: Record<string, string> = { downloading_engine: "running", downloading_model: "running", verifying: "running", loading: "running", testing: "running", ready: "done", failed: "failed", cancelled: "cancelled", queued: "queued" };

/** Home projection for producer-owned Stack image jobs. StackJob remains authoritative. */
export function mapStackJobToHomeJob(job: StackJob, owner: { startedBy: string; forPerson: string; title: string }): HomeJob {
  return {
    id: job.id, kind: job.kind, startedBy: owner.startedBy, forPerson: owner.forPerson, title: owner.title,
    state: job.state, progress: { percent: job.percent, completedBytes: job.completedBytes, totalBytes: job.totalBytes, status: job.status },
    resultRef: typeof job.result === "object" && job.result !== null && typeof (job.result as Record<string, unknown>).fileId === "string" ? (job.result as Record<string, string>).fileId : null,
    errorKind: job.state === "failed" ? "failed" : null, provenance: { producer: "stack", stackJobId: job.id }, createdAt: job.createdAt, updatedAt: job.updatedAt,
  };
}

export function mapModelDownloadStackJob(job: StackJob): HomeJob {
  const modelId = typeof job.input?.model === "string" ? job.input.model : job.id;
  const state = job.state;
  return { id: `stack:${job.id}`, kind: "model_download", startedBy: "system", forPerson: null, title: modelId, state, progress: { percent: job.percent, completedBytes: job.completedBytes, totalBytes: job.totalBytes, phase: job.status }, legacyProgress: { status: job.status, percent: job.percent, completedBytes: job.completedBytes, totalBytes: job.totalBytes, removalRelease: "2026-10-13" }, resultRef: null, errorKind: state === "failed" ? "failed" : null, raw: null, provenance: { producer: "stack", stackJobId: job.id, legacyRemovalRelease: "2026-10-13" }, createdAt: job.createdAt, updatedAt: job.updatedAt };
}

/** Additive projection while model_download_jobs remains readable for one release. */
export function modelDownloadJobsAsHomeJobs(): HomeJob[] {
  return db.select().from(modelDownloadJobs).all().map((row) => ({
    id: `model:${row.modelId}`, kind: "model_download", startedBy: "system", forPerson: null, title: row.modelId,
    state: stateMap[row.status] ?? "running", progress: { phase: row.phase, completedBytes: row.completedBytes, totalBytes: row.totalBytes },
    errorKind: row.status === "failed" ? "failed" : null, raw: row.error, provenance: { producer: "model_download_jobs", compatibility: "remove after 2026-10-13" }, createdAt: row.createdAt, updatedAt: row.updatedAt,
  }));
}

export async function listStackModelDownloadJobs(): Promise<HomeJob[]> {
  if (!isStackConfigured()) return [];
  try {
    const jobs = await getStackClient().jobs();
    return jobs.filter((job) => job.kind === "model.install").map(mapModelDownloadStackJob);
  } catch { return []; }
}

export function registerProducerJob(job: Omit<HomeJob, "createdAt" | "updatedAt">): HomeJob { return createJob(job); }
export function updateProducerJob(id: string, patch: Parameters<typeof updateJob>[1]): boolean { return updateJob(id, patch); }

/** Submit and mirror a Stack-owned image job; the Stack remains the executor and event authority. */
export async function startImageProducerJob(input: { actorId: string; prompt: string; conversationId?: string | null }): Promise<HomeJob> {
  if (!isStackConfigured()) throw new Error("image generation requires a configured MaiPai Stack");
  const stack = getStackClient();
  const submitted = await stack.submitJob({ kind: "image.generate", role: "image", input: { prompt } });
  const owner = { startedBy: input.actorId, forPerson: input.actorId, title: "Picture" };
  const mapped = mapStackJobToHomeJob(submitted, owner);
  const job: HomeJob = { ...mapped, conversationId: input.conversationId ?? null, provenance: { ...mapped.provenance, producer: "image", stackJobId: submitted.id } };
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...inputJob } = job;
  createJob(inputJob);
  try {
    const current = await stack.job(submitted.id);
    updateJob(submitted.id, { state: current.state, progress: { percent: current.percent, status: current.status }, resultRef: mapped.resultRef });
    return { ...job, state: current.state, progress: { percent: current.percent, status: current.status }, updatedAt: current.updatedAt };
  } catch {
    return job;
  }
}

/** Reconcile active image projections after a Stack link reconnect. The
 * Stack owns execution; Home only polls the persisted original job id. */
export async function pollActiveStackImageJobs(): Promise<number> {
  if (!isStackConfigured()) return 0;
  const active = db.select().from(jobs).where(inArray(jobs.state, ["queued", "running"])).all();
  let updated = 0;
  for (const row of active) {
    let provenance: Record<string, unknown>;
    try { provenance = JSON.parse(row.provenance) as Record<string, unknown>; } catch { continue; }
    if (provenance.producer !== "image" || typeof provenance.stackJobId !== "string") continue;
    try {
      const current = await getStackClient().job(provenance.stackJobId);
      if (updateJob(row.id, { state: current.state, progress: { percent: current.percent, status: current.status }, resultRef: typeof current.result === "object" && current.result !== null && typeof (current.result as Record<string, unknown>).fileId === "string" ? (current.result as Record<string, string>).fileId : null, errorKind: current.state === "failed" ? "failed" : null })) updated++;
    } catch {
      // A disconnected link is retried on the worker's next pass; never
      // resubmit a producer job or turn transport failure into job failure.
    }
  }
  return updated;
}
