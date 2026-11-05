// VIDEO-CHAT-01 and VIDEO-STUDIO-07: the ONE gate every edit of a finished clip goes through, in chat (`edit_video`: trim, join, mix) and on the
// Studio page (its Export). It holds what an edit may read and how it is marked: the surface and age gate with the screening of a typed voice line, the
// ownership and lock check of a source clip, the file of a clip, a song or a spoken line, and the audience floor (a new clip is never lower than any
// source). The two callers differ only in how they name the clips (a chat says "latest" or a job id; the page names Library files). Nothing here starts a job.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { readAttachment } from "@/lib/attachments";
import { fileAudience } from "@/lib/access";
import { lockItemOfProvenance, type MarkSource } from "@/lib/adultLock";
import { getMusicJobFor, readMusicFile } from "@/lib/music/jobs";
import { synthesizeRecordedSpeech } from "@/lib/tts";
import { listClonedVoices } from "@/lib/clonedVoices";
import { getOfferedVoices } from "@/lib/voiceResolve";
import { isPresetVoice, voiceForSpeech } from "@/lib/voiceForSpeech";
import { laneOf } from "@/lib/pictures/lane";
import { isAdultOnlyJob } from "@/lib/pictures/ageCheck";
import { videoJobLockState } from "./lock";
import { readVideoFile, type VideoJob } from "./jobs";
import { getLoraRecord } from "@/lib/loras/store";
import { videoRefusalFor, type VideoCallRefusal } from "./tool";
import type { VideoAudience } from "./policy";
import type { EditFile } from "./stackEdit";
import type { PersonRow } from "@/types";

export const EDIT_MINOR_LINE = "Making videos on the Create page is for adults. Ask an adult in your home to help.";

const EXTENSION_OF: Record<string, string> = { "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac", "audio/ogg": "ogg" };

/** The gate before anything is read: the surface and age gate, the screening of any typed words (a voice line, a remix's new words) like a prompt, and
 * the adult floor (cutting, joining and mixing are for adults on their own screen). Null when the edit may go on. */
export function editRefusal(audience: VideoAudience, typed: string): (VideoCallRefusal | { kind: "minor"; line: string }) | null {
  const refusal = videoRefusalFor(audience, { prompt: typed });
  if (refusal) return refusal;
  if (laneOf(audience) !== "adult") return { kind: "minor", line: EDIT_MINOR_LINE };
  return null;
}

/** A clip this person may edit: their own, finished, with a file, and open (not locked behind the Adult lock). */
export function editableClip(actor: PersonRow, job: VideoJob | null): VideoJob | null {
  if (!job || job.personId !== actor.id || job.state !== "done" || job.files.length === 0) return null;
  if (videoJobLockState(actor, job) !== "open") return null;
  return job;
}

/** The bytes of a clip's file; null for a clip in Trash, gone from the Library or not the person's. */
export function clipFileOf(actor: PersonRow, job: VideoJob): EditFile | null {
  const file = job.files[0];
  // A clip in Trash or gone from the Library is not edited.
  if (file && !job.temporary) { const row = db.select().from(attachments).where(eq(attachments.id, file.id)).get(); if (!row || row.deletedAt !== null || row.ownerPersonId !== actor.id) return null; }
  const read = file ? readVideoFile(actor, job, file.id) : null;
  return read ? { bytes: read.bytes, ext: "mp4" } : null;
}

/** ADULT-LOCK-06: the flags a source clip carries right now (design 3.10): from its Library file when it has one (so a lock the creator cleared since the job
 * ran counts as cleared), else from what the job was marked at its start. A saved clip whose note does not say all-ages counts as adult-only with the lock on. */
export async function clipMarkOf(job: VideoJob): Promise<MarkSource> {
  const file = job.files[0];
  if (file && !job.temporary) {
    const row = db.select().from(attachments).where(eq(attachments.id, file.id)).get();
    const item = row ? lockItemOfProvenance(row.ownerPersonId, row.provenance) : null;
    if (item) return { madeAudience: item.madeAudience, lock: item.lock };
    if (!row || fileAudience(row.provenance) !== "all-ages") return { madeAudience: "adult-only", lock: "on" };
    return { madeAudience: "all-ages", lock: "off" };
  }
  if (job.request.adultOnly === true) return { madeAudience: "adult-only", lock: job.request.adultLock ?? "on" };
  if (job.request.adultOnly === undefined && await isAdultOnlyJob(job.prompt, job.request.loras, async (id) => getLoraRecord(id)?.audience)) return { madeAudience: "adult-only", lock: "off" };
  return { madeAudience: "all-ages", lock: "off" };
}

/** A song or sound file of this person: their own music job (a temporary chat's only in that chat) or a file in their own Library. `track` is a music job
 * id or a Library file id. Returns the file and its audience flags, or null. */
export function ownTrackFile(actor: PersonRow, track: string, temporary: boolean, conversationId: string | null): { file: EditFile; mark: MarkSource; fileId: string | null } | null {
  const job = getMusicJobFor(actor, track);
  let fileId = track;
  if (job) {
    if (job.state !== "done" || !job.fileId || job.temporary !== temporary) return null;
    if (temporary && job.conversationId !== conversationId) return null;
    const read = job.conversationId ? readMusicFile(actor, job, job.fileId) : null;
    if (read) return { file: { bytes: read.bytes, ext: "m4a" }, mark: trackMark(job.fileId), fileId: job.fileId };
    if (temporary) return null;
    fileId = job.fileId;
  }
  // A temporary chat never uses a saved Library file.
  if (temporary) return null;
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id))).get();
  if (!row || row.deletedAt !== null || !row.mediaType.startsWith("audio/")) return null;
  const read = readAttachment(actor, fileId);
  return read.ok ? { file: { bytes: read.value.bytes, ext: EXTENSION_OF[row.mediaType] ?? "m4a" }, mark: trackMark(fileId), fileId } : null;
}

/** The flags a song carries: adult-only when its Library file says so (with the lock it has), else all-ages. */
export function trackMark(fileId: string | null): MarkSource {
  const row = fileId ? db.select().from(attachments).where(eq(attachments.id, fileId)).get() : null;
  if (row && fileAudience(row.provenance) === "adult-only") return { madeAudience: "adult-only", lock: lockItemOfProvenance(row.ownerPersonId, row.provenance)?.lock ?? "off" };
  return { madeAudience: "all-ages", lock: "off" };
}

/** The voice a line is spoken in: the person's own choice, or a household voice they named by id or name. */
export async function voiceChoice(actor: PersonRow, named: string | undefined): Promise<{ ok: true; voice: string } | { ok: false }> {
  if (!named) return { ok: true, voice: voiceForSpeech({ actor }) };
  const wanted = named.trim().toLowerCase();
  const household = listClonedVoices().find((voice) => voice.id.toLowerCase() === wanted || voice.label.trim().toLowerCase() === wanted);
  if (household) return { ok: true, voice: household.id };
  if (isPresetVoice(named)) return { ok: true, voice: named };
  const offered = (await getOfferedVoices())?.find((voice) => voice.id.toLowerCase() === wanted || voice.name.trim().toLowerCase() === wanted);
  return offered ? { ok: true, voice: offered.id } : { ok: false };
}

/** A typed line spoken by the home's text to speech; null when it cannot speak right now. */
export async function speakLine(line: string, voice: string): Promise<EditFile | null> {
  const spoken = await synthesizeRecordedSpeech(line, voice);
  if (!spoken.ok) return null;
  try {
    const bytes = new Uint8Array(await new Response(spoken.value.stream).arrayBuffer());
    return bytes.byteLength > 0 ? { bytes, ext: "wav" } : null;
  } catch { return null; }
}

/** An adult's typed line that the adult-only checks flag (a line is a source of the new clip: adult words make it adult-only). */
export async function lineMark(line: string): Promise<MarkSource | null> {
  return (await isAdultOnlyJob(line, [], async () => undefined)) ? { madeAudience: "adult-only", lock: "off" } : null;
}
