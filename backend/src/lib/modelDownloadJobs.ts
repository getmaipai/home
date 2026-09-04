// The real download-job queue (platform plan 4.11's "no download-job
// queue exists to [fetch a GGUF or a llama-server binary] safely" gap,
// spec/llm/README.md). One job per catalog model id: fetch the
// platform-matched engine binary if missing, fetch the model's GGUF,
// verify both, select it as the household's chat model, spawn it for
// real, and run the post-load check - all one job so ModelsSection.tsx's
// "choose this" button has exactly one thing to poll. Progress is
// persisted to model_download_jobs (db/schema.ts) so a browser refresh
// mid-download still shows real progress, and a crash mid-download
// resumes from the .part file on the next attempt rather than restarting.
import { existsSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { modelDownloadJobs } from "@/db/schema";
import { CATALOG } from "@/lib/modelCatalog";
import { detectHardware } from "@/lib/hardware";
import { selectEngineBinary, ENGINE_READY_MARKER, type EngineArchive } from "@/lib/engineCatalog";
import { modelsDir, enginesDir } from "@/lib/paths";
import { downloadUrl } from "@/lib/modelDownload";
import { extractArchive } from "@/lib/archive";
import { setHouseholdSettingValue } from "@/lib/settings";
import { getChatClient, restartChatBackend, getLastPostLoadCheck } from "@/lib/llmSupervisor";

export type JobStatus =
  | "queued"
  | "downloading_engine"
  | "downloading_model"
  | "verifying"
  | "loading"
  | "testing"
  | "ready"
  | "failed";

export interface JobRow {
  modelId: string;
  status: JobStatus;
  phase: string;
  completedBytes: number;
  totalBytes: number;
  error: string | null;
  postLoadCheck: { estimatedBytes: number; actualBytes: number | null; driftPct: number | null } | null;
  createdAt: string;
  updatedAt: string;
}

// At most ONE select job runs at a time, across every model id, not one
// per id: every job ends by writing the single household chat.model_id
// setting and restarting the single llmSupervisor.ts chatBackend
// singleton (code review, 2026-09-04) - two different models selected in
// quick succession would otherwise race both, leaving the persisted
// selection and the actually-running process naming different models.
// A second "choose this" for the SAME id already in flight returns that
// job; for a DIFFERENT id, startSelectJob refuses to start a second one.
let activeJob: { modelId: string; promise: Promise<void> } | null = null;

function toJobRow(row: typeof modelDownloadJobs.$inferSelect): JobRow {
  return {
    modelId: row.modelId,
    status: row.status as JobStatus,
    phase: row.phase,
    completedBytes: row.completedBytes,
    totalBytes: row.totalBytes,
    error: row.error,
    postLoadCheck: row.postLoadCheck ? JSON.parse(row.postLoadCheck) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function upsertJob(modelId: string, patch: Partial<Omit<typeof modelDownloadJobs.$inferInsert, "modelId">>): void {
  const now = new Date().toISOString();
  const existing = db.select().from(modelDownloadJobs).where(eq(modelDownloadJobs.modelId, modelId)).get();
  if (existing) {
    db.update(modelDownloadJobs)
      .set({ ...patch, updatedAt: now })
      .where(eq(modelDownloadJobs.modelId, modelId))
      .run();
  } else {
    db.insert(modelDownloadJobs)
      .values({
        modelId,
        status: "queued",
        phase: "queued",
        completedBytes: 0,
        totalBytes: 0,
        createdAt: now,
        updatedAt: now,
        ...patch,
      })
      .run();
  }
}

export function getJob(modelId: string): JobRow | null {
  const row = db.select().from(modelDownloadJobs).where(eq(modelDownloadJobs.modelId, modelId)).get();
  return row ? toJobRow(row) : null;
}

export function listJobs(): JobRow[] {
  return db.select().from(modelDownloadJobs).all().map(toJobRow);
}

function engineDir(binaryId: string): string {
  return join(enginesDir, binaryId);
}

// Throttled: a raw SQLite UPDATE on every downloaded chunk (potentially
// thousands per second on a fast connection) would make the download
// itself slower than the network. 500ms is frequent enough for a progress
// bar to look live without becoming the bottleneck.
const PROGRESS_WRITE_INTERVAL_MS = 500;

function throttledProgress(modelId: string, status: JobStatus, phase: string): (completed: number, total: number) => void {
  let lastWrite = 0;
  return (completedBytes: number, totalBytes: number) => {
    const now = Date.now();
    if (now - lastWrite < PROGRESS_WRITE_INTERVAL_MS) return;
    lastWrite = now;
    upsertJob(modelId, { status, phase, completedBytes, totalBytes });
  };
}

async function downloadArchiveVerified(
  modelId: string,
  status: JobStatus,
  archive: EngineArchive,
  destDir: string,
  onProgress: (completed: number, total: number) => void,
): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  // Stable name, not randomized: downloadUrl's own resume-from-.part
  // support depends on this path being the same across a crash and the
  // next retry (the same reason modelPath below is stable). Safe from
  // the cross-model collision the review flagged (two different models
  // sharing this engine pin, downloading concurrently) because the
  // one-job-at-a-time gate above already makes that impossible - only
  // one runSelectJob is ever touching a given destDir at a time.
  const archivePath = join(destDir, ".download.tmp");
  await downloadUrl(archive.url, archivePath, {
    expectedSha256: archive.sha256,
    expectedBytes: archive.approxBytes,
    onProgress: (p) => onProgress(p.completedBytes, p.totalBytes),
  });
  upsertJob(modelId, { status, phase: `extracting ${archive.label}` });
  await extractArchive(archivePath, destDir);
  rmSync(archivePath, { force: true });
}

/** Runs the whole select flow for one catalog model id. Never throws:
 * every failure is caught and written to the job row's `error` field, the
 * same "state lives in the row, not in a rejected promise" contract
 * lib/scheduler.ts's jobs already use. */
async function runSelectJob(modelId: string): Promise<void> {
  try {
    const model = CATALOG.find((m) => m.id === modelId && m.role === "chat");
    if (!model) throw new Error(`unknown chat catalog model: ${modelId}`);
    if (!model.implemented) throw new Error(`${modelId} has no real backend yet`);
    if (!model.download) throw new Error(`${modelId} has no pinned download source`);

    const hw = await detectHardware();
    const enginePin = selectEngineBinary(hw);
    if (!enginePin) {
      throw new Error("no llama-server build is pinned for this computer's platform yet");
    }

    const destDir = engineDir(enginePin.id);
    const binPath = join(destDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
    // Gated on the completion marker, not just `existsSync(binPath)`: the
    // main archive extracts (and drops llama-server at binPath) before
    // any extraArchives are even attempted, so a crash between those two
    // steps used to leave binPath present but the engine genuinely
    // incomplete (a Windows/CUDA box missing its cudart DLLs) - and
    // `existsSync(binPath)` alone would then skip re-fetching the extras
    // forever (code review, 2026-09-04). The marker is only written after
    // every archive (main + extras) has extracted successfully.
    const readyMarker = join(destDir, ENGINE_READY_MARKER);
    if (!existsSync(readyMarker)) {
      const onProgress = throttledProgress(modelId, "downloading_engine", enginePin.archive.label);
      await downloadArchiveVerified(modelId, "downloading_engine", enginePin.archive, destDir, onProgress);
      for (const extra of enginePin.extraArchives ?? []) {
        const extraProgress = throttledProgress(modelId, "downloading_engine", extra.label);
        await downloadArchiveVerified(modelId, "downloading_engine", extra, destDir, extraProgress);
      }
      if (process.platform !== "win32") chmodSync(binPath, 0o755);
      writeFileSync(readyMarker, new Date().toISOString());
    }

    const modelPath = join(modelsDir, `${modelId}.gguf`);
    if (!existsSync(modelPath)) {
      upsertJob(modelId, { status: "downloading_model", phase: "downloading model weights", completedBytes: 0, totalBytes: model.download.approx_bytes });
      const onProgress = throttledProgress(modelId, "downloading_model", "downloading model weights");
      await downloadUrl(model.download.url, modelPath, {
        expectedSha256: model.download.sha256,
        expectedBytes: model.download.approx_bytes,
        onProgress: (p) => onProgress(p.completedBytes, p.totalBytes),
      });
    }

    upsertJob(modelId, { status: "verifying", phase: "selecting model" });
    const set = setHouseholdSettingValue("chat.model_id", modelId);
    if (!set.ok) throw new Error(set.error);

    upsertJob(modelId, { status: "loading", phase: "starting the engine" });
    await restartChatBackend();
    await getChatClient(); // resolves through llmSupervisor's tier 3, spawns for real, runs the post-load check

    upsertJob(modelId, { status: "testing", phase: "running the post-load check" });
    const check = getLastPostLoadCheck();
    const postLoadCheck =
      check && check.modelId === modelId
        ? { estimatedBytes: check.estimatedBytes, actualBytes: check.actualBytes, driftPct: check.driftPct }
        : null;

    upsertJob(modelId, {
      status: "ready",
      phase: "ready",
      postLoadCheck: postLoadCheck ? JSON.stringify(postLoadCheck) : null,
      error: null,
    });
  } catch (err) {
    upsertJob(modelId, { status: "failed", phase: "failed", error: (err as Error).message });
  }
}

/** Starts (or returns the already-running) select job for `modelId`. A
 * different model already mid-select is refused rather than started
 * alongside it (see `activeJob`'s comment above for why). Owner/admin-
 * gated at the route (routes/host.ts); this function trusts its caller
 * already checked that. */
export function startSelectJob(modelId: string): JobRow {
  if (activeJob && activeJob.modelId !== modelId) {
    throw new Error(`"${activeJob.modelId}" is still being set up - wait for it to finish before choosing a different model`);
  }
  if (!activeJob) {
    upsertJob(modelId, { status: "queued", phase: "queued", error: null });
    const promise = runSelectJob(modelId).finally(() => {
      if (activeJob?.modelId === modelId) activeJob = null;
    });
    activeJob = { modelId, promise };
  }
  return getJob(modelId)!;
}
