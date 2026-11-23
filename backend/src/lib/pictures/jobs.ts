// IMGGEN-HOME-01: a picture job from the person's side. The chat card polls Home (never the Stack); Home polls the
// Stack, stores each finished picture as the person's own file (the Stack's bytes unchanged), and keeps one honest
// line when something fails (rule 6: a failed picture never fails the answer). Where jobs live is jobStore.ts.
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { createAttachment, purgeFileRecord, removeFileBlobs, storeFile, storeTemporaryChatImage } from "@/lib/attachments";
import { newCreationId, newFileId, newPictureJobId } from "@/lib/id";
import { recordPictureCreation, safely } from "@/lib/creations/writers";
import { LIBRARY_SOURCE, loadSource, pictureUrl, saveVersion } from "@/lib/imageEdit";
import type { PersonRow } from "@/types";
import { __clearPictureStoreForTests, markLive, markSettled, saveJob, getPictureJob, pictureJobsForTurn, unfinishedJobs, unfinishedStoredJobs, PICTURE_FAILED_PREFIX, SPELLING_PHASE, plainFailure, type PictureFile, type PictureJob, type PictureJobKind } from "./jobStore";
import { allAdapters } from "./adapters";
import { partsAfter, servesShape } from "./catalog";
import { pictureBodyForSlot } from "./slotBody";
import { passForPerson } from "@/lib/filter/pass";
import { checkImages, isAdultOnlyJob } from "./ageCheck";
import { compareWords, readPictureWords } from "./readWords";
import { gateFinished } from "./laneGate";
import { clearLive, updateLive } from "@/lib/genLive";
import { requestTier, refreshHouseholdQueue, registerQueueProvider, releaseHouseholdQueue, requeueAfterCritical, holdMaxAfterMemoryRefusal, type QueueJob, PERSISTED_HOLDS, type PersistedHold } from "@/lib/jobs/householdQueue";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import type { PicturePurpose } from "./jobStore";
import { cancelOrDelete, fetchPicture, fetchPicturePreview, getGenerationJob, listOfAudience, makePicture, pictureJobFor, StackPicturesError, submitGeneration, type GenerationBody, type StackPic } from "./stack";
import { fullViewForJob, type FullView } from "@/lib/stack/fullView";
import { lockItemOfProvenance, markFields, newItemMark, unlabeledSourceMark, type MarkSource } from "@/lib/adultLock";
import { logAutoMark } from "@/lib/adultMarks";
import { isAdultPictureStyle } from "@/lib/pictures/lock";

export { getPictureJob, pictureJobsForTurn, pictureJobIdsByTurn, plainFailure, PICTURE_FAILED_PREFIX, __clearPictureStoreForTests } from "./jobStore";
export type { PictureFile, PictureJob, PictureJobKind, PictureJobState, PictureRequest } from "./jobStore";

type QueuedPictureJob = PictureJob & { estimateSeconds?: number | null; riseReason?: QueueJob["riseReason"] };
const queuedPictureSubmits = new Map<string, () => Promise<{ job: string; done: StackPic[] | null }>>();
const generatedPictureCallbacks = new Map<string, (fileId: string) => Promise<void>>();
registerQueueProvider(() => unfinishedJobs().map((job) => {
  const queuedJob = job as QueuedPictureJob;
  const phaseHold = PERSISTED_HOLDS.find((reason) => job.phase === `held:${reason}`) as QueueJob["riseReason"] | undefined;
  const queued: QueueJob = { id: job.id, personId: job.personId, jobClass: "picture", state: job.state, tier: requestTier(job.request), createdAt: job.createdAt, adminBoost: ((job.request as PictureJob["request"]).lowPriority ? -1000 : undefined), headOfClass: ((job.request as PictureJob["request"] & { memoryRequeues?: number }).memoryRequeues ?? 0) > 0,
    position: job.position, estimateSeconds: queuedJob.estimateSeconds, riseReason: queuedJob.riseReason ?? phaseHold, typicalSeconds: job.kind === "edit" ? 20 : 44 };
  return { job: queued, stackWaiting: job.state === "queued" && !!job.stackJob,
    applyFit: (fit) => { (job.request as { profile?: unknown }).profile = fit.profile; savePictureJob(job); },
    lowerToStandard: (note) => { delete (job.request as { tier?: unknown }).tier; Object.assign(job.request as object, { waited_note: note }); savePictureJob(job); },
    stop: job.state === "running" ? async () => { const owner = db.select().from(people).where(eq(people.id, job.personId)).get(); if (owner) await cancelPictureJob(owner as PersonRow, job.id); } : undefined,
    release: job.state === "queued" && !job.stackJob ? () => releasePicture(job) : undefined,
    save: () => { job.position = queued.position ?? null; Object.assign(queuedJob, { estimateSeconds: queued.estimateSeconds, riseReason: queued.riseReason }); if (queued.riseReason && PERSISTED_HOLDS.includes(queued.riseReason)) job.phase = `held:${queued.riseReason}`; else if (job.phase?.startsWith("held:")) job.phase = "queued"; saveJob(job); } };
}));

/**
 * TIER-PIC-01: the Stack body of a generated picture at the level it was queued at, with that level's saved slot read now (`pictureBodyForSlot`). The job
 * record keeps what it really ran as: `request.tier` (absent for Standard), `lowered`, the Max line and the quality, so the card and provenance tell the
 * truth, and the stored body is the one sent so a spelling re-make asks for the same maker and level.
 */
async function slotBodyOf(job: PictureJob): Promise<Omit<GenerationBody, "timeout_ms">> {
  const request = job.request as PictureJob["request"] & { stackBody?: Omit<GenerationBody, "timeout_ms"> };
  const base: Omit<GenerationBody, "timeout_ms"> = request.stackBody ?? {
    prompt: job.prompt, size: job.request.size, n: job.request.n, audience: job.request.audience,
    ...(job.request.seed !== null ? { seed: job.request.seed } : {}),
  };
  const owner = db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow | undefined;
  const run = pictureBodyForSlot(base, requestTier(job.request), owner ? passForPerson(owner) : "child");
  if (run.tier === "standard") delete request.tier; else request.tier = run.tier;
  if (run.lowered) request.lowered = true; else delete request.lowered;
  if (run.line) request.line = run.line; else delete request.line;
  request.quality = run.quality;
  request.stackBody = run.body;
  return run.body;
}

async function releasePicture(job: PictureJob): Promise<void> {
  if (job.state !== "queued" || job.stackJob) return;
  try {
    const submit = queuedPictureSubmits.get(job.id);
    const submitted = submit ? await submit() : await submitGeneration({ ...(await slotBodyOf(job)), timeout_ms: 1 });
    if (job.state !== "queued") { void cancelOrDelete(submitted.job); return; }
    job.stackJob = submitted.job;
    queuedPictureSubmits.delete(job.id);
    markLive(job);
    savePictureJob(job);
    void watch(job, db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow, submitted.done);
  } catch (error) {
    if (error instanceof StackPicturesError && (error.code === "queue_full" || (error.code === "no_memory" && holdMaxAfterMemoryRefusal(job.request)))) { job.phase = "queued"; saveJob(job); return; }
    job.state = "failed"; job.error = plainFailure(error); queuedPictureSubmits.delete(job.id); generatedPictureCallbacks.delete(job.id); savePictureJob(job);
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
  generatedPictureCallbacks.clear();
  __clearPictureStoreForTests();
}

export interface StartPictureInput {
  actor: PersonRow;
  conversationId: string | null;
  turnId: string | null;
  companionId?: string | null;
  temporary: boolean;
  purpose?: PicturePurpose;
  kind: PictureJobKind;
  prompt: string;
  body: Omit<GenerationBody, "timeout_ms">;
  sourceFileId?: string | null;
  /** Current source marks for a variation or edit, resolved by the caller from the source file. */
  sources?: readonly MarkSource[];
  /** TIER-WIRE-01: the allowed tier (`jobTier`); Standard or absent adds nothing to the request. */
  tier?: "standard" | "boost" | "max";
  /** COVER-BACKFILL-01: queued below every request a person makes themselves. */
  lowPriority?: boolean;
  /** IMGEDIT-01: this job changes a picture already in the chat; the result is saved as its next version. */
  edit?: { sourceId: string; label: string; method: "instruct" | "tool" };
  /** IMGEDIT-01: how the Stack is asked (default: a generation). An edit sends the picture and the instruction to POST /v1/images/edits. */
  submit?: () => Promise<{ job: string; done: StackPic[] | null }>;
  /** Work Home does itself for non-generative picture tools: no Stack job to poll. */
  local?: (progress: (phase: string, percent: number) => void, signal: AbortSignal) => Promise<StackPic[]>;
  /** Follow-on media work for each stored generated file, through the media-op registry. */
  onDone?: (fileId: string) => Promise<void>;
  subjectIds?: string[];
  /** TEXT-PIC-05: the exact words the picture must show; the finish step checks the spelling and re-makes up to two more times. */
  words?: string[];
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
    const styles = await allAdapters();
    const styleIds = (input.body.loras ?? []).map((lora) => lora.id);
    const adultStyle = styleIds.some((id) => {
      const adapter = styles.find((item) => item.id === id);
      return isAdultPictureStyle(adapter, undefined, true);
    });
    const sourceIds = [...new Set([input.sourceFileId, input.edit?.sourceId].filter((id): id is string => Boolean(id)))];
    const sourceMarks: MarkSource[] = input.sources ? [...input.sources] : sourceIds.map((id) => {
      const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, id)).get();
      const item = row ? lockItemOfProvenance(row.owner, row.provenance) : null;
      const owner = row ? db.select().from(people).where(eq(people.id, row.owner)).get() as PersonRow | undefined : undefined;
      if (item) return { madeAudience: item.madeAudience, lock: item.lock };
      if (owner) return unlabeledSourceMark(owner);
      return unlabeledSourceMark(input.actor);
    });
    const mark = newItemMark(sourceMarks, adultStyle);
    const job: PictureJob = {
      id: newPictureJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, purpose: input.purpose ?? null, kind: input.kind, state: input.local ? "running" : "queued", stackJob: null,
      percent: 0, phase: input.local ? "starting" : "queued", position: null, prompt: input.prompt,
      request: ({ size: input.body.size ?? "1024x1024", n: input.body.n ?? 1, seed: input.body.seed ?? null, loras: (input.body.loras ?? []).map((l) => l.id), source_file_id: input.sourceFileId ?? input.edit?.sourceId ?? null, audience: input.body.audience, ...(mark.madeAudience === "adult-only" ? { adultLock: mark.lock } : {}), quality: "quick", ...(input.subjectIds?.length ? { subject_ids: input.subjectIds } : {}), ...(input.words?.length ? { words: input.words } : {}), ...(input.tier === "boost" || input.tier === "max" ? { tier: input.tier } : {}), ...(input.lowPriority ? { lowPriority: true } : {}), stackBody: Object.fromEntries(Object.entries(input.body).filter(([key]) => key !== "timeout_ms")) as Omit<GenerationBody, "timeout_ms">, ...(input.edit ? { edit: { source_id: input.edit.sourceId, label: input.edit.label, method: "instruct" } } : {}) } as PictureJob["request"]),
      error: null, files: [], temporary: input.temporary, createdAt: now, updatedAt: now,
    };
    markLive(job);
    if (input.submit) queuedPictureSubmits.set(job.id, input.submit);
    if (input.onDone) generatedPictureCallbacks.set(job.id, input.onDone);
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

/** ADULT-LOCK-03: a generated adult picture is read from the Stack with the full view (Home is its trusted caller; what it reads reaches a response only through the lock).
 * An edit is the exception: its form never tells the Stack the audience (ADULT-LOCK-07 decides that), so the Stack serves it the plain way and Home asks that way. */
const viewOfJob = (job: PictureJob, actor: PersonRow): FullView | undefined => (job.kind === "edit" ? undefined : fullViewForJob(job.request.audience, actor));

async function watch(job: PictureJob, actor: PersonRow, early: StackPic[] | null = null): Promise<void> {
  if (!job.stackJob || watching.has(job.id)) return;
  const view = viewOfJob(job, actor);
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
        status = await getGenerationJob(job.stackJob, view);
      } catch (error) {
        if (stopped(job) || controller.signal.aborted) return;
        if (error instanceof StackPicturesError && error.status === 404) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} It did not finish. Try again.`; savePictureJob(job); return; }
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
        if (requeueAfterCritical({ requeues: retries }) === "requeue_head") { request.memoryRequeues = retries + 1; job.state = "queued"; job.stackJob = null; job.phase = "requeued_memory"; job.percent = 0; savePictureJob(job); return; }
        job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} ${jobQueueCopy("failed_memory", "low_memory_failure", null, null, "adult")}`; savePictureJob(job); return;
      }
      if (status.state === "cancelled") { job.state = "cancelled"; job.error = null; savePictureJob(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      job.percent = Math.max(0, Math.min(99, Math.round(status.progress)));
      job.phase = status.phase;
      savePictureJob(job);
      await updateLive(job.id, status, () => fetchPicturePreview(job.stackJob!, view));
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
      job.error = plainFailure(error);
      job.files = [];
      try { savePictureJob(job); } catch { /* the job ends here either way */ }
    }
  } finally {
    watching.delete(job.id);
    markSettled(job);
  }
}

let TURN_END_WAIT_MS = 15 * 60_000;
export function __setPictureTurnWaitForTests(ms: number | null): void { TURN_END_WAIT_MS = ms ?? 15 * 60_000; }
async function waitForTurnRow(turnId: string, job: PictureJob): Promise<boolean> {
  // The turn's row is written when the reply ends; a fast picture can finish first.
  const deadline = Date.now() + TURN_END_WAIT_MS;
  while (Date.now() < deadline && !stopped(job)) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, turnId), eq(conversationTurns.status, "done"))).get()) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
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

type MadePicture = { raw: Uint8Array; width: number; height: number; meta: { seed: number | null; model: string | null; steps: number | null; ms: number | null } };

async function fetchMade(stackJob: string | null, pics: StackPic[], view: FullView | undefined): Promise<MadePicture[]> {
  const made: MadePicture[] = [];
  for (let index = 0; index < pics.length; index += 1) {
    const pic = pics[index]!;
    const raw = pic.b64_json ? new Uint8Array(Buffer.from(pic.b64_json, "base64")) : await fetchPicture(stackJob!, index, view);
    // The bytes are stored exactly as the Stack made them: image-to-video checks their digest against what the engine
    // returned, so nothing may re-encode them. They are decoded here only to prove they are a picture and read the size.
    const info = await sharp(raw, { failOn: "error", limitInputPixels: 64_000_000 }).metadata();
    if (!info.width || !info.height || info.format !== "png") throw new Error("not a png picture");
    made.push({ raw, width: info.width, height: info.height, meta: { seed: pic.seed ?? null, model: pic.model ?? null, steps: pic.steps ?? null, ms: pic.ms ?? null } });
  }
  return made;
}

/**
 * Asks for the picture again with a new seed (rule W4). A request that is only what the person asked for (`ask`, no style, no negative prompt) goes to
 * the generic `picture` job, naming the next part after the one that ran: the part the catalog shows first, then its alternatives, in the Stack's order.
 * The Stack refuses a part that cannot spell the words (rule W1), and the next one is tried; when none takes it, or the request is more than the generic
 * job carries, it goes to the size-and-prompt route as before, to the same part. `ran` is the part that made the take being replaced.
 */
async function askAgain(stackBody: Omit<GenerationBody, "timeout_ms">, seed: number, ran: string | null): Promise<{ job: string; done: StackPic[] | null; part: string | null }> {
  const ask = stackBody.ask;
  if (ask?.words?.length && !stackBody.loras?.length && !stackBody.negative_prompt && !stackBody.init_image) {
    const list = listOfAudience(stackBody.audience);
    const view = await pictureJobFor("picture", list);
    const level = stackBody.tier ?? "standard";
    for (const part of partsAfter(view, ran)) {
      // The part shown first has its shapes in the catalog: a shape it does not serve is not asked (the size route takes it). Another part answers for itself.
      if (view?.part?.id === part && !servesShape(view, ask.shape, level)) continue;
      const made = await makePicture({ job: "picture", audience: list, part, description: ask.description, words: ask.words.join("\n"), shape: ask.shape, level, ...(stackBody.n ? { count: stackBody.n } : {}), seed });
      if (made.ok) return { job: made.job, done: null, part: made.part ?? part };
    }
  }
  const submitted = await submitGeneration({ ...stackBody, seed, timeout_ms: 1 });
  return { ...submitted, part: ran };
}

/** TEXT-PIC-05: the same request once more with a new seed, inside this job, on the next part that can spell (`askAgain`). Null when it cannot be made again (the caller keeps what it has). */
async function remakeWithNewSeed(job: PictureJob, view: FullView | undefined, ran: string | null): Promise<{ made: MadePicture[]; ran: string | null } | null> {
  const stackBody = (job.request as PictureJob["request"] & { stackBody?: Omit<GenerationBody, "timeout_ms"> }).stackBody;
  if (!stackBody) return null;
  let again: string | null = null;
  try {
    const submitted = await askAgain(stackBody, 1 + Math.floor(Math.random() * 2_000_000_000), ran);
    again = submitted.job;
    let pics = submitted.done;
    const deadline = Date.now() + MAX_WATCH_MS;
    while (!pics) {
      if (stopped(job) || Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const status = await getGenerationJob(again, view);
      if (status.state === "done") pics = status.data;
      else if (status.state === "failed" || status.state === "cancelled") return null;
    }
    const made = await fetchMade(again, pics, view);
    return { made, ran: made[0]?.meta.model ?? submitted.part };
  } catch {
    return null;
  } finally {
    if (again) void cancelOrDelete(again);
  }
}

const MAX_SPELLING_RETRIES = 2;

/**
 * TEXT-PIC-05: after a picture with `words` is made, the local vision model reads the text on it and Home compares it exactly
 * (compareWords). A miss makes the same request again with a new seed, at most two more times, each time on the next part that can spell (`askAgain`); the take with the fewest missing
 * words is kept for each picture. The check never fails or blocks a picture: when the model cannot read it, the picture is kept
 * as made and the result says `checked: no`. The age and adult-lock gates run afterward, on the pictures this returns.
 */
async function spellingCheck(job: PictureJob, view: FullView | undefined, made: MadePicture[], words: readonly string[]): Promise<{ made: MadePicture[]; result: NonNullable<PictureJob["request"]["wordCheck"]> }> {
  const readAll = async (takes: readonly MadePicture[]): Promise<string[][] | null> => {
    const out: string[][] = [];
    for (const take of takes) {
      const read = await readPictureWords(take.raw);
      if (!read.ok) return null;
      out.push(compareWords(words, read.lines));
    }
    return out;
  };
  const best = [...made];
  let bestMissing = await readAll(best);
  if (!bestMissing) return { made, result: { checked: "no", missing: [], takes: 1 } };
  const canRemake = job.kind === "generate" && !job.request.edit && !queuedPictureSubmits.has(job.id) && Boolean((job.request as { stackBody?: unknown }).stackBody);
  let takes = 1;
  let ran: string | null = best[0]?.meta.model ?? null;
  while (canRemake && bestMissing.some((missing) => missing.length > 0) && takes <= MAX_SPELLING_RETRIES && !stopped(job)) {
    job.phase = SPELLING_PHASE; job.state = "running"; savePictureJob(job);
    const again = await remakeWithNewSeed(job, view, ran);
    if (!again || stopped(job)) break;
    const next = again.made;
    ran = again.ran ?? ran;
    takes += 1;
    const nextMissing = await readAll(next);
    if (!nextMissing) break;
    for (let index = 0; index < best.length; index += 1) {
      if (next[index] && nextMissing[index]!.length < bestMissing[index]!.length) { best[index] = next[index]!; bestMissing[index] = nextMissing[index]!; }
    }
  }
  const missing = [...new Set(bestMissing.flat())];
  return { made: best, result: { checked: "yes", missing, takes } };
}

export function misspelledNote(missing: readonly string[]): string {
  return `These words may be misspelled: ${missing.map((word) => `"${word}"`).join(", ")}. Try again, or edit the picture.`;
}

async function finish(job: PictureJob, actor: PersonRow, pics: StackPic[]): Promise<void> {
  const stackJob = job.stackJob;
  const view = viewOfJob(job, actor);
  const files: PictureFile[] = [];
  const storedIds: string[] = [];
  /** CREATOR-02: the creation id each stored picture's note points to; the records are written once the whole job has finished. */
  const creationIds = new Map<string, string>();
  const fail = (message: string) => { discardStored(storedIds); job.state = "failed"; job.error = message; job.files = []; generatedPictureCallbacks.delete(job.id); savePictureJob(job); if (stackJob) void cancelOrDelete(stackJob); };
  try {
    // Fetch and prove every picture first; nothing is stored until the safety check has seen all of them.
    let made = await fetchMade(stackJob, pics, view);
    if (stopped(job)) return;
    // TEXT-PIC-05: the spelling check comes first, so every gate below runs on the picture that is kept.
    const words = job.request.words ?? [];
    if (words.length > 0 && made.length > 0) {
      const spelled = await spellingCheck(job, view, made, words);
      if (stopped(job)) return;
      made = spelled.made;
      job.request.wordCheck = spelled.result;
      if (spelled.result.checked === "yes" && spelled.result.missing.length > 0) job.request.wordsNote = misspelledNote(spelled.result.missing);
      else delete job.request.wordsNote;
    }
    // IMGGEN-SAFE-01: the second, independent check, on the finished pixels, before anything is stored or shown.
    const adult = await adultOnly(job) || job.request.adultLock === "on";
    const checks = await checkImages(made.map((m) => m.raw), "picture");
    if (stopped(job)) return;
    const decision = await gateFinished({ actor, kind: "picture", jobId: job.id, adultOnly: adult, checks, images: made.map((m) => m.raw), prompt: job.prompt });
    if (decision.action === "withhold") { fail(decision.line); return; }
    for (let index = 0; index < made.length; index += 1) {
      if (stopped(job)) { discardStored(storedIds); return; }
      const { raw, width, height, meta } = made[index]!;
      const conversationId = job.conversationId;
      const sourceId = job.request.source_file_id;
      const sourceRow = sourceId ? db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, sourceId)).get() : undefined;
      const sourceItem = sourceRow ? lockItemOfProvenance(sourceRow.owner, sourceRow.provenance) : null;
      const sourceOwner = sourceRow ? db.select().from(people).where(eq(people.id, sourceRow.owner)).get() as PersonRow | undefined : undefined;
      const finishSources: MarkSource[] = sourceItem ? [{ madeAudience: sourceItem.madeAudience, lock: sourceItem.lock }] : sourceOwner ? [unlabeledSourceMark(sourceOwner)] : sourceId ? [unlabeledSourceMark(actor)] : [{ madeAudience: "all-ages", lock: "off" }];
      // Fail closed: a job that started adult-only keeps that mark even when its source file is gone by now.
      const mark = job.request.adultLock === "on"
        ? { madeAudience: "adult-only" as const, lock: "on" as const }
        : job.request.adultLock === "off"
        ? newItemMark(finishSources, false)
        : newItemMark(finishSources, adult);
      if (job.request.edit) {
        // IMGEDIT-01: a change to a picture already in the chat is the next version of that picture (its Original and Undo stay in the editor).
        const source = loadSource(actor, conversationId ?? LIBRARY_SOURCE, job.request.edit.source_id, true);
        const version = await saveVersion(actor, source, raw, { op: "comment", audience: adult ? "adult-only" : undefined, label: job.request.edit.label, model: meta.model ?? undefined, ms: meta.ms ?? undefined });
        storedIds.push(version.id);
        files.push({ id: version.id, width: version.width ?? width, height: version.height ?? height, ...meta });
        continue;
      }
      if (job.temporary && conversationId) {
        const id = newFileId();
        storeTemporaryChatImage({ id, turnId: job.turnId ?? `gen-${job.id}`, conversationId, ownerPersonId: actor.id, name: "Generated picture", mediaType: "image/png", width, height, bytes: raw, audience: mark.madeAudience, generated: true });
        files.push({ id, width, height, ...meta });
        continue;
      }
      const turnExists = !!conversationId && !!job.turnId && await waitForTurnRow(job.turnId, job);
      if (stopped(job)) { discardStored(storedIds); return; }
      const creationId = newCreationId();
      const provenance = `picture-gen:${JSON.stringify({ v: 1, ...markFields(mark), creation: creationId, job: job.id, index, ...meta, width, height, ...(!turnExists && job.turnId ? { pendingTurnId: job.turnId } : {}), ...(job.request.subject_ids?.length ? { subjects: job.request.subject_ids } : {}) })}`;
      const created = turnExists && conversationId ? createAttachment(actor, { conversationId, turnId: job.turnId!, mediaType: "image/png", bytes: raw, provenance, deduplicate: false, retention: "conversation" }) : storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: raw, provenance, deduplicate: false, retention: "kept", name: "Generated picture" });
      if (!created.ok) {
        fail(created.status === 403 ? `${PICTURE_FAILED_PREFIX} Your storage is full. Delete some files in Settings, Storage, then try again.` : `${PICTURE_FAILED_PREFIX} The picture couldn't be saved. Try again.`);
        return;
      }
      storedIds.push(created.value.id);
      creationIds.set(created.value.id, creationId);
      if (mark.lock === "on") logAutoMark(created.value.id, actor.id);
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
  // CREATOR-02: the record of how each stored picture was made, written only now that the job has finished (never for a temporary chat, which stores no file).
  for (const file of files) { const creationId = creationIds.get(file.id); if (creationId) safely(() => recordPictureCreation(actor, job, file, creationId)); }
  const callback = generatedPictureCallbacks.get(job.id);
  generatedPictureCallbacks.delete(job.id);
  if (callback) for (const file of files) void callback(file.id).catch(() => undefined);
  // A stored cover may update its song, but never changes this picture's outcome.
  try { const { finishSongCover } = await import("@/lib/music/cover"); finishSongCover(job); } catch { /* optional cover linkage */ }
  try { const { finishBandPicture } = await import("@/lib/music/band"); finishBandPicture(job); } catch { /* optional band linkage */ }
  try { const { finishAlbumPicture } = await import("@/lib/music/album"); finishAlbumPicture(job); } catch { /* optional album linkage */ }
  if (stackJob) void cancelOrDelete(stackJob);
}

/** Stop a job. Safe to call twice; a finished job stays finished. */
export async function cancelPictureJob(actor: PersonRow, id: string): Promise<PictureJob | null> {
  const job = getPictureJob(actor, id);
  if (!job) return null;
  if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return job;
  generatedPictureCallbacks.delete(job.id);
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
    if (!person) { job.state = "failed"; job.error = `${PICTURE_FAILED_PREFIX} It did not finish. Try again.`; savePictureJob(job); continue; }
    if (!job.stackJob) { markLive(job); continue; }
    void watch(job, person as PersonRow);
  }
  void releaseHouseholdQueue();
}

/** What the file's owner may fetch: the picture's address inside its conversation. */
export function fileUrl(job: PictureJob, file: PictureFile): string {
  return pictureUrl(job.conversationId ?? "", file.id);
}
