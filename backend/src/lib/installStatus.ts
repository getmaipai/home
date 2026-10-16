// The install as the person sees it: one summary over the Stack's model
// download jobs. Nothing is stored here; the Stack's job list is the one
// source, so the strip, the Details page and the gating below can never
// disagree about what has landed.
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { engineInstallStatus } from "@/lib/stackInstall";

// installing_engine and engine_failed come before any model download: the
// setup wizard is building the MaiPai Stack on this computer (INSTALL-SPLIT-01).
export type InstallState = "none" | "installing_engine" | "engine_failed" | "downloading" | "starter_ready" | "stalled" | "out_of_space" | "failed" | "ready";

export interface InstallItem {
  id: string;
  /** The model id the job installs. */
  model: string;
  role: string | null;
  label: string;
  state: StackJob["state"];
  completedBytes: number;
  totalBytes: number;
  reason: string | null;
}

export interface InstallStatus {
  state: InstallState;
  /** Chat can answer: at least one chat model has landed. */
  chatReady: boolean;
  /** Every planned model has landed. */
  complete: boolean;
  percent: number;
  completedBytes: number;
  totalBytes: number;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  items: InstallItem[];
  /** Plain-words reason when the state is stalled, out_of_space or failed. */
  problem: string | null;
  /** While the AI engine itself installs: the step (fetching, building, starting) and its plain label. */
  stage: string | null;
  stageLabel: string | null;
}

export const EMPTY_INSTALL: InstallStatus = {
  state: "none", chatReady: false, complete: false, percent: 0, completedBytes: 0, totalBytes: 0,
  bytesPerSecond: null, etaSeconds: null, items: [], problem: null, stage: null, stageLabel: null,
};

const OUT_OF_SPACE = /enospc|no space|not enough (disk )?space|disk (is )?full|out of (disk )?space/i;

function modelOf(job: StackJob): string {
  const value = job.input?.model;
  return typeof value === "string" ? value : job.id;
}

/** A model that landed and was later replaced or re-pulled keeps only its
 * newest job, so a retry after a failure replaces the failure. */
function newestPerModel(jobs: StackJob[]): StackJob[] {
  const byModel = new Map<string, StackJob>();
  for (const job of jobs) {
    const key = modelOf(job);
    const seen = byModel.get(key);
    if (!seen || job.createdAt > seen.createdAt) byModel.set(key, job);
  }
  return [...byModel.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function summarizeInstall(allJobs: StackJob[]): InstallStatus {
  const jobs = newestPerModel(allJobs.filter((job) => job.kind === "model.install"));
  if (jobs.length === 0) return EMPTY_INSTALL;
  const items: InstallItem[] = jobs.map((job) => ({
    id: job.id, model: modelOf(job), role: job.role, label: modelOf(job), state: job.state,
    completedBytes: job.state === "done" ? Math.max(job.completedBytes, job.totalBytes) : job.completedBytes,
    totalBytes: job.totalBytes, reason: job.reason,
  }));
  const completedBytes = items.reduce((sum, item) => sum + item.completedBytes, 0);
  const totalBytes = items.reduce((sum, item) => sum + item.totalBytes, 0);
  const active = jobs.filter((job) => job.state === "queued" || job.state === "running" || job.state === "paused" || job.state === "waiting_for_you");
  const stalled = jobs.filter((job) => job.state === "stalled");
  const failed = jobs.filter((job) => job.state === "failed");
  const chatReady = jobs.some((job) => job.role === "chat" && job.state === "done");
  const complete = jobs.every((job) => job.state === "done" || job.state === "cancelled");
  const speed = active.reduce((sum, job) => sum + (job.bytesPerSecond ?? 0), 0);
  const left = Math.max(0, totalBytes - completedBytes);

  let state: InstallState;
  let problem: string | null = null;
  if (complete) state = "ready";
  else if (failed.length && failed.some((job) => OUT_OF_SPACE.test(job.reason ?? ""))) {
    state = "out_of_space";
    problem = "This computer ran out of room for the AI models. Free some space, then try again.";
  } else if (stalled.length) {
    state = "stalled";
    problem = "A download stopped moving. Check the internet connection; it picks up again by itself.";
  } else if (failed.length && active.length === 0) {
    state = "failed";
    problem = "A download did not finish. Try again; the part already downloaded is kept.";
  } else if (chatReady) state = "starter_ready";
  else state = "downloading";

  return {
    state, chatReady, complete,
    percent: totalBytes > 0 ? Math.min(100, Math.floor((completedBytes / totalBytes) * 100)) : 0,
    completedBytes, totalBytes,
    bytesPerSecond: speed > 0 ? Math.round(speed) : null,
    etaSeconds: speed > 0 && left > 0 ? Math.ceil(left / speed) : null,
    items, problem, stage: null, stageLabel: null,
  };
}

let cache: { at: number; value: InstallStatus } | null = null;
const CACHE_MS = 1500;

export function resetInstallStatusCache(): void { cache = null; }

/** The live summary. A Stack that cannot be reached reads as "none" for the
 * strip (nothing to show), never as an error that blocks the page. */
export async function getInstallStatus(): Promise<InstallStatus> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = EMPTY_INSTALL;
  if (isStackConfigured()) {
    try { value = summarizeInstall(await getStackClient().jobs()); } catch { value = EMPTY_INSTALL; }
  }
  // Model downloads are the later, bigger part. Until one exists, the
  // engine's own install (if the wizard started it) is what is happening.
  if (value.items.length === 0) {
    const engine = engineInstallStatus();
    if (engine.state === "running") value = { ...EMPTY_INSTALL, state: "installing_engine", stage: engine.stage, stageLabel: engine.stageLabel };
    else if (engine.state === "failed") value = { ...EMPTY_INSTALL, state: "engine_failed", problem: engine.problem };
  }
  cache = { at: Date.now(), value };
  return value;
}
