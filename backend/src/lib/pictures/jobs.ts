// IMGGEN-HOME-01: a picture job from the person's side. The chat card polls Home (never the Stack); Home
// polls the Stack, stores each finished picture as the person's own file, and keeps one honest line when
// something fails (rule 6: a failed picture never fails the answer). A temporary or Incognito chat keeps
// the job and its pictures in memory only; every other job is a row in `picture_jobs` so a reload, a second
// device and a restart all show the same card.
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { conversationTurns, people, pictureJobs } from "@/db/schema";
import { createAttachment, getAttachment, storeTemporaryChatImage } from "@/lib/attachments";
import { newFileId, newPictureJobId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { pictureUrl } from "@/lib/imageEdit";
import type { PersonRow } from "@/types";
import { cancelOrDelete, fetchPicture, getGenerationJob, StackPicturesError, submitGeneration, type GenerationBody, type StackPic } from "./stack";

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
      case "no_memory": return `${PICTURE_FAILED_PREFIX} This computer is busy with other work right now. Try again in a minute.`;
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

const memory = new Map<string, PictureJob>();
const watching = new Map<string, AbortController>();

type Row = typeof pictureJobs.$inferSelect;
function fromRow(row: Row): PictureJob {
  return {
    id: row.id, personId: row.personId, conversationId: row.conversationId, turnId: row.turnId, kind: row.kind as PictureJobKind, state: row.state as PictureJobState,
    stackJob: row.stackJob, percent: row.percent, phase: row.phase, position: row.position, prompt: row.prompt, request: JSON.parse(row.request) as PictureRequest,
    error: row.error, files: JSON.parse(row.files) as PictureFile[], temporary: false, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function save(job: PictureJob): void {
  job.updatedAt = new Date().toISOString();
  if (job.temporary) { memory.set(job.id, job); return; }
  const values = {
    personId: job.personId, conversationId: job.conversationId, turnId: job.turnId, kind: job.kind, state: job.state, stackJob: job.stackJob, percent: job.percent,
    phase: job.phase, position: job.position, prompt: job.prompt, request: JSON.stringify(job.request), error: job.error, files: JSON.stringify(job.files), updatedAt: job.updatedAt, hlc: nextHlc(),
  };
  db.insert(pictureJobs).values({ id: job.id, createdAt: job.createdAt, ...values }).onConflictDoUpdate({ target: pictureJobs.id, set: values }).run();
}

/** A job by id for its owner only: nobody sees another person's pictures, a parent included. */
export function getPictureJob(actor: PersonRow, id: string): PictureJob | null {
  const live = memory.get(id);
  if (live) return live.personId === actor.id ? live : null;
  const row = db.select().from(pictureJobs).where(eq(pictureJobs.id, id)).get();
  return row && row.personId === actor.id ? fromRow(row) : null;
}

/** The job a turn started, by the turn id, for the chat history. */
export function pictureJobForTurn(actor: PersonRow, turnId: string): PictureJob | null {
  for (const job of memory.values()) if (job.turnId === turnId && job.personId === actor.id) return job;
  const row = db.select().from(pictureJobs).where(and(eq(pictureJobs.turnId, turnId), eq(pictureJobs.personId, actor.id))).get();
  return row ? fromRow(row) : null;
}

/** Every job of one turn in creation order: the first picture and the variations made from it. */
export function pictureJobsForTurn(actor: PersonRow, turnId: string): PictureJob[] {
  const jobs = new Map<string, PictureJob>();
  for (const job of memory.values()) if (job.turnId === turnId && job.personId === actor.id) jobs.set(job.id, job);
  for (const row of db.select().from(pictureJobs).where(and(eq(pictureJobs.turnId, turnId), eq(pictureJobs.personId, actor.id))).all()) if (!jobs.has(row.id)) jobs.set(row.id, fromRow(row));
  return [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The ids of the jobs of these turns, for the history list (one query). */
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

/** Test-only. */
export function __resetPictureJobsForTests(): void {
  for (const controller of watching.values()) controller.abort();
  watching.clear();
  memory.clear();
}

// ---------------------------------------------------------------- start

export interface StartPictureInput {
  actor: PersonRow;
  conversationId: string | null;
  turnId: string | null;
  temporary: boolean;
  kind: PictureJobKind;
  prompt: string;
  body: Omit<GenerationBody, "timeout_ms">;
  sourceFileId?: string | null;
}

/** Submits to the Stack and returns the job once the Stack has it; throws `StackPicturesError` when the Stack refuses. */
export async function startPictureJob(input: StartPictureInput): Promise<PictureJob> {
  const submitted = await submitGeneration({ ...input.body, timeout_ms: 1 });
  const now = new Date().toISOString();
  const job: PictureJob = {
    id: newPictureJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, kind: input.kind, state: "queued", stackJob: submitted.job,
    percent: 0, phase: "queued", position: null, prompt: input.prompt,
    request: { size: input.body.size ?? "1024x1024", n: input.body.n ?? 1, seed: input.body.seed ?? null, loras: (input.body.loras ?? []).map((l) => l.id), source_file_id: input.sourceFileId ?? null, audience: input.body.audience },
    error: null, files: [], temporary: input.temporary, createdAt: now, updatedAt: now,
  };
  save(job);
  void watch(job, input.actor, submitted.done);
  return job;
}

// ---------------------------------------------------------------- watching

let POLL_MS = 700;
/** Test seam: poll faster (null restores). */
export function __setPicturePollMsForTests(ms: number | null): void { POLL_MS = ms ?? 700; }
const MAX_WATCH_MS = 8 * 60 * 1000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

async function watch(job: PictureJob, actor: PersonRow, early: StackPic[] | null = null): Promise<void> {
  if (!job.stackJob || watching.has(job.id)) return;
  const controller = new AbortController();
  watching.set(job.id, controller);
  const deadline = Date.now() + MAX_WATCH_MS;
  try {
    if (early) { await finish(job, actor, early); return; }
    while (!controller.signal.aborted && Date.now() < deadline) {
      let status;
      try {
        status = await getGenerationJob(job.stackJob);
      } catch (error) {
        if (error instanceof StackPicturesError && error.status === 404) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} The engine lost track of it, most likely because it restarted. Try again.`; save(job); return; }
        // A single missed poll is not a failure; the next one decides.
        await sleep(POLL_MS * 2, controller.signal);
        continue;
      }
      if (status.state === "done") { await finish(job, actor, status.data); return; }
      if (status.state === "failed") { job.state = "failed"; job.error = plainFailure(new StackPicturesError(500, status.code ?? "failed", status.error ?? "")); save(job); return; }
      if (status.state === "cancelled") { job.state = "cancelled"; job.error = null; save(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      job.percent = Math.max(0, Math.min(99, Math.round(status.progress)));
      job.phase = status.phase;
      job.position = status.position;
      save(job);
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} It took longer than expected. Try again, or ask for something simpler.`; save(job); void cancelOrDelete(job.stackJob); }
  } catch {
    job.state = "failed";
    job.error = plainFailure(null);
    try { save(job); } catch { /* the job ends here either way */ }
  } finally {
    watching.delete(job.id);
  }
}

async function waitForTurnRow(turnId: string): Promise<boolean> {
  // The turn's row is written when the reply ends; a fast picture can finish first.
  for (let i = 0; i < 120; i += 1) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function finish(job: PictureJob, actor: PersonRow, pics: StackPic[]): Promise<void> {
  const stackJob = job.stackJob!;
  const files: PictureFile[] = [];
  for (let index = 0; index < pics.length; index += 1) {
    const pic = pics[index]!;
    const raw = pic.b64_json ? new Uint8Array(Buffer.from(pic.b64_json, "base64")) : await fetchPicture(stackJob, index);
    // The bytes are stored exactly as the Stack made them: image-to-video checks their digest against what the engine
    // returned, so nothing may re-encode them. They are decoded here only to prove they are a picture and read the size.
    const info = await sharp(raw, { failOn: "error", limitInputPixels: 64_000_000 }).metadata();
    if (!info.width || !info.height || info.format !== "png") throw new Error("not a png picture");
    const bytes = raw;
    const meta = { seed: pic.seed ?? null, model: pic.model ?? null, steps: pic.steps ?? null, ms: pic.ms ?? null };
    const conversationId = job.conversationId;
    if (!conversationId) throw new Error("no conversation");
    if (job.temporary) {
      const id = newFileId();
      storeTemporaryChatImage({ id, turnId: job.turnId ?? `gen-${job.id}`, conversationId, ownerPersonId: actor.id, name: "Generated picture", mediaType: "image/png", width: info.width, height: info.height, bytes });
      files.push({ id, width: info.width, height: info.height, ...meta });
      continue;
    }
    if (!job.turnId || !(await waitForTurnRow(job.turnId))) throw new Error("turn row never appeared");
    const created = createAttachment(actor, { conversationId, turnId: job.turnId, mediaType: "image/png", bytes, provenance: `picture-gen:${JSON.stringify({ v: 1, job: job.id, index, ...meta, width: info.width, height: info.height })}`, deduplicate: false });
    if (!created.ok) {
      job.state = "failed";
      job.error = created.status === 403 ? `${PICTURE_FAILED_PREFIX} Your storage is full. Delete some files in Settings, Storage, then try again.` : `${PICTURE_FAILED_PREFIX} The picture couldn't be saved. Try again.`;
      save(job);
      return;
    }
    files.push({ id: created.value.id, width: info.width, height: info.height, ...meta });
  }
  job.files = files;
  job.state = "done";
  job.percent = 100;
  job.phase = "ready";
  job.error = null;
  save(job);
  void cancelOrDelete(stackJob);
}

/** Stop a job. Safe to call twice; a finished job stays finished. */
export async function cancelPictureJob(actor: PersonRow, id: string): Promise<PictureJob | null> {
  const job = getPictureJob(actor, id);
  if (!job) return null;
  if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return job;
  watching.get(job.id)?.abort();
  watching.delete(job.id);
  if (job.stackJob) await cancelOrDelete(job.stackJob);
  job.state = "cancelled";
  job.error = null;
  save(job);
  return job;
}

/** Called once at boot: a job a restart interrupted either finishes now or is marked failed with an honest line. */
export function resumePictureJobs(): void {
  const rows = db.select().from(pictureJobs).where(inArray(pictureJobs.state, ["queued", "running"])).all();
  for (const row of rows) {
    const job = fromRow(row);
    void resume(job);
  }
}

async function resume(job: PictureJob): Promise<void> {
  const person = db.select().from(people).where(eq(people.id, job.personId)).get();
  if (!person || !job.stackJob) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} Home restarted before it finished. Try again.`; save(job); return; }
  void watch(job, person as PersonRow);
}

/** What the file's owner may fetch: the picture's address inside its conversation. */
export function fileUrl(job: PictureJob, file: PictureFile): string {
  return pictureUrl(job.conversationId ?? "", file.id);
}

/** A stored file the actor can read, used to check a variation's source is theirs. */
export function ownFile(actor: PersonRow, id: string): boolean {
  return getAttachment(actor, id).ok;
}
