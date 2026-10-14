import { describe, expect, test } from "bun:test";
import { isVisibleModelDownload, modelDownloadProgress } from "@/lib/modelDownloadProgress";
import type { HomeJobView } from "@/lib/api";

const job = (state: string, status: string, extra: Record<string, unknown> = {}): HomeJobView => ({
  id: `download-${state}`,
  kind: "model_download",
  state,
  title: "small-model",
  createdAt: "2026-10-14T10:00:00Z",
  updatedAt: "2026-10-14T10:01:00Z",
  progress: { completedBytes: 2_100_000_000, totalBytes: 9_400_000_000, bytesPerSecond: 100_000_000, status, items: [{ id: "weights", label: "weights.gguf", completedBytes: 2_100_000_000, totalBytes: 9_400_000_000, state }] , ...extra },
});

describe("modelDownloadProgress", () => {
  test("projects a slow download with size, rate, ETA input, and file details", () => {
    const view = modelDownloadProgress(job("running", "downloading_model"));
    expect(view).toMatchObject({ completedBytes: 2_100_000_000, totalBytes: 9_400_000_000, bytesPerSecond: 100_000_000, etaSeconds: 73, items: [{ id: "weights", state: "running" }] });
  });
  test("projects a stalled download with its retry copy", () => {
    expect(modelDownloadProgress(job("stalled", "network stalled"))).toMatchObject({ downloadState: "stalled", downloadStatus: "network stalled", copy: { stalled: "The download is having trouble. It will resume automatically." } });
  });
  test("shows terminal failure copy for checksum and disk space failures", () => {
    expect(modelDownloadProgress(job("failed", "checksum mismatch"))).toMatchObject({ outcome: { status: "failed" }, copy: { checksumFailed: "The file did not pass its checksum. Retry the download." } });
    expect(modelDownloadProgress(job("failed", "out of space"))).toMatchObject({ outcome: { status: "failed" }, copy: { outOfSpace: "Free up disk space, then retry the download." } });
  });
  test("keeps active downloads visible after a tab or hub restart via their persisted job timestamp", () => {
    expect(isVisibleModelDownload(job("running", "downloading_model"), Date.parse("2026-10-14T10:02:00Z"))).toBe(true);
    expect(isVisibleModelDownload({ ...job("done", "ready"), kind: "other" }, Date.parse("2026-10-14T10:02:00Z"))).toBe(false);
  });
});
