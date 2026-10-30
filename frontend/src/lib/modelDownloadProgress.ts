import type { JobProgressItem } from "@maipai/ui/src/elements/job-progress";
import { useEffect, useState } from "react";
import { downloadProgress, type DownloadProgressProps } from "@/lib/downloadProgress";
import { api, type HomeJobView } from "@/lib/api";

const ACTIVE_STATES = new Set(["queued", "running", "paused", "stalled"]);
const RECENT_MS = 15 * 60_000;

export function isVisibleModelDownload(job: HomeJobView, now = Date.now()): boolean {
  if (job.kind !== "model_download") return false;
  if (job.state && ACTIVE_STATES.has(job.state)) return true;
  const updated = Date.parse(job.updatedAt ?? "");
  return Number.isFinite(updated) && now - updated <= RECENT_MS;
}

export function useModelDownloadJobs(enabled = true): HomeJobView[] {
  const [jobs, setJobs] = useState<HomeJobView[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const rows = await api.jobs();
        if (disposed) return;
        const downloads = rows.filter((row) => row.kind === "model_download");
        setJobs(downloads);
        const active = downloads.some((row) => row.state === "queued" || row.state === "running" || row.state === "paused" || row.state === "stalled");
        timer = setTimeout(() => void poll(), active ? 1_000 : 15_000);
      } catch {
        if (!disposed) timer = setTimeout(() => void poll(), 15_000);
      }
    };
    void poll();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [enabled]);
  return jobs;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function itemList(value: unknown): JobProgressItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const states = ["queued", "running", "paused", "stalled", "verifying", "failed", "done"] as const;
    if (typeof item.id !== "string" || typeof item.label !== "string" || !states.includes(item.state as typeof states[number])) return [];
    const completedBytes = number(item.completedBytes);
    const totalBytes = number(item.totalBytes);
    if (completedBytes === undefined || totalBytes === undefined) return [];
    return [{ id: item.id, label: item.label, completedBytes, totalBytes, state: item.state as JobProgressItem["state"] }];
  });
}

export function modelDownloadProgress(job: HomeJobView): DownloadProgressProps {
  const progress = job.progress ?? {};
  const state = job.state === "done" || job.state === "ready" ? "done"
    : job.state === "failed" ? "failed"
      : job.state === "paused" ? "paused"
        : job.state === "stalled" ? "stalled"
          : job.state === "queued" ? "queued"
            : job.state === "cancelled" ? "cancelled" : "running";
  const status = typeof progress.status === "string" ? progress.status : typeof progress.phase === "string" ? progress.phase : job.state ?? "Downloading";
  const items = itemList(progress.items);
  const completedBytes = number(progress.completedBytes);
  const totalBytes = number(progress.totalBytes);
  const bytesPerSecond = number(progress.bytesPerSecond);
  const percent = number(progress.percent);
  return downloadProgress({
    title: job.title || "AI model download", state, status,
    ...(completedBytes !== undefined ? { completedBytes } : {}),
    ...(totalBytes !== undefined ? { totalBytes } : {}),
    ...(bytesPerSecond !== undefined ? { bytesPerSecond } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(items ? { items } : {}),
  });
}
