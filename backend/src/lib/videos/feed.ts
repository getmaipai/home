// VIDEO-UI-06: the rows of the Create page's results feed, from the person's own video jobs (`recipes` data scope `feed`, and `job` for one
// running row). One row is one job in the kit `result_feed` shape: the words, tags, reference chips, status, percent, poster, clip address and
// favorite mark. A job that is not finished is a row too, so the entry that is being made is the newest card of the feed (RULES S6, one job's
// progress lives on that job's card). A finished clip whose Library file is gone or in Trash is not a row, so a withheld clip never shows here.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, videoJobs } from "@/db/schema";
import { getLive, liveCardFields } from "@/lib/genLive";
import { plainStageLabel } from "@/lib/jobQueueCopy";
import { clipUrl, getVideoJobFor, posterUrl, type VideoJob } from "@/lib/videos/jobs";
import { favoriteFileIds } from "@/lib/videos/favorites";
import { phaseLabel } from "@/lib/videos/phaseLabel";
import { videoLookFor, videoRecipeFor } from "@/lib/videos/recipes";
import { videoJobLockState, lockedJobView } from "@/lib/videos/lock";
import type { PersonRow } from "@/types";

/** The newest rows the feed shows. My clips is the library of everything. */
export const FEED_LIMIT = 30;

export type FeedStatus = "queued" | "generating" | "ready" | "failed" | "cancelled";
const STATUS: Record<VideoJob["state"], FeedStatus> = { queued: "queued", running: "generating", done: "ready", failed: "failed", cancelled: "cancelled" };

export interface FeedParams { favorites?: boolean; type?: string; limit?: number }

const LEVEL_LABEL = { standard: "Standard", boost: "Boost", max: "Max" } as const;

/** The level a job ran at, as the level segment names it. The job's own `request.tier` is already what it ran at (Max only when the Max model made it);
 * an older job without one is Standard, or Boost when it was a Detailed clip. */
export function levelOfJob(job: VideoJob): keyof typeof LEVEL_LABEL {
  return job.request.tier ?? (job.request.quality === "detailed" ? "boost" : "standard");
}

/** The plain line while a job waits or runs: the same words the chat card uses, plus the one note a cut length carries. */
function phaseOf(job: VideoJob): string {
  const line = job.state === "running" ? plainStageLabel(getLive(job.id)?.stageLabel, "adult") ?? phaseLabel(job, "adult") : phaseLabel(job, "adult");
  return job.request.create?.note ? `${line} ${job.request.create.note}` : line;
}

function fileIsLive(person: PersonRow, fileId: string): boolean {
  const row = db.select({ deletedAt: attachments.deletedAt, owner: attachments.ownerPersonId }).from(attachments).where(eq(attachments.id, fileId)).get();
  return !!row && row.deletedAt === null && row.owner === person.id;
}

/** One job as a feed row, or null when it should not show (an edit, a chat clip, a finished clip whose file is gone). */
export function feedRowOf(person: PersonRow, job: VideoJob, favorites: ReadonlySet<string>): Record<string, unknown> | null {
  if (job.personId !== person.id || job.conversationId !== null || job.kind === "edit") return null;
  // ADULT-LOCK-02: a locked job is the lock tile, built from nothing of the job (no prompt, tags, poster, clip, seed, size, level or favorite).
  if (videoJobLockState(person, job) !== "open") return lockedJobView(job);
  const file = job.state === "done" ? job.files[0] : undefined;
  if (job.state === "done" && (!file || !fileIsLive(person, file.id))) return null;
  const [w, h] = (job.request.size ?? "").split("x").map(Number);
  const create = job.request.create ?? {};
  const level = levelOfJob(job);
  const look = create.look ? videoLookFor(create.look) : null;
  const camera = create.recipe ? videoRecipeFor(create.recipe) : null;
  const tags = [look?.label, camera?.label, LEVEL_LABEL[level], `${file?.seconds ?? job.request.seconds ?? 0} s`, file?.audio === true ? "With sound" : undefined].filter((tag): tag is string => !!tag);
  const live = job.state === "running" ? liveCardFields(job.id, (version) => `/api/videos/jobs/${encodeURIComponent(job.id)}/preview?v=${version}`) : null;
  return {
    id: job.id,
    prompt: job.prompt,
    tags,
    references: job.request.source_file_id ? [{ label: "Start frame", thumb: `/api/files/${encodeURIComponent(job.request.source_file_id)}/thumb?w=320` }] : [],
    status: STATUS[job.state],
    state: job.state,
    percent: job.state === "done" ? 100 : job.state === "running" && job.percent > 0 ? job.percent : null,
    phase: job.state === "queued" || job.state === "running" ? phaseOf(job) : null,
    queue_position: job.state === "queued" ? job.position : null,
    started_at: new Date(job.createdAt).getTime(),
    error: job.state === "failed" ? job.error ?? "It did not finish. Try again." : null,
    still: file ? posterUrl(job, file) : live?.preview_url ?? null,
    src: file ? clipUrl(job, file) : null,
    favorite: file ? favorites.has(file.id) : false,
    created_at: job.createdAt,
    // Remix and the like fill `{look}` into the page's state; an absent value is "" (a null would leave the placeholder text in place).
    look: create.look ?? "",
    camera: create.recipe ?? "",
    start_frame: job.request.source_file_id ?? "",
    seconds: job.request.seconds,
    tier: level,
    orientation: w && h && h > w ? "portrait" : "landscape",
    width: file?.width ?? w ?? null,
    height: file?.height ?? h ?? null,
    kind: "video",
  };
}

/** The person's Create jobs, newest first (jobs made on this page: no chat behind them). */
function createJobsOf(person: PersonRow, limit: number): VideoJob[] {
  const ids = db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.personId, person.id), isNull(videoJobs.conversationId), inArray(videoJobs.kind, ["generate", "animate"]))).orderBy(desc(videoJobs.createdAt)).limit(limit).all();
  return ids.flatMap(({ id }) => { const job = getVideoJobFor(person, id); return job ? [job] : []; });
}

/** `scope: "feed"`: the person's own clips, newest first, with the filters the feed writes (Favorites only, Type). Stills have no rows until the still draft lands. */
export function feedRows(person: PersonRow, params: FeedParams): Array<Record<string, unknown>> {
  if (params.type === "still") return [];
  // Reading more than the page shows lets a Favorites filter still fill the feed.
  const jobs = createJobsOf(person, params.favorites ? 200 : Math.min(params.limit ?? FEED_LIMIT, 200));
  const favorites = favoriteFileIds(person, jobs.flatMap((job) => (job.state === "done" && job.files[0] ? [job.files[0].id] : [])));
  const rows: Array<Record<string, unknown>> = [];
  let lock = null as { locked: true; making: boolean } | null;
  for (const job of jobs) {
    const row = feedRowOf(person, job, favorites);
    if (!row || (params.favorites && row.favorite !== true && row.locked !== true)) continue;
    // One tile for any number of locked jobs: the screen leaks neither a count nor an order (it always leads the feed).
    if (row.locked === true) { lock = { locked: true, making: lock?.making === true || (row as { making?: boolean }).making === true }; continue; }
    rows.push(row);
    if (rows.length >= (params.limit ?? FEED_LIMIT)) break;
  }
  return lock && !params.favorites ? [lock, ...rows] : rows;
}

/** `scope: "job"`: one running row read by its id (what `poll_while.record` asks), or no rows when the job is not this person's Create job. */
export function feedRowById(person: PersonRow, id: string | undefined): Array<Record<string, unknown>> {
  const job = id ? getVideoJobFor(person, id) : null;
  if (!job) return [];
  const file = job.state === "done" ? job.files[0] : undefined;
  const row = feedRowOf(person, job, file ? favoriteFileIds(person, [file.id]) : new Set());
  return row ? [row] : [];
}
