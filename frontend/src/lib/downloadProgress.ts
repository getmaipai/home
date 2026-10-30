// The one way Home shows a download: the kit's JobProgress card (size, speed, time left, the file list). Every page that
// downloads something maps its own job to a DownloadSnapshot and renders <JobProgress {...downloadProgress(snapshot)} />.
import type { JobProgress, JobProgressItem } from "@maipai/ui/src/elements/job-progress";
import { useRef, type ComponentProps } from "react";

export type DownloadState = JobProgressItem["state"];

export interface DownloadSnapshot {
  title: string;
  state: DownloadState | "cancelled";
  /** The plain-words line under the bar ("Downloading", "Waits for the nightly download window"). */
  status: string;
  completedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  /** Used only when the byte counts are unknown. */
  percent?: number;
  items?: JobProgressItem[];
}

export type DownloadProgressProps = Omit<ComponentProps<typeof JobProgress>, "variant" | "onCancel">;

export function downloadProgress(d: DownloadSnapshot): DownloadProgressProps {
  const { completedBytes, totalBytes, bytesPerSecond } = d;
  const stageProgress = totalBytes && completedBytes !== undefined ? Math.min(1, completedBytes / totalBytes) : (d.percent ?? 0) / 100;
  const outcome = d.state === "done" ? { status: "success" as const }
    : d.state === "failed" ? { status: "failed" as const, summary: d.status }
      : d.state === "cancelled" ? { status: "cancelled" as const } : undefined;
  return {
    title: d.title,
    stages: [{ name: "Download", weight: 1 }],
    stageIndex: outcome ? 1 : 0,
    stageProgress,
    ...(outcome ? { outcome } : {}),
    ...(completedBytes !== undefined && totalBytes !== undefined ? { completedBytes, totalBytes } : {}),
    ...(bytesPerSecond !== undefined ? { bytesPerSecond } : {}),
    ...(bytesPerSecond && totalBytes !== undefined && completedBytes !== undefined
      ? { etaSeconds: Math.max(0, (totalBytes - completedBytes) / bytesPerSecond) } : {}),
    ...(d.items ? { items: d.items } : {}),
    ...(d.state !== "cancelled" ? { downloadState: d.state } : {}),
    downloadStatus: d.status,
    copy: {
      stalled: "The download is having trouble. It will resume automatically.",
      checksumFailed: "The file did not pass its checksum. Retry the download.",
      outOfSpace: "Free up disk space, then retry the download.",
    },
  };
}

interface Sample { bytes: number; at: number; rate?: number }

/** A smoothed bytes-per-second for each running job, from the byte counts a page already polls. For jobs whose server does
 * not report a rate. Pass `now` only in tests. */
export function nextByteRates(previous: Map<string, Sample>, jobs: Array<{ id: string; completedBytes: number; running: boolean }>, now: number): Map<string, Sample> {
  const next = new Map<string, Sample>();
  for (const job of jobs) {
    if (!job.running) continue;
    const before = previous.get(job.id);
    if (!before || job.completedBytes < before.bytes) { next.set(job.id, { bytes: job.completedBytes, at: now }); continue; }
    const seconds = (now - before.at) / 1000;
    if (seconds <= 0 || job.completedBytes === before.bytes) { next.set(job.id, before); continue; }
    const instant = (job.completedBytes - before.bytes) / seconds;
    next.set(job.id, { bytes: job.completedBytes, at: now, rate: before.rate === undefined ? instant : before.rate * 0.7 + instant * 0.3 });
  }
  return next;
}

export function useByteRates(jobs: Array<{ id: string; completedBytes: number; running: boolean }>): Record<string, number | undefined> {
  const samples = useRef(new Map<string, Sample>());
  const key = jobs.map((job) => `${job.id}:${job.completedBytes}:${job.running}`).join(",");
  const seen = useRef("");
  if (seen.current !== key) { seen.current = key; samples.current = nextByteRates(samples.current, jobs, Date.now()); }
  return Object.fromEntries([...samples.current].map(([id, sample]) => [id, sample.rate]));
}
