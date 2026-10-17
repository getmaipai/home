// IMGGEN-HOME-01: where picture jobs live. A temporary or Incognito chat's jobs are memory only (and go with the chat,
// the person or two hours); every other job is a `picture_jobs` row, written only when what the card shows changed.
// No import of lib/attachments here: attachments.ts calls the delete helpers below when a turn, a chat or a person is
// forgotten, so a deleted chat takes its picture prompts with it.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { pictureJobs } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import type { JobLikeness } from "@/lib/likeness/guard";
import { StackPicturesError } from "./stack";

export type PictureJobKind = "generate" | "variation" | "edit";
export type PictureJobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface PictureFile {
  id: string;
  width: number;
  height: number;
  seed: number | null;
  model: string | null;
  steps: number | null;
  ms: number | null;
}

/** What the person asked for, kept on their own job record (never in a log). */
export interface PictureRequest {
  size: string;
  n: number;
  seed: number | null;
  loras: string[];
  /** A variation or an edit starts from this file in the same conversation. */
  source_file_id: string | null;
  audience: "all-ages" | "adult";
  /** IMGGEN-QUALITY-01: which maker made it (absent on a job stored before the choice existed: Quick). */
  quality?: "quick" | "detailed";
  /** LIKENESS-01: set when the picture looks like a household adult. Checked again on every poll while the job waits. */
  likeness?: JobLikeness | null;
  /** IMGEDIT-01: an edit of a picture already in this chat. The result is saved as the next version of that picture (so the editor shows Original and Undo), and its source is never changed. */
  edit?: { source_id: string; label: string; method: "instruct" | "erase_people" | "tool" };
}

export interface PictureJob {
  id: string;
  personId: string;
  conversationId: string | null;
  turnId: string | null;
  kind: PictureJobKind;
  state: PictureJobState;
  stackJob: string | null;
  percent: number;
  phase: string | null;
  position: number | null;
  prompt: string;
  request: PictureRequest;
  error: string | null;
  files: PictureFile[];
  temporary: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The plain line a failed picture shows. It says what happened and what to do; the Stack's own sentence is used when it has one. */
export const PICTURE_FAILED_PREFIX = "I couldn't make that picture.";

export function plainFailure(error: unknown): string {
  if (error instanceof StackPicturesError) {
    switch (error.code) {
      case "queue_full": return `${PICTURE_FAILED_PREFIX} The picture engine has a full line right now. Try again in a minute.`;
      case "no_memory": return `${PICTURE_FAILED_PREFIX} Paused: this computer is low on memory. Close big apps, or try again in a minute.`;
      case "not_installed": case "unsupported": return `${PICTURE_FAILED_PREFIX} No picture model is installed on this computer yet. An admin can add one in Settings, Pictures and videos.`;
      case "unreachable": case "no_stack": return `${PICTURE_FAILED_PREFIX} The picture engine isn't answering. Check that the engine is running, then try again.`;
      case "lora_not_allowed": return `${PICTURE_FAILED_PREFIX} That style isn't available for this request. Choose another style or leave it out.`;
      case "unknown_lora": case "wrong_base_model": return `${PICTURE_FAILED_PREFIX} That style isn't available any more. Choose another or leave it out.`;
      default: return `${PICTURE_FAILED_PREFIX} ${trimSentence(error.message)} Try again or change the request.`;
    }
  }
  return `${PICTURE_FAILED_PREFIX} Something went wrong while making it. Try again or change the request.`;
}
function trimSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Something went wrong while making it.";
  return /[.!?]$/.test(clean) ? clean.slice(0, 240) : `${clean.slice(0, 240)}.`;
}

// ---------------------------------------------------------------- store

/** Jobs of a temporary or Incognito chat: memory only. */
const memory = new Map<string, PictureJob>();
/** DB-backed jobs being made now. The watcher, a Stop and a read all see this one object, so a stop is never overwritten by a poll. */
const live = new Map<string, PictureJob>();
const lastSaved = new Map<string, string>();
const TEMP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type Row = typeof pictureJobs.$inferSelect;
function fromRow(row: Row): PictureJob {
  return {
    id: row.id, personId: row.personId, conversationId: row.conversationId, turnId: row.turnId, kind: row.kind as PictureJobKind, state: row.state as PictureJobState,
    stackJob: row.stackJob, percent: row.percent, phase: row.phase, position: row.position, prompt: row.prompt, request: JSON.parse(row.request) as PictureRequest,
    error: row.error, files: JSON.parse(row.files) as PictureFile[], temporary: false, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function signature(job: PictureJob): string {
  return `${job.state}|${job.percent}|${job.phase}|${job.position}|${job.error}|${job.stackJob}|${job.files.map((f) => f.id).join(",")}`;
}

/** Writes the job when what the card shows changed (a poll that saw the same thing writes nothing). */
export function saveJob(job: PictureJob): void {
  if (job.temporary) {
    const now = Date.now();
    for (const [id, other] of memory) if (now - new Date(other.createdAt).getTime() > TEMP_MAX_AGE_MS) memory.delete(id);
    job.updatedAt = new Date().toISOString();
    memory.set(job.id, job);
    return;
  }
  const sig = signature(job);
  if (lastSaved.get(job.id) === sig) return;
  lastSaved.set(job.id, sig);
  job.updatedAt = new Date().toISOString();
  const values = {
    personId: job.personId, conversationId: job.conversationId, turnId: job.turnId, kind: job.kind, state: job.state, stackJob: job.stackJob, percent: job.percent,
    phase: job.phase, position: job.position, prompt: job.prompt, request: JSON.stringify(job.request), error: job.error, files: JSON.stringify(job.files), updatedAt: job.updatedAt, hlc: nextHlc(),
  };
  db.insert(pictureJobs).values({ id: job.id, createdAt: job.createdAt, ...values }).onConflictDoUpdate({ target: pictureJobs.id, set: values }).run();
}

export function markLive(job: PictureJob): void { if (!job.temporary) live.set(job.id, job); }
export function markSettled(job: PictureJob): void { live.delete(job.id); lastSaved.delete(job.id); }

/** The job object to use: the live one while it is being made, else the stored row. */
function resolve(id: string): PictureJob | null {
  const mem = memory.get(id) ?? live.get(id);
  if (mem) return mem;
  const row = db.select().from(pictureJobs).where(eq(pictureJobs.id, id)).get();
  return row ? fromRow(row) : null;
}

/** A job by id for its owner only: nobody sees another person's pictures, a parent included. */
export function getPictureJob(actor: PersonRow, id: string): PictureJob | null {
  const job = resolve(id);
  return job && job.personId === actor.id ? job : null;
}

/** Every job of one turn in creation order: the first picture and the variations made from it. */
export function pictureJobsForTurn(actor: PersonRow, turnId: string): PictureJob[] {
  const jobs = new Map<string, PictureJob>();
  for (const job of [...memory.values(), ...live.values()]) if (job.turnId === turnId && job.personId === actor.id) jobs.set(job.id, job);
  for (const row of db.select().from(pictureJobs).where(and(eq(pictureJobs.turnId, turnId), eq(pictureJobs.personId, actor.id))).all()) if (!jobs.has(row.id)) jobs.set(row.id, fromRow(row));
  return [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The first job id of each of these turns, for the history list (one query). */
export function pictureJobIdsByTurn(actor: PersonRow, turnIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (turnIds.length === 0) return out;
  const firstAt = new Map<string, string>();
  const note = (turnId: string, id: string, at: string) => { const seen = firstAt.get(turnId); if (seen === undefined || at < seen) { firstAt.set(turnId, at); out.set(turnId, id); } };
  for (const job of memory.values()) if (job.turnId && turnIds.includes(job.turnId) && job.personId === actor.id) note(job.turnId, job.id, job.createdAt);
  const rows = db.select({ id: pictureJobs.id, turnId: pictureJobs.turnId, createdAt: pictureJobs.createdAt }).from(pictureJobs).where(and(eq(pictureJobs.personId, actor.id), inArray(pictureJobs.turnId, [...turnIds]))).all();
  for (const row of rows) if (row.turnId) note(row.turnId, row.id, row.createdAt);
  return out;
}

/** Every picture job being made right now, wherever it lives (memory only for a temporary chat, the live object, or a stored row), for the sweeps that stop jobs. */
export function unfinishedJobs(): PictureJob[] {
  const jobs = new Map<string, PictureJob>();
  for (const job of [...memory.values(), ...live.values()]) if (job.state === "queued" || job.state === "running") jobs.set(job.id, job);
  for (const row of db.select().from(pictureJobs).where(inArray(pictureJobs.state, ["queued", "running"])).all()) if (!jobs.has(row.id)) jobs.set(row.id, fromRow(row));
  return [...jobs.values()];
}

/** Unfinished stored jobs, for the boot-time resume. */
export function unfinishedStoredJobs(): PictureJob[] {
  return db.select().from(pictureJobs).where(inArray(pictureJobs.state, ["queued", "running"])).all().map(fromRow);
}

// ---------------------------------------------------------------- forgetting

/** A turn is deleted (or expires): its picture jobs go with it, prompts included. */
export function deletePictureJobsForTurns(turnIds: readonly string[]): void {
  if (turnIds.length === 0) return;
  db.delete(pictureJobs).where(inArray(pictureJobs.turnId, [...turnIds])).run();
  for (const [id, job] of memory) if (job.turnId && turnIds.includes(job.turnId)) memory.delete(id);
  for (const [id, job] of live) if (job.turnId && turnIds.includes(job.turnId)) live.delete(id);
}

/** A person is forgotten or deleted: every job of theirs goes. */
export function deletePictureJobsForPerson(personId: string): void {
  db.delete(pictureJobs).where(eq(pictureJobs.personId, personId)).run();
  for (const [id, job] of memory) if (job.personId === personId) memory.delete(id);
  for (const [id, job] of live) if (job.personId === personId) live.delete(id);
}

/** A temporary chat ends: its jobs (memory only) go. */
export function dropTemporaryPictureJobs(conversationId: string): void {
  for (const [id, job] of memory) if (job.conversationId === conversationId) memory.delete(id);
}
export function dropTemporaryPictureJobsForPerson(personId: string): void {
  for (const [id, job] of memory) if (job.personId === personId) memory.delete(id);
}

/** Test-only. */
export function __clearPictureStoreForTests(): void {
  memory.clear();
  live.clear();
  lastSaved.clear();
}
