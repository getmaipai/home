import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { listVersions } from "@/lib/imageEdit";
import { routeAudience } from "@/lib/pictures/audience";
import { musicViewDenial } from "./policy";
import { adultAdaptersAllowed, pictureDenial, refusePrompt } from "@/lib/pictures/policy";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { laneOf } from "@/lib/pictures/lane";
import { QUICK_MODEL } from "@/lib/pictures/quality";
import { startPictureJob, getPictureJob, type PictureJob } from "@/lib/pictures/jobs";
import { getMusicJobFor, saveMusicJob } from "./store";
import type { MusicJob, MusicRequest } from "./types";
import type { PersonRow } from "@/types";

export function coverPromptFor(request: MusicRequest): string {
  const title = request.title?.trim();
  const description = request.description.trim();
  const lines = request.instrumental ? [] : (request.lyrics ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^\[.*\]$/.test(line)).slice(0, 2);
  const subject = `Album cover art for a song${title ? ` called ${title}` : ""}${description ? `: ${description}` : ""}.`;
  const content = `${subject}${lines.length ? ` Theme: ${lines.join(" ")}.` : ""}`;
  return `${content.slice(0, 578)} No text, no letters.`;
}

/** Uses the picture's stored result, including after Home resumes a picture job. */
export function finishSongCover(picture: PictureJob): void {
  if (picture.state !== "done" || !picture.files[0]) return;
  db.update(musicJobs).set({ coverFileId: picture.files[0].id, updatedAt: new Date().toISOString(), hlc: nextHlc() })
    .where(and(eq(musicJobs.coverJobId, picture.id), eq(musicJobs.personId, picture.personId))).run();
}

/** Covers are optional: every refusal and failure leaves the song alone. */
const starting = new Set<string>();
function songCoverBusy(actor: PersonRow, job: MusicJob): boolean {
  const previous = job.coverJobId ? getPictureJob(actor, job.coverJobId) : null;
  return starting.has(job.id) || previous?.state === "queued" || previous?.state === "running";
}
export async function startSongCover(actor: PersonRow, job: MusicJob, options: { seed?: number; prompt?: string } = {}): Promise<"busy" | void> {
  if (songCoverBusy(actor, job)) return "busy";
  starting.add(job.id);
  try {
    const audience = routeAudience(actor);
    if (job.personId !== actor.id || !["queued", "running", "done"].includes(job.state) || job.temporary || !job.conversationId || !job.turnId || musicViewDenial(audience) || pictureDenial(audience)) return;
    const prompt = options.prompt?.trim() || coverPromptFor(job.request);
    if (job.request.imitates_real_voice === true || refusePrompt(prompt, { lane: laneOf(audience) }) || !(await pictureEngineReady())) return;
    const current = getMusicJobFor(actor, job.id);
    if (!current) return;
    const previous = current.coverJobId ? getPictureJob(actor, current.coverJobId) : null;
    if (previous && (previous.state === "queued" || previous.state === "running")) return "busy";
    const seed = options.seed ?? ((previous?.request.seed ?? Math.floor(Math.random() * 2147483647)) + 1) % 2147483647;
    const versions = current.coverFileId ? listVersions(actor, job.conversationId, current.coverFileId) : [];
    const source = versions.at(-1)?.id;
    // Covers stay conversation attachments so Files shows them like any made picture.
    const picture = await startPictureJob({ actor, conversationId: job.conversationId, turnId: job.turnId, temporary: false,
      purpose: "cover", kind: "generate", prompt, body: { prompt, model: QUICK_MODEL, size: "1024x1024", n: 1, seed, audience: adultAdaptersAllowed() ? "adult" : "all-ages" },
      ...(source ? { edit: { sourceId: source, label: "New cover", method: "instruct" as const } } : {}),
    });
    const latest = getMusicJobFor(actor, job.id);
    if (!latest) return;
    latest.coverJobId = picture.id;
    saveMusicJob(latest);
    // An immediate picture result can settle before its id is linked to the song.
    finishSongCover(picture);
  } catch { /* A cover never fails the song. */ }
  finally { starting.delete(job.id); }
}
