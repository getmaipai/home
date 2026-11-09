// VIDEOS-PARITY: the one notification when a clip made at home finishes ("videos.clip_ready", declared in the Videos manifest). Only a clip started from the
// Create page counts (a clip made inside a chat shows in that chat); a failure here never touches the clip.
import { trigger } from "@/lib/notifications";
import type { PersonRow } from "@/types";
import type { VideoJob } from "./jobs";
import { videoJobLockItem } from "./lock";

export const CLIP_READY_TYPE = "videos.clip_ready";

export async function notifyClipReady(job: VideoJob, actor: PersonRow): Promise<void> {
  if (job.conversationId !== null || job.temporary || job.state !== "done" || job.files.length === 0) return;
  // A locked clip (an adult-audience clip) is never named: the bell says only that a video is ready (ADULT-LOCK: no lock item in a notification).
  const locked = videoJobLockItem(job) !== null;
  const title = locked ? "" : job.prompt.replace(/\s+/g, " ").trim();
  try {
    await trigger(CLIP_READY_TYPE, { title: title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title || "Your video" }, { personId: actor.id, repeatKey: job.id });
  } catch (error) {
    console.error(`[videos] could not send the clip-ready notice: ${error instanceof Error ? error.message : String(error)}`);
  }
}
