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
import { videoJobLockItem, videoJobLockState, lockedJobView } from "@/lib/videos/lock";
import { adultStateOf } from "@/lib/adultMarks";
import { creationOfFile } from "@/lib/creations/store";
import { clipFindingLine, type ClipFinding } from "@/lib/videos/frameCheck";
import type { PersonRow } from "@/types";

/** The newest rows the feed shows. My clips is the library of everything. */
export const FEED_LIMIT = 30;

export type FeedStatus = "queued" | "generating" | "ready" | "failed" | "cancelled";
const STATUS: Record<VideoJob["state"], FeedStatus> = { queued: "queued", running: "generating", done: "ready", failed: "failed", cancelled: "cancelled" };

export interface FeedParams { favorites?: boolean; hidden?: boolean; type?: string; limit?: number }

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
export function feedRowOf(person: PersonRow, job: VideoJob, favorites: ReadonlySet<string>, takes = 1): Record<string, unknown> | null {
  // A chat's clips are not on this page; a clip made by the Studio's Export (an edit with no chat behind it) is an entry like any other.
  if (job.personId !== person.id || job.conversationId !== null) return null;
  // ADULT-LOCK-02: a locked job is the lock tile, built from nothing of the job (no prompt, tags, poster, clip, seed, size, level or favorite).
  if (videoJobLockState(person, job) !== "open") return lockedJobView(job);
  const file = job.state === "done" ? job.files[0] : undefined;
  if (job.state === "done" && (!file || !fileIsLive(person, file.id))) return null;
  const [w, h] = (job.request.size ?? "").split("x").map(Number);
  const create = job.request.create ?? {};
  const level = levelOfJob(job);
  const look = create.look ? videoLookFor(create.look) : null;
  const camera = create.recipe ? videoRecipeFor(create.recipe) : null;
  const edited = job.kind === "edit";
  // FEED-HIDE-01: the clip check's finding as one plain line (its words are the table beside CLIP_RULES); a clip that passed or was never checked has none.
  const findings = file ? (creationOfFile(person.id, file.id)?.checks as { clip?: { findings?: ClipFinding[] } } | null | undefined)?.clip?.findings : undefined;
  const checkNote = clipFindingLine(findings);
  const tags = [edited ? "Edited" : look?.label, edited ? undefined : camera?.label, edited ? undefined : LEVEL_LABEL[level], `${file?.seconds ?? job.request.seconds ?? 0} s`, file?.audio === true ? "With sound" : undefined, job.state === "done" && (job.request.madeSeconds ?? 0) >= 1 ? `Made in ${job.request.madeSeconds} s` : undefined, takes >= 2 ? `${takes} takes` : undefined, checkNote ?? undefined].filter((tag): tag is string => !!tag);
  const live = job.state === "running" ? liveCardFields(job.id, (version) => `/api/videos/jobs/${encodeURIComponent(job.id)}/preview?v=${version}`) : null;
  const adult = file && !job.temporary ? adultStateOf(person, file.id) : null;
  const hidden = job.request.hidden === true;
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
    ...(hidden ? { hidden: true } : {}),
    ...(file ? { can_hide: true } : {}),
    ...(job.request.anotherOf ? { parent_id: job.request.anotherOf } : {}),
    ...(takes >= 2 ? { takes } : {}),
    ...(checkNote ? { check_note: checkNote } : {}),
    ...(file ? { can_unmark: adult?.can_clear ?? false, can_mark: adult?.can_mark ?? false } : {}),
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
    // ADULT-LOCK-05: an open adult-only clip (unlocked, or the creator cleared the lock) plays only in its own page's player.
    ...(videoJobLockItem(job)?.madeAudience === "adult-only" ? { adult_only: true } : {}),
  };
}

/** The person's Create jobs, newest first (jobs made on this page: no chat behind them). */
function createJobsOf(person: PersonRow, limit: number): VideoJob[] {
  const ids = db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.personId, person.id), isNull(videoJobs.conversationId), inArray(videoJobs.kind, ["generate", "animate", "edit"]))).orderBy(desc(videoJobs.createdAt)).limit(limit).all();
  return ids.flatMap(({ id }) => { const job = getVideoJobFor(person, id); return job ? [job] : []; });
}

/** FEED-HIDE-01: the take count of each chain, keyed by the newest ready clip of the chain (jobs are newest first). A take's parent is the job named in `anotherOf` (Another take, Re-shoot, Next shot, an automatic retake); a chain is every ready, shown clip that reaches the same first clip. A chain of one has no entry. */
function takeCounts(jobs: readonly VideoJob[]): Map<string, number> {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const rootOf = (job: VideoJob): string => { let id = job.id; for (let step = 0; step < 50; step++) { const up = byId.get(id)?.request.anotherOf; if (!up) break; id = up; } return id; };
  const chains = new Map<string, string[]>();
  for (const job of jobs) if (job.state === "done" && job.request.hidden !== true) { const root = rootOf(job); chains.set(root, [...(chains.get(root) ?? []), job.id]); }
  const counts = new Map<string, number>();
  for (const ids of chains.values()) if (ids.length >= 2) counts.set(ids[0]!, ids.length);
  return counts;
}

/** `scope: "feed"`: the person's own clips, newest first, with the filters the feed writes (Favorites only, Hidden, Type). Hidden clips show only in the Hidden view. Stills have no rows until the still draft lands. */
export function feedRows(person: PersonRow, params: FeedParams): Array<Record<string, unknown>> {
  if (params.type === "still") return [];
  const limit = params.limit ?? FEED_LIMIT;
  // Reading more than the page shows lets a Favorites or Hidden filter still fill the feed, and lets a chain count its takes.
  const jobs = createJobsOf(person, params.favorites || params.hidden ? 200 : Math.min(limit * 3, 200));
  const favorites = favoriteFileIds(person, jobs.flatMap((job) => (job.state === "done" && job.files[0] ? [job.files[0].id] : [])));
  const takes = takeCounts(jobs);
  const rows: Array<Record<string, unknown>> = [];
  let lock = null as { locked: true; making: boolean } | null;
  for (const job of jobs) {
    const row = feedRowOf(person, job, favorites, takes.get(job.id) ?? 1);
    if (!row) continue;
    if (row.locked === true) {
      if (params.favorites || params.hidden) continue;
      lock = { locked: true, making: lock?.making === true || (row as { making?: boolean }).making === true }; continue;
    }
    if ((row.hidden === true) !== (params.hidden === true)) continue;
    if (params.favorites && row.favorite !== true) continue;
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return lock ? [lock, ...rows] : rows;
}

/** `scope: "job"`: one running row read by its id (what `poll_while.record` asks), or no rows when the job is not this person's Create job. */
export function feedRowById(person: PersonRow, id: string | undefined): Array<Record<string, unknown>> {
  const job = id ? getVideoJobFor(person, id) : null;
  if (!job) return [];
  const file = job.state === "done" ? job.files[0] : undefined;
  const row = feedRowOf(person, job, file ? favoriteFileIds(person, [file.id]) : new Set());
  return row ? [row] : [];
}
