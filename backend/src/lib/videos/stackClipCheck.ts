// Whole-clip quality measurements come from the local Stack's CPU media.check job.
import { getStackClient, isRemoteStackSelected } from "@/lib/stackEngine";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import { evaluateClipSeries, type ClipCheck, type ClipEvaluationOptions, type ClipSeries } from "./frameCheck";

const TIMEOUT_MS = 60_000;
const POLL_MS = 250;
const UNCHECKED: ClipCheck = { checked: false, frames: 0, findings: [] };

/** A failed or remote Stack check is advisory and never prevents use of a clip. */
export async function checkClipFile(absPath: string, opts: ClipEvaluationOptions = {}): Promise<ClipCheck> {
  try {
    if (isRemoteStackSelected()) return UNCHECKED;
    const input = { path: absPath, ...(opts.cameraMove === "move" ? { flow: true } : {}) };
    let job: StackJob = await getStackClient().submitJob({ kind: "media.check", input });
    const deadline = Date.now() + TIMEOUT_MS;
    while (["queued", "running", "paused", "stalled"].includes(job.state)) {
      if (Date.now() > deadline) return UNCHECKED;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      job = await getStackClient().job(job.id);
    }
    if (job.state !== "done" || !job.result || typeof job.result !== "object") return UNCHECKED;
    const result = job.result as ClipSeries;
    if (!Array.isArray(result.luma) || !Array.isArray(result.diff) || !Array.isArray(result.sharpness)) return UNCHECKED;
    return evaluateClipSeries(result, opts);
  } catch {
    return UNCHECKED;
  }
}
