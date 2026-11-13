// SOUNDS-FOLLOW-01: the takes of one sound request, and laying a made sound into one of the person's songs.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaItems } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { newMusicJobId } from "@/lib/id";
import type { PersonRow } from "@/types";
import { getMusicJobFor, jobsForPerson, musicVersions, readMusicFile, saveFinishedMusicJob } from "./jobs";
import { m4aSeconds } from "./m4a";
import { modelStampFor } from "./models";
import { provenanceFor } from "./commercial";
import { addSoundToSongM4a } from "./soundAudio";
import { MUSIC_NOTE, type GenerationProvenance, type MusicJob } from "./types";
import { musicJobLockState } from "./lock";

export interface SoundTake { job_id: string; index: number; total: number; state: MusicJob["state"]; file_id: string | null; src: string | null; saved: boolean; loop: boolean; seconds: number | null }

/** Every take of one request, in order. Only the person's own jobs are ever read. */
export function soundTakesOf(actor: PersonRow, group: string): SoundTake[] {
  const takes = jobsForPerson(actor, 200).filter((job) => job.request.sound?.takes?.group === group && musicJobLockState(job, actor) === "open");
  return takes.sort((a, b) => a.request.sound!.takes!.index - b.request.sound!.takes!.index).map((job) => {
    const fileId = job.state === "done" ? job.fileId : null;
    const gone = fileId ? !!db.select({ at: attachments.deletedAt }).from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id))).get()?.at : false;
    const saved = fileId ? !!db.select({ id: mediaItems.id }).from(mediaItems).where(and(eq(mediaItems.locFileId, fileId), eq(mediaItems.kind, "sound"), isNull(mediaItems.deletedAt))).get() : false;
    return { job_id: job.id, index: job.request.sound!.takes!.index, total: job.request.sound!.takes!.total, state: job.state, file_id: gone ? null : fileId,
      src: fileId && !gone ? `/api/files/${encodeURIComponent(fileId)}/content` : null, saved, loop: !!job.request.sound?.loop && job.request.sound.looped !== false, seconds: job.durationS };
  }).filter((take) => take.state !== "done" || take.file_id !== null);
}

export type AddSoundResult = { ok: true; root: MusicJob } | { ok: false; status: 404 | 422 | 503; line: string };
/** Lay a finished sound into a song at `startSeconds`, as a new version of the song. The earlier versions, the sound and its song stay as they were. */
export async function addSoundToSong(actor: PersonRow, input: { soundJobId: string; songId: string; fileId?: string; startSeconds: number }): Promise<AddSoundResult> {
  const sound = getMusicJobFor(actor, input.soundJobId);
  if (!sound || !sound.request.sound || sound.state !== "done" || !sound.fileId) return { ok: false, status: 404, line: "That sound isn't available any more. Make it again, then add it to a song." };
  const root = getMusicJobFor(actor, input.songId);
  if (!root || root.request.sound || root.task === "stems" || root.temporary) return { ok: false, status: 404, line: "That song isn't available any more. Pick a song from your list." };
  if (musicJobLockState(root, actor) !== "open") return { ok: false, status: 404, line: "That song isn't available any more. Pick a song from your list." };
  const versions = musicVersions(actor, root).filter((job) => job.state === "done" && job.fileId && job.task !== "stems");
  const source = (input.fileId ? versions.find((job) => job.fileId === input.fileId) : [...versions].sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt))[0]) ?? null;
  if (source && musicJobLockState(source, actor) !== "open") return { ok: false, status: 404, line: "That song isn't available any more. Pick a song from your list." };
  if (!source || !source.fileId || !source.conversationId || !source.turnId) return { ok: false, status: 404, line: "That song isn't available any more. Pick a song from your list." };
  const parent = provenanceFor(source.fileId);
  if (!parent) return { ok: false, status: 422, line: "Only songs made here can have a sound added. Pick one of your made songs." };
  const songFile = readMusicFile(actor, source, source.fileId), soundFile = readMusicFile(actor, sound, sound.fileId);
  if (!songFile || !soundFile) return { ok: false, status: 404, line: "The song or the sound could not be opened. Refresh the page and try again." };
  const songSeconds = m4aSeconds(songFile.bytes) ?? source.durationS ?? null;
  if (songSeconds !== null && input.startSeconds >= songSeconds) return { ok: false, status: 422, line: `The song is ${Math.floor(songSeconds)} seconds long. Pick a start time before the end of the song.` };
  let bytes: Uint8Array;
  try { bytes = await addSoundToSongM4a(songFile.bytes, soundFile.bytes, input.startSeconds); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "start_after_end") return { ok: false, status: 422, line: "Pick a start time before the end of the song." };
    return { ok: false, status: 503, line: code === "mix_unavailable" ? "This computer has no audio tool to mix the sound into the song. Install ffmpeg or use a Mac, then try again." : "The sound could not be mixed into the song. Try again, or pick another start time." };
  }
  if (bytes.length < 12 || Buffer.from(bytes.subarray(4, 8)).toString() !== "ftyp") return { ok: false, status: 503, line: "The sound could not be mixed into the song. Try again, or pick another start time." };
  const id = newMusicJobId();
  const seconds = Math.round(m4aSeconds(bytes) ?? songSeconds ?? source.request.seconds);
  const provenance: GenerationProvenance = { kind: "music", job_id: id, task: "trim", ...modelStampFor("trim", null, parent), seed: parent.seed ?? null, duration_s: seconds,
    bpm: parent.bpm ?? null, key: parent.key ?? null, parent_file_id: source.fileId, source_kind: "made_here", made_at: new Date().toISOString() };
  const made = createAttachment(actor, { conversationId: source.conversationId, turnId: source.turnId, mediaType: "audio/mp4", bytes, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
  if (!made.ok) return { ok: false, status: 422, line: made.status === 403 ? "There is no storage left for a new version. Free some space, then try again." : "The new version could not be saved. Try again." };
  const newest = Math.max(Date.now(), ...versions.map((job) => Date.parse(job.chosenAt ?? job.createdAt)));
  const now = new Date(newest + 1).toISOString();
  const { stackBody: _stackBody, takes: _takes, ...request } = source.request as typeof source.request & { stackBody?: unknown };
  const job: MusicJob = { id, personId: actor.id, conversationId: source.conversationId, turnId: source.turnId, companionId: source.companionId ?? null, task: "trim", request: { ...request, seconds },
    stackJob: null, state: "done", stage: "ready", progress: 1, etaSeconds: 0, position: null, errorCode: null, errorLine: null, fileId: made.value.id, parentFileId: source.fileId,
    coverJobId: null, coverFileId: null, seed: parent.seed ?? null, durationS: seconds, lrc: source.lrc, timedWords: null, chosenAt: now, createdAt: now, updatedAt: now, temporary: false };
  saveFinishedMusicJob(job);
  return { ok: true, root };
}
