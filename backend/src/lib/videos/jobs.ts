// VIDEO-GEN-05: a video job from the person's side. The chat card polls Home (never the Stack); Home polls the
// Stack, stores each finished clip as the person's own file, and keeps one honest line when something fails
// (rule 6: a failed video never fails the answer). A temporary or Incognito chat keeps the job and its clip in
// memory only (a two-hour window, gone with the chat); every other job is a row in `video_jobs` so a reload, a
// second device and a restart all show the same card. Same shape as lib/pictures/jobs.ts, on purpose.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, people, videoJobs } from "@/db/schema";
import { createAttachment, getTemporaryChatImage, latestGeneratedTemporaryImage, readAttachmentForConversation, registerTemporaryMedia } from "@/lib/attachments";
import { newFileId, newVideoJobId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import { allVideoAdapters } from "./adapters";
import { checkImages, isAdultOnlyJob } from "@/lib/pictures/ageCheck";
import { gateFinished, laneOfPerson } from "@/lib/pictures/laneGate";
import { videoModelForLane } from "@/lib/pictures/lane";
import { ensureKeyframeHelper, extractKeyframes } from "@/lib/pictures/keyframes";
import { likenessStillAllowed, type JobLikeness } from "@/lib/likeness/guard";
import { clearLive, updateLive } from "@/lib/genLive";
import { cancelOrDeleteVideo, fetchClip, fetchPoster, fetchVideoPreview, getVideoJob, StackVideoError, submitVideo, type StackClip, type VideoBody } from "./stack";

export type VideoJobKind = "generate" | "animate";
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
}

/** What the person asked for, kept on their own job record (never in a log). */
export interface VideoRequest {
  size: string;
  seconds: number;
  seed: number | null;
  loras: string[];
  /** The generated picture a clip starts from (an attachment id in this conversation), or null. */
  source_file_id: string | null;
  audience: "all-ages" | "adult";
  /** VIDEO-LTX-01: Quick or Detailed (absent on a job stored before the choice existed: Quick). */
  quality?: "quick" | "detailed";
  /** LIKENESS-01: set when the clip looks like a household adult. Checked again on every poll while the job waits. */
  likeness?: JobLikeness | null;
}

export interface VideoJob {
  id: string;
  personId: string;
  conversationId: string | null;
  turnId: string | null;
  kind: VideoJobKind;
  state: VideoJobState;
  stackJob: string | null;
  percent: number;
  phase: string | null;
  position: number | null;
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

/** The line a queued job shows while the Stack is busy with another picture or video. */
export function busyLine(position: number | null): string {
  const base = "Home is busy making another picture, video or song. It will start in a minute.";
  return position && position > 1 ? `${base} You are number ${position} in line.` : base;
}

export function plainVideoFailure(error: unknown): string {
  if (error instanceof StackVideoError) {
    switch (error.code) {
      case "already_making": return `${VIDEO_FAILED_PREFIX} ${error.message}`;
      case "queue_full": return `${VIDEO_FAILED_PREFIX} Home already has a full line of videos waiting. Try again in a few minutes.`;
      case "no_memory": case "out_of_memory": return `${VIDEO_FAILED_PREFIX} Paused: this computer is low on memory. Close big apps, or try again in a few minutes.`;
      case "not_installed": case "model_missing": case "setup_failed": return `${VIDEO_FAILED_PREFIX} No video model is installed on this computer yet. An admin can add one in Settings, Pictures, videos and music.`;
      case "not_available_on_this_computer": case "unsupported": return `${VIDEO_FAILED_PREFIX} This computer can't make videos. Videos need a Mac with 128 GB of memory.`;
      case "unreachable": case "no_stack": return `${VIDEO_FAILED_PREFIX} The video engine isn't answering. Check that the engine is running, then try again.`;
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

type Row = typeof videoJobs.$inferSelect;
function fromRow(row: Row): VideoJob {
  return {
    id: row.id, personId: row.personId, conversationId: row.conversationId, turnId: row.turnId, kind: row.kind as VideoJobKind, state: row.state as VideoJobState,
    stackJob: row.stackJob, percent: row.percent, phase: row.phase, position: row.position, prompt: row.prompt, request: JSON.parse(row.request) as VideoRequest,
    error: row.error, files: JSON.parse(row.files) as VideoFile[], temporary: false, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function save(job: VideoJob): void {
  job.updatedAt = new Date().toISOString();
  if (job.temporary) { memory.set(job.id, job); return; }
  const values = {
    personId: job.personId, conversationId: job.conversationId, turnId: job.turnId, kind: job.kind, state: job.state, stackJob: job.stackJob, percent: job.percent,
    phase: job.phase, position: job.position, prompt: job.prompt, request: JSON.stringify(job.request), error: job.error, files: JSON.stringify(job.files), updatedAt: job.updatedAt, hlc: nextHlc(),
  };
  db.insert(videoJobs).values({ id: job.id, createdAt: job.createdAt, ...values }).onConflictDoUpdate({ target: videoJobs.id, set: values }).run();
}

/** A job by id for its owner only: nobody sees another person's videos, a parent included. */
export function getVideoJobFor(actor: PersonRow, id: string): VideoJob | null {
  const live = memory.get(id) ?? liveJobs.get(id);
  if (live) return live.personId === actor.id ? live : null;
  const row = db.select().from(videoJobs).where(eq(videoJobs.id, id)).get();
  return row && row.personId === actor.id ? fromRow(row) : null;
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

interface TemporaryClip { id: string; conversationId: string; ownerPersonId: string; mediaType: string; bytes: Uint8Array; createdAt: number; /** LIKENESS-01: the poster of a clip that looks like a person is not a free starting picture. */ noReference?: true }
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
  if (!job.conversationId) return null;
  const read = readAttachmentForConversation(actor, job.conversationId, fileId);
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

// ---------------------------------------------------------------- reference pictures

export const GENERATED_PICTURE_NOTE = "picture-gen:";
export const CLIP_POSTER_NOTE = "video-poster:";

export type ReferenceResult = { ok: true; id: string; base64: string; bytes: Uint8Array; width: number | null; height: number | null; /** LIKENESS-01: the person this picture looks like (it was made with a style of them, or from a photo of them). Starting a clip from it asks their agreement again. */ likenessSubject: string | null } | { ok: false; line: string };
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
    if (clip && clip.ownerPersonId === actor.id && clip.conversationId === conversationId && clip.mediaType === "image/jpeg" && clip.noReference !== true) return { ok: true, id: fileId, base64: Buffer.from(clip.bytes).toString("base64"), bytes: clip.bytes, width: null, height: null, likenessSubject: null };
    // A temporary picture counts only when Home marked it `generated` when the picture engine made it (a field no upload
    // can set; a file name proves nothing). The Stack still checks the bytes' hash.
    const image = getTemporaryChatImage(actor, conversationId, fileId);
    if (image && image.generated === true) return { ok: true, id: fileId, base64: Buffer.from(image.bytes).toString("base64"), bytes: image.bytes, width: image.width, height: image.height, likenessSubject: null };
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
  let likenessSubject: string | null = null;
  try {
    const meta = JSON.parse(note.slice(note.indexOf(":") + 1)) as { width?: number; height?: number; likeness?: string | null };
    width = typeof meta.width === "number" ? meta.width : null;
    height = typeof meta.height === "number" ? meta.height : null;
    likenessSubject = typeof meta.likeness === "string" && meta.likeness ? meta.likeness : null;
  } catch { /* the size is only a hint for the clip's shape */ }
  return { ok: true, id: fileId, base64: Buffer.from(read.value.bytes).toString("base64"), bytes: read.value.bytes, width, height, likenessSubject };
}

export type PhotoResult = { ok: true; id: string; base64: string; bytes: Uint8Array; width: number | null; height: number | null } | { ok: false; line: string };
const NOT_A_PHOTO_LINE = "I can't find that photo any more. Attach it again and ask once more.";

/** A photo a person attached in this conversation (not one this home made), as its stored bytes, unchanged. LIKENESS-01: it starts a clip only for a declared household adult who agreed, and only after the photo is checked to show exactly that one person. */
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
  temporary: boolean;
  kind: VideoJobKind;
  prompt: string;
  body: Omit<VideoBody, "timeout_ms">;
  sourceFileId?: string | null;
  /** LIKENESS-01: the clip looks like this household adult (already decided by lib/likeness/decide.ts). */
  likeness?: JobLikeness | null;
}

/** Submits to the Stack and returns the job once the Stack has it; throws `StackVideoError` when the Stack refuses. */
export async function startVideoJob(input: StartVideoInput): Promise<VideoJob> {
  // One clip at a time per person: a second one waits until the first is done or stopped, so no one can fill the Stack's line.
  if (activeVideoJobsFor(input.actor) > 0) throw new StackVideoError(429, "already_making", "You already have a video being made. Wait for it to finish, or stop it first.");
  // Whoever calls, a teen or a child is on an allowed model (Quick, silent); only an adult's own choice reaches the engine.
  const model = videoModelForLane(laneOfPerson(input.actor), input.body.model);
  const submitted = await submitVideo({ ...input.body, ...(model ? { model } : {}), timeout_ms: 1 });
  // The finished-clip check needs the keyframe helper; compile it now, while the clip renders, so it is ready when the clip is.
  void ensureKeyframeHelper();
  const now = new Date().toISOString();
  const job: VideoJob = {
    id: newVideoJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, kind: input.kind, state: "queued", stackJob: submitted.job,
    percent: 0, phase: "queued", position: null, prompt: input.prompt,
    request: { size: input.body.size ?? (model === "detailed" ? "768x448" : "832x480"), seconds: input.body.seconds ?? 5, quality: model === "detailed" ? "detailed" : "quick", seed: input.body.seed ?? null, loras: (input.body.loras ?? []).map((l) => l.id), source_file_id: input.sourceFileId ?? null, audience: input.body.audience, ...(input.likeness ? { likeness: input.likeness } : {}) },
    error: null, files: [], temporary: input.temporary, createdAt: now, updatedAt: now,
  };
  save(job);
  liveJobs.set(job.id, job);
  void watch(job, input.actor, submitted.done);
  return job;
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

/** LIKENESS-01: ends the job (and the Stack's copy) when its subject no longer agrees. True when it did. */
function stopForLikeness(job: VideoJob): boolean {
  const likeness = job.request.likeness;
  if (!likeness) return false;
  const now = likenessStillAllowed(likeness);
  if (now.ok) return false;
  job.state = "failed";
  job.error = now.line;
  job.files = [];
  save(job);
  watching.get(job.id)?.abort();
  watching.delete(job.id);
  if (job.stackJob) void cancelOrDeleteVideo(job.stackJob);
  return true;
}

/** The person took their agreement back (or only the adult-content part): every clip of them still waiting or being made stops now. Returns how many. */
export function stopLikenessVideoJobs(subjectPersonId: string, onlyAdultContent: boolean): number {
  let count = 0;
  const jobs = new Map<string, VideoJob>();
  for (const job of [...memory.values(), ...liveJobs.values()]) if (job.state === "queued" || job.state === "running") jobs.set(job.id, job);
  for (const row of db.select().from(videoJobs).where(inArray(videoJobs.state, ["queued", "running"])).all()) if (!jobs.has(row.id)) jobs.set(row.id, fromRow(row));
  for (const job of jobs.values()) {
    const likeness = job.request.likeness;
    if (!likeness || likeness.subject !== subjectPersonId || likeness.subject === likeness.requester) continue;
    if (onlyAdultContent && !likeness.adult_content) continue;
    if (stopForLikeness(job)) count += 1;
  }
  return count;
}

async function watch(job: VideoJob, actor: PersonRow, early: StackClip[] | null = null): Promise<void> {
  if (!job.stackJob || watching.has(job.id)) return;
  const controller = new AbortController();
  watching.set(job.id, controller);
  const deadline = Date.now() + MAX_WATCH_MS;
  try {
    if (early) {
      if (stopForLikeness(job)) return;
      await finish(job, actor, early, controller.signal);
      return;
    }
    while (!controller.signal.aborted && Date.now() < deadline) {
      // The person it looks like can take their agreement back at any moment: checked on every poll, so a clip waiting in the line is stopped.
      if (stopForLikeness(job)) return;
      let status;
      try {
        status = await getVideoJob(job.stackJob);
      } catch (error) {
        if (error instanceof StackVideoError && error.status === 404) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} The engine lost track of it, most likely because it restarted. Try again.`; save(job); return; }
        // A single missed poll is not a failure; the next one decides.
        await sleep(POLL_MS * 2, controller.signal);
        continue;
      }
      if (controller.signal.aborted) return;
      if (status.state === "done") { if (stopForLikeness(job)) return; await finish(job, actor, status.data, controller.signal); return; }
      if (status.state === "failed") { job.state = "failed"; job.error = plainVideoFailure(new StackVideoError(500, status.code ?? "failed", status.error ?? "")); save(job); return; }
      if (status.state === "cancelled" && status.code === "no_memory") { job.state = "failed"; job.error = plainVideoFailure(new StackVideoError(503, "no_memory", status.error ?? "")); save(job); return; }
      if (status.state === "cancelled") { job.state = "cancelled"; job.error = null; save(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      job.percent = Math.max(0, Math.min(99, Math.round(status.progress)));
      job.phase = status.phase;
      job.position = status.position;
      save(job);
      await updateLive(job.id, status, () => fetchVideoPreview(job.stackJob!));
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} It took longer than expected. Try again, or ask for something simpler.`; save(job); void cancelOrDeleteVideo(job.stackJob); }
  } catch {
    job.state = "failed";
    job.error = plainVideoFailure(null);
    try { save(job); } catch { /* the job ends here either way */ }
  } finally {
    watching.delete(job.id);
    clearLive(job.id);
    liveJobs.delete(job.id);
  }
}

async function waitForTurnRow(turnId: string): Promise<boolean> {
  // The turn's row is written when the reply ends; the clip arrives minutes later, but a restart-resumed job can come sooner.
  for (let i = 0; i < 120; i += 1) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** An mp4 starts with a box header: four size bytes, then `ftyp`. Anything else is not a clip and is never stored. */
export function looksLikeMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength > 1024 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}
function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength > 100 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function saveFailureLine(status: number): string {
  return status === 403 ? `${VIDEO_FAILED_PREFIX} Your storage is full. Delete some files in Settings, Storage, then try again.` : `${VIDEO_FAILED_PREFIX} The video couldn't be saved. Try again.`;
}

async function finish(job: VideoJob, actor: PersonRow, clips: StackClip[], signal: AbortSignal): Promise<void> {
  const stackJob = job.stackJob!;
  try {
    const clip = clips[0];
    if (!clip) { job.state = "failed"; job.error = plainVideoFailure(null); save(job); return; }
    // The Stack's bytes are stored unchanged: a poster that is re-encoded could never start a later clip.
    const video = await fetchClip(stackJob);
    const poster = await fetchPoster(stackJob);
    if (signal.aborted) return;
    if (!looksLikeMp4(video) || !looksLikeJpeg(poster)) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} The video engine sent a file I couldn't read. Try again.`; save(job); return; }
    // VIDEO-GEN / IMGGEN-SAFE-01: the finished-clip check, before anything is stored or shown. First, middle and last
    // keyframes go through the same local vision check as a picture; a Mac that cannot decode a clip checks the poster alone.
    const adult = await isAdultOnlyJob(job.prompt, job.request.loras, async (id) => (await allVideoAdapters()).find((a) => a.id === id)?.classification);
    const keyframes = await extractKeyframes(video, clip.seconds ?? job.request.seconds);
    const checks = await checkImages(keyframes ?? [poster], "video");
    // The poster is frame 0 only. For an adult-only clip that is not enough to answer for the rest of it, so it counts as "could not check".
    if (!keyframes) checks.push({ ok: false, why: "unavailable" });
    if (signal.aborted) return;
    const decision = await gateFinished({ actor, kind: "video", jobId: job.id, adultOnly: adult, checks, images: keyframes ?? [poster], prompt: job.prompt });
    if (decision.action === "withhold") { job.state = "failed"; job.error = decision.line; job.files = []; save(job); return; }
    const conversationId = job.conversationId;
    if (!conversationId) throw new Error("no conversation");
    const width = clip.width ?? 832;
    const height = clip.height ?? 480;
    const quality = clip.quality === "detailed" ? "detailed" as const : "quick" as const;
    const meta = { seed: clip.seed ?? null, model: clip.model ?? null, ms: clip.ms ?? null, seconds: clip.seconds ?? null, width, height, quality, audio: clip.audio === true };
    let file: VideoFile;
    if (job.temporary) {
      const id = newFileId();
      const posterId = newFileId();
      storeTemporaryClip({ id, conversationId, ownerPersonId: actor.id, mediaType: "video/mp4", bytes: video });
      storeTemporaryClip({ id: posterId, conversationId, ownerPersonId: actor.id, mediaType: "image/jpeg", bytes: poster, ...(job.request.likeness ? { noReference: true as const } : {}) });
      file = { id, poster_id: posterId, width, height, seconds: meta.seconds, seed: meta.seed, model: meta.model, ms: meta.ms, bytes: video.byteLength, quality, audio: meta.audio };
    } else {
      if (!job.turnId || !(await waitForTurnRow(job.turnId))) throw new Error("turn row never appeared");
      if (signal.aborted) return;
      const made = createAttachment(actor, { conversationId, turnId: job.turnId, mediaType: "video/mp4", bytes: video, provenance: `video-gen:${JSON.stringify({ v: 1, audience: adult ? "adult-only" : "all-ages", job: job.id, ...meta })}`, deduplicate: false, retention: "conversation" });
      if (!made.ok) { job.state = "failed"; job.error = saveFailureLine(made.status); save(job); return; }
      const madePoster = createAttachment(actor, { conversationId, turnId: job.turnId, mediaType: "image/jpeg", bytes: poster, provenance: `${CLIP_POSTER_NOTE}${JSON.stringify({ v: 1, audience: adult ? "adult-only" : "all-ages", job: job.id, width, height, ...(job.request.likeness ? { likeness: job.request.likeness.subject } : {}) })}`, deduplicate: false, retention: "conversation" });
      if (!madePoster.ok) { job.state = "failed"; job.error = saveFailureLine(madePoster.status); save(job); return; }
      file = { id: made.value.id, poster_id: madePoster.value.id, width, height, seconds: meta.seconds, seed: meta.seed, model: meta.model, ms: meta.ms, bytes: video.byteLength, quality, audio: meta.audio };
    }
    job.files = [file];
    job.state = "done";
    job.percent = 100;
    job.phase = "ready";
    job.error = null;
    save(job);
  } finally {
    // Done or not, Home has taken what it wanted: the Stack's copy goes (a failed save would otherwise leave a clip on its disk).
    void cancelOrDeleteVideo(stackJob);
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
  save(job);
  return job;
}

/** Called once at boot: a job a restart interrupted either finishes now or is marked failed with an honest line. */
export function resumeVideoJobs(): void {
  const rows = db.select().from(videoJobs).where(inArray(videoJobs.state, ["queued", "running"])).all();
  for (const row of rows) void resume(fromRow(row));
}

async function resume(job: VideoJob): Promise<void> {
  const person = db.select().from(people).where(eq(people.id, job.personId)).get();
  if (!person || !job.stackJob) { job.state = "failed"; job.error = `${VIDEO_FAILED_PREFIX} Home restarted before it finished. Try again.`; save(job); return; }
  liveJobs.set(job.id, job);
  void watch(job, person as PersonRow);
}

/** The address of a job's clip or poster for its owner (Range-capable, see routes/videos.ts). */
export function clipUrl(job: VideoJob, file: VideoFile): string { return `/api/videos/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(file.id)}`; }
export function posterUrl(job: VideoJob, file: VideoFile): string { return `/api/videos/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(file.poster_id)}`; }
