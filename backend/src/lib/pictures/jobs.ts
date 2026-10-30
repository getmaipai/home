// IMGGEN-HOME-01: a picture job from the person's side. The chat card polls Home (never the Stack); Home polls the
// Stack, stores each finished picture as the person's own file (the Stack's bytes unchanged), and keeps one honest
// line when something fails (rule 6: a failed picture never fails the answer). Where jobs live is jobStore.ts.
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { createAttachment, purgeFileRecord, removeFileBlobs, storeTemporaryChatImage } from "@/lib/attachments";
import { newFileId, newPictureJobId } from "@/lib/id";
import { loadSource, pictureUrl, saveVersion } from "@/lib/imageEdit";
import type { PersonRow } from "@/types";
import { __clearPictureStoreForTests, markLive, markSettled, saveJob, getPictureJob, pictureJobsForTurn, unfinishedJobs, unfinishedStoredJobs, PICTURE_FAILED_PREFIX, plainFailure, type PictureFile, type PictureJob, type PictureJobKind } from "./jobStore";
import { allAdapters } from "./adapters";
import { qualityOfModel } from "./quality";
import { checkImages, isAdultOnlyJob } from "./ageCheck";
import { gateFinished } from "./laneGate";
import { clearLive, updateLive } from "@/lib/genLive";
import { requestTier, refreshHouseholdQueue, registerQueueProvider, releaseHouseholdQueue, type QueueJob } from "@/lib/jobs/householdQueue";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import { cancelOrDelete, fetchPicture, fetchPicturePreview, getGenerationJob, StackPicturesError, submitGeneration, type GenerationBody, type StackPic } from "./stack";

export { getPictureJob, pictureJobsForTurn, pictureJobIdsByTurn, plainFailure, PICTURE_FAILED_PREFIX, __clearPictureStoreForTests } from "./jobStore";
export type { PictureFile, PictureJob, PictureJobKind, PictureJobState, PictureRequest } from "./jobStore";

type QueuedPictureJob = PictureJob & { estimateSeconds?: number | null; riseReason?: QueueJob["riseReason"] };
const queuedPictureSubmits = new Map<string, () => Promise<{ job: string; done: StackPic[] | null }>>();
registerQueueProvider(() => unfinishedJobs().map((job) => {
  const queuedJob = job as QueuedPictureJob;
  const queued: QueueJob = { id: job.id, personId: job.personId, jobClass: "picture", state: job.state, tier: requestTier(job.request), createdAt: job.createdAt, headOfClass: ((job.request as PictureJob["request"] & { memoryRequeues?: number }).memoryRequeues ?? 0) > 0,
    position: job.position, estimateSeconds: queuedJob.estimateSeconds, riseReason: queuedJob.riseReason, typicalSeconds: job.kind === "edit" ? 20 : 44 };
  return { job: queued, stackWaiting: job.state === "queued" && !!job.stackJob,
    applyFit: (fit) => { (job.request as { profile?: unknown }).profile = fit.profile; savePictureJob(job); },
    release: job.state === "queued" && !job.stackJob ? () => releasePicture(job) : undefined,
    save: () => { job.position = queued.position ?? null; Object.assign(queuedJob, { estimateSeconds: queued.estimateSeconds, riseReason: queued.riseReason }); saveJob(job); } };
}));

async function releasePicture(job: PictureJob): Promise<void> {
  if (job.state !== "queued" || job.stackJob) return;
  try {
    const submit = queuedPictureSubmits.get(job.id);
    const submitted = submit ? await submit() : await submitGeneration({ ...((job.request as PictureJob["request"] & { stackBody?: Omit<GenerationBody, "timeout_ms"> }).stackBody ?? {
      prompt: job.prompt, size: job.request.size, n: job.request.n, audience: job.request.audience,
      ...(job.request.seed !== null ? { seed: job.request.seed } : {}),
    }), timeout_ms: 1 });
    if (job.state !== "queued") { void cancelOrDelete(submitted.job); return; }
    job.stackJob = submitted.job;
    queuedPictureSubmits.delete(job.id);
    markLive(job);
    savePictureJob(job);
    void watch(job, db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow, submitted.done);
  } catch (error) {
    job.state = "failed"; job.error = plainFailure(error); queuedPictureSubmits.delete(job.id); savePictureJob(job);
  }
}

function savePictureJob(job: PictureJob): void {
  saveJob(job);
  refreshHouseholdQueue();
}

const watching = new Map<string, AbortController>();
/** Turns with a job being submitted right now: two quick clicks never start two. */
const starting = new Set<string>();

/** Test-only. */
export function __resetPictureJobsForTests(): void {
  for (const controller of watching.values()) controller.abort();
  watching.clear();
  starting.clear();
  queuedPictureSubmits.clear();
  __clearPictureStoreForTests();
}

export interface StartPictureInput {
  actor: PersonRow;
  conversationId: string | null;
  turnId: string | null;
  companionId?: string | null;
  temporary: boolean;
  purpose?: "cover";
  kind: PictureJobKind;
  prompt: string;
  body: Omit<GenerationBody, "timeout_ms">;
  sourceFileId?: string | null;
  /** IMGEDIT-01: this job changes a picture already in the chat; the result is saved as its next version. */
  edit?: { sourceId: string; label: string; method: "instruct" | "tool" };
  /** IMGEDIT-01: how the Stack is asked (default: a generation). An edit sends the picture and the instruction to POST /v1/images/edits. */
  submit?: () => Promise<{ job: string; done: StackPic[] | null }>;
  /** Work Home does itself for non-generative picture tools: no Stack job to poll. */
  local?: (progress: (phase: string, percent: number) => void, signal: AbortSignal) => Promise<StackPic[]>;
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
    const now = new Date().toISOString();
    const job: PictureJob = {
      id: newPictureJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, purpose: input.purpose ?? null, kind: input.kind, state: input.local ? "running" : "queued", stackJob: null,
      percent: 0, phase: input.local ? "starting" : "queued", position: null, prompt: input.prompt,
      request: ({ size: input.body.size ?? "1024x1024", n: input.body.n ?? 1, seed: input.body.seed ?? null, loras: (input.body.loras ?? []).map((l) => l.id), source_file_id: input.sourceFileId ?? input.edit?.sourceId ?? null, audience: input.body.audience, quality: qualityOfModel(input.body.model) ?? "quick", stackBody: Object.fromEntries(Object.entries(input.body).filter(([key]) => key !== "timeout_ms")) as Omit<GenerationBody, "timeout_ms">, ...(input.edit ? { edit: { source_id: input.edit.sourceId, label: input.edit.label, method: input.edit.method } } : {}) } as PictureJob["request"]),
      error: null, files: [], temporary: input.temporary, createdAt: now, updatedAt: now,
    };
    markLive(job);
    if (input.submit) queuedPictureSubmits.set(job.id, input.submit);
    savePictureJob(job);
    if (input.local) void watchLocal(job, input.actor, input.local);
    else void releaseHouseholdQueue();
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
    if (early) {
      await finish(job, actor, early);
      return;
    }
    while (!controller.signal.aborted && !stopped(job) && Date.now() < deadline) {
      let status;
      try {
        status = await getGenerationJob(job.stackJob);
      } catch (error) {
        if (stopped(job) || controller.signal.aborted) return;
        if (error instanceof StackPicturesError && error.status === 404) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} The engine lost track of it, most likely because it restarted. Try again.`; savePictureJob(job); return; }
        // A single missed poll is not a failure; the next one decides.
        await sleep(POLL_MS * 2, controller.signal);
        continue;
      }
      if (stopped(job) || controller.signal.aborted) return;
      if (status.state === "done") { await finish(job, actor, status.data); return;}
      if (status.state === "failed") { job.state = "failed"; job.error = plainFailure(new StackPicturesError(500, status.code ?? "failed", status.error ?? "")); savePictureJob(job); return; }
      // The Stack's memory watchdog stopped it (code no_memory): that is a pause the person should hear about, not a cancel they asked for.
      if (status.state === "cancelled" && status.code === "no_memory") {
        const request = job.request as PictureJob["request"] & { memoryRequeues?: number };
        const retries = request.memoryRequeues ?? 0;
        if (retries < 2) { request.memoryRequeues = retries + 1; job.state = "queued"; job.stackJob = null; job.phase = "requeued_memory"; job.percent = 0; savePictureJob(job); return; }
        job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} ${jobQueueCopy("failed_memory", "low_memory_failure", null, null, "adult")}`; savePictureJob(job); return;
      }
      if (status.state === "cancelled") { job.state = "cancelled"; job.error = null; savePictureJob(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      job.percent = Math.max(0, Math.min(99, Math.round(status.progress)));
      job.phase = status.phase;
      savePictureJob(job);
      await updateLive(job.id, status, () => fetchPicturePreview(job.stackJob!));
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted && !stopped(job)) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} It took longer than expected. Try again, or ask for something simpler.`; savePictureJob(job); void cancelOrDelete(job.stackJob); }
  } catch {
    if (!stopped(job)) {
      job.state = "failed";
      job.error = plainFailure(null);
      try { savePictureJob(job); } catch { /* the job ends here either way */ }
    }
  } finally {
    watching.delete(job.id);
    clearLive(job.id);
    markSettled(job);
    refreshHouseholdQueue();
  }
}

/** IMGEDIT-01: a job Home runs itself (the Stack's tools, a few seconds). It reports phases on the same job record the card polls, ends through the same safety check and storage as any picture, and stops when the person presses Stop. */
async function watchLocal(job: PictureJob, actor: PersonRow, run: NonNullable<StartPictureInput["local"]>): Promise<void> {
  if (watching.has(job.id)) return;
  const controller = new AbortController();
  watching.set(job.id, controller);
  markLive(job);
  try {
    const pics = await run((phase, percent) => {
      if (stopped(job) || controller.signal.aborted) return;
      job.phase = phase; job.percent = Math.max(job.percent, Math.min(95, Math.round(percent))); savePictureJob(job);
    }, controller.signal);
    if (stopped(job) || controller.signal.aborted) return;
    await finish(job, actor, pics);
  } catch (error) {
    if (!stopped(job)) {
      job.state = "failed";
      job.error = `${PICTURE_FAILED_PREFIX} ${error instanceof Error && error.message ? error.message : "Something went wrong. Try again."}`.replace(`${PICTURE_FAILED_PREFIX} ${PICTURE_FAILED_PREFIX}`, PICTURE_FAILED_PREFIX);
      job.files = [];
      try { savePictureJob(job); } catch { /* the job ends here either way */ }
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

/** Whether this job is adult-only for the finished-picture check: a sexual word in the prompt, or any style used that is adult-only (or no longer in the library). */
async function adultOnly(job: PictureJob): Promise<boolean> {
  return isAdultOnlyJob(job.prompt, job.request.loras, async (id) => (await allAdapters()).find((a) => a.id === id)?.classification);
}

async function finish(job: PictureJob, actor: PersonRow, pics: StackPic[]): Promise<void> {
  const stackJob = job.stackJob;
  const files: PictureFile[] = [];
  const storedIds: string[] = [];
  const fail = (message: string) => { discardStored(storedIds); job.state = "failed"; job.error = message; job.files = []; savePictureJob(job); if (stackJob) void cancelOrDelete(stackJob); };
  try {
    // Fetch and prove every picture first; nothing is stored until the safety check has seen all of them.
    const made: Array<{ raw: Uint8Array; width: number; height: number; meta: { seed: number | null; model: string | null; steps: number | null; ms: number | null } }> = [];
    for (let index = 0; index < pics.length; index += 1) {
      if (stopped(job)) return;
      const pic = pics[index]!;
      const raw = pic.b64_json ? new Uint8Array(Buffer.from(pic.b64_json, "base64")) : await fetchPicture(stackJob!, index);
      // The bytes are stored exactly as the Stack made them: image-to-video checks their digest against what the engine
      // returned, so nothing may re-encode them. They are decoded here only to prove they are a picture and read the size.
      const info = await sharp(raw, { failOn: "error", limitInputPixels: 64_000_000 }).metadata();
      if (!info.width || !info.height || info.format !== "png") throw new Error("not a png picture");
      made.push({ raw, width: info.width, height: info.height, meta: { seed: pic.seed ?? null, model: pic.model ?? null, steps: pic.steps ?? null, ms: pic.ms ?? null } });
    }
    // IMGGEN-SAFE-01: the second, independent check, on the finished pixels, before anything is stored or shown.
    const adult = await adultOnly(job);
    const checks = await checkImages(made.map((m) => m.raw), "picture");
    if (stopped(job)) return;
    const decision = await gateFinished({ actor, kind: "picture", jobId: job.id, adultOnly: adult, checks, images: made.map((m) => m.raw), prompt: job.prompt });
    if (decision.action === "withhold") { fail(decision.line); return; }
    for (let index = 0; index < made.length; index += 1) {
      if (stopped(job)) { discardStored(storedIds); return; }
      const { raw, width, height, meta } = made[index]!;
      const conversationId = job.conversationId;
      if (!conversationId) throw new Error("no conversation");
      if (job.request.edit) {
        // IMGEDIT-01: a change to a picture already in the chat is the next version of that picture (its Original and Undo stay in the editor).
        const source = loadSource(actor, conversationId, job.request.edit.source_id, true);
        const version = await saveVersion(actor, source, raw, { op: "comment", audience: adult ? "adult-only" : "all-ages", label: job.request.edit.label, model: meta.model ?? undefined, ms: meta.ms ?? undefined });
        storedIds.push(version.id);
        files.push({ id: version.id, width: version.width ?? width, height: version.height ?? height, ...meta });
        continue;
      }
      if (job.temporary) {
        const id = newFileId();
        storeTemporaryChatImage({ id, turnId: job.turnId ?? `gen-${job.id}`, conversationId, ownerPersonId: actor.id, name: "Generated picture", mediaType: "image/png", width, height, bytes: raw, audience: adult ? "adult-only" : "all-ages", generated: true });
        files.push({ id, width, height, ...meta });
        continue;
      }
      if (!job.turnId || !(await waitForTurnRow(job.turnId, job))) { if (stopped(job)) { discardStored(storedIds); return; } throw new Error("turn row never appeared"); }
      const created = createAttachment(actor, { conversationId, turnId: job.turnId, mediaType: "image/png", bytes: raw, provenance: `picture-gen:${JSON.stringify({ v: 1, audience: adult ? "adult-only" : "all-ages", job: job.id, index, ...meta, width, height })}`, deduplicate: false, retention: "conversation" });
      if (!created.ok) {
        fail(created.status === 403 ? `${PICTURE_FAILED_PREFIX} Your storage is full. Delete some files in Settings, Storage, then try again.` : `${PICTURE_FAILED_PREFIX} The picture couldn't be saved. Try again.`);
        return;
      }
      storedIds.push(created.value.id);
      files.push({ id: created.value.id, width, height, ...meta });
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
  queuedPictureSubmits.delete(job.id);
  savePictureJob(job);
  // A stored cover may update its song, but never changes this picture's outcome.
  try { const { finishSongCover } = await import("@/lib/music/cover"); finishSongCover(job); } catch { /* optional cover linkage */ }
  if (stackJob) void cancelOrDelete(stackJob);
}

/** Stop a job. Safe to call twice; a finished job stays finished. */
export async function cancelPictureJob(actor: PersonRow, id: string): Promise<PictureJob | null> {
  const job = getPictureJob(actor, id);
  if (!job) return null;
  if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return job;
  job.state = "cancelled";
  job.error = null;
  queuedPictureSubmits.delete(job.id);
  savePictureJob(job);
  watching.get(job.id)?.abort();
  if (job.stackJob) await cancelOrDelete(job.stackJob);
  return job;
}

/** Called once at boot: a job a restart interrupted either finishes now or ends with an honest line. */
export function resumePictureJobs(): void {
  for (const job of unfinishedStoredJobs()) {
    const person = db.select().from(people).where(eq(people.id, job.personId)).get();
    if (!person) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} Home restarted before it finished. Try again.`; savePictureJob(job); continue; }
    if (!job.stackJob) { markLive(job); continue; }
    void watch(job, person as PersonRow);
  }
  void releaseHouseholdQueue();
}

/** What the file's owner may fetch: the picture's address inside its conversation. */
export function fileUrl(job: PictureJob, file: PictureFile): string {
  return pictureUrl(job.conversationId ?? "", file.id);
}
