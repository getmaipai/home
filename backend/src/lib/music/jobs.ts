// Home owns the card and the files; the Stack owns generation. Temporary requests and audio never touch disk.
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { attachmentFilePath, createAttachment, readAttachmentForConversation, registerTemporaryMedia } from "@/lib/attachments";
import { checkStorageCap } from "@/lib/storage/usage";
import { newFileId, newMusicJobId } from "@/lib/id";
import type { PersonRow } from "@/types";
import { cancelOrDeleteMusic, musicBody, fetchSong, getMusicJob, StackMusicError, submitMusic, type MusicBody, type StackSong } from "./stack";
import { MUSIC_NOTE, generationOf, type GenerationProvenance, type MusicJob, type MusicRequest, type MusicTask } from "./types";
import { musicEngineStatus } from "./ready";
import { sungLyricsFromLrc } from "./sections";
import { startSongCover } from "./cover";
import { modelStampFor } from "./models";
import { provenanceFor } from "./commercial";
import { refuseMusicPrompt } from "./policy";
import { activeMusicJobsFor, dropMusicJob, dropTemporaryMusicConversation, getMusicJobFor, jobsForConversation, forgetRemovedMusicJob, liveJobs, memory, pendingMusicJobs, pruneMusicJobs, saveMusicJob, temporarySongs, watching } from "./store";
export { getMusicJobFor, musicJobIdsByTurn, __resetMusicJobsForTests } from "./store";
export type { MusicJob, MusicRequest } from "./types";

let POLL_MS = 1000;
export function __setMusicPollMsForTests(ms: number | null): void { POLL_MS = ms ?? 1000; }
const starting = new Set<string>();
export function plainMusicFailure(code: string): string {
  const prefix = "I couldn't make that song.";
  switch (code) {
    case "already_making": return "You already have a song being made. Wait for it to finish, or stop it first.";
    case "storage_full": return `${prefix} Your storage is full. Delete some files in Settings, Storage, then try again.`;
    case "no_memory": return `${prefix} Paused: this computer is low on memory. Close big apps, or try again in a few minutes.`;
    case "not_installed": return `${prefix} No music model is installed. An admin can add one in Settings, Pictures, videos and music.`;
    case "not_available_on_this_computer": return `${prefix} This computer can't run the music model. Try on a computer that can.`;
    case "source_not_made_here": return "I can only edit a song made here in this chat. Ask me to make one first.";
    case "bad_range": return `${prefix} That part is outside the song. Give the start and end in seconds.`;
    case "too_long": return `${prefix} That song is too long for this computer. Ask for a shorter one.`;
    case "timeout": return `${prefix} It took longer than expected. Try again, or ask for a shorter song.`;
    default: return `${prefix} The music engine did not finish it. Try again or change the request.`;
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
  actor: PersonRow; conversationId: string; turnId: string; temporary: boolean; task: MusicTask;
  request: MusicRequest; body: Omit<MusicBody, "timeout_ms">; parentFileId?: string | null;
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
  if (refuseMusicPrompt([input.request.description, input.request.lyrics, input.request.written_lyrics, input.request.title, input.request.key, input.request.language].join(" "))) throw new StackMusicError(422, "minor_sexual");
  if (starting.has(input.actor.id) || activeMusicJobsFor(input.actor)) throw new StackMusicError(429, "already_making");
  starting.add(input.actor.id);
  const priorAt = jobsForConversation(input.actor, input.conversationId, input.temporary).reduce((at, j) => Math.max(at, Date.parse(j.chosenAt ?? j.createdAt)), 0);
  const now = new Date(Math.max(Date.now(), priorAt + 1)).toISOString();
  const job: MusicJob = {
    id: newMusicJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, task: input.task, request: input.request,
    stackJob: null, state: "queued", stage: "queued", progress: 0, etaSeconds: null, position: null,
    coverJobId: null, coverFileId: null, errorCode: null, errorLine: null, fileId: null, parentFileId: input.parentFileId ?? null,
    seed: null, durationS: null, lrc: null, chosenAt: null, createdAt: now, updatedAt: now, temporary: input.temporary,
  };
  // Reserve before the network await: forgetting the turn during submit can abort admission too.
  liveJobs.set(job.id, job);
  try {
    const submitted = await submitMusic({ ...input.body, timeout_ms: 1 });
    // A stop (or a forget) that landed during the submit sticks: the Stack's copy is freed and no watcher starts.
    if (!liveJobs.has(job.id) || stopped(job)) { void cancelOrDeleteMusic(submitted.job); throw new StackMusicError(409, "cancelled"); }
    job.stackJob = submitted.job;
    try { saveMusicJob(job); } catch (error) { void cancelOrDeleteMusic(submitted.job); throw error; }
    if (stopped(job)) { void cancelOrDeleteMusic(submitted.job); throw new StackMusicError(409, "cancelled"); }
    void watch(job, input.actor, submitted.done);
    // The picture job takes its normal governor/admission path and remains optional to the song.
    void startSongCover(input.actor, job).catch(() => {});
    return job;
  } catch (error) { liveJobs.delete(job.id); forgetRemovedMusicJob(job.id); throw error; }
  finally { starting.delete(input.actor.id); }
}

function fail(job: MusicJob, code: string): void { job.state = "failed"; job.errorCode = code; job.errorLine = plainMusicFailure(code); saveMusicJob(job); }
const stopped = (job: MusicJob): boolean => job.state === "cancelled";
async function watch(job: MusicJob, actor: PersonRow, early: StackSong[] | null = null): Promise<void> {
  if (!job.stackJob || watching.has(job.id)) return;
  const controller = new AbortController(); watching.set(job.id, controller);
  const deadline = Date.now() + 25 * 60 * 1000;
  try {
    if (early && await finish(job, actor, early, controller.signal) !== false) return;
    while (!controller.signal.aborted && Date.now() < deadline) {
      let status;
      try { status = await getMusicJob(job.stackJob); }
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
      if (status.state === "failed" || (status.state === "cancelled" && status.code === "no_memory")) { fail(job, status.code ?? "failed"); return; }
      if (status.state === "cancelled") { job.state = "cancelled"; saveMusicJob(job); return; }
      job.state = status.state === "queued" ? "queued" : "running";
      // Stage labels come from a closed map at the card boundary, never from arbitrary Stack text.
      job.stage = job.request.retried && status.state === "queued" ? "longer" : status.stage ?? null; job.progress = Math.max(0, Math.min(0.99, status.progress_fraction ?? 0));
      job.etaSeconds = status.eta_seconds ?? null; job.position = status.position ?? null;
      saveMusicJob(job);
      if (stopped(job)) return; // a stop stored by another writer is adopted by saveMusicJob
      await sleep(POLL_MS, controller.signal);
    }
    if (!controller.signal.aborted) fail(job, "timeout");
  } catch (error) { if (!controller.signal.aborted) fail(job, error instanceof StackMusicError ? error.code : "failed"); }
  finally {
    watching.delete(job.id); liveJobs.delete(job.id); forgetRemovedMusicJob(job.id);
    await cancelOrDeleteMusic(job.stackJob);
  }
}
async function finish(job: MusicJob, actor: PersonRow, songs: StackSong[], signal: AbortSignal): Promise<false | void> {
  if (stopped(job)) return;
  const song = songs[0];
  if (!song || !Number.isFinite(song.duration_s) || !Number.isFinite(song.seed)) { fail(job, "bad_reply"); return; }
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
  const stamp = modelStampFor(job.task, song.model, job.parentFileId ? provenanceFor(job.parentFileId) : null);
  const provenance: GenerationProvenance = {
    kind: "music", job_id: job.id, task: job.task, ...stamp, seed: song.seed, duration_s: song.duration_s,
    bpm: song.bpm ?? job.request.bpm ?? null, key: song.key ?? job.request.key ?? null,
    parent_file_id: job.parentFileId, source_kind: job.parentFileId ? "made_here" : "none",
    made_at: new Date().toISOString(),
  };
  if (job.temporary) {
    job.fileId = newFileId();
    temporarySongs.set(job.fileId, { bytes, jobId: job.id, personId: job.personId, conversationId: job.conversationId!, createdAt: Date.parse(job.createdAt), provenance });
  } else {
    // A quick edit may finish before the turn is written. Forget aborts this wait and prevents resurrection.
    let turn = false;
    for (let i = 0; i < 120 && !signal.aborted; i++) {
      if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get()) { turn = true; break; }
      await sleep(500, signal);
    }
    if (signal.aborted) return;
    if (!turn) { fail(job, "lost_turn"); return; }
    const made = createAttachment(actor, { conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/mp4", bytes, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
    if (!made.ok) { fail(job, made.status === 403 ? "storage_full" : "save_failed"); return; }
    job.fileId = made.value.id;
  }
  job.seed = song.seed; job.durationS = song.duration_s; job.lrc = song.lrc ?? null;
  if (stopped(job)) return;
  job.state = "done"; job.stage = "ready"; job.progress = 1; job.etaSeconds = 0; job.errorCode = null; job.errorLine = null;
  saveMusicJob(job);
  void startSongCover(actor, job).catch(() => {});
}
export async function cancelMusicJob(actor: PersonRow, id: string): Promise<MusicJob | null> {
  const job = getMusicJobFor(actor, id);
  if (!job || !["queued", "running"].includes(job.state)) return job;
  // Drop it from the live set first: a submit still in flight sees the stop when it returns and frees the Stack's copy.
  watching.get(job.id)?.abort(); liveJobs.delete(job.id);
  job.state = "cancelled"; job.errorCode = null; job.errorLine = null; saveMusicJob(job);
  if (job.stackJob) await cancelOrDeleteMusic(job.stackJob);
  return job;
}
export function resumeMusicJobs(): void {
  for (const job of pendingMusicJobs()) {
    const person = db.select().from(people).where(eq(people.id, job.personId)).get();
    if (!person || !job.stackJob) { fail(job, "lost_job"); continue; }
    liveJobs.set(job.id, job); void watch(job, person);
  }
}
export function readMusicFile(actor: PersonRow, job: MusicJob, fileId: string): { bytes: Uint8Array; mediaType: string; sha256: string } | null {
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
    .where(and(eq(attachments.id, job.fileId), eq(attachments.ownerPersonId, actor.id), eq(attachments.conversationId, job.conversationId))).get();
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
  const songs = jobsForConversation(actor, root.conversationId, root.temporary).filter((j) => j.fileId && ownsMusicAttachment(actor, j));
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
