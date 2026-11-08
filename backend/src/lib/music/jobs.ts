// Home owns the card and the files; the Stack owns generation. Temporary requests and audio never touch disk.
import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { attachmentFilePath, createAttachment, readAttachment, readAttachmentForConversation, registerTemporaryMedia } from "@/lib/attachments";
import { checkStorageCap } from "@/lib/storage/usage";
import { newFileId, newMusicJobId } from "@/lib/id";
import type { PersonRow } from "@/types";
import { cancelOrDeleteMusic, deleteStemsJob, deleteVoiceConvertJob, musicBody, fetchSong, getMusicJob, StackMusicError, submitMusic, type MusicBody, type StackSong, submitStems, getStemsJob, fetchStem, type StackStem, stemsStatus, stemsStatusReady, submitVoiceConvert, getVoiceConvertJob, fetchConverted } from "./stack";
import { MUSIC_NOTE, generationOf, type GenerationProvenance, type MusicJob, type MusicRequest, type MusicTask } from "./types";
import { musicEngineStatus } from "./ready";
import { partsDoneLine, prepareMusicEdit } from "./tool";
import { sungLyricsFromLrc } from "./sections";
import { startSongCover } from "./cover";
import { startWordTiming } from "./timedWords";
import { modelStampFor } from "./models";
import { provenanceFor } from "./commercial";
import { m4aSeconds } from "./m4a";
import { mixMusicParts } from "./mixParts";
import { shapeSoundM4a } from "./soundAudio";
import { readClonedVoiceClip } from "@/lib/clonedVoices";
import { musicProtections } from "./policy";
import { routeAudience } from "@/lib/pictures/audience";
import { laneOf, CHILD_CONTENT_LINE, TEEN_CONTENT_LINE, markKidWithheld, attachKid, releaseKidForJob } from "@/lib/pictures/lane";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import { speakerAgeBand } from "@/lib/ageBand";
import { slotRun } from "@/lib/tiers";
import { requestTier, refreshHouseholdQueue, registerQueueProvider, releaseHouseholdQueue, requeueAfterCritical, holdMaxAfterMemoryRefusal, type QueueJob, PERSISTED_HOLDS, type PersistedHold } from "@/lib/jobs/householdQueue";
import { activeMusicJobsFor, dropMusicJob, dropTemporaryMusicConversation, getMusicJobFor, jobsForConversation, jobsForPerson, forgetRemovedMusicJob, liveJobs, memory, pendingMusicJobs, pruneMusicJobs, saveMusicJob as persistMusicJob, temporarySongs, watching } from "./store";
export { getMusicJobFor, jobsForConversation, jobsForPerson, musicJobIdsByTurn, __resetMusicJobsForTests } from "./store";
export type { MusicJob, MusicRequest } from "./types";

let POLL_MS = 1000;
export function __setMusicPollMsForTests(ms: number | null): void { POLL_MS = ms ?? 1000; }
const starting = new Set<string>();
function saveMusicJob(job: MusicJob): void { persistMusicJob(job); refreshHouseholdQueue(); }
registerQueueProvider(() => {
  const jobs = new Map<string, MusicJob>();
  for (const job of [...memory.values(), ...liveJobs.values()]) if (["queued", "running"].includes(job.state)) jobs.set(job.id, job);
  for (const job of pendingMusicJobs()) if (!jobs.has(job.id)) jobs.set(job.id, job);
  return [...jobs.values()].map((job) => {
    const request = job.request as MusicRequest & { memoryRequeues?: number };
    const phaseHold = PERSISTED_HOLDS.find((reason) => job.stage === `held:${reason}`) as QueueJob["riseReason"] | undefined;
    const queued: QueueJob = { id: job.id, personId: job.personId, jobClass: "other", category: "music", tier: requestTier(job.request), state: job.state === "running" ? "running" : "queued", createdAt: job.createdAt,
      position: job.position, estimateSeconds: job.etaSeconds, riseReason: phaseHold, typicalSeconds: 180, headOfClass: (request.memoryRequeues ?? 0) > 0 };
    return { job: queued, stackWaiting: job.state === "queued" && !!job.stackJob,
      applyFit: (fit) => { (job.request as { profile?: unknown }).profile = fit.profile; saveMusicJob(job); },
      stop: job.state === "running" ? async () => { const owner = db.select().from(people).where(eq(people.id, job.personId)).get(); if (owner) await cancelMusicJob(owner as PersonRow, job.id); } : undefined,
      release: job.state === "queued" && !job.stackJob ? () => releaseMusic(job) : undefined,
      save: () => { job.position = queued.position ?? null; if (queued.riseReason && PERSISTED_HOLDS.includes(queued.riseReason)) job.stage = `held:${queued.riseReason}`; else if (job.stage?.startsWith("held:")) job.stage = "queued"; persistMusicJob(job); } };
  });
});
/**
 * TIER-HOME-04: the Stack body of a song at the level it was queued at, with that level's saved slot read now (`slotRun`, lib/tiers.ts). A level
 * switched off since the song was queued is sent at Standard (the Quick maker, no tier). The music engine has one model, so the slot's model is
 * not sent; its options are not read by the engine (`SLOT_OPTIONS_READ`, shared/tierSlotOptions.ts).
 */
export function slotBodyFor(job: MusicJob, base: Omit<MusicBody, "timeout_ms">): Omit<MusicBody, "timeout_ms"> {
  const body = { ...base }; delete body.tier;
  if (body.task === "edit") return body;
  const owner = db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow | undefined;
  const run = slotRun("music", requestTier(job.request), owner ? speakerAgeBand(owner, new Date()) : "child");
  // A level switched off since the song was queued is made at the level below it (Max to Boost, then Standard); the request records what it really ran as.
  if (run.lowered) { const quality = run.tier === "standard" ? "quick" : "detailed"; body.quality = quality; const request = job.request as { quality?: string; tier?: string }; request.quality = quality; request.tier = run.tier; }
  if (run.tier === "boost" || run.tier === "max") body.tier = run.tier;
  return body;
}
async function releaseMusic(job: MusicJob): Promise<void> {
  if (job.state !== "queued" || job.stackJob) return;
  try {
    const storedBody = (job.request as MusicRequest & { stackBody?: Omit<MusicBody, "timeout_ms"> }).stackBody;
    const partsJob = !!job.request.parts;
    const submitted = job.task === "stems" || partsJob
      ? { job: await submitStems(storedBody?.source ?? "", storedBody?.source_sha256 ?? "", storedBody?.origin), done: null }
      : await submitMusic({ ...slotBodyFor(job, storedBody ?? musicBody(job.request, "text2music")), timeout_ms: 1 });
    if (job.state !== "queued" || !liveJobs.has(job.id)) { void cancelOrDeleteMusic(submitted.job); return; }
    job.stackJob = submitted.job; saveMusicJob(job);
    const actor = db.select().from(people).where(eq(people.id, job.personId)).get();
    if (!actor) { await cancelOrDeleteMusic(submitted.job); job.state = "failed"; fail(job, "lost_job"); return; }
    void watch(job, actor, submitted.done);
    if (job.task !== "stems" && !job.request.sound) void startSongCover(actor, job).catch(() => {});
  } catch (error) { if (error instanceof StackMusicError && (error.code === "queue_full" || (error.code === "no_memory" && holdMaxAfterMemoryRefusal(job.request)))) { job.stage = "queued"; persistMusicJob(job); return; } fail(job, error instanceof StackMusicError ? error.code : "failed"); }
}
export function plainMusicFailure(code: string): string {
  if (code === "voice_swap") return "The voice could not be changed. Try again in a minute.";
  if (code === "stems_unavailable") return "The stems could not be made. Try again in a minute.";
  if (code === "stems_failed") return "The stems could not be made. Try again in a minute.";
  const prefix = "I couldn't make that song.";
  switch (code) {
    case "coding_mode": return "Pictures, videos and songs will be back in a little while. Please try again later.";
    case "already_making": return "You already have a song being made. Wait for it to finish, or stop it first.";
    case "storage_full": return `${prefix} Your storage is full. Delete some files in Settings, Storage, then try again.`;
    case "no_memory": return `${prefix} ${jobQueueCopy("failed_memory", "low_memory_failure", null, null, "adult")}`;
    case "not_installed": return `${prefix} No music model is installed. An admin can add one in Settings, Pictures, videos and music.`;
    case "not_available_on_this_computer": return `${prefix} This computer can't run the music model. Try on a computer that can.`;
    case "source_not_made_here": return "I can only edit a song made here in this chat. Ask me to make one first.";
    case "bad_range": return `${prefix} That part is outside the song. Give the start and end in seconds.`;
    case "too_long": return `${prefix} That song is too long for this computer. Ask for a shorter one.`;
    case "timeout": return `${prefix} It took longer than expected. Try again, or ask for a shorter song.`;
    default: return `${prefix} The song did not finish. Try again or change the request.`;
  }
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true });
  });
}
export interface StartMusicInput {
  actor: PersonRow; conversationId: string; turnId: string; companionId?: string | null; temporary: boolean; task: MusicTask;
  request: MusicRequest; body: Omit<MusicBody, "timeout_ms">; parentFileId?: string | null; kidUsageId?: string | null;
}
/** Shared bytes and Stack body for both the edit_music tool and the song card's stems action. */
export async function prepareStemsJob(actor: PersonRow, source: MusicJob): Promise<{ ok: true; task: "stems"; request: MusicRequest; body: Omit<MusicBody, "timeout_ms"> } | { ok: false; status: 422 | 503; line: string }> {
  const status = await stemsStatus();
  if (!stemsStatusReady(status)) return { ok: false, status: 503, line: plainMusicFailure("stems_unavailable") };
  if (source.task === "stems" || !source.fileId) return { ok: false, status: 422, line: "A stem cannot be split again. Choose a song instead." };
  const file = readMusicFile(actor, source, source.fileId);
  if (!file) return { ok: false, status: 422, line: plainMusicFailure("source_not_made_here") };
  const plan = prepareMusicEdit(source, { track: source.fileId, change: "stems" });
  if (!plan.ok) return { ok: false, status: 422, line: plan.line };
  plan.body.source = Buffer.from(file.bytes).toString("base64");
  plan.body.source_sha256 = file.sha256;
  plan.body.task = "edit";
  return { ok: true, task: "stems", request: plan.request, body: plan.body };
}
/** TIER-STEMS-02b: an audio file in the person's own Library. Only theirs, never a song made here (that has its own card) and never a file shared with them. The bytes go to the local Stack and nowhere else. */
export const OWNED_STEMS_MAX_BYTES = 40 * 1024 * 1024;
type OwnedAudioRead = { ok: true; row: typeof attachments.$inferSelect; bytes: Uint8Array; sha256: string; seconds: number } | { ok: false; reason: "missing" | "generated" | "large" | "unreadable" };
/** Shared ownership, media, size and local-read check for the owned-audio tools. */
function readOwnedAudio(actor: PersonRow, fileId: string): OwnedAudioRead {
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  if (!row || !row.mediaType.startsWith("audio/")) return { ok: false, reason: "missing" };
  if (generationOf(row.provenance)) return { ok: false, reason: "generated" };
  if (row.size > OWNED_STEMS_MAX_BYTES) return { ok: false, reason: "large" };
  const read = readAttachment(actor, fileId);
  if (!read.ok) return { ok: false, reason: "unreadable" };
  const seconds = Math.min(720, Math.max(10, Math.round(row.size / 16_000)));
  return { ok: true, row, bytes: read.value.bytes, sha256: read.value.record.sha256, seconds };
}
/** Made-here songs in this conversation, or a non-generated audio file owned by this person. */
export function resolveSongSource(actor: PersonRow, track: string, conversationId: string, temporary = false): MusicJob | null {
  const made = sourceMusicJob(actor, conversationId, track, temporary);
  if (made || track === "latest") return made;
  const owned = readOwnedAudio(actor, track);
  if (!owned.ok) return null;
  const now = new Date().toISOString();
  return { id: `upload-${track}`, personId: actor.id, conversationId, turnId: null, task: "trim",
    request: { description: "", title: "Audio file", instrumental: false, seconds: owned.seconds, ownedFile: true },
    stackJob: null, state: "done", stage: null, progress: 1, etaSeconds: null, position: null, errorCode: null, errorLine: null,
    fileId: track, parentFileId: null, coverJobId: null, coverFileId: null, seed: null, durationS: owned.seconds, lrc: null,
    chosenAt: now, createdAt: now, updatedAt: now, temporary: false };
}
export async function prepareOwnedStemsJob(actor: PersonRow, fileId: string): Promise<{ ok: true; request: MusicRequest; body: Omit<MusicBody, "timeout_ms">; name: string } | { ok: false; status: 404 | 413 | 422 | 503; line: string }> {
  const owned = readOwnedAudio(actor, fileId);
  if (!owned.ok) {
    if (owned.reason === "generated") return { ok: false, status: 422, line: "That song was made in a chat. Open it there and choose Stems." };
    if (owned.reason === "large") return { ok: false, status: 413, line: "That file is too big to split. Try one under 40 MB." };
    return { ok: false, status: 404, line: "That file isn't available any more." };
  }
  if (!stemsStatusReady(await stemsStatus())) return { ok: false, status: 503, line: plainMusicFailure("stems_unavailable") };
  const name = (owned.row.name ?? "Audio file").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim().slice(0, 80) || "Audio file";
  return { ok: true, name,
    request: { description: "", instrumental: false, seconds: owned.seconds, title: name, ownedFile: true },
    body: { task: "edit", caption: "", duration_s: owned.seconds, source: Buffer.from(owned.bytes).toString("base64"), source_sha256: owned.sha256, origin: "owned_file" } };
}
export async function startMusicJob(input: StartMusicInput): Promise<MusicJob> {
  if (input.task === "text2music") {
    if (typeof input.request.description !== "string") throw new StackMusicError(422, "bad_description");
    // The persisted request is authoritative. Keep the submitted caption in sync with it.
    input.body.caption = input.request.description;
  }
  // Charge storage before admission, then check actual bytes again when saving. Temporary audio is memory only.
  const cap = checkStorageCap(input.actor.role, input.actor.id, Math.ceil(input.request.seconds * 32_000));
  if (!cap.ok) throw new StackMusicError(403, "storage_full");
  const protections = musicProtections(routeAudience(input.actor));
  // A teen's or child's song is always transcribed and checked as sung, whatever the caller set (design 18.7).
  if (protections.lane !== "adult") { input.request.transcribe = true; input.body.transcribe = true; }
  for (const [text, field] of [[input.request.description, "prompt"], [input.request.lyrics, "lyrics"], [input.request.written_lyrics, "lyrics"], [input.request.title, "title"]] as const) {
    if (text && protections.checkWords(text, field)) throw new StackMusicError(422, "minor_sexual");
  }
  if (starting.has(input.actor.id) || activeMusicJobsFor(input.actor)) throw new StackMusicError(429, "already_making");
  starting.add(input.actor.id);
  const priorAt = jobsForConversation(input.actor, input.conversationId, input.temporary).reduce((at, j) => Math.max(at, Date.parse(j.chosenAt ?? j.createdAt)), 0);
  const now = new Date(Math.max(Date.now(), priorAt + 1)).toISOString();
  const job: MusicJob = {
    id: newMusicJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, task: input.task, request: input.request,
    stackJob: null, state: "queued", stage: "queued", progress: 0, etaSeconds: null, position: null,
    coverJobId: null, coverFileId: null, errorCode: null, errorLine: null, fileId: null, parentFileId: input.parentFileId ?? null,
    seed: null, durationS: null, lrc: null, timedWords: null, chosenAt: null, createdAt: now, updatedAt: now, temporary: input.temporary,
  };
  (job.request as MusicRequest & { stackBody?: Omit<MusicBody, "timeout_ms"> }).stackBody = input.body;
  // Reserve before the network await: forgetting the turn during submit can abort admission too.
  liveJobs.set(job.id, job);
  attachKid(input.kidUsageId ?? null, job.id);
  try {
    saveMusicJob(job);
    void releaseHouseholdQueue();
    return job;
  } catch (error) { liveJobs.delete(job.id); forgetRemovedMusicJob(job.id); throw error; }
  finally { starting.delete(input.actor.id); }
}

function fail(job: MusicJob, code: string): void {
  if (code === "transcript_unavailable") {
    const actor = db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow | undefined;
    if (actor) { withholdMinor(job, actor); return; }
  }
  if (job.request.transcribe) releaseKidForJob(job.id);
  job.state = "failed"; job.errorCode = code; job.errorLine = job.request.voiceSwap ? plainMusicFailure("voice_swap") : job.request.parts || job.task === "stems" ? plainMusicFailure("stems_failed") : plainMusicFailure(code); saveMusicJob(job);
}
const stopped = (job: MusicJob): boolean => job.state === "cancelled";
async function watch(job: MusicJob, actor: PersonRow, early: StackSong[] | null = null): Promise<void> {
  if (!job.stackJob || watching.has(job.id)) return;
  const controller = new AbortController(); watching.set(job.id, controller);
  const deadline = Date.now() + 25 * 60 * 1000;
  try {
    if (early && await finish(job, actor, early, controller.signal) !== false) return;
    while (!controller.signal.aborted && Date.now() < deadline) {
      let status;
      try { status = job.task === "stems" || job.request.parts ? await getStemsJob(job.stackJob) : await getMusicJob(job.stackJob); }
      catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof StackMusicError && error.status === 404) { fail(job, "lost_job"); return; }
        await sleep(POLL_MS * 2, controller.signal); continue;
      }
      if (controller.signal.aborted || stopped(job)) return;
      if (status.state === "done") {
        if (await finish(job, actor, status.data ?? [], controller.signal) === false) continue;
        return;
      }
      if (status.state === "cancelled" && status.code === "no_memory") {
        const request = job.request as MusicRequest & { memoryRequeues?: number };
        const retries = request.memoryRequeues ?? 0;
        if (requeueAfterCritical({ requeues: retries }) === "requeue_head") { request.memoryRequeues = retries + 1; job.state = "queued"; job.stackJob = null; job.stage = "requeued_memory"; job.progress = 0; saveMusicJob(job); return; }
        fail(job, "no_memory"); return;
      }
      if (status.state === "failed") { if (status.code === "transcript_unavailable") withholdMinor(job, actor); else fail(job, status.code ?? "failed"); return; }
      if (status.state === "cancelled") { job.state = "cancelled"; saveMusicJob(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      // Stage labels come from a closed map at the card boundary, never from arbitrary Stack text.
      job.stage = job.request.retried && status.state === "queued" ? "longer" : status.stage ?? null; job.progress = Math.max(0, Math.min(0.99, status.progress_fraction ?? 0));
      job.etaSeconds = status.eta_seconds ?? null;
      saveMusicJob(job);
      if (stopped(job)) return; // a stop stored by another writer is adopted by saveMusicJob
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted) fail(job, "timeout");
  } catch (error) { if (!controller.signal.aborted) fail(job, error instanceof StackMusicError ? error.code : "failed"); }
  finally {
    watching.delete(job.id); if (job.state !== "queued") liveJobs.delete(job.id); forgetRemovedMusicJob(job.id);
    if (job.stackJob) {
      if (job.request.voiceSwap || job.request.parts) await deleteStemsJob(job.stackJob);
      else await cancelOrDeleteMusic(job.stackJob);
    }
    refreshHouseholdQueue();
  }
}
async function finish(job: MusicJob, actor: PersonRow, songs: StackSong[], signal: AbortSignal): Promise<false | void> {
  if (stopped(job)) return;
  const minorAudience = routeAudience(actor);
  const minorLane = laneOf(minorAudience) !== "adult";
  // Stems, parts and voice swaps are never offered to a minor and carry no transcript: withhold if one ever arrives.
  if (minorLane && (job.request.voiceSwap || job.request.parts || job.task === "stems")) { withholdMinor(job, actor); return; }
  if (job.request.voiceSwap) return finishVoiceSwap(job, actor, songs as unknown as StackStem[], signal);
  if (job.request.parts) return finishParts(job, actor, songs as unknown as StackStem[], signal);
  if (job.task === "stems") return finishStems(job, actor, songs as unknown as StackStem[], signal);
  const song = songs[0];
  if (!song || !Number.isFinite(song.duration_s) || !Number.isFinite(song.seed)) { fail(job, "bad_reply"); return; }
  if (minorLane || job.request.transcribe) {
    // Held in a local only: never stored, logged or traced.
    const transcript = song.transcript;
    if (!job.request.instrumental && (!transcript?.trim() || musicProtections(minorAudience).checkWords(transcript, "transcript"))) { withholdMinor(job, actor); return; }
  }
  if (!job.request.retried && ["text2music", "remake", "variation"].includes(job.task) && song.lrc
    && sungLyricsFromLrc(song.lrc, song.duration_s).length < sungLyricsFromLrc(song.lrc, null, { keepSqueezed: true }).length) {
    const ceiling = (await musicEngineStatus())?.limits.max_seconds ?? job.request.max_seconds;
    if (signal.aborted || stopped(job)) return;
    if (ceiling !== undefined && job.request.seconds < ceiling) {
      const previous = job.stackJob!;
      job.request.seconds = Math.min(ceiling, Math.round(job.request.seconds * 1.3));
      job.request.retried = true; job.request.max_seconds = ceiling;
      job.stage = "longer"; job.state = "running"; job.progress = 0; job.etaSeconds = null; job.position = null;
      saveMusicJob(job);
      await cancelOrDeleteMusic(previous);
      if (signal.aborted || stopped(job)) return;
      const submitted = await submitMusic({ ...musicBody(job.request, "text2music"), timeout_ms: 1 });
      if (signal.aborted || stopped(job)) { await cancelOrDeleteMusic(submitted.job); return; }
      job.stackJob = submitted.job; saveMusicJob(job);
      if (submitted.done) return finish(job, actor, submitted.done, signal);
      return false;
    }
  }
  const bytes = await fetchSong(job.stackJob!);
  if (signal.aborted) return;
  if (bytes.length < 12 || Buffer.from(bytes.subarray(4, 8)).toString() !== "ftyp") { fail(job, "bad_file"); return; }
  // The model comes from the Stack's own result, never from a constant: an unknown one is stamped unknown and never cleared.
  let soundBytes = bytes, soundSeconds = song.duration_s;
  const shape = job.request.sound;
  if (shape && (shape.loop || shape.trimTo)) {
    // A short or looping sound is shaped here, never by the model: cut to the asked length, then the tail is crossfaded into the head.
    // A host without an audio tool keeps the plain sound, and the card says it is not trimmed or not seamless.
    const shaped = await shapeSoundM4a(bytes, { trimTo: shape.trimTo, loop: shape.loop });
    if (signal.aborted) return;
    if (shape.loop) shape.looped = !!shaped;
    if (shape.trimTo) shape.trimmed = !!shaped;
    if (shaped) { soundBytes = shaped; soundSeconds = m4aSeconds(shaped) ?? (shape.trimTo ?? song.duration_s); }
  }
  const stamp = modelStampFor(job.request.sound ? "sfx" : job.task, song.model, job.parentFileId ? provenanceFor(job.parentFileId) : null);
  const provenance: GenerationProvenance = {
    kind: job.request.sound ? "sound" : "music", job_id: job.id, task: job.request.sound ? "sfx" : job.task, ...stamp, seed: song.seed, duration_s: soundSeconds,
    bpm: song.bpm ?? job.request.bpm ?? null, key: song.key ?? job.request.key ?? null,
    parent_file_id: job.request.ownedFile ? null : job.parentFileId, source_kind: job.request.ownedFile ? "upload" : job.parentFileId ? "made_here" : "none",
    made_at: new Date().toISOString(),
  };
  if (job.temporary) {
    job.fileId = newFileId();
    temporarySongs.set(job.fileId, { bytes: soundBytes, jobId: job.id, personId: job.personId, conversationId: job.conversationId!, createdAt: Date.parse(job.createdAt), provenance });
  } else {
    // A quick edit may finish before the turn is written. Forget aborts this wait and prevents resurrection.
    let turn = false;
    for (let i = 0; i < 120 && !signal.aborted; i++) {
      if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get()) { turn = true; break; }
      await sleep(500, signal);
    }
    if (signal.aborted) return;
    if (!turn) { fail(job, "lost_turn"); return; }
    const made = createAttachment(actor, { conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/mp4", bytes: soundBytes, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
    if (!made.ok) { fail(job, made.status === 403 ? "storage_full" : "save_failed"); return; }
    job.fileId = made.value.id;
  }
  job.seed = song.seed; job.durationS = soundSeconds; job.lrc = song.lrc ?? null;
  if (stopped(job)) return;
  job.state = "done"; job.stage = "ready"; job.progress = 1; job.etaSeconds = 0; job.errorCode = null; job.errorLine = null;
  saveMusicJob(job);
  if (job.request.sound) void startNextSoundTake(job, actor).catch(() => {});
  if (!job.request.sound) {
    void startSongCover(actor, job).catch(() => {});
    // MUSIC-GEN-20b: word timing runs in the background and never blocks or fails the song.
    void startWordTiming(job, bytes).catch(() => {});
  }
}
function withholdMinor(job: MusicJob, actor: PersonRow): void {
  if (job.stackJob) void cancelOrDeleteMusic(job.stackJob);
  job.fileId = null;
  job.state = "failed"; job.stage = "ready"; job.errorCode = "content_withheld";
  job.errorLine = laneOf(routeAudience(actor)) === "child" ? CHILD_CONTENT_LINE : TEEN_CONTENT_LINE;
  job.lrc = null; job.timedWords = null; markKidWithheld(job.id); saveMusicJob(job);
}
/** SOUNDS-FOLLOW-01: a request for up to three takes runs them one after another (a person has one music job at a time); each take is its own job and Library item. A take that fails or is stopped ends the run. */
async function startNextSoundTake(job: MusicJob, actor: PersonRow): Promise<void> {
  const sound = job.request.sound, takes = sound?.takes;
  if (!sound || !takes || takes.index + 1 >= takes.total || !job.conversationId || !job.turnId) return;
  const request: MusicRequest = { description: job.request.description, instrumental: true, lyrics: job.request.lyrics, seconds: job.request.seconds, quality: "quick", max_seconds: job.request.max_seconds,
    sound: { loop: sound.loop, surprise: sound.surprise, ...(sound.trimTo ? { trimTo: sound.trimTo } : {}), takes: { ...takes, index: takes.index + 1 } } };
  const body = musicBody(request, "text2music"); body.quality = "quick";
  await startMusicJob({ actor, conversationId: job.conversationId, turnId: job.turnId, companionId: job.companionId ?? null, temporary: job.temporary, task: "text2music", request, body, parentFileId: null });
}
/** SOUNDS-FOLLOW-01: save a finished job that was built outside the Stack (a sound laid into a song). */
export function saveFinishedMusicJob(job: MusicJob): void { saveMusicJob(job); }
async function finishStems(job: MusicJob, actor: PersonRow, stems: StackStem[], signal: AbortSignal): Promise<void> {
  if (!stems.length || stems.some((s) => !["vocals", "drums", "bass", "other"].includes(s.stem) || !s.url)) { fail(job, "bad_reply"); return; }
  let turn = false;
  for (let i = 0; i < 120 && !signal.aborted; i++) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get()) { turn = true; break; }
    await sleep(500, signal);
  }
  if (signal.aborted || stopped(job)) return;
  if (!turn) { fail(job, "lost_turn"); return; }
  const owned = job.request.ownedFile === true;
  const ownedStill = owned && !!job.parentFileId && !!db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.id, job.parentFileId), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  // A file the person owns has no generation record of its own: its stems carry an unknown model stamp and the "upload" source, so commercial use is never claimed and no edit takes them as a source.
  const parent: GenerationProvenance | null = owned
    ? (ownedStill ? { kind: "music", job_id: job.id, task: "trim" /* the pinned spec has no "stems" task value yet; the model stamp below is unknown and the source is "upload" */, ...modelStampFor("stems", null, null), seed: 0, duration_s: 0, bpm: null, key: null, parent_file_id: job.parentFileId, source_kind: "upload", made_at: new Date().toISOString() } : null)
    : (job.parentFileId ? provenanceFor(job.parentFileId) : null);
  if (!parent) { fail(job, owned ? "lost_job" : "source_not_made_here"); return; }
  const baseTitle = job.request.title ?? "Song"; const batch = job.id;
  for (let i = 0; i < stems.length; i++) {
    const stem = stems[i]!; const bytes = await fetchStem(stem.url);
    if (signal.aborted || stopped(job)) return;
    if (bytes.length < 12 || Buffer.from(bytes.subarray(4, 8)).toString() !== "ftyp") { fail(job, "bad_file"); return; }
    const target = i === 0 ? job : { ...job, id: newMusicJobId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), fileId: null, stackJob: null };
    const seconds = owned ? Math.round(m4aSeconds(bytes) ?? job.request.seconds) : job.request.seconds;
    const provenance: GenerationProvenance = { ...parent, job_id: target.id, duration_s: seconds, parent_file_id: job.parentFileId, source_kind: owned ? "upload" : "made_here", made_at: new Date().toISOString() };
    if (job.temporary) {
      target.fileId = newFileId(); temporarySongs.set(target.fileId, { bytes, jobId: target.id, personId: job.personId, conversationId: job.conversationId!, createdAt: Date.parse(target.createdAt), provenance });
    } else {
      const made = createAttachment(actor, { conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/mp4", bytes, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
      if (!made.ok) { fail(job, made.status === 403 ? "storage_full" : "save_failed"); return; }
      target.fileId = made.value.id;
    }
    target.request = { ...job.request, title: `${baseTitle} (${stem.stem})`, stemsOf: batch, instrumental: stem.stem !== "vocals", seconds };
    target.seed = parent.seed ?? job.seed ?? 0; target.durationS = seconds; target.state = "done"; target.stage = "ready"; target.progress = 1; target.etaSeconds = 0; target.errorCode = null; target.errorLine = null;
    persistMusicJob(target);
  }
  job.state = "done"; job.stage = "ready"; job.progress = 1; job.etaSeconds = 0; job.errorCode = null; job.errorLine = null;
  saveMusicJob(job);
}
async function finishParts(job: MusicJob, actor: PersonRow, stems: StackStem[], signal: AbortSignal): Promise<void> {
  const kept = job.request.parts;
  if (!kept || !stems.length || stems.some((s) => !["vocals", "drums", "bass", "other"].includes(s.stem) || !s.url)) { fail(job, "bad_reply"); return; }
  let turn = false;
  for (let i = 0; i < 120 && !signal.aborted; i++) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get()) { turn = true; break; }
    await sleep(500, signal);
  }
  if (signal.aborted || stopped(job)) return;
  if (!turn) { fail(job, "lost_turn"); return; }
  try {
    const fetched: Partial<Record<"vocals" | "drums" | "bass" | "other", Uint8Array>> = {};
    for (const stem of stems) if (kept.keep.includes(stem.stem)) fetched[stem.stem] = await fetchStem(stem.url);
    if (signal.aborted || stopped(job)) return;
    const bytes = await mixMusicParts(fetched, kept.keep);
    if (signal.aborted || stopped(job)) return;
    if (bytes.length < 12 || Buffer.from(bytes.subarray(4, 8)).toString() !== "ftyp") { fail(job, "bad_file"); return; }
    const owned = job.request.ownedFile === true;
    const parent = owned ? null : job.parentFileId ? provenanceFor(job.parentFileId) : null;
    if (!owned && !parent) { fail(job, "source_not_made_here"); return; }
    const seconds = Math.round(m4aSeconds(bytes) ?? job.request.seconds);
    const provenance: GenerationProvenance = { kind: "music", job_id: job.id, task: "trim", ...modelStampFor("trim", null, parent), seed: null, duration_s: seconds,
      bpm: parent?.bpm ?? null, key: parent?.key ?? null, parent_file_id: job.parentFileId, source_kind: owned ? "upload" : "made_here", made_at: new Date().toISOString() };
    if (job.temporary) {
      job.fileId = newFileId(); temporarySongs.set(job.fileId, { bytes, jobId: job.id, personId: job.personId, conversationId: job.conversationId!, createdAt: Date.parse(job.createdAt), provenance });
    } else {
      const made = createAttachment(actor, { conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/mp4", bytes, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
      if (!made.ok) { fail(job, made.status === 403 ? "storage_full" : "save_failed"); return; }
      job.fileId = made.value.id;
    }
    job.request = { ...job.request, title: job.request.title ?? "Song", instrumental: kept.keep.length === 1 && kept.keep[0] !== "vocals", seconds };
    job.durationS = seconds; job.seed = parent?.seed ?? null; job.state = "done"; job.stage = "ready"; job.progress = 1; job.etaSeconds = 0; job.errorCode = null; job.errorLine = null;
    saveMusicJob(job);
  } catch (error) { fail(job, error instanceof StackMusicError ? error.code : "stems_failed"); }
}
/** One job owns all private split and converted audio. Only the final mix is saved as a song. */
async function finishVoiceSwap(job: MusicJob, actor: PersonRow, stems: StackStem[], signal: AbortSignal): Promise<void> {
  const target = job.request.voiceSwap;
  if (!target || !stems.length || stems.some((s) => !["vocals", "drums", "bass", "other"].includes(s.stem) || !s.url)) { fail(job, "voice_swap"); return; }
  let turn = false;
  for (let i = 0; i < 120 && !signal.aborted; i++) {
    if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get()) { turn = true; break; }
    await sleep(500, signal);
  }
  if (signal.aborted || stopped(job)) return;
  if (!turn) { fail(job, "voice_swap"); return; }
  try {
    const reference = readClonedVoiceClip(target.voiceId);
    if (!reference) { fail(job, "voice_swap"); return; }
    const fetched: Partial<Record<"vocals" | "drums" | "bass" | "other", Uint8Array>> = {};
    for (const stem of stems) fetched[stem.stem] = await fetchStem(stem.url);
    const vocals = fetched.vocals;
    if (!vocals || !fetched.drums || !fetched.bass || !fetched.other || signal.aborted || stopped(job)) { if (!signal.aborted) fail(job, "voice_swap"); return; }
    job.stage = "voice-convert"; job.progress = 0.45; job.etaSeconds = null; saveMusicJob(job);
    const submitted = await submitVoiceConvert(Buffer.from(vocals).toString("base64"), Buffer.from(reference.bytes).toString("base64"));
    let convertedBytes: Uint8Array;
    try {
      let converted = submitted.done;
      const deadline = Date.now() + 20 * 60_000;
      while (!converted && Date.now() < deadline && !signal.aborted && !stopped(job)) {
        await sleep(POLL_MS, signal);
        const status = await getVoiceConvertJob(submitted.job);
        if (status.state === "done") converted = status.data ?? null;
        else if (status.state === "failed" || status.state === "cancelled") throw new StackMusicError(500, "voice_swap");
        else { job.stage = status.stage ?? "voice-convert"; job.progress = Math.max(0.45, Math.min(0.85, 0.45 + 0.4 * (status.progress_fraction ?? 0))); job.etaSeconds = status.eta_seconds ?? null; saveMusicJob(job); }
      }
      if (signal.aborted || stopped(job)) return;
      if (!converted) throw new StackMusicError(504, "voice_swap");
      convertedBytes = await fetchConverted(converted.url);
    } finally { await deleteVoiceConvertJob(submitted.job); }
    if (signal.aborted || stopped(job)) return;
    job.stage = "mix"; job.progress = 0.88; job.etaSeconds = null; saveMusicJob(job);
    const mixed = await mixMusicParts({ drums: fetched.drums, bass: fetched.bass, other: fetched.other, converted_vocals: convertedBytes }, ["drums", "bass", "other", "converted_vocals"]);
    if (signal.aborted || stopped(job)) return;
    if (mixed.length < 12 || Buffer.from(mixed.subarray(4, 8)).toString() !== "ftyp") { fail(job, "voice_swap"); return; }
    const owned = job.request.ownedFile === true;
    const parent = owned ? null : job.parentFileId ? provenanceFor(job.parentFileId) : null;
    if (!owned && !parent) { fail(job, "voice_swap"); return; }
    const seconds = Math.round(m4aSeconds(mixed) ?? job.request.seconds);
    const provenance: GenerationProvenance = { kind: "music", job_id: job.id, task: "cover",
      model: { id: "unknown", revision: "unknown", licence: "unknown" }, engine: { id: "unknown", version: "unknown" },
      commercial_use: "unknown", commercial_basis: "The voice conversion model is unknown, so its licence and training data are not cleared for commercial use.", seed: null,
      duration_s: seconds, bpm: parent?.bpm ?? null, key: parent?.key ?? null, parent_file_id: job.parentFileId,
      source_kind: owned ? "upload" : "made_here", made_at: new Date().toISOString() };
    if (job.temporary) {
      job.fileId = newFileId(); temporarySongs.set(job.fileId, { bytes: mixed, jobId: job.id, personId: job.personId, conversationId: job.conversationId!, createdAt: Date.parse(job.createdAt), provenance });
    } else {
      const made = createAttachment(actor, { conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/mp4", bytes: mixed, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
      if (!made.ok) { fail(job, made.status === 403 ? "storage_full" : "voice_swap"); return; }
      job.fileId = made.value.id;
    }
    job.request = { ...job.request, title: job.request.title ?? "Song", instrumental: false, seconds };
    job.durationS = seconds; job.seed = null; job.state = "done"; job.stage = "ready"; job.progress = 1; job.etaSeconds = 0; job.errorCode = null; job.errorLine = null; saveMusicJob(job);
  } catch { if (!signal.aborted) fail(job, "voice_swap"); }
}
export async function cancelMusicJob(actor: PersonRow, id: string): Promise<MusicJob | null> {
  const job = getMusicJobFor(actor, id);
  if (!job || !["queued", "running"].includes(job.state)) return job;
  // Drop it from the live set first: a submit still in flight sees the stop when it returns and frees the Stack's copy.
  watching.get(job.id)?.abort(); liveJobs.delete(job.id);
  if (job.request.transcribe) releaseKidForJob(job.id);
  job.state = "cancelled"; job.errorCode = null; job.errorLine = null; saveMusicJob(job);
  if (job.stackJob) await cancelOrDeleteMusic(job.stackJob);
  return job;
}
export function resumeMusicJobs(): void {
  for (const job of pendingMusicJobs()) {
    const person = db.select().from(people).where(eq(people.id, job.personId)).get();
    if (!person) { fail(job, "lost_job"); continue; }
    liveJobs.set(job.id, job);
    if (job.stackJob) void watch(job, person);
  }
  void releaseHouseholdQueue();
}
export function readMusicFile(actor: PersonRow, job: MusicJob, fileId: string): { bytes: Uint8Array; mediaType: string; sha256: string } | null {
  if (job.id.startsWith("upload-")) { // the synthetic source of resolveSongSource; finished jobs (stems, edits of an upload) read through the made-song path below
    if (job.personId !== actor.id || job.fileId !== fileId) return null;
    const owned = readOwnedAudio(actor, fileId);
    return owned.ok ? { bytes: owned.bytes, mediaType: owned.row.mediaType, sha256: owned.sha256 } : null;
  }
  if (job.personId !== actor.id || job.fileId !== fileId || !job.conversationId) return null;
  if (job.temporary) {
    pruneMusicJobs(); const song = temporarySongs.get(fileId);
    if (!song || song.personId !== actor.id || song.conversationId !== job.conversationId) return null;
    return { bytes: song.bytes, mediaType: "audio/mp4", sha256: createHash("sha256").update(song.bytes).digest("hex") };
  }
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id), eq(attachments.conversationId, job.conversationId))).get();
  if (!row || row.mediaType !== "audio/mp4" || !generationOf(row.provenance)) return null;
  const read = readAttachmentForConversation(actor, job.conversationId, fileId);
  return read.ok ? { bytes: read.value.bytes, mediaType: "audio/mp4", sha256: row.sha256 } : null;
}
export interface MusicFileHandle { size: number; mediaType: string; read(start: number, endExclusive: number): Uint8Array }
const verifiedFiles = new Map<string, { size: number; mtimeMs: number }>();
/**
 * The song's bytes for the file routes. The integrity hash runs once per file (and again only when the file's size or
 * modified time changes); Range slices are then read straight from the file, so seeking never re-reads and re-hashes
 * the whole song. Ownership is checked on every call.
 */
export function openMusicFile(actor: PersonRow, job: MusicJob, fileId: string): MusicFileHandle | null {
  if (job.personId !== actor.id || job.fileId !== fileId || !job.conversationId) return null;
  if (job.temporary) {
    pruneMusicJobs(); const song = temporarySongs.get(fileId);
    if (!song || song.personId !== actor.id || song.conversationId !== job.conversationId) return null;
    return { size: song.bytes.length, mediaType: "audio/mp4", read: (start, end) => song.bytes.subarray(start, end) };
  }
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id), eq(attachments.conversationId, job.conversationId))).get();
  if (!row || row.mediaType !== "audio/mp4" || !generationOf(row.provenance)) return null;
  const path = attachmentFilePath(row.storagePath);
  let stat; try { stat = statSync(path); } catch { verifiedFiles.delete(fileId); return null; }
  const seen = verifiedFiles.get(fileId);
  if (!seen || seen.size !== stat.size || seen.mtimeMs !== stat.mtimeMs || stat.size !== row.size) {
    verifiedFiles.delete(fileId);
    if (!readAttachmentForConversation(actor, job.conversationId, fileId).ok) return null;
    if (verifiedFiles.size >= 200) verifiedFiles.delete(verifiedFiles.keys().next().value!);
    verifiedFiles.set(fileId, { size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return { size: stat.size, mediaType: "audio/mp4", read: (start, end) => {
    const fd = openSync(path, "r");
    try { const size = fstatSync(fd).size; const out = Buffer.alloc(Math.max(0, Math.min(end, size) - start)); readSync(fd, out, 0, out.length, start); return new Uint8Array(out); }
    finally { closeSync(fd); }
  } };
}
/** Metadata only: the tool offer and card polling never load audio bytes or inspect wording. */
function ownsMusicAttachment(actor: PersonRow, job: MusicJob): boolean {
  if (job.personId !== actor.id || !job.fileId || !job.conversationId) return false;
  if (job.temporary) {
    const song = temporarySongs.get(job.fileId);
    return !!song && song.personId === actor.id && song.conversationId === job.conversationId;
  }
  const row = db.select({ provenance: attachments.provenance, mediaType: attachments.mediaType }).from(attachments)
    .where(and(eq(attachments.id, job.fileId), eq(attachments.ownerPersonId, actor.id), eq(attachments.conversationId, job.conversationId), isNull(attachments.deletedAt))).get();
  return row?.mediaType === "audio/mp4" && generationOf(row.provenance) !== null;
}
export function sourceMusicJob(actor: PersonRow, conversationId: string, track: string, temporary: boolean): MusicJob | null {
  const songs = jobsForConversation(actor, conversationId, temporary).filter((j) => j.state === "done" && j.fileId);
  if (track !== "latest") return songs.find((j) => j.fileId === track && ownsMusicAttachment(actor, j)) ?? null;
  return songs.sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt) || b.id.localeCompare(a.id)).find((j) => ownsMusicAttachment(actor, j)) ?? null;
}
export function conversationHasMusic(actor: PersonRow, conversationId: string, temporary: boolean): boolean { return sourceMusicJob(actor, conversationId, "latest", temporary) !== null; }
/** The connected version tree, scoped to the owner and this conversation. */
export function musicVersions(actor: PersonRow, root: MusicJob): MusicJob[] {
  if (root.personId !== actor.id || !root.conversationId) return [];
  // A stem is its own track, never a version of the song it was split from: it stays out of the song's family and has none of its own.
  if (root.task === "stems") return root.fileId && ownsMusicAttachment(actor, root) ? [root] : [];
  const songs = jobsForConversation(actor, root.conversationId, root.temporary).filter((j) => j.fileId && j.task !== "stems" && ownsMusicAttachment(actor, j));
  const ids = new Set([root.fileId, root.parentFileId].filter((id): id is string => !!id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of songs) if ((j.fileId && ids.has(j.fileId)) || (j.parentFileId && ids.has(j.parentFileId))) {
      for (const id of [j.fileId, j.parentFileId]) if (id && !ids.has(id)) { ids.add(id); changed = true; }
    }
  }
  return songs.filter((j) => ids.has(j.fileId!)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export function useMusicVersion(actor: PersonRow, root: MusicJob, fileId: string): MusicJob | null {
  const selected = musicVersions(actor, root).find((j) => j.fileId === fileId);
  if (!selected) return null;
  const newest = Math.max(Date.now(), ...musicVersions(actor, root).map((j) => Date.parse(j.chosenAt ?? j.createdAt)));
  selected.chosenAt = new Date(newest + 1).toISOString(); saveMusicJob(selected); return selected;
}
registerTemporaryMedia({
  removeConversation: dropTemporaryMusicConversation,
  removePerson: (id) => { for (const job of [...memory.values(), ...liveJobs.values()]) if (job.temporary && job.personId === id) dropMusicJob(job); },
  prune: (ids) => { pruneMusicJobs(); for (const job of [...memory.values(), ...liveJobs.values()]) if (job.temporary && (!job.conversationId || !ids.has(job.conversationId))) dropMusicJob(job); },
});
