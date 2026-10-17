// IMGGEN-HOME-01: a picture job from the person's side. The chat card polls Home (never the Stack); Home polls the
// Stack, stores each finished picture as the person's own file (the Stack's bytes unchanged), and keeps one honest
// line when something fails (rule 6: a failed picture never fails the answer). Where jobs live is jobStore.ts.
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { createAttachment, purgeFileRecord, removeFileBlobs, storeTemporaryChatImage } from "@/lib/attachments";
import { newFileId, newPictureJobId } from "@/lib/id";
import { pictureUrl } from "@/lib/imageEdit";
import type { PersonRow } from "@/types";
import { __clearPictureStoreForTests, markLive, markSettled, saveJob, getPictureJob, pictureJobsForTurn, unfinishedStoredJobs, PICTURE_FAILED_PREFIX, plainFailure, type PictureFile, type PictureJob, type PictureJobKind } from "./jobStore";
import { cancelOrDelete, fetchPicture, getGenerationJob, StackPicturesError, submitGeneration, type GenerationBody, type StackPic } from "./stack";

export { getPictureJob, pictureJobsForTurn, pictureJobIdsByTurn, plainFailure, PICTURE_FAILED_PREFIX, __clearPictureStoreForTests } from "./jobStore";
export type { PictureFile, PictureJob, PictureJobKind, PictureJobState, PictureRequest } from "./jobStore";

const watching = new Map<string, AbortController>();
/** Turns with a job being submitted right now: two quick clicks never start two. */
const starting = new Set<string>();

/** Test-only. */
export function __resetPictureJobsForTests(): void {
  for (const controller of watching.values()) controller.abort();
  watching.clear();
  starting.clear();
  __clearPictureStoreForTests();
}

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

/** Submits to the Stack and returns the job once the Stack has it; throws `StackPicturesError` when the Stack refuses
 * (and `busy` when this turn's card already has a picture being made). */
export async function startPictureJob(input: StartPictureInput): Promise<PictureJob> {
  const key = input.turnId;
  if (key) {
    const busy = starting.has(key) || pictureJobsForTurn(input.actor, key).some((j) => j.state === "queued" || j.state === "running");
    if (busy && input.kind !== "generate") throw new StackPicturesError(409, "busy", "A picture is still being made. Wait for it or stop it first.");
    starting.add(key);
  }
  try {
    const submitted = await submitGeneration({ ...input.body, timeout_ms: 1 });
    const now = new Date().toISOString();
    const job: PictureJob = {
      id: newPictureJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, kind: input.kind, state: "queued", stackJob: submitted.job,
      percent: 0, phase: "queued", position: null, prompt: input.prompt,
      request: { size: input.body.size ?? "1024x1024", n: input.body.n ?? 1, seed: input.body.seed ?? null, loras: (input.body.loras ?? []).map((l) => l.id), source_file_id: input.sourceFileId ?? null, audience: input.body.audience },
      error: null, files: [], temporary: input.temporary, createdAt: now, updatedAt: now,
    };
    markLive(job);
    saveJob(job);
    void watch(job, input.actor, submitted.done);
    return job;
  } finally {
    if (key) starting.delete(key);
  }
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

const stopped = (job: PictureJob) => job.state === "cancelled";

async function watch(job: PictureJob, actor: PersonRow, early: StackPic[] | null = null): Promise<void> {
  if (!job.stackJob || watching.has(job.id)) return;
  const controller = new AbortController();
  watching.set(job.id, controller);
  markLive(job);
  const deadline = Date.now() + MAX_WATCH_MS;
  try {
    if (early) { await finish(job, actor, early); return; }
    while (!controller.signal.aborted && !stopped(job) && Date.now() < deadline) {
      let status;
      try {
        status = await getGenerationJob(job.stackJob);
      } catch (error) {
        if (stopped(job)) return;
        if (error instanceof StackPicturesError && error.status === 404) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} The engine lost track of it, most likely because it restarted. Try again.`; saveJob(job); return; }
        // A single missed poll is not a failure; the next one decides.
        await sleep(POLL_MS * 2, controller.signal);
        continue;
      }
      if (stopped(job)) return;
      if (status.state === "done") { await finish(job, actor, status.data); return; }
      if (status.state === "failed") { job.state = "failed"; job.error = plainFailure(new StackPicturesError(500, status.code ?? "failed", status.error ?? "")); saveJob(job); return; }
      if (status.state === "cancelled") { job.state = "cancelled"; job.error = null; saveJob(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      job.percent = Math.max(0, Math.min(99, Math.round(status.progress)));
      job.phase = status.phase;
      job.position = status.position;
      saveJob(job);
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted && !stopped(job)) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} It took longer than expected. Try again, or ask for something simpler.`; saveJob(job); void cancelOrDelete(job.stackJob); }
  } catch {
    if (!stopped(job)) {
      job.state = "failed";
      job.error = plainFailure(null);
      try { saveJob(job); } catch { /* the job ends here either way */ }
    }
  } finally {
    watching.delete(job.id);
    markSettled(job);
  }
}

async function waitForTurnRow(turnId: string, job: PictureJob): Promise<boolean> {
  // The turn's row is written when the reply ends; a fast picture can finish first.
  for (let i = 0; i < 120 && !stopped(job); i += 1) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Removes the files a half-finished batch already stored. */
function discardStored(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const rows = db.select().from(attachments).where(inArray(attachments.id, [...ids])).all();
  const blobs: string[] = [];
  for (const row of rows) { const blob = purgeFileRecord(row); if (blob) blobs.push(blob); }
  removeFileBlobs(blobs);
}

async function finish(job: PictureJob, actor: PersonRow, pics: StackPic[]): Promise<void> {
  const stackJob = job.stackJob!;
  const files: PictureFile[] = [];
  const storedIds: string[] = [];
  const fail = (message: string) => { discardStored(storedIds); job.state = "failed"; job.error = message; job.files = []; saveJob(job); void cancelOrDelete(stackJob); };
  try {
    for (let index = 0; index < pics.length; index += 1) {
      if (stopped(job)) { discardStored(storedIds); return; }
      const pic = pics[index]!;
      const raw = pic.b64_json ? new Uint8Array(Buffer.from(pic.b64_json, "base64")) : await fetchPicture(stackJob, index);
      // The bytes are stored exactly as the Stack made them: image-to-video checks their digest against what the engine
      // returned, so nothing may re-encode them. They are decoded here only to prove they are a picture and read the size.
      const info = await sharp(raw, { failOn: "error", limitInputPixels: 64_000_000 }).metadata();
      if (!info.width || !info.height || info.format !== "png") throw new Error("not a png picture");
      const meta = { seed: pic.seed ?? null, model: pic.model ?? null, steps: pic.steps ?? null, ms: pic.ms ?? null };
      const conversationId = job.conversationId;
      if (!conversationId) throw new Error("no conversation");
      if (job.temporary) {
        const id = newFileId();
        storeTemporaryChatImage({ id, turnId: job.turnId ?? `gen-${job.id}`, conversationId, ownerPersonId: actor.id, name: "Generated picture", mediaType: "image/png", width: info.width, height: info.height, bytes: raw, generated: true });
        files.push({ id, width: info.width, height: info.height, ...meta });
        continue;
      }
      if (!job.turnId || !(await waitForTurnRow(job.turnId, job))) { if (stopped(job)) { discardStored(storedIds); return; } throw new Error("turn row never appeared"); }
      const created = createAttachment(actor, { conversationId, turnId: job.turnId, mediaType: "image/png", bytes: raw, provenance: `picture-gen:${JSON.stringify({ v: 1, job: job.id, index, ...meta, width: info.width, height: info.height })}`, deduplicate: false });
      if (!created.ok) {
        fail(created.status === 403 ? `${PICTURE_FAILED_PREFIX} Your storage is full. Delete some files in Settings, Storage, then try again.` : `${PICTURE_FAILED_PREFIX} The picture couldn't be saved. Try again.`);
        return;
      }
      storedIds.push(created.value.id);
      files.push({ id: created.value.id, width: info.width, height: info.height, ...meta });
    }
  } catch (error) {
    fail(plainFailure(error instanceof StackPicturesError ? error : null));
    return;
  }
  if (stopped(job)) { discardStored(storedIds); return; }
  job.files = files;
  job.state = "done";
  job.percent = 100;
  job.phase = "ready";
  job.error = null;
  saveJob(job);
  void cancelOrDelete(stackJob);
}

/** Stop a job. Safe to call twice; a finished job stays finished. */
export async function cancelPictureJob(actor: PersonRow, id: string): Promise<PictureJob | null> {
  const job = getPictureJob(actor, id);
  if (!job) return null;
  if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return job;
  job.state = "cancelled";
  job.error = null;
  saveJob(job);
  watching.get(job.id)?.abort();
  if (job.stackJob) await cancelOrDelete(job.stackJob);
  return job;
}

/** Called once at boot: a job a restart interrupted either finishes now or ends with an honest line. */
export function resumePictureJobs(): void {
  for (const job of unfinishedStoredJobs()) {
    const person = db.select().from(people).where(eq(people.id, job.personId)).get();
    if (!person || !job.stackJob) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} Home restarted before it finished. Try again.`; saveJob(job); continue; }
    void watch(job, person as PersonRow);
  }
}

/** What the file's owner may fetch: the picture's address inside its conversation. */
export function fileUrl(job: PictureJob, file: PictureFile): string {
  return pictureUrl(job.conversationId ?? "", file.id);
}
