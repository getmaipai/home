// ACTIVITY-PAGE-01 (PRO-LOOK-01 sections 20 to 25; RULES.md S6 "One job's progress" and the Activity row): the viewer's own jobs across
// apps as one list, read from the job records that already exist (picture_jobs, video_jobs, music_jobs and the unified jobs table). No new
// table, no new poller. Rule 6a: only the viewer's own rows, an admin included. A locked or adult-only item is left out entirely (the same
// lock checks as the Library), so this list never names one. A child's titles are the child-safe label, never the prompt.
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { activityDismissals, attachments, musicJobs, pictureJobs, videoJobs } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import { jobQueueCopy, plainStageLabel, type JobQueueAudience } from "@/lib/jobQueueCopy";
import { listJobsForViewer } from "@/lib/jobs";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { getPictureJob } from "@/lib/pictures/jobStore";
import { pictureJobLockState } from "@/lib/pictures/lock";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { phaseLabel } from "@/lib/videos/phaseLabel";
import { videoJobLockState } from "@/lib/videos/lock";
import { musicJobLockState } from "@/lib/music/lock";
import { getMusicJobFor } from "@/lib/music/store";
import { getPersonSettingValue, readLayerRow, setValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

/** The five states of the one status card (section 20): WAITING, MAKING NOW, DONE, NEEDS A LOOK, COULD NOT FINISH. */
export type ActivityState = "waiting" | "making" | "done" | "attention" | "failed";
export type ActivitySource = "picture" | "video" | "song" | "job";

export interface ActivityItem {
  id: string;
  source: ActivitySource;
  state: ActivityState;
  /** The person's own prompt or title in one line; a child gets the child-safe label. */
  title: string;
  /** One muted line: the waiting line, the stage, or the failure with its next step. Null when there is nothing to add. */
  line: string | null;
  /** 0 to 100 while making and a figure is known, else null. */
  percent: number | null;
  /** About how many minutes a job of this kind usually takes, for a making job with no percent yet. */
  typicalMinutes: number | null;
  /** Where Open goes: the result, or the app's own page. */
  href: string | null;
  /** Epoch-ish ISO time of the last change (what the list sorts and groups by). */
  at: string;
}

export type ActivityDot = "none" | "running" | "attention" | "finished";

export interface ActivityList {
  items: ActivityItem[];
  /** When the person last opened the Activity page (ISO), or null. */
  seenAt: string | null;
  dot: ActivityDot;
}

export const ACTIVITY_SEEN_KEY = "ui.activity_seen_at";
const WINDOW_MS = 30 * 24 * 3_600_000;
const PER_SOURCE_LIMIT = 60;

const audienceOf = (actor: PersonRow): JobQueueAudience => (speakerAgeBand(actor, new Date()) === "child" ? "child" : "adult");

function oneLine(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const CHILD_LABEL: Record<Exclude<ActivitySource, "job">, string> = { picture: "A picture", video: "A video", song: "A song" };
const CHILD_FAILED_LINE = "That did not work. Try again, or ask a grown-up to help.";
const TYPICAL_MINUTES: Record<Exclude<ActivitySource, "job">, number> = { picture: 1, video: 3, song: 2 };

function titleFor(actor: PersonRow, source: Exclude<ActivitySource, "job">, text: string, fallback: string): string {
  if (audienceOf(actor) === "child") return CHILD_LABEL[source];
  return oneLine(text) || fallback;
}

function percentOf(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.min(99, Math.round(value)));
}

function recent(at: string): boolean {
  const time = Date.parse(at);
  return Number.isFinite(time) && Date.now() - time <= WINDOW_MS;
}

function fileIsLive(actor: PersonRow, fileId: string): boolean {
  const row = db.select({ deletedAt: attachments.deletedAt, owner: attachments.ownerPersonId }).from(attachments).where(eq(attachments.id, fileId)).get();
  return !!row && row.deletedAt === null && row.owner === actor.id;
}

function fileIsOpenFor(actor: PersonRow, fileId: string): boolean {
  const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, fileId)).get();
  const item = row ? lockItemOfProvenance(row.owner, row.provenance) : null;
  return lockState(item, actor) === "open";
}

function pictureItems(actor: PersonRow): ActivityItem[] {
  const audience = audienceOf(actor);
  const ids = db.select({ id: pictureJobs.id }).from(pictureJobs)
    .where(and(eq(pictureJobs.personId, actor.id), isNull(pictureJobs.purpose))).orderBy(desc(pictureJobs.updatedAt)).limit(PER_SOURCE_LIMIT).all();
  const out: ActivityItem[] = [];
  for (const { id } of ids) {
    const job = getPictureJob(actor, id);
    if (!job || job.state === "cancelled" || !recent(job.updatedAt)) continue;
    if (pictureJobLockState(actor, job) !== "open") continue;
    const href = job.conversationId ? `/chat?conversation=${encodeURIComponent(job.conversationId)}` : "/files";
    const title = titleFor(actor, "picture", job.prompt, "A picture");
    const base = { id: `picture:${job.id}`, source: "picture" as const, title, at: job.updatedAt, href };
    if (job.state === "queued") out.push({ ...base, state: "waiting", line: jobQueueCopy("queued", "queue", job.position, null, audience), percent: null, typicalMinutes: null });
    else if (job.state === "running") out.push({ ...base, state: "making", line: plainStageLabel(job.phase, audience) ?? "Making your picture.", percent: percentOf(job.percent), typicalMinutes: TYPICAL_MINUTES.picture });
    else if (job.state === "failed") out.push({ ...base, state: "failed", line: audience === "child" ? CHILD_FAILED_LINE : job.error ?? "The picture did not finish. Try again.", percent: null, typicalMinutes: null });
    else out.push({ ...base, state: "done", line: null, percent: null, typicalMinutes: null });
  }
  return out;
}

function videoItems(actor: PersonRow): ActivityItem[] {
  const audience = audienceOf(actor);
  const ids = db.select({ id: videoJobs.id }).from(videoJobs).where(eq(videoJobs.personId, actor.id)).orderBy(desc(videoJobs.updatedAt)).limit(PER_SOURCE_LIMIT).all();
  const out: ActivityItem[] = [];
  for (const { id } of ids) {
    const job = getVideoJobFor(actor, id);
    if (!job || job.state === "cancelled" || !recent(job.updatedAt)) continue;
    if (videoJobLockState(actor, job) !== "open") continue;
    // A finished clip whose Library file is gone is not a result (the Create feed drops it the same way).
    if (job.state === "done" && (!job.files[0] || !fileIsLive(actor, job.files[0].id))) continue;
    const href = job.conversationId ? `/chat?conversation=${encodeURIComponent(job.conversationId)}` : "/apps/videos/create";
    const title = titleFor(actor, "video", job.prompt, "A video");
    const base = { id: `video:${job.id}`, source: "video" as const, title, at: job.updatedAt, href };
    if (job.state === "queued") out.push({ ...base, state: "waiting", line: phaseLabel(job, audience), percent: null, typicalMinutes: null });
    else if (job.state === "running") out.push({ ...base, state: "making", line: phaseLabel(job, audience), percent: percentOf(job.percent), typicalMinutes: TYPICAL_MINUTES.video });
    else if (job.state === "failed") out.push({ ...base, state: "failed", line: audience === "child" ? CHILD_FAILED_LINE : job.error ?? "The video did not finish. Try again.", percent: null, typicalMinutes: null });
    else out.push({ ...base, state: "done", line: null, percent: null, typicalMinutes: null });
  }
  return out;
}

function songItems(actor: PersonRow): ActivityItem[] {
  const audience = audienceOf(actor);
  const rows = db.select().from(musicJobs).where(and(eq(musicJobs.personId, actor.id), inArray(musicJobs.task, ["text2music"]))).orderBy(desc(musicJobs.updatedAt)).limit(PER_SOURCE_LIMIT).all();
  const out: ActivityItem[] = [];
  for (const row of rows) {
    if (row.state === "cancelled" || !recent(row.updatedAt)) continue;
    const job = getMusicJobFor(actor, row.id);
    if (job && musicJobLockState(job, actor) !== "open") continue;
    if (row.fileId && !fileIsOpenFor(actor, row.fileId)) continue;
    let request: { title?: string; description?: string } = {};
    try { request = JSON.parse(row.request) as typeof request; } catch { request = {}; }
    const title = titleFor(actor, "song", request.title ?? request.description ?? "", "A song");
    const base = { id: `song:${row.id}`, source: "song" as const, title, at: row.updatedAt, href: `/apps/music/create?song=${encodeURIComponent(row.id)}` };
    if (row.state === "queued") out.push({ ...base, state: "waiting", line: jobQueueCopy("queued", "queue", row.position, null, audience), percent: null, typicalMinutes: null });
    else if (row.state === "running") out.push({ ...base, state: "making", line: plainStageLabel(row.stage, audience) ?? "Making your song.", percent: percentOf(row.progress * 100), typicalMinutes: TYPICAL_MINUTES.song });
    else if (row.state === "failed") out.push({ ...base, state: "failed", line: audience === "child" ? CHILD_FAILED_LINE : row.errorLine ?? "The song did not finish. Open it to try again.", percent: null, typicalMinutes: null });
    else out.push({ ...base, state: "done", line: null, percent: null, typicalMinutes: null });
  }
  return out;
}

const OTHER_JOB_KINDS = new Set(["backup", "import", "chat_plan", "approval", "chat_ask"]);

/** The rest of the viewer's own work from the unified job list (a backup, a chat plan, a question waiting on them). Already per viewer; only
 * their own rows with a state and a title come through, never a row about someone else and never a reminder or routine. */
function otherItems(actor: PersonRow): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const row of listJobsForViewer(actor)) {
    const kind = String(row.kind ?? "");
    if (!OTHER_JOB_KINDS.has(kind) || row.forPersonName !== undefined || typeof row.title !== "string" || typeof row.state !== "string") continue;
    if (row.forPerson !== undefined && row.forPerson !== null && row.forPerson !== actor.id) continue;
    const at = String(row.updatedAt ?? row.createdAt ?? "");
    if (!recent(at)) continue;
    const state: ActivityState | null = row.state === "waiting_for_you" ? "attention" : row.state === "queued" ? "waiting" : row.state === "running" || row.state === "paused" ? "making" : row.state === "done" ? "done" : row.state === "failed" ? "failed" : null;
    if (!state) continue;
    const conversationId = typeof row.conversationId === "string" ? row.conversationId : null;
    const href = conversationId ? `/chat?conversation=${encodeURIComponent(conversationId)}` : kind === "backup" || kind === "import" ? "/backups" : null;
    const line = state === "attention" ? "This is waiting for your answer." : state === "failed" ? "It did not finish. Open it to try again." : null;
    out.push({ id: `job:${String(row.id)}`, source: "job", state, title: oneLine(row.title), line, percent: null, typicalMinutes: null, href, at });
  }
  return out;
}

/** The dot an Activity entry carries (section 25): needs a look wins, then finished and unopened, then running; no number. */
export function activityDot(items: readonly ActivityItem[], seenAt: string | null): ActivityDot {
  const seen = seenAt ? Date.parse(seenAt) : 0;
  const unseen = (item: ActivityItem) => Date.parse(item.at) > seen;
  if (items.some((item) => item.state === "attention" || (item.state === "failed" && unseen(item)))) return "attention";
  if (items.some((item) => item.state === "done" && unseen(item))) return "finished";
  if (items.some((item) => item.state === "waiting" || item.state === "making")) return "running";
  return "none";
}

/** The registry key `ui.activity_seen_at` (a text setting, person scope), read through the settings API like `ui.home_order`.
 * A value an older build stored as a JSON string in the same row is read once and rewritten as the plain registry value. */
export function activitySeenAt(actor: PersonRow): string | null {
  const valid = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
  const current = getPersonSettingValue(actor, ACTIVITY_SEEN_KEY);
  if (valid(current)) return current;
  const legacy = readLayerRow(actor.id, ACTIVITY_SEEN_KEY);
  if (!legacy) return null;
  try {
    const value: unknown = JSON.parse(legacy);
    if (!valid(value)) return null;
    setValue(actor, `person:${actor.id}`, ACTIVITY_SEEN_KEY, value);
    return value;
  } catch { return null; }
}

/** The person opened the Activity page: everything finished so far stops counting as unopened. */
export function markActivitySeen(actor: PersonRow, now = new Date()): string {
  const at = now.toISOString();
  setValue(actor, `person:${actor.id}`, ACTIVITY_SEEN_KEY, at);
  return at;
}

/** ACTIVITY-CLEAR-01: the row keys this person cleared from their own list. */
function dismissedKeys(actor: PersonRow): Set<string> {
  return new Set(db.select({ key: activityDismissals.rowKey }).from(activityDismissals).where(eq(activityDismissals.personId, actor.id)).all().map((row) => row.key));
}

function allItems(actor: PersonRow): ActivityItem[] {
  return [...pictureItems(actor), ...videoItems(actor), ...songItems(actor), ...otherItems(actor)].sort((a, b) => b.at.localeCompare(a.at));
}

/** The viewer's own work, newest change first, without the rows they cleared. */
export function activityForViewer(actor: PersonRow): ActivityList {
  const hidden = dismissedKeys(actor);
  const items = allItems(actor).filter((item) => !hidden.has(item.id));
  const seenAt = activitySeenAt(actor);
  return { items, seenAt, dot: activityDot(items, seenAt) };
}

/** Only a finished row can be cleared: done, could not finish, or needs a look. Waiting and making rows never are. */
export const isClearable = (item: ActivityItem): boolean => item.state === "done" || item.state === "failed" || item.state === "attention";

const DISMISSAL_KEEP_MS = 60 * 24 * 3_600_000;

/** Hide finished rows from this person's Activity list only. Names a key (or `all`); a key that is not one of the person's own visible
 * finished rows is ignored, so nothing about another person's work or a locked item is stored. The job and its files are never touched. */
export function clearActivity(actor: PersonRow, request: { keys?: string[]; all?: boolean }, now = new Date()): ActivityList {
  const hidden = dismissedKeys(actor);
  const wanted = request.all ? null : new Set(request.keys ?? []);
  const keys = allItems(actor).filter((item) => isClearable(item) && !hidden.has(item.id) && (wanted === null || wanted.has(item.id))).map((item) => item.id);
  const at = now.toISOString();
  if (keys.length) db.insert(activityDismissals).values(keys.map((rowKey) => ({ personId: actor.id, rowKey, dismissedAt: at }))).onConflictDoNothing().run();
  // A cleared key only matters while its job can still be listed (30 days), so old ones are dropped.
  db.delete(activityDismissals).where(and(eq(activityDismissals.personId, actor.id), lt(activityDismissals.dismissedAt, new Date(now.getTime() - DISMISSAL_KEEP_MS).toISOString()))).run();
  return activityForViewer(actor);
}

/** The viewer's own pictures, clips and songs that are waiting or being made, as rows of the unified job list (`GET /api/jobs`). This is how the
 * progress strip (`InstallDock`) learns about them without a second poll: the strip already reads that list. Each row is the viewer's own; a
 * stop is not offered here (the producers own their cancel routes). */
export function activeGenerationRows(actor: PersonRow): Record<string, unknown>[] {
  const items = [...pictureItems(actor), ...videoItems(actor), ...songItems(actor)];
  return items.filter((item) => item.state === "waiting" || item.state === "making").map((item) => ({
    id: item.id, kind: item.source, startedBy: actor.id, forPerson: actor.id, title: item.title, state: item.state === "waiting" ? "queued" : "running",
    progress: { percent: item.percent ?? 0, ...(item.line ? { line: item.line } : {}) }, createdAt: item.at, updatedAt: item.at, actions: [],
  }));
}
