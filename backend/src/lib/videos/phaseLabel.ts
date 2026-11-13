// The one plain line for what a video job is doing now (queued, held, or a stage of the render). Shared by the chat card's route
// (routes/videos.ts) and the Create page's feed rows (lib/videos/feed.ts), so both say the same words.
import { PERSISTED_HOLDS, pendingFitAsk, type PersistedHold } from "@/lib/jobs/householdQueue";
import { jobQueueCopy, JOB_QUEUE_COPY } from "@/lib/jobQueueCopy";
import { videoWaitLine } from "@/lib/videos/waitLine";
import type { VideoJob } from "@/lib/videos/jobs";

/** REFVIDEO-01: the phase of a video being made from reference sheets. */
export const REFERENCE_PHASE = "making from the sheet";
/** REFVIDEO-FIRSTFRAME-01: the phase of a video made from a first picture (a real person's face). */
export const FIRST_FRAME_PHASE = "making from the first picture";

export function phaseLabel(job: VideoJob, audience: "adult" | "child"): string {
  const hold = job.riseReason ?? (job.phase?.startsWith("held:") ? job.phase.slice(5) : null);
  if (hold === "tier_ask" && audience === "adult") { const line = pendingFitAsk(job.id)?.line; if (line) return line; }
  if (hold && PERSISTED_HOLDS.includes(hold)) return jobQueueCopy("queued", hold as PersistedHold, job.position, null, audience);
  const stackWait = videoWaitLine(job.phase, audience);
  if (stackWait) return stackWait;
  if (job.phase === "paused while chat is working") return jobQueueCopy("paused_chat", "paused_chat", null, null, audience);
  if (job.phase === "paused: low memory") return JOB_QUEUE_COPY.picture_paused_memory[audience];
  // A job waiting on memory is not waiting in a line: with nothing ahead of it, "You are next" is wrong, so it gets the memory words.
  if (job.phase === "waiting for memory") return jobQueueCopy("waiting_memory", job.riseReason ?? "memory_elsewhere", job.position, null, audience);
  if (job.state === "queued" || job.phase === "queued") return jobQueueCopy("queued", job.riseReason ?? "queue", job.position, job.estimateSeconds ?? null, audience);
  if (job.phase === "setting up") return "Setting up the video model for the first time";
  if (job.phase === "starting" || job.phase === "loading") return "Getting the video model ready";
  if (job.phase === "rendering") return "Drawing the frames";
  if (job.phase === "decoding") return "Finishing the frames";
  if (job.phase === "encoding") return "Putting the video together";
  if (job.phase === REFERENCE_PHASE) return "Making your video from the sheet";
  if (job.phase === FIRST_FRAME_PHASE) return "Making your video from the first picture";
  if (job.phase === "editing") return "Putting your edit together";
  if (job.phase === "placing the sound") return "Placing the sound";
  return "Making your video";
}
