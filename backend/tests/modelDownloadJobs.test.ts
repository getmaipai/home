import { describe, expect, test, afterEach } from "bun:test";
import { getJob, startSelectJob, recoverInterruptedJobsAtBoot } from "@/lib/modelDownloadJobs";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { modelDownloadJobs } from "@/db/schema";

afterEach(() => {
  __resetLlmSupervisorForTests();
  setHouseholdSettingValue("chat.model_id", "");
});

async function waitForTerminal(modelId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getJob(modelId);
    if (job && (job.status === "ready" || job.status === "failed")) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job for ${modelId} never reached a terminal state`);
}

describe("modelDownloadJobs", () => {
  test("getJob returns null for a model that was never started", () => {
    expect(getJob("never-started")).toBeNull();
  });

  test("an unknown model id fails fast with a specific reason (no network involved)", async () => {
    startSelectJob("not-a-real-model-id");
    const job = await waitForTerminal("not-a-real-model-id");
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/unknown chat catalog model/);
  });

  test("a real catalog id from the wrong role fails fast, not silently ignored", async () => {
    // juggernaut-xl-ragnarok is a real catalog entry, just role: "image" -
    // startSelectJob only ever drives the chat role.
    startSelectJob("juggernaut-xl-ragnarok");
    const job = await waitForTerminal("juggernaut-xl-ragnarok");
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/unknown chat catalog model/);
  });

  test("a second 'choose this' while one is already running returns the same job, not a duplicate", () => {
    const first = startSelectJob("not-a-real-model-id-2");
    const second = startSelectJob("not-a-real-model-id-2");
    expect(second.modelId).toBe(first.modelId);
  });

  // A code review (2026-09-04) found the original version keyed its
  // in-flight guard per model id, so two DIFFERENT models selected in
  // quick succession could both spawn real jobs that race the same
  // household chat.model_id setting and the same llmSupervisor.ts
  // singleton. Fixed to one active job across every model id; this
  // proves the refusal without needing real network timing (the throw
  // happens synchronously, before runSelectJob's first await, so calling
  // startSelectJob a second time in the same tick still sees the first
  // job as active).
  test("a different model id while one is already selecting is refused, not raced", () => {
    startSelectJob("not-a-real-model-id-3");
    expect(() => startSelectJob("not-a-real-model-id-4")).toThrow(/not-a-real-model-id-3/);
  });
});

// COR-8 (code review, 2026-09-06): activeJob is in-memory only and
// always starts null on a fresh process - a crash mid-download left the
// job ROW in whatever non-terminal status it was in, with
// GET /models/:id/select-status reporting that phantom job forever.
describe("recoverInterruptedJobsAtBoot()", () => {
  function insertJobRow(modelId: string, status: string, error: string | null = null): void {
    const now = new Date().toISOString();
    db.insert(modelDownloadJobs)
      .values({ modelId, status, phase: "mid-flight", completedBytes: 100, totalBytes: 1000, error, createdAt: now, updatedAt: now })
      .run();
  }

  test("marks a non-terminal job (a real crash-mid-download shape) as failed", () => {
    insertJobRow("crashed-model", "downloading_model");
    recoverInterruptedJobsAtBoot();
    const job = getJob("crashed-model");
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("interrupted by restart");
  });

  test("leaves an already-terminal job (ready or failed) alone", () => {
    insertJobRow("ready-model", "ready");
    insertJobRow("already-failed-model", "failed", "checksum mismatch");
    recoverInterruptedJobsAtBoot();
    expect(getJob("ready-model")?.status).toBe("ready");
    const failedJob = getJob("already-failed-model");
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.error).toBe("checksum mismatch"); // untouched, not overwritten
  });

  test("every non-terminal status gets recovered, not just downloading_model", () => {
    for (const status of ["queued", "downloading_engine", "downloading_model", "verifying", "loading", "testing"]) {
      insertJobRow(`stuck-${status}`, status);
    }
    recoverInterruptedJobsAtBoot();
    for (const status of ["queued", "downloading_engine", "downloading_model", "verifying", "loading", "testing"]) {
      expect(getJob(`stuck-${status}`)?.status).toBe("failed");
    }
  });
});
