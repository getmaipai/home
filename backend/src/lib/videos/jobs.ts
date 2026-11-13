// VIDEO-GEN-05: a video job from the person's side. The chat card polls Home (never the Stack); Home polls the
// Stack, stores each finished clip as the person's own file, and keeps one honest line when something fails
// (rule 6: a failed video never fails the answer). A temporary or Incognito chat keeps the job and its clip in
// memory only (a two-hour window, gone with the chat); every other job is a row in `video_jobs` so a reload, a
// second device and a restart all show the same card. Same shape as lib/pictures/jobs.ts, on purpose.
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, people, videoJobs } from "@/db/schema";
import { createAttachment, getTemporaryChatImage, latestGeneratedTemporaryImage, readAttachment, readAttachmentForConversation, registerTemporaryMedia, storeFile, purgeFileRecord, removeFileBlobs } from "@/lib/attachments";
import { notifyClipReady } from "./clipNotice";
import { newCreationId, newFileId, newVideoJobId } from "@/lib/id";
import { recordClipCreation, safely } from "@/lib/creations/writers";
import { nextHlc } from "@/lib/hlc";
import { setShotClip } from "@/lib/mediaProductions";
import { requestTier, refreshHouseholdQueue, registerQueueProvider, releaseHouseholdQueue, requeueAfterCritical, holdMaxAfterMemoryRefusal, type QueueJob, PERSISTED_HOLDS, type PersistedHold } from "@/lib/jobs/householdQueue";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import type { PersonRow } from "@/types";
import { getLoraRecord } from "@/lib/loras/store";
import { usesAdultOnlyStyle } from "./adultStyle";
import { wireLoras } from "./loraWire";
import { markFields, newItemMark } from "@/lib/adultLock";
import { logAutoMark } from "@/lib/adultMarks";
import { checkImages, isAdultOnlyJob } from "@/lib/pictures/ageCheck";
import { gateFinished, laneOfPerson } from "@/lib/pictures/laneGate";
import { videoModelForLane } from "@/lib/pictures/lane";
import { speakerAgeBand } from "@/lib/ageBand";
import { videoBodyForSlot } from "./slotBody";
import { LTX25_DEFAULTS, LTX25_MAX_DEFAULTS, LTX25_MAX_MODEL, LTX25_MODEL } from "./quality";
import { videoEngineStatus } from "./ready";
import { ensureKeyframeHelper, extractKeyframes } from "@/lib/pictures/keyframes";
import { clearLive, updateLive } from "@/lib/genLive";
import { cancelOrDeleteVideo, fetchClip, fetchPoster, fetchVideoPreview, getVideoJob, StackVideoError, submitVideo, type StackClip, type VideoBody } from "./stack";
import { fullViewForJob, type FullView } from "@/lib/stack/fullView";

export type VideoJobKind = "generate" | "animate" | "edit";
export type VideoJobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface VideoFile {
  /** The clip (video/mp4). */
  id: string;
  /** Its poster (image/jpeg, frame 0). */
  poster_id: string;
  width: number;
  height: number;
  seconds: number | null;
  seed: number | null;
  model: string | null;
  ms: number | null;
  bytes: number;
  /** VIDEO-LTX-01: which kind made the clip, and whether it has a sound track the model made (absent on a clip stored before: Quick, silent). */
  quality?: "quick" | "detailed";
  audio?: boolean;
  /** SPATIAL-04: set only on the 5.1 sibling of a spatial-sound clip ("surround_5_1"). `files[0]` is always the stereo clip; the sibling shares its poster. */
  role?: "stereo" | "surround_5_1";
}

/** REFVIDEO-STEPS-01: where a video made from pictures is, in its two steps. Kept on the job's request so the card and a restart read the same state. */
export interface ReferenceProgress {
  /** 1: the reference sheet (or, on the first-picture route, the first picture), 2: the video. */
  step: 1 | 2;
  /** REFVIDEO-FIRSTFRAME-01: absent on the sheet route; "first_frame" when step 1 makes the clip's first picture (a real person's face). The card's step names follow it. */
  route?: "first_frame";
  /** Step 1: sub-steps done of total, and the plain sentence for the one in hand. */
  sheet: { done: number; total: number; line: string };
  /** Step 2: the clip's percent; `waiting` while the Stack holds the job without a worker running; `line` is the plain sentence. */
  clip: { percent: number; waiting: boolean; line: string };
}
/** The whole job's percent: the sheet is the first fifth, the clip the rest. */
export function referencePercent(progress: ReferenceProgress): number {
  if (progress.step === 1) return Math.round(20 * Math.max(0, Math.min(1, progress.sheet.done / Math.max(1, progress.sheet.total))));
  return Math.max(20, Math.min(99, Math.round(20 + 0.8 * progress.clip.percent)));
}
/** What the run of a video from pictures may tell the job while it works. */
export interface EditHooks {
  /** Change the two-step progress (the job saves it and its percent). */
  steps(change: (progress: ReferenceProgress) => void): void;
  /** The sheet is made and kept: the job now carries its recipe (the sheet picture shows on the card from here). */
  recipe(recipe: ReferenceRecipe): void;
  /** REFVIDEO-FIRSTFRAME-01: the run learned what the clip really is (its size, length, kind and level); the job's request takes it. */
  request(patch: Partial<VideoRequest>): void;
}

/** What the person asked for, kept on their own job record (never in a log). */
/** REFVIDEO-01: everything a video made from reference sheets needs to be made again or edited without redoing the sheets. Stored on the job's request, so it survives a restart. */
export interface ReferenceRecipe {
  v: 1;
  /** The sheet PNGs (kept attachments of the person), in the order they went to the Stack (one or two). */
  sheetFileIds: string[];
  /** The "Reference sheet: ..." text of every sheet (the second one starts "Second reference sheet:"). */
  description: string;
  /** The "Generated video" paragraph: the person's request rewritten around the sheet panels. */
  request: string;
  /** The whole prompt the Stack received: the description, a blank line, "Generated video: " and the paragraph. */
  prompt: string;
  seed: number | null;
  seconds: number;
  /** Every panel: its subject name, view, slot on the sheet, which sheet it is on, and the attached pictures (file ids) it came from. */
  panels: Array<{ name: string; view: string; slot: string; sheet: number; pictures: string[] }>;
  pictureFileIds: string[];
  /** Per sheet: the person's own picture was already a sheet and was used as provided. */
  providedAsIs: boolean[];
  /** REFVIDEO-FIRSTFRAME-01: absent (or "sheet") for the sheet route; "first_frame" when `sheetFileIds[0]` is the clip's FIRST PICTURE (a real person's face is in frame 0, image-to-video) and `prompt` is just the paragraph. */
  route?: "sheet" | "first_frame";
  /** First-picture route: how the first picture was made ("composed": the edit model placed the people and every face passed the check; "pasted": the people's own cut-outs pasted over the place; "photo": the attached photo itself), the plain notes about what could not be done exactly, and each person: their face against their own photo in the first picture, and their own photo's face (SFace vector) that the finished clip is measured against. */
  firstPicture?: { how: "composed" | "pasted" | "photo"; notes: string[]; people: Array<{ name: string; score: number | null; face: number[] | null }> };
  /** First-picture route: the face check of the finished clip (6 frames, SFace cosine against each person's photo). Measured only; it never blocks the clip. */
  faceMatch?: { frames: number; people: Array<{ name: string; scores: number[]; median: number | null }>; threshold: number; low: boolean };
}

export interface VideoRequest {
  size: string;
  seconds: number;
  seed: number | null;
  loras: string[];
  /** The generated picture a clip starts from (an attachment id in this conversation), or null. */
  source_file_id: string | null;
  end_file_id?: string | null;
  production_id?: string;
  shot_id?: string;
  audience: "all-ages" | "adult";
  /** VIDEO-LTX-01: Quick or Detailed (absent on a job stored before the choice existed: Quick). */
  quality?: "quick" | "detailed";
  /** TIER-WIRE-01: the resource tier the job is queued at (absent: Standard). The household queue reads it with `requestTier`. */
  tier?: "boost" | "max";
  /** VIDEO-CREATE-01 (V1b): what the Create page added to the words (ids from recipes.ts) and the one plain line it showed, so Another take repeats the choices. */
  create?: { recipe?: string; look?: string; voices?: string; /** VIDEO-LORA-09: Less, Normal or More, kept so a new take of the clip uses the same strength. */ strength?: "less" | "normal" | "more"; note?: string };
  /** VIDEO-CHAT-01 (C3, C4): set on a clip made by editing others (trim, join, mix): the job it came from (the first clip of a join) and what was done. The old clips stay. */
  /** Set when the clip is stored: it is adult-only (its words, style or sources), so an edit of it never goes lower. */
  adultOnly?: boolean;
  /** ADULT-LOCK-06: whether the Adult lock applies while the clip is made. Absent with `adultOnly` means on (a job stored before the lock was split from the audience). */
  adultLock?: "on" | "off";
  /** CREATOR-02: set on an Another take: the job it repeats. The finished clip's creation record takes that job's record as its parent. */
  anotherOf?: string;
  /** REFVIDEO-01: set on a clip made from reference sheets (see `ReferenceRecipe`). */
  reference?: ReferenceRecipe;
  /** REFVIDEO-STEPS-01: the two-step progress of a video made from pictures (set from the start, before the recipe exists). */
  refProgress?: ReferenceProgress;
  edit?: { from: string; change: "ingredients" | "trim" | "join" | "mix" | "reframe" | "grade" | "speed" | "captions" | "upscale" | "remove_background" | "spatial_sound" | "restyle"; with?: string[];
    /** SPATIAL-04: the one plain line kept with a spatial-sound clip (the Stack's own lines); the card shows it as its muted notice. */
    note?: string };
  background?: string;
}

export interface VideoJob {
  id: string;
  personId: string;
  conversationId: string | null;
  turnId: string | null;
  companionId: string | null;
  kind: VideoJobKind;
  state: VideoJobState;
  stackJob: string | null;
  percent: number;
  phase: string | null;
  position: number | null;
  estimateSeconds?: number | null;
  riseReason?: QueueJob["riseReason"];
  prompt: string;
  request: VideoRequest;
  error: string | null;
  files: VideoFile[];
  temporary: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The plain line a failed video starts with. It says what happened and what to do; the Stack's own sentence is used when it has one. */
export const VIDEO_FAILED_PREFIX = "I couldn't make that video.";
/** The Stack's code for a clip its memory watchdog stopped (queued or running; a Max clip ends `failed` with it). Older Stacks said `no_memory` on a `cancelled` clip. */
export const MEMORY_CANCELLED_CODE = "memory_cancelled";

export function plainVideoFailure(error: unknown): string {
  if (error instanceof StackVideoError) {
    switch (error.code) {
      case "coding_mode": return "Pictures, videos and songs will be back in a little while. Please try again later.";
      case "already_making": return `${VIDEO_FAILED_PREFIX} ${error.message}`;
      case "queue_full": return `${VIDEO_FAILED_PREFIX} Home already has a full line of videos waiting. Try again in a few minutes.`;
      case "no_memory": case "out_of_memory": return `${VIDEO_FAILED_PREFIX} ${jobQueueCopy("failed_memory", "low_memory_failure", null, null, "adult")}`;
      case MEMORY_CANCELLED_CODE: return `${VIDEO_FAILED_PREFIX} ${jobQueueCopy("failed_memory", "memory_stopped_failure", null, null, "adult")}`;
      case "not_installed": case "model_missing": case "setup_failed": return `${VIDEO_FAILED_PREFIX} No video model is installed on this computer yet. An admin can add one in Settings, Pictures, videos and music.`;
      case "not_available_on_this_computer": case "unsupported": return `${VIDEO_FAILED_PREFIX} This computer can't make videos. Try a picture instead.`;
      case "unreachable": case "no_stack": return `${VIDEO_FAILED_PREFIX} Videos are not ready yet. Try again in a few minutes.`;
      case "lora_not_allowed": case "unknown_lora": case "wrong_base_model": case "lora_changed": case "lora_missing": return `${VIDEO_FAILED_PREFIX} That style isn't available for this request. Choose another style or leave it out.`;
      case "reference_not_generated": case "reference_source_required": case "reference_image_refused": case "bad_image": return `${VIDEO_FAILED_PREFIX} I can only animate a picture that was made here in this home. Ask me to make a picture first, then animate that one.`;
      case "timeout": return `${VIDEO_FAILED_PREFIX} It took longer than expected. Try again, or ask for something simpler.`;
      default: return `${VIDEO_FAILED_PREFIX} ${trimSentence(error.message)} Try again or change the request.`;
    }
  }
  return `${VIDEO_FAILED_PREFIX} Something went wrong while making it. Try again or change the request.`;
}
function trimSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Something went wrong while making it.";
  return /[.!?]$/.test(clean) ? clean.slice(0, 240) : `${clean.slice(0, 240)}.`;
}

// ---------------------------------------------------------------- store

const memory = new Map<string, VideoJob>();
const watching = new Map<string, AbortController>();
// The one object a watcher and a Stop both act on, so neither saves a stale copy over the other.
const liveJobs = new Map<string, VideoJob>();
const videoReservations = new Set<string>();

type Row = typeof videoJobs.$inferSelect;
function fromRow(row: Row): VideoJob {
  const request = JSON.parse(row.request) as VideoRequest & { memoryRequeues?: number };
  return {
    id: row.id, personId: row.personId, conversationId: row.conversationId, turnId: row.turnId, companionId: row.companionId, kind: row.kind as VideoJobKind, state: row.state as VideoJobState,
    stackJob: row.stackJob, percent: row.percent, phase: row.phase, position: row.position, prompt: row.prompt, request: JSON.parse(row.request) as VideoRequest,
    error: row.error, files: JSON.parse(row.files) as VideoFile[], temporary: false, createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...((request.memoryRequeues ?? 0) > 0 ? { riseReason: "requeued_memory" as const } : {}),
  };
}

function persistVideoJob(job: VideoJob): void {
  job.updatedAt = new Date().toISOString();
  if (job.temporary) { memory.set(job.id, job); return; }
  const values = {
    personId: job.personId, conversationId: job.conversationId, turnId: job.turnId, companionId: job.companionId, kind: job.kind, state: job.state, stackJob: job.stackJob, percent: job.percent,
    phase: job.phase, position: job.position, prompt: job.prompt, request: JSON.stringify(job.request), error: job.error, files: JSON.stringify(job.files), updatedAt: job.updatedAt, hlc: nextHlc(),
  };
  db.insert(videoJobs).values({ id: job.id, createdAt: job.createdAt, ...values }).onConflictDoUpdate({ target: videoJobs.id, set: values }).run();
}

function saveVideoJob(job: VideoJob): void {
  persistVideoJob(job);
  refreshHouseholdQueue();
}

registerQueueProvider(() => {
  const jobs = new Map<string, VideoJob>();
  for (const job of [...memory.values(), ...liveJobs.values()]) if (job.state === "queued" || job.state === "running") jobs.set(job.id, job);
  for (const row of db.select().from(videoJobs).where(inArray(videoJobs.state, ["queued", "running"])).all()) if (!jobs.has(row.id)) jobs.set(row.id, fromRow(row));
  return [...jobs.values()].map((job) => {
    const phaseHold = PERSISTED_HOLDS.find((reason) => job.phase === `held:${reason}`) as QueueJob["riseReason"] | undefined;
    const queued: QueueJob = { id: job.id, personId: job.personId, jobClass: "video", state: job.state, tier: requestTier(job.request), createdAt: job.createdAt,
      position: job.position, estimateSeconds: job.estimateSeconds, riseReason: ((job.request as VideoRequest & { memoryRequeues?: number }).memoryRequeues ?? 0) > 0 ? "requeued_memory" : job.riseReason ?? phaseHold, typicalSeconds: 140,
      headOfClass: ((job.request as VideoRequest & { memoryRequeues?: number }).memoryRequeues ?? 0) > 0 };
    return { job: queued, stackWaiting: job.state === "queued" && !!job.stackJob,
      applyFit: (fit) => { (job.request as { profile?: unknown }).profile = fit.profile; saveVideoJob(job); },
      stop: job.state === "running" ? async () => { const owner = db.select().from(people).where(eq(people.id, job.personId)).get(); if (owner) await cancelVideoJob(owner as PersonRow, job.id); } : undefined,
      release: job.state === "queued" && !job.stackJob ? () => releaseVideo(job) : undefined,
      save: () => { job.position = queued.position ?? null; job.estimateSeconds = queued.estimateSeconds; job.riseReason = queued.riseReason; if (queued.riseReason && PERSISTED_HOLDS.includes(queued.riseReason)) job.phase = `held:${queued.riseReason}`; else if (job.phase?.startsWith("held:")) job.phase = "queued"; persistVideoJob(job); } };
  });
});

async function releaseVideo(job: VideoJob): Promise<void> {
  if (job.state !== "queued" || job.stackJob) return;
  try {
    const storedBody = (job.request as VideoRequest & { stackBody?: Omit<VideoBody, "timeout_ms"> }).stackBody;
    // TIER-HOME-04: the level's saved slot is read now, so the pick made in the dialog is what this job runs with.
    const owner = db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow | undefined;
    const base = storedBody ?? { prompt: job.prompt, audience: job.request.audience, size: job.request.size, seconds: job.request.seconds };
    const slotted = owner ? videoBodyForSlot(base, requestTier(job.request), speakerAgeBand(owner, new Date()), laneOfPerson(owner), await videoEngineStatus()) : null;
    if (slotted) { job.request.quality = slotted.quality; if (slotted.body.seconds !== undefined) job.request.seconds = slotted.body.seconds; if (slotted.tier === "standard") delete (job.request as { tier?: unknown }).tier; }
    const submitted = await submitVideo({ ...(slotted?.body ?? base), timeout_ms: 1 });
    if (job.state !== "queued") { void cancelOrDeleteVideo(submitted.job); return; }
    job.stackJob = submitted.job;
    // LTXD-18B: the Stack's own words about an old-base style ride the clip's existing muted line (`create.note`, read by the card, the feed and the make reply); no new status surface.
    const warned = [...new Set(submitted.warnings.map((w) => w.message.trim()).filter(Boolean))].join(" ");
    if (warned) job.request.create = { ...(job.request.create ?? {}), note: [job.request.create?.note, warned].filter(Boolean).join(" ") };
    liveJobs.set(job.id, job); persistVideoJob(job);
    void ensureKeyframeHelper();
    const actor = db.select().from(people).where(eq(people.id, job.personId)).get();
    if (actor) void watch(job, actor as PersonRow, submitted.done);
  } catch (error) {
    if (error instanceof StackVideoError && (error.code === "queue_full" || ((error.code === "no_memory" || error.code === MEMORY_CANCELLED_CODE) && holdMaxAfterMemoryRefusal(job.request)))) { job.phase = "queued"; persistVideoJob(job); return; }
    job.state = "failed"; job.error = plainVideoFailure(error); persistVideoJob(job); refreshHouseholdQueue();
  }
}

/** A job by id for its owner only: nobody sees another person's videos, a parent included. */
/** CREATOR-02: an Another take names the job it repeats, so the new clip's creation record points back at that job's record (`parent_id`). Called right after the new job is started, before it finishes. */
export function markAnotherTake(job: VideoJob, source: VideoJob): void {
  job.request.anotherOf = source.id;
  saveVideoJob(job);
}

export function getVideoJobFor(actor: PersonRow, id: string): VideoJob | null {
  const live = memory.get(id) ?? liveJobs.get(id);
  if (live) return live.personId === actor.id ? live : null;
  const row = db.select().from(videoJobs).where(eq(videoJobs.id, id)).get();
  return row && row.personId === actor.id ? fromRow(row) : null;
}

/** VIDEO-CHAT-01: the finished clips of one person, newest first: this conversation's when given (a temporary chat keeps its own in memory), else every clip the person made (the Videos pane). */
export function doneVideoJobsFor(actor: PersonRow, conversationId: string | null, temporary: boolean): VideoJob[] {
  const jobs = new Map<string, VideoJob>();
  const wanted = (job: VideoJob) => job.personId === actor.id && job.state === "done" && job.files.length > 0 && (conversationId === null || job.conversationId === conversationId);
  for (const job of [...memory.values(), ...liveJobs.values()]) if (wanted(job) && job.temporary === temporary) jobs.set(job.id, job);
  if (!temporary) {
    const rows = db.select().from(videoJobs).where(conversationId === null ? and(eq(videoJobs.personId, actor.id), eq(videoJobs.state, "done")) : and(eq(videoJobs.personId, actor.id), eq(videoJobs.conversationId, conversationId), eq(videoJobs.state, "done"))).orderBy(desc(videoJobs.createdAt)).all();
    for (const row of rows) if (!jobs.has(row.id)) { const job = fromRow(row); if (wanted(job)) jobs.set(job.id, job); }
  }
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** The clip an edit names: "latest" or a video job id, a finished clip of this person (in this chat when there is one). */
export function sourceVideoJob(actor: PersonRow, conversationId: string | null, clip: string, temporary: boolean): VideoJob | null {
  const wanted = clip.trim();
  if (!wanted || /^(latest|last|this|that)$/i.test(wanted)) return doneVideoJobsFor(actor, conversationId, temporary)[0] ?? null;
  const job = getVideoJobFor(actor, wanted);
  // A temporary chat never edits a saved clip and a saved chat never edits a temporary one.
  return job && job.temporary === temporary && job.state === "done" && job.files.length > 0 ? job : null;
}

/** Whether this chat already holds a finished clip (the offer gate for `edit_video`). */
export function conversationHasVideo(actor: PersonRow, conversationId: string, temporary: boolean): boolean {
  return doneVideoJobsFor(actor, conversationId, temporary).length > 0;
}

/** VIDEO-CREATE-02 (U3): the person's job that made a Library clip (the stage player and the shot strip know a clip by its file id). */
export function getVideoJobByFileFor(actor: PersonRow, fileId: string): VideoJob | null {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(fileId)) return null;
  for (const job of [...memory.values(), ...liveJobs.values()]) if (job.personId === actor.id && job.files.some((file) => file.id === fileId)) return job;
  const row = db.select().from(videoJobs).where(and(eq(videoJobs.personId, actor.id), like(videoJobs.files, `%"${fileId}"%`))).get();
  return row ? fromRow(row) : null;
}

/** Every job of one turn in creation order. */
export function videoJobsForTurn(actor: PersonRow, turnId: string): VideoJob[] {
  const jobs = new Map<string, VideoJob>();
  for (const job of memory.values()) if (job.turnId === turnId && job.personId === actor.id) jobs.set(job.id, job);
  for (const row of db.select().from(videoJobs).where(and(eq(videoJobs.turnId, turnId), eq(videoJobs.personId, actor.id))).all()) if (!jobs.has(row.id)) jobs.set(row.id, fromRow(row));
  return [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The ids of the first job of these turns, for the history list (one query). */
export function videoJobIdsByTurn(actor: PersonRow, turnIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (turnIds.length === 0) return out;
  const firstAt = new Map<string, string>();
  const note = (turnId: string, id: string, at: string) => { const seen = firstAt.get(turnId); if (seen === undefined || at < seen) { firstAt.set(turnId, at); out.set(turnId, id); } };
  for (const job of memory.values()) if (job.turnId && turnIds.includes(job.turnId) && job.personId === actor.id) note(job.turnId, job.id, job.createdAt);
  const rows = db.select({ id: videoJobs.id, turnId: videoJobs.turnId, createdAt: videoJobs.createdAt }).from(videoJobs).where(and(eq(videoJobs.personId, actor.id), inArray(videoJobs.turnId, [...turnIds]))).all();
  for (const row of rows) if (row.turnId) note(row.turnId, row.id, row.createdAt);
  return out;
}

// ---------------------------------------------------------------- temporary clips (memory only)

interface TemporaryClip { id: string; conversationId: string; ownerPersonId: string; mediaType: string; bytes: Uint8Array; createdAt: number }
const TEMP_MS = 2 * 60 * 60 * 1000;
const temporaryClips = new Map<string, TemporaryClip>();
function storeTemporaryClip(clip: Omit<TemporaryClip, "createdAt">): void {
  const now = Date.now();
  for (const [id, value] of temporaryClips) if (now - value.createdAt > TEMP_MS) temporaryClips.delete(id);
  temporaryClips.set(clip.id, { ...clip, createdAt: now });
}
registerTemporaryMedia({
  removeConversation: (conversationId) => { for (const [id, clip] of temporaryClips) if (clip.conversationId === conversationId) temporaryClips.delete(id); },
  removePerson: (personId) => { for (const [id, clip] of temporaryClips) if (clip.ownerPersonId === personId) temporaryClips.delete(id); },
  prune: (live) => { for (const [id, clip] of temporaryClips) if (!live.has(clip.conversationId)) temporaryClips.delete(id); },
});

/** The bytes and type of a clip or poster the actor owns: a temporary one from memory, any other from the Library's store. */
export function readVideoFile(actor: PersonRow, job: VideoJob, fileId: string): { bytes: Uint8Array; mediaType: string } | null {
  if (!job.files.some((f) => f.id === fileId || f.poster_id === fileId)) return null;
  if (job.temporary) {
    const clip = temporaryClips.get(fileId);
    if (!clip || clip.ownerPersonId !== actor.id || Date.now() - clip.createdAt > TEMP_MS) return null;
    return { bytes: clip.bytes, mediaType: clip.mediaType };
  }
  // VIDEO-CREATE-01: a clip made on the Create page belongs to no chat; it is the person's own Library file.
  const read = job.conversationId ? readAttachmentForConversation(actor, job.conversationId, fileId) : readAttachment(actor, fileId);
  return read.ok ? { bytes: read.value.bytes, mediaType: read.value.record.media_type } : null;
}

/** Test-only. */
export function __resetVideoJobsForTests(): void {
  for (const controller of watching.values()) controller.abort();
  watching.clear();
  liveJobs.clear();
  memory.clear();
  temporaryClips.clear();
}
/** Test-only fixture seam for an already finished source clip. */
export function __setVideoJobForTests(job: VideoJob): void { liveJobs.set(job.id, job); }

// ---------------------------------------------------------------- reference pictures

export const GENERATED_PICTURE_NOTE = "picture-gen:";
export const CLIP_POSTER_NOTE = "video-poster:";

export type ReferenceResult = { ok: true; id: string; base64: string; bytes: Uint8Array; width: number | null; height: number | null } | { ok: false; line: string };
const NOT_GENERATED_LINE = "I can only animate a picture that was made here in this home. Ask me to make a picture first, then animate that one.";

/** The newest picture of this temporary chat the Stack made: a generated picture or the poster of a clip, whichever is newer. */
export function latestTemporaryPosterId(actor: PersonRow, conversationId: string): string | null {
  let best: { id: string; at: number } | null = null;
  for (const clip of temporaryClips.values()) if (clip.ownerPersonId === actor.id && clip.conversationId === conversationId && clip.mediaType === "image/jpeg" && (!best || clip.createdAt >= best.at)) best = { id: clip.id, at: clip.createdAt };
  const image = latestGeneratedTemporaryImage(actor, conversationId);
  if (image && (!best || image.createdAt >= best.at)) best = { id: image.id, at: image.createdAt };
  return best?.id ?? null;
}

/** A picture of this conversation the Stack itself made (a generated picture or a clip's poster), as base64 of its stored bytes, unchanged. Anything else is refused here before the Stack is asked; the Stack checks the bytes' hash again. */
export function loadGeneratedReference(actor: PersonRow, conversationId: string, fileId: string, temporary: boolean): ReferenceResult {
  if (temporary) {
    const clip = temporaryClips.get(fileId);
    if (clip && clip.ownerPersonId === actor.id && clip.conversationId === conversationId && clip.mediaType === "image/jpeg") return { ok: true, id: fileId, base64: Buffer.from(clip.bytes).toString("base64"), bytes: clip.bytes, width: null, height: null };
    // A temporary picture counts only when Home marked it `generated` when the picture engine made it (a field no upload
    // can set; a file name proves nothing). The Stack still checks the bytes' hash.
    const image = getTemporaryChatImage(actor, conversationId, fileId);
    if (image && (image.generated === true)) return { ok: true, id: fileId, base64: Buffer.from(image.bytes).toString("base64"), bytes: image.bytes, width: image.width, height: image.height };
    return { ok: false, line: NOT_GENERATED_LINE };
  }
  const row = db.select().from(attachments).where(eq(attachments.id, fileId)).get();
  if (!row || row.conversationId !== conversationId || row.ownerPersonId !== actor.id) return { ok: false, line: NOT_GENERATED_LINE };
  const note = row.provenance ?? "";
  if (!note.startsWith(GENERATED_PICTURE_NOTE) && !note.startsWith(CLIP_POSTER_NOTE)) return { ok: false, line: NOT_GENERATED_LINE };
  const read = readAttachmentForConversation(actor, conversationId, fileId);
  if (!read.ok) return { ok: false, line: NOT_GENERATED_LINE };
  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = JSON.parse(note.slice(note.indexOf(":") + 1)) as { width?: number; height?: number; audience?: string };
    width = typeof meta.width === "number" ? meta.width : null;
    height = typeof meta.height === "number" ? meta.height : null;
  } catch { /* the size is only a hint for the clip's shape */ }
  return { ok: true, id: fileId, base64: Buffer.from(read.value.bytes).toString("base64"), bytes: read.value.bytes, width, height };
}

export type PhotoResult = { ok: true; id: string; base64: string; bytes: Uint8Array; width: number | null; height: number | null } | { ok: false; line: string };
const NOT_A_PHOTO_LINE = "I can't find that photo any more. Attach it again and ask once more.";

/** A photo the person attached in this conversation, as its stored bytes, unchanged. */
export function loadUploadedPhoto(actor: PersonRow, conversationId: string, fileId: string, temporary: boolean): PhotoResult {
  const typeOk = (type: string) => type === "image/png" || type === "image/jpeg" || type === "image/webp";
  if (temporary) {
    const image = getTemporaryChatImage(actor, conversationId, fileId);
    if (!image || image.generated === true || !typeOk(image.mediaType)) return { ok: false, line: NOT_A_PHOTO_LINE };
    return { ok: true, id: fileId, base64: Buffer.from(image.bytes).toString("base64"), bytes: image.bytes, width: image.width, height: image.height };
  }
  const row = db.select().from(attachments).where(eq(attachments.id, fileId)).get();
  if (!row || row.conversationId !== conversationId || row.ownerPersonId !== actor.id || !typeOk(row.mediaType)) return { ok: false, line: NOT_A_PHOTO_LINE };
  const read = readAttachmentForConversation(actor, conversationId, fileId);
  if (!read.ok) return { ok: false, line: NOT_A_PHOTO_LINE };
  return { ok: true, id: fileId, base64: Buffer.from(read.value.bytes).toString("base64"), bytes: read.value.bytes, width: null, height: null };
}

const NOT_YOUR_PICTURE_LINE = "That picture isn't in your Library any more. Choose another one, or add it again.";

/** VIDEO-CREATE-02 (U3): a picture in this person's own Library (an upload or a picture made here) as its stored bytes, for a Start frame.
 * Another person's file, a file in Trash, an unknown id and anything that is not a png, jpeg or webp picture all get the same plain line. */
export function loadLibraryPicture(actor: PersonRow, fileId: string): PhotoResult {
  const row = db.select().from(attachments).where(eq(attachments.id, fileId)).get();
  if (!row || row.ownerPersonId !== actor.id || row.deletedAt !== null || !["image/png", "image/jpeg", "image/webp"].includes(row.mediaType)) return { ok: false, line: NOT_YOUR_PICTURE_LINE };
  const read = readAttachment(actor, fileId);
  if (!read.ok) return { ok: false, line: NOT_YOUR_PICTURE_LINE };
  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = JSON.parse((row.provenance ?? "").slice((row.provenance ?? "").indexOf(":") + 1)) as { width?: number; height?: number };
    width = typeof meta.width === "number" ? meta.width : null;
    height = typeof meta.height === "number" ? meta.height : null;
  } catch { /* the size is only a hint for the clip's shape */ }
  return { ok: true, id: fileId, base64: Buffer.from(read.value.bytes).toString("base64"), bytes: read.value.bytes, width, height };
}

/** VIDEO-CHAT-01 (continue): keeps the last frame of a clip as this chat's own picture (the same kind of file a clip's poster is), so the new clip starts from a stored file that Make another can load again. Memory only in a temporary chat. */
export function storeContinueFrame(actor: PersonRow, input: { conversationId: string; turnId: string | null; temporary: boolean; jpeg: Uint8Array; width: number; height: number; adultOnly: boolean; lock?: "on" | "off"; sourceJobId: string }): { ok: true; id: string } | { ok: false; line: string } {
  if (input.temporary) {
    const id = newFileId();
    storeTemporaryClip({ id, conversationId: input.conversationId, ownerPersonId: actor.id, mediaType: "image/jpeg", bytes: input.jpeg });
    return { ok: true, id };
  }
  if (!input.turnId) return { ok: false, line: "A video can only be continued from a chat message. Ask again in a chat." };
  const provenance = `${CLIP_POSTER_NOTE}${JSON.stringify({ v: 1, ...markFields({ madeAudience: input.adultOnly ? "adult-only" : "all-ages", lock: input.lock ?? (input.adultOnly ? "on" : "off") }), job: input.sourceJobId, width: input.width, height: input.height, frame: "last" })}`;
  const made = createAttachment(actor, { conversationId: input.conversationId, turnId: input.turnId, mediaType: "image/jpeg", bytes: input.jpeg, provenance, deduplicate: false, retention: "conversation" });
  return made.ok ? { ok: true, id: made.value.id } : { ok: false, line: saveFailureLine(made.status) };
}

/** How many of this person's clips are waiting or being made. */
export function activeVideoJobsFor(actor: PersonRow): number {
  let count = 0;
  for (const job of memory.values()) if (job.personId === actor.id && (job.state === "queued" || job.state === "running")) count += 1;
  const rows = db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.personId, actor.id), inArray(videoJobs.state, ["queued", "running"]))).all();
  for (const row of rows) if (!memory.has(row.id)) count += 1;
  return count;
}

// ---------------------------------------------------------------- start

export interface StartVideoInput {
  actor: PersonRow;
  conversationId: string | null;
  turnId: string | null;
  companionId?: string | null;
  temporary: boolean;
  kind: VideoJobKind;
  prompt: string;
  body: Omit<VideoBody, "timeout_ms">;
  sourceFileId?: string | null;
  endFileId?: string | null;
  productionId?: string;
  shotId?: string;
  /** TIER-WIRE-01: the allowed tier (`jobTier`); Standard or absent adds nothing to the request. */
  tier?: "standard" | "boost" | "max";
  /** VIDEO-CREATE-01 (V1b): kept on the request for Another take. */
  create?: VideoRequest["create"];
  /** VIDEO-CHAT-01 (continue): the clip is adult-only whatever its words say (it starts from an adult-only clip's frame), so the finished-clip check never judges it lower. */
  adultOnly?: boolean;
  /** ADULT-LOCK-06: the source's Adult lock (`on` or `off`) when `adultOnly` comes from a source clip; absent means on. */
  adultLock?: "on" | "off";
}

/** Submits to the Stack and returns the job once the Stack has it; throws `StackVideoError` when the Stack refuses. */
export async function startVideoJob(input: StartVideoInput): Promise<VideoJob> {
  // One clip at a time per person: a second one waits until the first is done or stopped, so no one can fill the Stack's line.
  if (activeVideoJobsFor(input.actor) > 0) throw new StackVideoError(429, "already_making", "You already have a video being made. Wait for it to finish, or stop it first.");
  if (videoReservations.has(input.actor.id)) throw new StackVideoError(429, "already_making", "You already have a video being made. Wait for it to finish, or stop it first.");
  videoReservations.add(input.actor.id);
  // Whoever calls, a teen or a child is on an allowed model (Quick, silent); only an adult's own choice reaches the engine.
  const model = videoModelForLane(laneOfPerson(input.actor), input.body.model);
  const now = new Date().toISOString();
  // ADULT-LOCK-02: a clip made with an adult-only style is a locked item from the start, before the Stack is called, so a clip being made is already a lock tile.
  // ADULT-LOCK-06: the mark is decided here, from the one table (newItemMark): an adult-only style locks it on; a source's flags (`input.adultOnly`, `input.adultLock`) carry over.
  try {
  const adultStyle = await usesAdultOnlyStyle((input.body.loras ?? []).map((l) => l.id));
  // VIDEO-LORA-03: the LoRAs go to the Stack only as it reports it can use them on this model; otherwise the clip fails now, with a plain line, before anything is queued.
  const wired = await wireLoras(input.body.loras, model);
  if (!wired.ok) throw new StackVideoError(422, "loras_unsupported", wired.line);
  const mark = newItemMark(input.adultOnly ? [{ madeAudience: "adult-only", lock: input.adultLock ?? "on" }] : [], adultStyle);
  const job: VideoJob = {
    id: newVideoJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, kind: input.kind, state: "queued", stackJob: null,
    percent: 0, phase: "queued", position: null, prompt: input.prompt,
    request: ({ size: input.body.size ?? (model === LTX25_MAX_MODEL ? LTX25_MAX_DEFAULTS.landscape : model === LTX25_MODEL ? LTX25_DEFAULTS.standard.landscape : "832x480"), seconds: input.body.seconds ?? (model === LTX25_MODEL && input.tier !== "boost" && input.tier !== "max" ? 10 : 5), quality: (model === LTX25_MODEL || model === LTX25_MAX_MODEL) && (input.tier === "boost" || input.tier === "max") ? "detailed" : "quick", seed: input.body.seed ?? null, loras: (input.body.loras ?? []).map((l) => l.id), source_file_id: input.sourceFileId ?? null, ...(input.endFileId ? { end_file_id: input.endFileId } : {}), ...(input.productionId && input.shotId ? { production_id: input.productionId, shot_id: input.shotId } : {}), audience: input.body.audience, ...(input.tier === "boost" || input.tier === "max" ? { tier: input.tier } : {}), ...(input.create ? { create: input.create } : {}), ...(mark.madeAudience === "adult-only" ? { adultOnly: true, adultLock: mark.lock } : {}), stackBody: { ...input.body, ...(wired.loras !== undefined ? { loras: wired.loras } : {}), ...(model ? { model } : {}) },  } as VideoRequest),
    error: null, files: [], temporary: input.temporary, createdAt: now, updatedAt: now,
  };
  liveJobs.set(job.id, job);
  saveVideoJob(job);
  videoReservations.delete(input.actor.id);
  void releaseHouseholdQueue();
  return job;
  } catch (error) { videoReservations.delete(input.actor.id); throw error; }
}

// ---------------------------------------------------------------- watching

let POLL_MS = 1000;
/** Test seam: poll faster (null restores). */
export function __setVideoPollMsForTests(ms: number | null): void { POLL_MS = ms ?? 1000; }
// A clip waits behind a picture job or another clip, then takes about two and a half minutes; the Stack gives up at 15 minutes of its own.
const MAX_WATCH_MS = 25 * 60 * 1000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** ADULT-LOCK-03: an adult job is read from the Stack with the full view (Home is its trusted caller; what it reads reaches a response only through the lock). Any other job is read the plain way. */
const viewOfJob = (job: VideoJob, actor: PersonRow): FullView | undefined => fullViewForJob((job.request as { audience?: unknown }).audience, actor);

async function watch(job: VideoJob, actor: PersonRow, early: StackClip[] | null = null): Promise<void> {
  if (!job.stackJob || watching.has(job.id)) return;
  const view = viewOfJob(job, actor);
  const controller = new AbortController();
  watching.set(job.id, controller);
  const deadline = Date.now() + MAX_WATCH_MS;
  try {
    if (early) {
      await finish(job, actor, early, controller.signal);
      return;
    }
    while (!controller.signal.aborted && Date.now() < deadline) {
      let status;
      try {
        status = await getVideoJob(job.stackJob, view);
      } catch (error) {
        if (error instanceof StackVideoError && error.status === 404) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} It did not finish. Try again.`; saveVideoJob(job); return; }
        // A single missed poll is not a failure; the next one decides.
        await sleep(POLL_MS * 2, controller.signal);
        continue;
      }
      if (controller.signal.aborted) return;
      if (status.state === "done") { await finish(job, actor, status.data, controller.signal); return; }
      // MEM-RETRY-01: the Stack's memory watchdog stopped the clip (a Max clip ends `failed` with the same code; an older Stack said `no_memory` on a `cancelled` clip). Never a person's Stop: that is code `cancelled` and ends the clip.
      if ((status.state === "cancelled" || status.state === "failed") && (status.code === MEMORY_CANCELLED_CODE || (status.state === "cancelled" && status.code === "no_memory"))) {
        if (controller.signal.aborted || job.state === "cancelled") return;
        const request = job.request as VideoRequest & { memoryRequeues?: number };
        const retries = request.memoryRequeues ?? 0;
        if (requeueAfterCritical({ requeues: retries }) === "requeue_head") { request.memoryRequeues = retries + 1; job.state = "queued"; job.stackJob = null; job.phase = "requeued_memory"; job.percent = 0; saveVideoJob(job); return; }
        job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} ${jobQueueCopy("failed_memory", "memory_stopped_failure", null, null, laneOfPerson(actor) === "child" ? "child" : "adult")}`; saveVideoJob(job); return;
      }
      if (status.state === "failed") { job.state = "failed"; job.error = plainVideoFailure(new StackVideoError(500, status.code ?? "failed", status.error ?? "")); saveVideoJob(job); return; }
      if (status.state === "cancelled") { job.state = "cancelled"; job.error = null; saveVideoJob(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      job.percent = Math.max(0, Math.min(99, Math.round(status.progress)));
      job.phase = status.phase;
      saveVideoJob(job);
      await updateLive(job.id, status, () => fetchVideoPreview(job.stackJob!, view));
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} It took longer than expected. Try again, or ask for something simpler.`; saveVideoJob(job); void cancelOrDeleteVideo(job.stackJob); }
  } catch {
    job.state = "failed";
    job.error = plainVideoFailure(null);
    try { saveVideoJob(job); } catch { /* the job ends here either way */ }
  } finally {
    watching.delete(job.id);
    clearLive(job.id);
    liveJobs.delete(job.id);
    refreshHouseholdQueue();
  }
}

let TURN_END_WAIT_MS = 15 * 60_000;
export function __setVideoTurnWaitForTests(ms: number | null): void { TURN_END_WAIT_MS = ms ?? 15 * 60_000; }
async function waitForTurnRow(turnId: string): Promise<boolean> {
  // The turn's row is written when the reply ends; the clip arrives minutes later, but a restart-resumed job can come sooner.
  const deadline = Date.now() + TURN_END_WAIT_MS;
  while (Date.now() < deadline) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, turnId), eq(conversationTurns.status, "done"))).get()) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
  }
  return false;
}

/** SPATIAL-04: the Library name of the 5.1 file of a spatial-sound clip. */
export const SURROUND_FILE_NAME = "Spatial sound 5.1.mp4";

/** An mp4 starts with a box header: four size bytes, then `ftyp`. Anything else is not a clip and is never stored. */
export function looksLikeMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength > 1024 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}
export function looksLikeWebm(bytes: Uint8Array): boolean { return bytes.byteLength > 1024 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3; }
function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength > 100 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function saveFailureLine(status: number): string {
  return status === 403 ? `${VIDEO_FAILED_PREFIX} Your storage is full. Delete some files in Settings, Storage, then try again.` : `${VIDEO_FAILED_PREFIX} The video couldn't be saved. Try again.`;
}

/** The finished-clip check, the store and the job's end, for a clip the Stack made (`finish`) and one an edit made (`finishEdit`). The Stack's bytes are stored unchanged. */
async function settleClip(job: VideoJob, actor: PersonRow, video: Uint8Array, posterIn: Uint8Array | null, clip: StackClip, signal: AbortSignal, writer: "video-gen" | "video-edit", mediaType: "video/mp4" | "video/webm" = "video/mp4", surround: Uint8Array | null = null): Promise<void> {
  // VIDEO-GEN / IMGGEN-SAFE-01: the finished-clip check, before anything is stored or shown. First, middle and last
  // keyframes go through the same local vision check as a picture; a Mac that cannot decode a clip checks the poster alone.
  // An edit is adult-only when any clip it is made from is (`request.adultOnly`, set when the edit starts), never lower than its sources.
  const startedAdult = job.request.adultOnly === true;
  const adult = startedAdult || await isAdultOnlyJob(job.prompt, job.request.loras, async (id) => getLoraRecord(id)?.audience);
  const keyframes = await extractKeyframes(video, clip.seconds ?? job.request.seconds);
  // An edit has no poster from the Stack: frame 0 of the new clip is its poster, and a clip no frame can be taken from is not stored.
  const poster = posterIn ?? keyframes?.[0] ?? null;
  if (!poster) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} The video didn't come out right. Try again.`; saveVideoJob(job); return; }
  const checks = await checkImages(keyframes ?? [poster], "video");
  // The poster is frame 0 only. For an adult-only clip that is not enough to answer for the rest of it, so it counts as "could not check".
  if (!keyframes) checks.push({ ok: false, why: "unavailable" });
  if (signal.aborted) return;
  const decision = await gateFinished({ actor, kind: "video", jobId: job.id, adultOnly: adult, checks, images: keyframes ?? [poster], prompt: job.prompt });
  if (decision.action === "withhold") { job.state = "failed"; job.error = decision.line; job.files = []; saveVideoJob(job); return; }
  // SPATIAL-04: the 5.1 file takes the same finished-clip check as the stereo clip (the same keyframe check and the same lane gate), before either is stored.
  // It carries the same picture (the Stack copies the video stream), but it is its own file, so it is looked at on its own. One withheld file ends the job.
  if (surround) {
    const siblingFrames = await extractKeyframes(surround, clip.seconds ?? job.request.seconds);
    const siblingChecks = await checkImages(siblingFrames ?? [poster], "video");
    if (!siblingFrames) siblingChecks.push({ ok: false, why: "unavailable" });
    if (signal.aborted) return;
    const siblingDecision = await gateFinished({ actor, kind: "video", jobId: job.id, adultOnly: adult, checks: siblingChecks, images: siblingFrames ?? [poster], prompt: job.prompt });
    if (siblingDecision.action === "withhold") { job.state = "failed"; job.error = siblingDecision.line; job.files = []; saveVideoJob(job); return; }
  }
  // ADULT-LOCK-06: the lock is on from the start (an adult-only style or source: `request.adultLock`), or now, when the finished-clip check's own verdict is nude or
  // sexual. The prompt word check above raised the audience only. A job that started from a source (an edit, a continued frame) follows the source's flags (the table), so a verdict never relocks a clip the creator cleared.
  const verdictNude = !job.request.edit && job.request.adultLock === undefined && checks.some((check) => check.ok && check.verdict.is_nude_or_sexual);
  const lock: "on" | "off" = (startedAdult && job.request.adultLock !== "off") || verdictNude ? "on" : "off";
  job.request.adultLock = lock;
  const madeAdult = adult || verdictNude;
  job.request.adultOnly = madeAdult;
  const markNote = markFields({ madeAudience: madeAdult ? "adult-only" : "all-ages", lock });
  const conversationId = job.conversationId;
  // VIDEO-CREATE-01: no conversation means the Create page made it; the clip and poster are kept Library files, not chat attachments.
  if (!conversationId && job.temporary) throw new Error("no conversation");
  const width = clip.width ?? 832;
  const height = clip.height ?? 480;
  // VIDEO-TIERS-01: an LTX-2.5 clip is Standard ("quick") or Boost ("detailed") by the level the job ran at; it has sound either way (`audio`).
  const quality = clip.quality === "detailed" || ((clip.quality === "ltx25" || clip.quality === "ltx25max") && job.request.quality === "detailed") ? "detailed" as const : "quick" as const;
  const meta = { seed: clip.seed ?? null, model: clip.model ?? null, ms: clip.ms ?? null, seconds: clip.seconds ?? null, width, height, quality, audio: clip.audio === true };
  let file: VideoFile;
  let sibling: VideoFile | null = null;
  /** CREATOR-02: the id the stored files' notes point to; the record itself is written once the job is done. */
  const creationId = newCreationId();
  if (job.temporary) {
    const id = newFileId();
    const posterId = newFileId();
    storeTemporaryClip({ id, conversationId: conversationId!, ownerPersonId: actor.id, mediaType, bytes: video });
    storeTemporaryClip({ id: posterId, conversationId: conversationId!, ownerPersonId: actor.id, mediaType: "image/jpeg", bytes: poster,  });
    file = { id, poster_id: posterId, width, height, seconds: meta.seconds, seed: meta.seed, model: meta.model, ms: meta.ms, bytes: video.byteLength, quality, audio: meta.audio };
    if (surround) {
      const siblingId = newFileId();
      storeTemporaryClip({ id: siblingId, conversationId: conversationId!, ownerPersonId: actor.id, mediaType, bytes: surround });
      sibling = { ...file, id: siblingId, bytes: surround.byteLength, role: "surround_5_1" };
    }
  } else {
    const own = conversationId === null;
    const turnExists = !own && !!job.turnId && await waitForTurnRow(job.turnId);
    if (signal.aborted) return;
    const posterProvenance = `${CLIP_POSTER_NOTE}${JSON.stringify({ v: 1, ...markNote, creation: creationId, job: job.id, width, height,  })}`;
    const clipProvenance = `${writer}:${JSON.stringify({ v: 1, ...markNote, creation: creationId, job: job.id, ...meta, ...(!own && !turnExists && job.turnId ? { pendingTurnId: job.turnId } : {}), ...(job.request.edit ? { from: job.request.edit.from, change: job.request.edit.change } : {}) })}`;
    const made = own || !turnExists
      ? storeFile(actor, { conversationId: null, turnId: null, mediaType, bytes: video, provenance: clipProvenance, deduplicate: false, retention: "kept", name: mediaType === "video/webm" ? "Edited video.webm" : undefined })
      : createAttachment(actor, { conversationId: conversationId!, turnId: job.turnId!, mediaType, bytes: video, provenance: clipProvenance, deduplicate: false, retention: "conversation", name: mediaType === "video/webm" ? "Edited video.webm" : undefined });
    if (!made.ok) { job.state = "failed"; job.error = saveFailureLine(made.status); saveVideoJob(job); return; }
    const madePoster = own || !turnExists
      ? storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/jpeg", bytes: poster, provenance: posterProvenance, deduplicate: false, retention: "kept" })
      : createAttachment(actor, { conversationId: conversationId!, turnId: job.turnId!, mediaType: "image/jpeg", bytes: poster, provenance: posterProvenance, deduplicate: false, retention: "conversation" });
    if (!madePoster.ok) {
      const clipRow = db.select().from(attachments).where(eq(attachments.id, made.value.id)).get();
      const blob = clipRow ? purgeFileRecord(clipRow) : null;
      if (blob) removeFileBlobs([blob]);
      job.state = "failed"; job.error = saveFailureLine(madePoster.status); saveVideoJob(job); return;
    }
    if (lock === "on") logAutoMark(made.value.id, actor.id);
    file = { id: made.value.id, poster_id: madePoster.value.id, width, height, seconds: meta.seconds, seed: meta.seed, model: meta.model, ms: meta.ms, bytes: video.byteLength, quality, audio: meta.audio };
    if (surround) {
      // SPATIAL-04: the 5.1 file is its own Library file, marked exactly like the stereo clip (same provenance flags), named so it can be told apart.
      const siblingProvenance = `${writer}:${JSON.stringify({ v: 1, ...markNote, creation: creationId, job: job.id, ...meta, role: "surround_5_1", ...(job.request.edit ? { from: job.request.edit.from, change: job.request.edit.change } : {}) })}`;
      const siblingMade = own
        ? storeFile(actor, { conversationId: null, turnId: null, mediaType, bytes: surround, provenance: siblingProvenance, deduplicate: false, retention: "kept", name: SURROUND_FILE_NAME })
        : createAttachment(actor, { conversationId: conversationId!, turnId: job.turnId!, mediaType, bytes: surround, provenance: siblingProvenance, deduplicate: false, retention: "conversation", name: SURROUND_FILE_NAME });
      if (!siblingMade.ok) { job.state = "failed"; job.error = saveFailureLine(siblingMade.status); saveVideoJob(job); return; }
      if (lock === "on") logAutoMark(siblingMade.value.id, actor.id);
      sibling = { ...file, id: siblingMade.value.id, bytes: surround.byteLength, role: "surround_5_1" };
    }
  }
  job.files = sibling ? [{ ...file, role: "stereo" }, sibling] : [file];
  job.state = "done";
  job.percent = 100;
  job.phase = "ready";
  job.error = null;
  saveVideoJob(job);
  // CREATOR-02: the record of how this clip was made, written only now that the job has finished (a temporary chat stores no file, so it keeps no record).
  if (!job.temporary) safely(() => recordClipCreation(actor, job, job.files, writer, creationId));
  void notifyClipReady(job, actor);
  if (writer === "video-gen" && job.files[0] && job.request.production_id && job.request.shot_id) setShotClip(actor.id, job.request.production_id, job.request.shot_id, job.files[0].id);
}

async function finish(job: VideoJob, actor: PersonRow, clips: StackClip[], signal: AbortSignal): Promise<void> {
  const stackJob = job.stackJob!;
  try {
    const clip = clips[0];
    if (!clip) { job.state = "failed"; job.error = plainVideoFailure(null); saveVideoJob(job); return; }
    // The Stack's bytes are stored unchanged: a poster that is re-encoded could never start a later clip.
    const view = viewOfJob(job, actor);
    const video = await fetchClip(stackJob, view);
    const poster = await fetchPoster(stackJob, view);
    if (signal.aborted) return;
    if (!looksLikeMp4(video) || !looksLikeJpeg(poster)) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} The video didn't come out right. Try again.`; saveVideoJob(job); return; }
    await settleClip(job, actor, video, poster, clip, signal, "video-gen");
  } finally {
    // Done or not, Home has taken what it wanted: the Stack's copy goes (a failed save would otherwise leave a clip on its disk).
    void cancelOrDeleteVideo(stackJob);
  }
}

// ---------------------------------------------------------------- edits (VIDEO-CHAT-01, C3 and C4)

/** What an edit hands back: the new clip's bytes and what the Stack measured. Frame 0 of the clip is its poster. */
export interface EditedClip { video: Uint8Array; seconds: number | null; width: number | null; height: number | null; audio: boolean; ms: number;
  /** SPATIAL-04: the 5.1 file made beside the stereo clip (`video`); it takes the same finished-clip check and the same flags. */
  surround?: Uint8Array;
  /** SPATIAL-04: the plain line kept with the clip (the Stack's lines for a spatial-sound step). */
  note?: string }
/** The work of one edit (the Stack call, and any speech made first). It never throws: a failure is one plain line. */
export type EditRun = (signal: AbortSignal, onProgress?: (percent: number) => void, hooks?: EditHooks) => Promise<{ ok: true; clip: EditedClip } | { ok: false; line: string }>;
export const EDIT_FAILED_PREFIX = "I couldn't change that video.";
export const EDIT_RESTART_LINE = `${EDIT_FAILED_PREFIX} Home restarted while it was working. Ask again.`;

export interface StartEditInput { /** REFVIDEO-01: fields of the new job's request that the source does not carry (the reference recipe, the seed, the size). */ request?: Partial<VideoRequest>; /** The styles the new clip is made with (recorded for lineage and the Adult lock; an edit is a local cut and sends no LoRA to the Stack). */ styleIds?: readonly string[]; background?: string; adultLock?: "on" | "off"; actor: PersonRow; conversationId: string | null; turnId: string | null; temporary: boolean; source: VideoJob; edit: NonNullable<VideoRequest["edit"]>; run: EditRun; phase?: string; /** Called after an edited clip has been safely stored. */ onSaved?: (fileId: string) => void; /** Any source clip, track or typed line is adult-only. */ adultOnly: boolean }

/** Starts a new clip made by editing others and returns its job at once (the card polls it like any clip). The old clips stay.
 * One clip at a time per person, as for a made clip; a refusal is the plain line. */
export function startVideoEditJob(input: StartEditInput): { ok: true; job: VideoJob } | { ok: false; line: string } {
  if (activeVideoJobsFor(input.actor) > 0) return { ok: false, line: "You already have a video being made. Wait for it to finish, or stop it first." };
  const now = new Date().toISOString();
  const from = input.source.request;
  const job: VideoJob = {
    id: newVideoJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: null, kind: "edit", state: "running", stackJob: null,
    percent: 5, phase: input.phase ?? "editing", position: null, prompt: input.source.prompt,
    request: { size: from.size, seconds: from.seconds, seed: from.seed, loras: [...(input.styleIds ?? [])], source_file_id: null, audience: from.audience, ...(from.quality ? { quality: from.quality } : {}), ...(from.create ? { create: from.create } : {}), edit: input.edit, ...(input.background ? { background: input.background } : {}), ...(input.adultOnly ? { adultOnly: true, adultLock: input.adultLock ?? "on" } : {}), ...(input.request ?? {}) },
    error: null, files: [], temporary: input.temporary, createdAt: now, updatedAt: now,
  };
  liveJobs.set(job.id, job);
  saveVideoJob(job);
  void runEdit(job, input.actor, input.run, input.source, input.onSaved);
  return { ok: true, job };
}

async function runEdit(job: VideoJob, actor: PersonRow, run: EditRun, source: VideoJob, onSaved?: (fileId: string) => void): Promise<void> {
  const controller = new AbortController();
  watching.set(job.id, controller);
  try {
    const hooks: EditHooks = {
      steps: (change) => { const progress = job.request.refProgress; if (!progress) return; change(progress); job.percent = referencePercent(progress); saveVideoJob(job); },
      recipe: (recipe) => {
        job.request.reference = recipe; job.request.seed = recipe.seed; job.request.seconds = recipe.seconds; job.prompt = recipe.prompt;
        if (job.request.edit) job.request.edit = { ...job.request.edit, from: recipe.sheetFileIds[0] ?? job.request.edit.from };
        source.request.seed = recipe.seed; source.prompt = recipe.prompt;
        saveVideoJob(job);
      },
      request: (patch) => { Object.assign(job.request, patch); saveVideoJob(job); },
    };
    const made = await run(controller.signal, (percent) => { job.percent = Math.max(0, Math.min(99, Math.round(percent))); saveVideoJob(job); }, hooks);
    if (controller.signal.aborted) return;
    if (!made.ok) { job.state = "failed"; job.error = made.line; saveVideoJob(job); return; }
    const { clip } = made;
    const webm = job.request.edit?.change === "remove_background" && job.request?.background === "transparent";
    if (webm ? !looksLikeWebm(clip.video) : !looksLikeMp4(clip.video)) { job.state = "failed"; job.error = `${EDIT_FAILED_PREFIX} The edited video didn't come out right. Try again.`; saveVideoJob(job); return; }
    const seconds = clip.seconds === null ? null : Math.round(clip.seconds * 100) / 100;
    if (seconds !== null) job.request.seconds = Math.max(1, Math.round(seconds));
    const quality = job.request.quality === "detailed" ? "detailed" as const : "quick" as const;
    if (clip.surround && !looksLikeMp4(clip.surround)) { job.state = "failed"; job.error = `${EDIT_FAILED_PREFIX} The 5.1 file didn't come out right. Try again.`; saveVideoJob(job); return; }
    if (clip.note && job.request.edit) job.request.edit = { ...job.request.edit, note: clip.note };
    await settleClip(job, actor, clip.video, null, { seconds: seconds ?? undefined, width: clip.width ?? undefined, height: clip.height ?? undefined, seed: source.request.seed ?? undefined, model: source.files[0]?.model ?? undefined, ms: clip.ms, quality, audio: clip.audio }, controller.signal, "video-edit", webm ? "video/webm" : "video/mp4", clip.surround ?? null);
    if (job.state === "done" && job.files[0]) { try { onSaved?.(job.files[0].id); } catch { /* the saved film remains delivered */ } }
  } catch {
    job.state = "failed";
    job.error = `${EDIT_FAILED_PREFIX} Something went wrong while making it. Try again.`;
    try { saveVideoJob(job); } catch { /* the job ends here either way */ }
  } finally {
    watching.delete(job.id);
    liveJobs.delete(job.id);
    refreshHouseholdQueue();
  }
}

/** Stop a job. Safe to call twice; a finished job stays finished. */
export async function cancelVideoJob(actor: PersonRow, id: string): Promise<VideoJob | null> {
  const job = getVideoJobFor(actor, id);
  if (!job) return null;
  if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return job;
  watching.get(job.id)?.abort();
  watching.delete(job.id);
  if (job.stackJob) await cancelOrDeleteVideo(job.stackJob);
  job.state = "cancelled";
  job.error = null;
  saveVideoJob(job);
  return job;
}

/** Called once at boot: a job a restart interrupted either finishes now or is marked failed with an honest line. */
export function resumeVideoJobs(): void {
  const rows = db.select().from(videoJobs).where(inArray(videoJobs.state, ["queued", "running"])).all();
  for (const row of rows) void resume(fromRow(row));
  void releaseHouseholdQueue();
}

async function resume(job: VideoJob): Promise<void> {
  const person = db.select().from(people).where(eq(people.id, job.personId)).get();
  if (!person) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} It did not finish. Try again.`; saveVideoJob(job); return; }
  if (job.kind === "edit") {
    job.state = "failed";
    // REFVIDEO-STEPS-01: a video from pictures keeps its sheet once step 1 is done; Try again makes the video from it without new cut-outs.
    job.error = job.request.reference ? `${EDIT_RESTART_LINE.replace(/ Ask again\.$/, "")} Your ${job.request.reference.route === "first_frame" ? "first picture" : "reference sheet"} is kept: choose Try again to make the video from it.` : EDIT_RESTART_LINE;
    saveVideoJob(job); return;
  }
  liveJobs.set(job.id, job);
  if (!job.stackJob) return;
  void watch(job, person as PersonRow);
}

/** The address of a job's clip or poster for its owner (Range-capable, see routes/videos.ts). */
export function clipUrl(job: VideoJob, file: VideoFile): string { return `/api/videos/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(file.id)}`; }
export function posterUrl(job: VideoJob, file: VideoFile): string { return `/api/videos/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(file.poster_id)}`; }
